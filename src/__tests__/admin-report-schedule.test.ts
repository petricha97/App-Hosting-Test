// @vitest-environment node
/**
 * M7-T3 — src/lib/db/adminReportSchedule.ts. Spec:
 * agents/docs/specs/m7-scheduled-reports.md §2/§4.
 *
 * Locks:
 *  - upsert is a create-if-absent onto the deterministic (org, event,
 *    templateSlug) id — a second "create" call for the same template
 *    UPDATES the existing doc, never creates a second one
 *  - every recipient is independently re-verified via
 *    verifyReportScheduleRecipient before ANY write — a non-member email
 *    (typo, ex-member, or a real member of a DIFFERENT org) is rejected
 *    all-or-nothing, zero write
 *  - the matched member's REAL name is stored, never a client-supplied one
 *  - a 21st recipient is rejected (cap), not silently truncated
 *  - list/get are org+event scoped (cross-org access returns null/empty)
 *  - delete is a hard delete, NOT_FOUND on cross-org/unknown id
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  deleteAdminReportSchedule,
  getAdminReportScheduleByTemplate,
  getAdminReportScheduleForEvent,
  listAdminReportSchedulesForEvent,
  upsertAdminReportSchedule,
  verifyReportScheduleRecipient,
} = await import("@/lib/db/adminReportSchedule");
const { reportScheduleId } = await import("@/lib/db/reportScheduleId");

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";
const EVENT_ID = "evt-1";
const TEMPLATE = "registration-overview";

function seedMember(
  email: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
): void {
  fake.store.set(`User/${email}`, {
    uid: `uid-${email}`,
    name: overrides.name ?? "Real Member Name",
    email,
    organizationId,
    organizationRole: "member",
    organizations: [
      {
        organizationId,
        role: "member",
        joinedAt: { seconds: 1 },
        joinMethod: "invite_link",
      },
    ],
    emailVerified: true,
    status: "active",
    permissions: ["view:events"],
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

function validPatch(overrides: Record<string, unknown> = {}) {
  return {
    frequency: "daily",
    dayOfWeek: null,
    dayOfMonth: null,
    hour: 9,
    minute: 0,
    recipientEmails: ["member@example.com"],
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
});

describe("verifyReportScheduleRecipient", () => {
  it("returns the matched member's REAL name for a current org member", async () => {
    seedMember("member@example.com", ORG_ID, { name: "Ada Lovelace" });

    const result = await verifyReportScheduleRecipient(
      "member@example.com",
      ORG_ID,
    );

    expect(result).toEqual({
      email: "member@example.com",
      name: "Ada Lovelace",
    });
  });

  it("returns null for an email with no membership anywhere", async () => {
    const result = await verifyReportScheduleRecipient(
      "nobody@example.com",
      ORG_ID,
    );
    expect(result).toBeNull();
  });

  it("returns null for a real member of a DIFFERENT org (cross-tenant IDOR case)", async () => {
    seedMember("member@example.com", OTHER_ORG_ID);

    const result = await verifyReportScheduleRecipient(
      "member@example.com",
      ORG_ID,
    );
    expect(result).toBeNull();
  });

  it("is case-insensitive on the candidate email", async () => {
    seedMember("member@example.com", ORG_ID, { name: "Ada Lovelace" });

    const result = await verifyReportScheduleRecipient(
      "MEMBER@EXAMPLE.com",
      ORG_ID,
    );
    expect(result?.email).toBe("member@example.com");
  });
});

describe("upsertAdminReportSchedule", () => {
  it("creates a new schedule at the deterministic (org, event, template) id", async () => {
    seedMember("member@example.com", ORG_ID);

    const result = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.schedule.id).toBe(
      reportScheduleId({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        templateSlug: TEMPLATE,
      }),
    );
    expect(result.schedule.recipients).toEqual([
      { email: "member@example.com", name: "Real Member Name" },
    ]);
    expect(result.schedule.createdBy).toBe("organizer@example.com");
  });

  it("a second create call for the SAME (event, template) UPDATES, never creates a second doc", async () => {
    seedMember("member@example.com", ORG_ID);

    const first = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch({ frequency: "daily" }),
    });
    expect(first.ok && first.created).toBe(true);

    const second = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch({
        frequency: "weekly",
        dayOfWeek: 2,
      }),
    });
    expect(second.ok && second.created).toBe(false);

    const schedules = await listAdminReportSchedulesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(schedules).toHaveLength(1);
    expect(schedules[0].frequency).toBe("weekly"); // the SECOND call's config wins
  });

  it("rejects the whole write when ANY recipient is not a current org member — zero write", async () => {
    seedMember("member@example.com", ORG_ID);
    // "ghost@example.com" is never seeded — not a member of any org.

    const result = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch({
        recipientEmails: ["member@example.com", "ghost@example.com"],
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_A_MEMBER");
    if (result.code !== "NOT_A_MEMBER") return;
    expect(result.emails).toEqual(["ghost@example.com"]);

    const schedules = await listAdminReportSchedulesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(schedules).toHaveLength(0); // zero write
  });

  it("rejects a real member of a DIFFERENT org as a recipient (cross-tenant), zero write", async () => {
    seedMember("outsider@example.com", OTHER_ORG_ID);

    const result = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch({ recipientEmails: ["outsider@example.com"] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_A_MEMBER");
  });

  it("rejects a 21st recipient (cap) — typed error, not silent truncation", async () => {
    const emails: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const email = `member${i}@example.com`;
      seedMember(email, ORG_ID);
      emails.push(email);
    }

    const result = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch({ recipientEmails: emails }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
  });

  it("rejects an unknown templateSlug — zero write", async () => {
    seedMember("member@example.com", ORG_ID);

    const result = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: "not-a-real-template",
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNKNOWN_TEMPLATE");
  });

  it("rejects a weekly schedule missing dayOfWeek, and a daily schedule carrying a stray dayOfWeek", async () => {
    seedMember("member@example.com", ORG_ID);

    const missing = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch({ frequency: "weekly", dayOfWeek: null }),
    });
    expect(missing.ok).toBe(false);

    const stray = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch({ frequency: "daily", dayOfWeek: 2 }),
    });
    expect(stray.ok).toBe(false);
  });
});

describe("get/list — tenancy scoping", () => {
  it("getAdminReportScheduleForEvent returns null for a cross-org id (IDOR-safe)", async () => {
    seedMember("member@example.com", ORG_ID);
    const created = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const crossOrgRead = await getAdminReportScheduleForEvent({
      scheduleId: created.schedule.id,
      eventId: EVENT_ID,
      organizationId: OTHER_ORG_ID,
    });
    expect(crossOrgRead).toBeNull();
  });

  it("getAdminReportScheduleByTemplate resolves via the deterministic id", async () => {
    seedMember("member@example.com", ORG_ID);
    await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });

    const found = await getAdminReportScheduleByTemplate({
      templateSlug: TEMPLATE,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(found?.templateSlug).toBe(TEMPLATE);
  });

  it("listAdminReportSchedulesForEvent only returns THIS event+org's schedules", async () => {
    seedMember("member@example.com", ORG_ID);
    await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });
    await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: "other-event",
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });

    const schedules = await listAdminReportSchedulesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(schedules).toHaveLength(1);
    expect(schedules[0].eventId).toBe(EVENT_ID);
  });
});

describe("deleteAdminReportSchedule", () => {
  it("hard-deletes the schedule doc", async () => {
    seedMember("member@example.com", ORG_ID);
    const created = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteAdminReportSchedule({
      scheduleId: created.schedule.id,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(result.ok).toBe(true);

    const after = await getAdminReportScheduleForEvent({
      scheduleId: created.schedule.id,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(after).toBeNull();
  });

  it("returns NOT_FOUND for a cross-org delete attempt (IDOR-safe)", async () => {
    seedMember("member@example.com", ORG_ID);
    const created = await upsertAdminReportSchedule({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE,
      createdBy: "organizer@example.com",
      patch: validPatch(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteAdminReportSchedule({
      scheduleId: created.schedule.id,
      eventId: EVENT_ID,
      organizationId: OTHER_ORG_ID,
    });
    expect(result.ok).toBe(false);
  });
});
