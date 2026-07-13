// @vitest-environment node
/**
 * M5-T1/T2/T4/T5 — Attendee admin DAL (src/lib/db/adminAttendee.ts).
 * Spec: agents/docs/specs/m5-attendees-checkin.md (T1 AC-2/AC-8; T2 AC-2;
 * T4 AC-1; T5 AC-5/AC-6).
 *
 * Locks:
 *  - deterministic doc id (attendeeIdFromSubmissionId) — duplicate creates
 *    collapse onto one doc, second call performs ZERO writes
 *  - create initializes status "accepted", checkInState "not-arrived",
 *    null checkedInAt/checkedInBy; only qrTokenHash is stored (schema
 *    assertion — no raw token field)
 *  - org/event-scoped get: cross-tenant ids read as null (IDOR-safe)
 *  - list: newest first, bounded, Firestore-side status/checkInState
 *    filters, cursor; combined filters rejected (no index for that shape)
 *  - counts: aggregate count() — accepted total + checked-in
 *  - check-in: transactional idempotent flip — first call records
 *    checkedInAt/checkedInBy, duplicates return the ORIGINAL values with no
 *    write, cancelled -> CANCELLED, cross-org -> NOT_FOUND
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

import { Timestamp } from "firebase-admin/firestore";

import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";
import type { AttendeeDoc } from "@/types/collection";

const {
  checkInAdminAttendee,
  countAdminAttendeesForEvent,
  createAdminAttendeeIfAbsent,
  getAdminAttendeeByQrTokenHash,
  getAdminAttendeeBySubmissionId,
  getAdminAttendeeForEvent,
  listAdminAttendeesForEvent,
} = await import("@/lib/db/adminAttendee");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const SUBMISSION_ID = "sub-1";

const ATTENDEE_ID = attendeeIdFromSubmissionId({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  submissionId: SUBMISSION_ID,
});

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: SUBMISSION_ID,
    orderId: "ord-1",
    pathId: "path-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@dentsu.com",
    company: "Dentsu",
    jobTitle: "Engineer",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tt-1",
    ticketLabel: "VIP",
    qrTokenHash: "f".repeat(64),
    ...overrides,
  };
}

function seedAttendee(id: string, overrides: Partial<AttendeeDoc> = {}) {
  fake.store.set(`Attendee/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: SUBMISSION_ID,
    orderId: "ord-1",
    pathId: "path-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@dentsu.com",
    company: "Dentsu",
    jobTitle: "Engineer",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tt-1",
    ticketLabel: "VIP",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "f".repeat(64),
    createdAt: Timestamp.fromMillis(1_000),
    updatedAt: Timestamp.fromMillis(1_000),
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("createAdminAttendeeIfAbsent — deterministic id + idempotent replay (T1 AC-2)", () => {
  it("creates at the deterministic id with the T1 AC-8 initial state", async () => {
    const result = await createAdminAttendeeIfAbsent(createInput());

    expect(result.created).toBe(true);
    expect(result.attendeeId).toBe(ATTENDEE_ID);

    const stored = fake.store.get(`Attendee/${ATTENDEE_ID}`)!;
    expect(stored).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      orderId: "ord-1",
      pathId: "path-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@dentsu.com",
      company: "Dentsu",
      jobTitle: "Engineer",
      registrationTypeId: "rt-1",
      registrationTypeLabel: "Delegate",
      ticketTypeId: "tt-1",
      ticketLabel: "VIP",
      status: "accepted",
      checkInState: "not-arrived",
      checkedInAt: null,
      checkedInBy: null,
      qrTokenHash: "f".repeat(64),
    });
    expect(stored.createdAt).toBeDefined();
    expect(stored.updatedAt).toBeDefined();
  });

  it("stores ONLY the token hash — schema assertion, no raw token material (T1 AC-6)", async () => {
    await createAdminAttendeeIfAbsent(createInput());

    const stored = fake.store.get(`Attendee/${ATTENDEE_ID}`)!;
    expect(Object.keys(stored).sort()).toEqual(
      [
        "organizationId",
        "eventId",
        "submissionId",
        "orderId",
        "pathId",
        "firstName",
        "lastName",
        "email",
        "company",
        "jobTitle",
        "registrationTypeId",
        "registrationTypeLabel",
        "ticketTypeId",
        "ticketLabel",
        "status",
        "checkInState",
        "checkedInAt",
        "checkedInBy",
        "qrTokenHash",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });

  it("replays with ZERO writes: the second call returns the existing doc untouched (T1 AC-2)", async () => {
    await createAdminAttendeeIfAbsent(createInput());
    const writesAfterFirst = fake.writes.length;

    const replay = await createAdminAttendeeIfAbsent(
      // Even drifted denorms never rewrite an existing attendee.
      createInput({ firstName: "Changed", ticketLabel: "changed" }),
    );

    expect(replay.created).toBe(false);
    expect(replay.attendeeId).toBe(ATTENDEE_ID);
    expect(replay.attendee.firstName).toBe("Ada");
    expect(replay.attendee.ticketLabel).toBe("VIP");
    expect(fake.writes).toHaveLength(writesAfterFirst);
  });

  it("namespaces ids per (org, event, submission) with the Attendee domain prefix", () => {
    const base = {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
    };
    expect(attendeeIdFromSubmissionId(base)).toBe(ATTENDEE_ID);
    expect(
      attendeeIdFromSubmissionId({ ...base, submissionId: "other" }),
    ).not.toBe(ATTENDEE_ID);
    expect(
      attendeeIdFromSubmissionId({ ...base, organizationId: "org-2" }),
    ).not.toBe(ATTENDEE_ID);
    expect(attendeeIdFromSubmissionId({ ...base, eventId: "evt-2" })).not.toBe(
      ATTENDEE_ID,
    );
  });
});

describe("scoped reads (IDOR-safe)", () => {
  it("getAdminAttendeeForEvent returns null for missing, cross-org and cross-event ids", async () => {
    expect(
      await getAdminAttendeeForEvent({
        attendeeId: ATTENDEE_ID,
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBeNull();

    seedAttendee(ATTENDEE_ID);
    expect(
      await getAdminAttendeeForEvent({
        attendeeId: ATTENDEE_ID,
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toBeNull();
    expect(
      await getAdminAttendeeForEvent({
        attendeeId: ATTENDEE_ID,
        eventId: "evt-other",
        organizationId: ORG_ID,
      }),
    ).toBeNull();
    expect(
      await getAdminAttendeeForEvent({
        attendeeId: ATTENDEE_ID,
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toMatchObject({ id: ATTENDEE_ID, firstName: "Ada" });
  });

  it("getAdminAttendeeBySubmissionId resolves through the deterministic id (scanner resolve)", async () => {
    seedAttendee(ATTENDEE_ID);

    expect(
      await getAdminAttendeeBySubmissionId({
        submissionId: SUBMISSION_ID,
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toMatchObject({ id: ATTENDEE_ID });
    // Another tenant's derivation simply doesn't exist.
    expect(
      await getAdminAttendeeBySubmissionId({
        submissionId: SUBMISSION_ID,
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toBeNull();
  });

  it("getAdminAttendeeByQrTokenHash is event-scoped and null on no match", async () => {
    seedAttendee(ATTENDEE_ID, { qrTokenHash: "a".repeat(64) });

    expect(
      await getAdminAttendeeByQrTokenHash({
        eventId: EVENT_ID,
        qrTokenHash: "a".repeat(64),
      }),
    ).toMatchObject({ id: ATTENDEE_ID });
    expect(
      await getAdminAttendeeByQrTokenHash({
        eventId: "evt-other",
        qrTokenHash: "a".repeat(64),
      }),
    ).toBeNull();
    expect(
      await getAdminAttendeeByQrTokenHash({
        eventId: EVENT_ID,
        qrTokenHash: "b".repeat(64),
      }),
    ).toBeNull();
  });
});

describe("listAdminAttendeesForEvent (T2 roster)", () => {
  beforeEach(() => {
    seedAttendee("att-1", {
      submissionId: "s1",
      createdAt: Timestamp.fromMillis(1_000),
    });
    seedAttendee("att-2", {
      submissionId: "s2",
      createdAt: Timestamp.fromMillis(2_000),
      checkInState: "checked-in",
    });
    seedAttendee("att-3", {
      submissionId: "s3",
      createdAt: Timestamp.fromMillis(3_000),
      status: "cancelled",
    });
    seedAttendee("att-other-org", {
      submissionId: "s4",
      organizationId: "org-other",
      createdAt: Timestamp.fromMillis(4_000),
    });
    seedAttendee("att-other-evt", {
      submissionId: "s5",
      eventId: "evt-other",
      createdAt: Timestamp.fromMillis(5_000),
    });
  });

  it("returns the event's attendees newest first, org-scoped", async () => {
    const rows = await listAdminAttendeesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows.map((r) => r.id)).toEqual(["att-3", "att-2", "att-1"]);
  });

  it("pushes status and checkInState filters to Firestore", async () => {
    const accepted = await listAdminAttendeesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      status: "accepted",
    });
    expect(accepted.map((r) => r.id)).toEqual(["att-2", "att-1"]);

    const checkedIn = await listAdminAttendeesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      checkInState: "checked-in",
    });
    expect(checkedIn.map((r) => r.id)).toEqual(["att-2"]);
  });

  it("rejects combining both filters (no composite index for that shape)", async () => {
    await expect(
      listAdminAttendeesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        status: "accepted",
        checkInState: "checked-in",
      }),
    ).rejects.toThrow(/cannot be combined/);
  });

  it("bounds the page and honors the createdAt cursor (load more)", async () => {
    const page1 = await listAdminAttendeesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 2,
    });
    expect(page1.map((r) => r.id)).toEqual(["att-3", "att-2"]);

    const page2 = await listAdminAttendeesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 2,
      startAfterCreatedAtMs: 2_000,
    });
    expect(page2.map((r) => r.id)).toEqual(["att-1"]);
  });
});

describe("countAdminAttendeesForEvent — aggregate counts (T2 AC-2 / T4 AC-1)", () => {
  it("counts accepted and checked-in attendees org-scoped", async () => {
    seedAttendee("att-1", { submissionId: "s1" });
    seedAttendee("att-2", { submissionId: "s2", checkInState: "checked-in" });
    seedAttendee("att-3", { submissionId: "s3", status: "cancelled" });
    seedAttendee("att-x", { submissionId: "s4", organizationId: "org-other" });

    expect(
      await countAdminAttendeesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        status: "accepted",
      }),
    ).toBe(2);
    expect(
      await countAdminAttendeesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        checkInState: "checked-in",
      }),
    ).toBe(1);
    expect(
      await countAdminAttendeesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBe(3);
  });
});

describe("checkInAdminAttendee — idempotent transactional flip (T5 AC-5/AC-6)", () => {
  const ADMIN_SCANNER = { kind: "admin", userId: "ada@dentsu.com" } as const;
  const TEAM_SCANNER = {
    kind: "team-member",
    teamMemberId: "tm-1",
    name: "Maria",
  } as const;

  it("flips exactly once: records checkInState + checkedInAt + checkedInBy", async () => {
    seedAttendee(ATTENDEE_ID);

    const result = await checkInAdminAttendee({
      attendeeId: ATTENDEE_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      checkedInBy: TEAM_SCANNER,
    });

    expect(result).toMatchObject({ ok: true, alreadyCheckedIn: false });
    const stored = fake.store.get(`Attendee/${ATTENDEE_ID}`)!;
    expect(stored.checkInState).toBe("checked-in");
    expect(stored.checkedInAt).toBeDefined();
    expect(stored.checkedInBy).toEqual(TEAM_SCANNER);
  });

  it("duplicate confirm returns ALREADY with the ORIGINAL scanner + timestamp, ZERO writes", async () => {
    const originalAt = Timestamp.fromMillis(9_000);
    seedAttendee(ATTENDEE_ID, {
      checkInState: "checked-in",
      checkedInAt: originalAt,
      checkedInBy: TEAM_SCANNER,
    });
    const writesBefore = fake.writes.length;

    // A different scanner double-taps — the first record is never overwritten.
    const result = await checkInAdminAttendee({
      attendeeId: ATTENDEE_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      checkedInBy: ADMIN_SCANNER,
    });

    expect(result).toMatchObject({
      ok: true,
      alreadyCheckedIn: true,
      checkedInAt: originalAt,
      checkedInBy: TEAM_SCANNER,
    });
    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.get(`Attendee/${ATTENDEE_ID}`)!.checkedInBy).toEqual(
      TEAM_SCANNER,
    );
  });

  it("first-then-duplicate sequence is race-shaped: one write, original preserved", async () => {
    seedAttendee(ATTENDEE_ID);

    const first = await checkInAdminAttendee({
      attendeeId: ATTENDEE_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      checkedInBy: ADMIN_SCANNER,
    });
    const writesAfterFirst = fake.writes.length;
    const second = await checkInAdminAttendee({
      attendeeId: ATTENDEE_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      checkedInBy: TEAM_SCANNER,
    });

    expect(first).toMatchObject({ ok: true, alreadyCheckedIn: false });
    expect(second).toMatchObject({
      ok: true,
      alreadyCheckedIn: true,
      checkedInBy: ADMIN_SCANNER,
    });
    expect(fake.writes).toHaveLength(writesAfterFirst);
  });

  it("returns CANCELLED for cancelled attendees, no write", async () => {
    seedAttendee(ATTENDEE_ID, { status: "cancelled" });
    const writesBefore = fake.writes.length;

    const result = await checkInAdminAttendee({
      attendeeId: ATTENDEE_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      checkedInBy: ADMIN_SCANNER,
    });

    expect(result).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.get(`Attendee/${ATTENDEE_ID}`)!.checkInState).toBe(
      "not-arrived",
    );
  });

  it("returns NOT_FOUND for missing, cross-org and cross-event ids (IDOR-safe)", async () => {
    expect(
      await checkInAdminAttendee({
        attendeeId: ATTENDEE_ID,
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        checkedInBy: ADMIN_SCANNER,
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });

    seedAttendee(ATTENDEE_ID, { organizationId: "org-other" });
    expect(
      await checkInAdminAttendee({
        attendeeId: ATTENDEE_ID,
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        checkedInBy: ADMIN_SCANNER,
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });

    fake.reset();
    seedAttendee(ATTENDEE_ID, { eventId: "evt-other" });
    expect(
      await checkInAdminAttendee({
        attendeeId: ATTENDEE_ID,
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        checkedInBy: ADMIN_SCANNER,
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(fake.writes).toHaveLength(0);
  });
});
