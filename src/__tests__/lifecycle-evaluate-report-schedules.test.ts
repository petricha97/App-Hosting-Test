// @vitest-environment node
/**
 * M7-T3 — scheduled report delivery evaluator
 * (src/lib/email/lifecycle/evaluate-report-schedules.ts). Spec:
 * agents/docs/specs/m7-scheduled-reports.md D2/D3/D4/§5.
 *
 * Locks:
 *  - a due daily schedule sends to every currently-verified recipient;
 *    dedupeKey = scheduleId:periodKey means re-running the sweep for an
 *    ALREADY-FIRED period produces ZERO additional sends
 *  - fire-time recipient re-verification: 3 stored recipients, one of whom
 *    has left the org, sends to exactly 2 — no error, no crash, no mutation
 *    of the schedule's own stored recipient list
 *  - a disabled schedule never fires
 *  - cross-org isolation: a schedule never fires against another org's
 *    membership roster or another event's data
 *  - the rendered email body contains the exact
 *    /dashboard/events/{eventId}/reports?template={slug} deep link and NO
 *    row-level data
 *  - kind = "scheduled-report:<templateSlug>", definitionId = null,
 *    dedupeKey = scheduleId:periodKey (spec §5 AC-1)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { createFakeAdminDb } from "./helpers/fake-admin-db";
import type { SendEmailInput } from "@/lib/email/transport";
import type { ReportScheduleDoc, WithId } from "@/types/collection";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { evaluateReportScheduleTrigger, reportScheduleKind } =
  await import("@/lib/email/lifecycle/evaluate-report-schedules");
const { reportScheduleId } = await import("@/lib/db/reportScheduleId");

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";
const EVENT_ID = "evt-1";
const TEMPLATE = "registration-overview";
const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};

const NOW_MS = Date.parse("2026-07-20T09:00:00.000Z"); // daily 09:00 UTC due instant
// Default fixture createdAt: recent enough that ONLY "today"'s period is
// in range (D4's notBeforeMs floor excludes yesterday's, 24h earlier) — the
// dedicated catch-up/floor tests below override this explicitly to exercise
// D4's actual multi-period behavior.
const CREATED_RECENTLY = Timestamp.fromMillis(NOW_MS - 2 * 60 * 60 * 1000);

function seedMember(email: string, organizationId: string): void {
  fake.store.set(`User/${email}`, {
    uid: `uid-${email}`,
    name: `Name for ${email}`,
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
  });
}

function seedSchedule(overrides: Record<string, unknown> = {}): string {
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
    createdAt: CREATED_RECENTLY,
    updatedAt: CREATED_RECENTLY,
    ...overrides,
  });
  return id;
}

function stubTransport() {
  return {
    send: vi.fn(async (_input: SendEmailInput) => ({
      status: "sent" as const,
      providerMessageId: "dev-1",
    })),
  };
}

function baseInput(
  scheduleId: string,
  overrides: Record<string, unknown> = {},
) {
  const stored = fake.store.get(
    `ReportSchedule/${scheduleId}`,
  ) as unknown as ReportScheduleDoc;
  const schedule: WithId<ReportScheduleDoc> = { id: scheduleId, ...stored };
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    eventName: EVENT.name,
    event: EVENT,
    schedule,
    nowMs: NOW_MS,
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("evaluateReportScheduleTrigger", () => {
  it("sends to every currently-verified recipient once due; a later tick for the SAME period sends zero more", async () => {
    seedMember("a@example.com", ORG_ID);
    const id = seedSchedule({
      recipients: [{ email: "a@example.com", name: "A" }],
    });
    const transport = stubTransport();

    const first = await evaluateReportScheduleTrigger(
      baseInput(id, { transport }),
    );
    expect(first.enqueued).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const second = await evaluateReportScheduleTrigger(
      baseInput(id, { transport }),
    );
    expect(second.enqueued).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1); // never re-sent

    const rows = [...fake.store.keys()].filter((k) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(1);
  });

  it("fire-time re-verification: 3 recipients, 1 departed, sends to exactly 2 — no error, no crash", async () => {
    seedMember("a@example.com", ORG_ID);
    seedMember("b@example.com", ORG_ID);
    // "c@example.com" is stored on the schedule but never seeded as a
    // member (simulates having left the org between add-time and fire-time).
    const id = seedSchedule({
      recipients: [
        { email: "a@example.com", name: "A" },
        { email: "b@example.com", name: "B" },
        { email: "c@example.com", name: "C" },
      ],
    });
    const transport = stubTransport();

    const outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport }),
    );

    expect(outcome.enqueued).toBe(2);
    expect(transport.send).toHaveBeenCalledTimes(2);
    const sentTo = transport.send.mock.calls.map(
      ([call]: [SendEmailInput]) => call.to.address,
    );
    expect(sentTo.sort()).toEqual(["a@example.com", "b@example.com"]);

    // The schedule's OWN stored recipient list is never mutated by a
    // fire-time drop (spec §2: "no auto-removal from the schedule's stored
    // config").
    const stored = fake.store.get(`ReportSchedule/${id}`) as {
      recipients: Array<{ email: string }>;
    };
    expect(stored.recipients).toHaveLength(3);
  });

  it("a departed-then-rejoined member catches up on the period they missed, without double-firing anyone else's already-sent period", async () => {
    // Broader than the single-tick "fire-time re-verification" test above:
    // covers TWO ticks across TWO periods, with membership changing
    // (departs, then rejoins) between them — exercises the interaction
    // between D2's per-recipient re-verification and D3/D4's
    // oldest-first, per-period dedupe together, which neither the
    // single-period departed test nor the D4 catch-up test (constant
    // membership throughout) exercises on its own.
    seedMember("a@example.com", ORG_ID);
    seedMember("b@example.com", ORG_ID);
    seedMember("c@example.com", ORG_ID);
    const id = seedSchedule({
      recipients: [
        { email: "a@example.com", name: "A" },
        { email: "b@example.com", name: "B" },
        { email: "c@example.com", name: "C" },
      ],
      // Uses the default CREATED_RECENTLY (NOW_MS - 2h): only "today"
      // (NOW_MS) is in range on the FIRST tick below (yesterday's due
      // instant, NOW_MS - 24h, predates it and stays excluded by D4's
      // floor) — but by the SECOND tick (nowMs = NOW_MS + 24h), that same
      // fixed createdAt is old enough for BOTH day1 (NOW_MS) and day2
      // (NOW_MS + 24h) to be in range.
    });
    const transport = stubTransport();

    // Day 1 fire: "c" has departed the org.
    fake.store.delete("User/c@example.com");
    const day1Outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport, nowMs: NOW_MS }),
    );
    expect(day1Outcome.enqueued).toBe(2);
    let sentTo = transport.send.mock.calls.map(
      ([call]: [SendEmailInput]) => call.to.address,
    );
    expect(sentTo.sort()).toEqual(["a@example.com", "b@example.com"]);

    // "c" rejoins before the next period fires.
    seedMember("c@example.com", ORG_ID);
    transport.send.mockClear();

    const day2Ms = NOW_MS + 24 * 60 * 60 * 1000;
    const day2Outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport, nowMs: day2Ms }),
    );
    // Two periods are due on this tick: day1 (still open for "c", who
    // never got a send for it) and day2 (fresh for everyone). Oldest-first
    // processing (D4) means day1 fires ONLY for "c" ("a"/"b" already
    // deduped from the first tick), then day2 fires for all three ->
    // 1 + 3 = 4 sends, with "c" appearing twice.
    expect(day2Outcome.enqueued).toBe(4);
    expect(day2Outcome.duplicates).toBe(2); // a+b deduped on day1's re-evaluation
    sentTo = transport.send.mock.calls.map(
      ([call]: [SendEmailInput]) => call.to.address,
    );
    expect(sentTo.sort()).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "c@example.com",
    ]);

    // The schedule's own stored recipient list is untouched throughout.
    const stored = fake.store.get(`ReportSchedule/${id}`) as {
      recipients: Array<{ email: string }>;
    };
    expect(stored.recipients).toHaveLength(3);
  });

  it("a schedule whose every recipient has left the org fires zero mail, zero error, zero crash", async () => {
    // Nobody seeded as a member — all 3 stored recipients are departed.
    const id = seedSchedule({
      recipients: [
        { email: "a@example.com", name: "A" },
        { email: "b@example.com", name: "B" },
      ],
    });
    const transport = stubTransport();

    const outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport }),
    );

    expect(outcome.enqueued).toBe(0);
    expect(outcome.pagesProcessed).toBe(1); // still "attempted" the period
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("a disabled schedule never fires", async () => {
    seedMember("a@example.com", ORG_ID);
    const id = seedSchedule({ enabled: false });
    const transport = stubTransport();

    const outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport }),
    );

    expect(outcome.enqueued).toBe(0);
    expect(outcome.stoppedReason).toBe("disabled");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("does not fire before the configured event-local due instant", async () => {
    seedMember("a@example.com", ORG_ID);
    const id = seedSchedule();
    const transport = stubTransport();

    const outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport, nowMs: NOW_MS - 60 * 60 * 1000 }),
    );

    expect(outcome.enqueued).toBe(0);
    expect(outcome.stoppedReason).toBe("not-due");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("cross-org isolation: a schedule only ever checks membership against ITS OWN organizationId", async () => {
    // The recipient is a real member, but of a DIFFERENT org than the
    // schedule's own organizationId.
    seedMember("outsider@example.com", OTHER_ORG_ID);
    const id = seedSchedule({
      recipients: [{ email: "outsider@example.com", name: "Outsider" }],
    });
    const transport = stubTransport();

    const outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport }),
    );

    expect(outcome.enqueued).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("kind/definitionId/dedupeKey match spec §5 AC-1 exactly", async () => {
    seedMember("a@example.com", ORG_ID);
    const id = seedSchedule({
      recipients: [{ email: "a@example.com", name: "A" }],
    });
    const transport = stubTransport();

    await evaluateReportScheduleTrigger(baseInput(id, { transport }));

    const rows = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(1);
    const [, doc] = rows[0] as [string, Record<string, unknown>];
    expect(doc.kind).toBe(reportScheduleKind(TEMPLATE));
    expect(doc.kind).toBe("scheduled-report:registration-overview");
    expect(doc.definitionId).toBeNull();
    expect(doc.dedupeKey).toBe(`${id}:2026-07-20`);
  });

  it("the rendered body contains the exact deep link and no row-level data", async () => {
    seedMember("a@example.com", ORG_ID);
    const id = seedSchedule({
      recipients: [{ email: "a@example.com", name: "A" }],
    });
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const transport = stubTransport();

    await evaluateReportScheduleTrigger(baseInput(id, { transport }));

    const [[sendCall]] = transport.send.mock.calls;
    const expectedLink = `https://app.example.com/dashboard/events/${EVENT_ID}/reports?template=${TEMPLATE}`;
    expect(sendCall.bodyText).toContain(expectedLink);
    expect(sendCall.bodyHtml).toContain(EVENT_ID);
    // No PII/row data of any kind — a fixture attendee name/email/amount
    // would never appear since this evaluator never reads Attendee/Order
    // data at all.
    expect(sendCall.bodyText).not.toMatch(/\$\d/);
  });

  it("zero-PII, verified against the ACTUAL persisted EmailMessage doc (not the mock call args), with real PII seeded in unrelated collections in the SAME store", async () => {
    // Stronger version of the "no row-level data" test above: reads the
    // doc that actually landed in the store (proving the persistence path
    // itself is clean, not just what happened to be passed to the
    // transport mock) and seeds real Attendee/Order PII into the SAME
    // fake store to prove the evaluator's independence from those
    // collections isn't an accident of "it doesn't happen to query them
    // right now" — a real attendee name/email/amount sits right there and
    // still never leaks in.
    seedMember("a@example.com", ORG_ID);
    fake.store.set("Attendee/att-1", {
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      name: "Jane Real Attendee",
      email: "jane.real.attendee@example.com",
    });
    fake.store.set("Order/order-1", {
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      amounts: { totalMinor: 999999 },
    });
    const id = seedSchedule({
      recipients: [{ email: "a@example.com", name: "A" }],
    });
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const transport = stubTransport();

    await evaluateReportScheduleTrigger(baseInput(id, { transport }));

    const [[, doc]] = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    ) as [string, Record<string, unknown>][];
    const bodyText = String(doc.bodyText);
    const bodyHtml = String(doc.bodyHtml);
    expect(bodyText).toContain(
      `/dashboard/events/${EVENT_ID}/reports?template=${TEMPLATE}`,
    );
    expect(bodyText).not.toContain("Jane Real Attendee");
    expect(bodyText).not.toContain("jane.real.attendee@example.com");
    expect(bodyText).not.toMatch(/999999|9,999\.99|\$9/);
    expect(bodyHtml).not.toContain("Jane Real Attendee");
    expect(bodyHtml).not.toContain("jane.real.attendee@example.com");
  });

  it("falls back to a site-relative deep link when NEXT_PUBLIC_APP_URL is unset", async () => {
    seedMember("a@example.com", ORG_ID);
    const id = seedSchedule({
      recipients: [{ email: "a@example.com", name: "A" }],
    });
    const transport = stubTransport();

    await evaluateReportScheduleTrigger(baseInput(id, { transport }));

    const [[sendCall]] = transport.send.mock.calls;
    expect(sendCall.bodyText).toContain(
      `/dashboard/events/${EVENT_ID}/reports?template=${TEMPLATE}`,
    );
    expect(sendCall.bodyText).not.toContain("http");
  });

  it("D4 catch-up: a schedule paused 10 days then re-enabled catches up AT MOST 4 periods, not 10", async () => {
    seedMember("a@example.com", ORG_ID);
    const id = seedSchedule({
      recipients: [{ email: "a@example.com", name: "A" }],
      createdAt: Timestamp.fromMillis(
        Date.parse("2026-01-01T00:00:00.000Z"), // long-lived schedule
      ),
    });
    const transport = stubTransport();

    const outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport, nowMs: NOW_MS }),
    );

    // Exactly 4 periods attempted (pagesProcessed), never the full backlog.
    expect(outcome.pagesProcessed).toBe(4);
    expect(outcome.enqueued).toBe(4);
    expect(transport.send).toHaveBeenCalledTimes(4);
  });

  it("D4 floor: never backfills a period that predates the schedule's own createdAt", async () => {
    seedMember("a@example.com", ORG_ID);
    // Schedule created only 90 minutes before `now` — only "today"'s 09:00
    // period is in range even though the catch-up ceiling allows 4.
    const id = seedSchedule({
      recipients: [{ email: "a@example.com", name: "A" }],
      createdAt: Timestamp.fromMillis(NOW_MS - 90 * 60 * 1000),
    });
    const transport = stubTransport();

    const outcome = await evaluateReportScheduleTrigger(
      baseInput(id, { transport, nowMs: NOW_MS }),
    );

    expect(outcome.pagesProcessed).toBe(1);
    expect(outcome.enqueued).toBe(1);
  });
});
