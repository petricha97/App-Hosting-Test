// @vitest-environment node
/**
 * M7-T3 — confirms report-schedule evaluation is folded into the SAME
 * per-event fan-out M6-T3 already ships (spec
 * agents/docs/specs/m7-scheduled-reports.md D5: "one Cloud Scheduler job
 * continues to drive everything," not a parallel mechanism). Exercises
 * evaluateEventLifecycleTriggers end-to-end (the exact function
 * run-sweep.ts / the internal route already call) rather than the
 * lower-level evaluateReportScheduleTrigger unit directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { evaluateEventLifecycleTriggers } =
  await import("@/lib/email/lifecycle/evaluate-event");
const { reportScheduleId } = await import("@/lib/db/reportScheduleId");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const TEMPLATE = "registration-overview";
const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};
const NOW_MS = Date.parse("2026-07-20T09:00:00.000Z");

beforeEach(() => {
  fake.reset();
});

function seedMember(email: string): void {
  fake.store.set(`User/${email}`, {
    uid: `uid-${email}`,
    name: "A Member",
    email,
    organizationId: ORG_ID,
    organizationRole: "member",
    organizations: [
      {
        organizationId: ORG_ID,
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
  });
}

function seedSchedule(): string {
  const id = reportScheduleId({
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    templateSlug: TEMPLATE,
  });
  fake.store.set(`ReportSchedule/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    templateSlug: TEMPLATE,
    frequency: "daily",
    dayOfWeek: null,
    dayOfMonth: null,
    hour: 9,
    minute: 0,
    recipients: [{ email: "a@example.com", name: "A" }],
    enabled: true,
    createdBy: "organizer@example.com",
    createdAt: Timestamp.fromMillis(NOW_MS - 60 * 60 * 1000),
    updatedAt: Timestamp.fromMillis(NOW_MS - 60 * 60 * 1000),
  });
  return id;
}

function stubTransport() {
  return {
    send: vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "dev-1",
    })),
  };
}

describe("evaluateEventLifecycleTriggers — M7-T3 report-schedule step", () => {
  it("includes a result entry for the due ReportSchedule, alongside the existing M6-T3 trigger types", async () => {
    seedMember("a@example.com");
    const scheduleId = seedSchedule();
    const transport = stubTransport();

    const result = await evaluateEventLifecycleTriggers({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      nowMs: NOW_MS,
      transport,
    });

    const scheduleResult = result.results.find(
      (r) => r.definitionId === scheduleId,
    );
    expect(scheduleResult).toBeDefined();
    expect(scheduleResult?.kind).toBe("scheduled-report:registration-overview");
    expect(scheduleResult?.outcome.enqueued).toBe(1);

    // Still evaluates the pre-existing M6-T3 trigger types in the SAME
    // pass (abandoned-reminder / payment-reminder are always present, as
    // virtual defaults, even with zero eligible candidates).
    const kinds = result.results.map((r) => r.kind);
    expect(kinds).toContain("abandoned-reminder");
    expect(kinds).toContain("payment-reminder");
  });

  it("an event with zero ReportSchedule docs adds zero report-schedule entries (no crash)", async () => {
    const transport = stubTransport();

    const result = await evaluateEventLifecycleTriggers({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      nowMs: NOW_MS,
      transport,
    });

    const scheduleResults = result.results.filter((r) =>
      r.kind.startsWith("scheduled-report:"),
    );
    expect(scheduleResults).toHaveLength(0);
  });
});
