// @vitest-environment node
/**
 * M5-T4/T5 — CheckinTeamMember admin DAL
 * (src/lib/db/adminCheckinTeamMember.ts). Spec: agents/docs/specs/
 * m5-attendees-checkin.md (T4 AC-4/AC-5/AC-6/AC-9; T5 AC-1/AC-9).
 *
 * Locks:
 *  - create persists ONLY the accessCodeHash — schema assertion: no raw
 *    code material in the doc; isActive true, lastSeenAt null
 *  - access-code exchange lookup: active-only, event-scoped; revoked and
 *    unknown codes are both null (no oracle); full generate -> hash ->
 *    lookup round-trip using the real scanner-session helpers
 *  - revoke: org-scoped isActive:false, idempotent, cross-org false
 *  - touch: bumps lastSeenAt
 *  - list: newest first, org-scoped, bounded; includes revoked rows
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

import { Timestamp } from "firebase-admin/firestore";

import {
  generateScannerAccessCode,
  hashScannerAccessCode,
} from "@/lib/qr/scanner-session";
import type { CheckinTeamMemberDoc } from "@/types/collection";

const {
  createAdminCheckinTeamMember,
  getAdminActiveCheckinTeamMemberByAccessCodeHash,
  getAdminCheckinTeamMemberForEvent,
  listAdminCheckinTeamMembersForEvent,
  revokeAdminCheckinTeamMember,
  touchAdminCheckinTeamMemberLastSeen,
} = await import("@/lib/db/adminCheckinTeamMember");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function seedMember(id: string, overrides: Partial<CheckinTeamMemberDoc> = {}) {
  fake.store.set(`CheckinTeamMember/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Maria",
    deviceLabel: "Door A",
    accessCodeHash: hashScannerAccessCode("GC7Q-4KXN-P2MB-9RTD"),
    isActive: true,
    lastSeenAt: null,
    createdAt: Timestamp.fromMillis(1_000),
    updatedAt: Timestamp.fromMillis(1_000),
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("createAdminCheckinTeamMember (T4 AC-4/AC-5)", () => {
  it("persists ONLY hash material — schema assertion, no raw code anywhere", async () => {
    const code = generateScannerAccessCode();
    const member = await createAdminCheckinTeamMember({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Maria",
      deviceLabel: "Door A",
      accessCodeHash: hashScannerAccessCode(code),
    });

    const stored = fake.store.get(`CheckinTeamMember/${member.id}`)!;
    expect(Object.keys(stored).sort()).toEqual(
      [
        "organizationId",
        "eventId",
        "name",
        "deviceLabel",
        "accessCodeHash",
        "isActive",
        "lastSeenAt",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(stored).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Maria",
      deviceLabel: "Door A",
      accessCodeHash: hashScannerAccessCode(code),
      isActive: true,
      lastSeenAt: null,
    });
    // The raw code never appears in any persisted value.
    for (const value of Object.values(stored)) {
      if (typeof value === "string") expect(value).not.toContain(code);
    }
  });
});

describe("getAdminActiveCheckinTeamMemberByAccessCodeHash (T5 AC-1)", () => {
  it("round-trips generate -> hash -> lookup, tolerant of entry format", async () => {
    const code = generateScannerAccessCode();
    const member = await createAdminCheckinTeamMember({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Maria",
      deviceLabel: "Door A",
      accessCodeHash: hashScannerAccessCode(code),
    });

    // Staff type it lowercase without dashes — same hash, same member.
    const found = await getAdminActiveCheckinTeamMemberByAccessCodeHash({
      eventId: EVENT_ID,
      accessCodeHash: hashScannerAccessCode(
        code.toLowerCase().replace(/-/g, " "),
      ),
    });

    expect(found).toMatchObject({ id: member.id, name: "Maria" });
  });

  it("returns null identically for unknown, revoked and cross-event codes (no oracle)", async () => {
    seedMember("tm-active");
    seedMember("tm-revoked", {
      isActive: false,
      accessCodeHash: hashScannerAccessCode("AAAA-BBBB-CCCC-DDDD"),
    });

    // Unknown code.
    expect(
      await getAdminActiveCheckinTeamMemberByAccessCodeHash({
        eventId: EVENT_ID,
        accessCodeHash: hashScannerAccessCode("ZZZZ-ZZZZ-ZZZZ-ZZZZ"),
      }),
    ).toBeNull();
    // Revoked member's (correct) code — indistinguishable from unknown.
    expect(
      await getAdminActiveCheckinTeamMemberByAccessCodeHash({
        eventId: EVENT_ID,
        accessCodeHash: hashScannerAccessCode("AAAA-BBBB-CCCC-DDDD"),
      }),
    ).toBeNull();
    // Right code, wrong event.
    expect(
      await getAdminActiveCheckinTeamMemberByAccessCodeHash({
        eventId: "evt-other",
        accessCodeHash: hashScannerAccessCode("GC7Q-4KXN-P2MB-9RTD"),
      }),
    ).toBeNull();
  });
});

describe("getAdminCheckinTeamMemberForEvent — the session revocation check (T5 AC-9)", () => {
  it("is org/event-scoped: cross-tenant ids read as null (IDOR-safe)", async () => {
    seedMember("tm-1");

    expect(
      await getAdminCheckinTeamMemberForEvent({
        teamMemberId: "tm-1",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toMatchObject({ id: "tm-1", isActive: true });
    expect(
      await getAdminCheckinTeamMemberForEvent({
        teamMemberId: "tm-1",
        eventId: "evt-other",
        organizationId: ORG_ID,
      }),
    ).toBeNull();
    expect(
      await getAdminCheckinTeamMemberForEvent({
        teamMemberId: "tm-1",
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toBeNull();
    expect(
      await getAdminCheckinTeamMemberForEvent({
        teamMemberId: "missing",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBeNull();
  });

  it("surfaces isActive:false after revoke — resolve/confirm 401 on it", async () => {
    seedMember("tm-1");

    await revokeAdminCheckinTeamMember({
      teamMemberId: "tm-1",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    const member = await getAdminCheckinTeamMemberForEvent({
      teamMemberId: "tm-1",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(member).toMatchObject({ isActive: false });
  });
});

describe("revokeAdminCheckinTeamMember (T4 AC-6)", () => {
  it("flips isActive to false, idempotently; cross-org returns false with no write", async () => {
    seedMember("tm-1");

    expect(
      await revokeAdminCheckinTeamMember({
        teamMemberId: "tm-1",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBe(true);
    expect(fake.store.get("CheckinTeamMember/tm-1")!.isActive).toBe(false);

    const writesAfterRevoke = fake.writes.length;
    // Idempotent second revoke: found, but no second write.
    expect(
      await revokeAdminCheckinTeamMember({
        teamMemberId: "tm-1",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBe(true);
    expect(fake.writes).toHaveLength(writesAfterRevoke);

    // Cross-org (IDOR-safe): false, untouched.
    seedMember("tm-2", { organizationId: "org-other" });
    expect(
      await revokeAdminCheckinTeamMember({
        teamMemberId: "tm-2",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBe(false);
    expect(fake.store.get("CheckinTeamMember/tm-2")!.isActive).toBe(true);
  });
});

describe("touchAdminCheckinTeamMemberLastSeen", () => {
  it("bumps lastSeenAt from its null start", async () => {
    seedMember("tm-1");
    expect(fake.store.get("CheckinTeamMember/tm-1")!.lastSeenAt).toBeNull();

    await touchAdminCheckinTeamMemberLastSeen("tm-1");

    expect(
      fake.store.get("CheckinTeamMember/tm-1")!.lastSeenAt,
    ).not.toBeNull();
  });
});

describe("listAdminCheckinTeamMembersForEvent", () => {
  it("lists newest first, org-scoped, bounded — revoked rows included", async () => {
    seedMember("tm-1", { createdAt: Timestamp.fromMillis(1_000) });
    seedMember("tm-2", {
      createdAt: Timestamp.fromMillis(2_000),
      isActive: false,
    });
    seedMember("tm-other-org", {
      organizationId: "org-other",
      createdAt: Timestamp.fromMillis(3_000),
    });
    seedMember("tm-other-evt", {
      eventId: "evt-other",
      createdAt: Timestamp.fromMillis(4_000),
    });

    const rows = await listAdminCheckinTeamMembersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(rows.map((r) => r.id)).toEqual(["tm-2", "tm-1"]);

    const bounded = await listAdminCheckinTeamMembersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 1,
    });
    expect(bounded.map((r) => r.id)).toEqual(["tm-2"]);
  });
});
