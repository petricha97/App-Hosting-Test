// @vitest-environment node
/**
 * M5-T2 — merged roster serialization + CSV builder (spec T2 AC-1/8/10):
 * - Attendee docs -> Accepted rows with the live check-in cell values;
 * - FormData with status ∈ {new, pending, reviewed} -> Pending rows; accepted
 *   FormData is EXCLUDED (its row comes from the Attendee source — the merge
 *   never double-counts a submission);
 * - merge sorts newest-first across both sources;
 * - the CSV shares the M3-T4 escaping rules (formula guard + RFC-4180).
 */
import { describe, expect, it } from "vitest";

import {
  formatCheckInTime,
  mergeRosterRows,
  parseRosterStatusFilter,
  serializeAttendeeRow,
  serializePendingRow,
  timestampToIso,
  timestampToMs,
} from "@/features/attendees/roster";
import { buildAttendeesCsv } from "@/features/attendees/csv";
import type { AttendeeDoc, FormDataDoc, WithId } from "@/types/collection";

function ts(ms: number) {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
  };
}

function makeAttendee(
  overrides: Partial<WithId<AttendeeDoc>> = {},
): WithId<AttendeeDoc> {
  return {
    id: "att-1",
    organizationId: "org-1",
    eventId: "evt-1",
    submissionId: "sub-1",
    orderId: "order-1",
    pathId: "path-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@dentsu.com",
    company: "Dentsu",
    jobTitle: "Engineer",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tick-1",
    ticketLabel: "General Admission",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "hash",
    createdAt: ts(2000),
    updatedAt: ts(2000),
    ...overrides,
  } as WithId<AttendeeDoc>;
}

function makeResponse(
  overrides: Partial<WithId<FormDataDoc>> = {},
): WithId<FormDataDoc> {
  return {
    id: "fd-1",
    formId: "form-1",
    eventId: "evt-1",
    organizationId: "org-1",
    submission: {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@navy.mil",
      company: "US Navy",
    },
    submittedAt: ts(1000),
    status: "new",
    ticketLabel: "VIP",
    ...overrides,
  } as WithId<FormDataDoc>;
}

describe("serializeAttendeeRow", () => {
  it("maps an attendee doc to an Accepted row with denorms and sort key", () => {
    const row = serializeAttendeeRow(makeAttendee());

    expect(row).toMatchObject({
      id: "att-1",
      kind: "attendee",
      name: "Ada Lovelace",
      email: "ada@dentsu.com",
      company: "Dentsu",
      ticketLabel: "General Admission",
      registrationTypeLabel: "Delegate",
      status: "accepted",
      checkInState: "not-arrived",
      checkedInAtIso: null,
      sortMs: 2000,
    });
  });

  it("carries the checked-in state + timestamp (T2 AC-10 column contract)", () => {
    const row = serializeAttendeeRow(
      makeAttendee({ checkInState: "checked-in", checkedInAt: ts(5000) }),
    );

    expect(row.checkInState).toBe("checked-in");
    expect(row.checkedInAtIso).toBe(new Date(5000).toISOString());
  });

  it("falls back to email, then 'Unnamed attendee', for blank names", () => {
    expect(
      serializeAttendeeRow(makeAttendee({ firstName: "", lastName: "" })).name,
    ).toBe("ada@dentsu.com");
    expect(
      serializeAttendeeRow(
        makeAttendee({ firstName: "", lastName: "", email: "" }),
      ).name,
    ).toBe("Unnamed attendee");
  });

  it("keeps the DAL's em-dash label fallbacks", () => {
    const row = serializeAttendeeRow(
      makeAttendee({ ticketLabel: "—", registrationTypeLabel: "—" }),
    );
    expect(row.ticketLabel).toBe("—");
    expect(row.registrationTypeLabel).toBe("—");
  });
});

describe("serializePendingRow", () => {
  it.each(["new", "pending", "reviewed"] as const)(
    "renders a %s submission as an amber Pending row with em-dash cells",
    (status) => {
      const row = serializePendingRow(makeResponse({ status }));

      expect(row).toMatchObject({
        kind: "pending",
        name: "Grace Hopper",
        email: "grace@navy.mil",
        company: "US Navy",
        ticketLabel: "VIP",
        registrationTypeLabel: null,
        status: "pending",
        checkInState: null,
        checkedInAtIso: null,
        sortMs: 1000,
      });
    },
  );

  it("returns null for accepted submissions (their row comes from the Attendee source)", () => {
    expect(serializePendingRow(makeResponse({ status: "accepted" }))).toBeNull();
  });

  it("treats legacy docs without a status field as pending (read-time 'new')", () => {
    const legacy = makeResponse();
    delete (legacy as Record<string, unknown>).status;
    expect(serializePendingRow(legacy)?.status).toBe("pending");
  });

  it("null ticketLabel stays null (the table renders the em dash)", () => {
    expect(
      serializePendingRow(makeResponse({ ticketLabel: null }))?.ticketLabel,
    ).toBeNull();
  });
});

describe("mergeRosterRows", () => {
  it("merges newest-first across both sources; rows without timestamps sort last", () => {
    const attendee = serializeAttendeeRow(makeAttendee()); // sortMs 2000
    const pending = serializePendingRow(makeResponse())!; // sortMs 1000
    const dateless = { ...pending, id: "fd-2", sortMs: null };
    const newest = { ...pending, id: "fd-3", sortMs: 3000 };

    const merged = mergeRosterRows([attendee], [pending, dateless, newest]);
    expect(merged.map((row) => row.id)).toEqual([
      "fd-3",
      "att-1",
      "fd-1",
      "fd-2",
    ]);
  });
});

describe("timestamp + filter helpers", () => {
  it("converts toDate-style and plain-seconds shapes; rejects garbage", () => {
    expect(timestampToIso(ts(1500))).toBe(new Date(1500).toISOString());
    expect(timestampToIso({ seconds: 2 })).toBe(new Date(2000).toISOString());
    expect(timestampToIso(null)).toBeNull();
    expect(timestampToIso("2026-01-01")).toBeNull();
    expect(timestampToMs(ts(1500))).toBe(1500);
    expect(timestampToMs(undefined)).toBeNull();
  });

  it("formats the check-in time as HH:MM (24h)", () => {
    // Construct 09:42 in LOCAL time so the assertion is TZ-independent.
    const local = new Date(2026, 0, 15, 9, 42);
    expect(formatCheckInTime(local.toISOString())).toBe("09:42");
  });

  it("parses only accepted/pending as roster filters", () => {
    expect(parseRosterStatusFilter("accepted")).toBe("accepted");
    expect(parseRosterStatusFilter("pending")).toBe("pending");
    expect(parseRosterStatusFilter("any")).toBeUndefined();
    expect(parseRosterStatusFilter(["pending"])).toBe("pending");
    expect(parseRosterStatusFilter(undefined)).toBeUndefined();
  });
});

describe("buildAttendeesCsv (T2 AC-8)", () => {
  it("emits the spec columns and escapes formula/CSV metacharacters", () => {
    const attendee = serializeAttendeeRow(
      makeAttendee({
        firstName: "=cmd()",
        lastName: "",
        company: "Acme, Inc",
        checkInState: "checked-in",
        checkedInAt: ts(5000),
      }),
    );
    const pending = serializePendingRow(makeResponse())!;

    const csv = buildAttendeesCsv([attendee, pending]);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(
      "Name,Email,Company,Ticket,Registration type,Status,Check-in,Checked-in at",
    );
    // Formula-injection guard: leading = gets the quote prefix; the comma in
    // the company cell triggers RFC-4180 quoting.
    expect(lines[1]).toContain("'=cmd()");
    expect(lines[1]).toContain('"Acme, Inc"');
    expect(lines[1]).toContain("checked-in");
    expect(lines[1]).toContain(new Date(5000).toISOString());
    // Pending row: empty check-in cells, pending status.
    expect(lines[2]).toContain("Grace Hopper");
    expect(lines[2]).toContain("pending");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
