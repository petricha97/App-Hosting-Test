/**
 * M5-T4/T5 — pure check-in helpers:
 * - isEventStartInFuture: the "event not started" caption rule (T4 AC-1),
 *   tolerant of legacy period key spellings, fail-quiet without dates;
 * - serializeActiveTeamMembers: drops revoked rows, never leaks
 *   accessCodeHash (T4 AC-4);
 * - outcomeFromResolve/Confirm: the resolve->takeover mapping, including the
 *   already-checked-in short-circuit (a second scan never shows "Check in").
 */
import { describe, expect, it } from "vitest";

import {
  outcomeFromConfirm,
  outcomeFromResolve,
  type ScanAttendeeCard,
} from "@/features/checkin/scan-types";
import {
  isEventStartInFuture,
  serializeActiveTeamMembers,
} from "@/features/checkin/utils";
import type { CheckinTeamMemberDoc, WithId } from "@/types/collection";

describe("isEventStartInFuture (T4 AC-1 caption rule)", () => {
  const now = new Date("2026-07-11T12:00:00");

  it("true when the earliest period start is in the future", () => {
    expect(
      isEventStartInFuture(
        { periods: [{ date: "2026-09-01", startTime: "09:00" }] },
        now,
      ),
    ).toBe(true);
  });

  it("false once the earliest period has started (multi-period events)", () => {
    expect(
      isEventStartInFuture(
        {
          periods: [
            { date: "2026-09-02", startTime: "09:00" },
            { date: "2026-07-11", startTime: "08:00" },
          ],
        },
        now,
      ),
    ).toBe(false);
  });

  it("resolves legacy key spellings (start / start_time)", () => {
    expect(
      isEventStartInFuture(
        { periods: [{ start: "2026-12-01", start_time: "10:00" }] },
        now,
      ),
    ).toBe(true);
  });

  it("fails quiet (false) when no period has a parseable date", () => {
    expect(isEventStartInFuture({ periods: [] }, now)).toBe(false);
    expect(isEventStartInFuture({ periods: [{ label: "TBD" }] }, now)).toBe(
      false,
    );
  });
});

describe("serializeActiveTeamMembers (T4 AC-4)", () => {
  const base: WithId<CheckinTeamMemberDoc> = {
    id: "m1",
    organizationId: "org-1",
    eventId: "evt-1",
    name: "Maria",
    deviceLabel: "Door A",
    accessCodeHash: "super-secret-hash",
    isActive: true,
    lastSeenAt: null,
    createdAt: { toDate: () => new Date(0) } as never,
    updatedAt: { toDate: () => new Date(0) } as never,
  };

  it("drops revoked members and NEVER emits code material", () => {
    const rows = serializeActiveTeamMembers([
      base,
      { ...base, id: "m2", isActive: false },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "m1",
      name: "Maria",
      deviceLabel: "Door A",
      lastSeenAtIso: null,
    });
    expect(JSON.stringify(rows)).not.toContain("super-secret-hash");
  });

  it("serializes lastSeenAt timestamps to ISO", () => {
    const rows = serializeActiveTeamMembers([
      {
        ...base,
        lastSeenAt: { toDate: () => new Date(1700000000000) } as never,
      },
    ]);
    expect(rows[0].lastSeenAtIso).toBe(new Date(1700000000000).toISOString());
  });
});

describe("scan outcome mapping", () => {
  const card: ScanAttendeeCard = {
    name: "Ada",
    registrationTypeLabel: "Delegate",
    ticketLabel: "GA",
    checkInState: "not-arrived",
    checkedInAtIso: null,
    checkedInByName: null,
  };

  it("OK + not-arrived resolves to the confirmable card", () => {
    expect(outcomeFromResolve({ status: "OK", attendee: card })).toEqual({
      kind: "resolved",
      attendee: card,
    });
  });

  it("OK + already checked in short-circuits to the amber variant (AC-6)", () => {
    const checkedIn: ScanAttendeeCard = {
      ...card,
      checkInState: "checked-in",
      checkedInAtIso: "2026-07-11T09:42:00.000Z",
      checkedInByName: "Maria",
    };
    expect(outcomeFromResolve({ status: "OK", attendee: checkedIn })).toEqual({
      kind: "already",
      attendee: checkedIn,
      checkedInAtIso: "2026-07-11T09:42:00.000Z",
      checkedInByName: "Maria",
    });
  });

  it("maps the four non-OK states 1:1", () => {
    expect(outcomeFromResolve({ status: "WRONG_EVENT" }).kind).toBe(
      "wrong-event",
    );
    expect(outcomeFromResolve({ status: "INVALID" }).kind).toBe("invalid");
    expect(outcomeFromResolve({ status: "NOT_ACCEPTED" }).kind).toBe(
      "not-accepted",
    );
    expect(outcomeFromResolve({ status: "CANCELLED" }).kind).toBe("cancelled");
  });

  it("confirm responses map to checked-in / already with the record intact", () => {
    expect(
      outcomeFromConfirm({
        status: "CHECKED_IN",
        attendee: card,
        checkedInAtIso: "2026-07-11T10:00:00.000Z",
      }),
    ).toEqual({
      kind: "checked-in",
      attendee: card,
      checkedInAtIso: "2026-07-11T10:00:00.000Z",
    });

    expect(
      outcomeFromConfirm({
        status: "ALREADY_CHECKED_IN",
        attendee: card,
        checkedInAtIso: "2026-07-11T09:42:00.000Z",
        checkedInByName: "Maria",
      }),
    ).toMatchObject({ kind: "already", checkedInByName: "Maria" });
  });
});
