// @vitest-environment node
/**
 * M6-T3 — §4 periodic trigger `unpaid-offsets` (`payment-reminder`, debt
 * chase). Spec: agents/docs/specs/m6-lifecycle-triggers.md §4.
 *
 * Locks:
 *  - dueOffsetDedupeKeys (pure): orderId:offsetDays, one key per DUE offset
 *  - an accepted+outstanding order at day 7 fires ONLY the day-7 reminder;
 *    days 14/21 fire on later ticks if still outstanding
 *  - an order paid between day 7 and day 14 fires only day-7 — the
 *    eligibility re-query on the day-14 tick no longer includes it
 *  - an outstanding order whose submission was never accepted (no
 *    Attendee) fires ZERO reminders at any offset
 *  - orderId:offsetDays produces THREE distinct EmailMessage rows under
 *    the single kind "payment-reminder"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";
import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { evaluateUnpaidOffsetsTrigger, dueOffsetDedupeKeys } =
  await import("@/lib/email/lifecycle/evaluate-unpaid-offsets");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");

function seedOrder(id: string, overrides: Record<string, unknown> = {}): void {
  fake.store.set(`Order/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: `sub-${id}`,
    ticketTypeId: "tt-1",
    registrationTypeId: "rt-1",
    feeId: "fee-1",
    promotionId: null,
    taxIds: [],
    currency: "USD",
    amounts: {
      subtotalMinor: 1000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1000,
    },
    snapshot: {
      feeName: "Fee",
      basePriceMinor: 1000,
      promoCode: null,
      discountType: null,
      discountValue: null,
      taxLines: [],
    },
    paymentMethod: "invoice",
    paymentStatus: "outstanding",
    paymentProvider: "simulated",
    providerPaymentId: null,
    idempotencyKey: id,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

// getAdminAttendeeBySubmissionId does a DIRECT DOC GET at the deterministic
// id derived from submissionId — `orderId` here is the seedOrder id whose
// default `submissionId: sub-${id}` this attendee must match.
function seedAttendee(
  orderId: string,
  overrides: Record<string, unknown> = {},
): void {
  const submissionId = `sub-${orderId}`;
  const attendeeId = attendeeIdFromSubmissionId({
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId,
  });
  fake.store.set(`Attendee/${attendeeId}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId,
    orderId,
    pathId: "path-1",
    firstName: "Alan",
    lastName: "Turing",
    email: "alan@example.com",
    company: "Bletchley",
    jobTitle: "Cryptanalyst",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tt-1",
    ticketLabel: "General",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "hash",
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

function stubTransport() {
  return {
    send: vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "dev-1",
    })),
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    eventName: EVENT.name,
    event: EVENT,
    definitionId: "def-payment-reminder",
    template: { subject: "Payment reminder", body: "{order_total} due" },
    offsetsDays: [7, 14, 21],
    nowMs: NOW_MS,
    pageSize: 100,
    maxPages: 20,
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
});

describe("dueOffsetDedupeKeys (pure)", () => {
  it("returns only the offsets already elapsed", () => {
    const keys = dueOffsetDedupeKeys({
      candidate: {
        recipientKey: "a-1",
        recipient: { name: "x", email: "x@example.com" },
        attendeeId: "a-1",
        submissionId: "s-1",
        orderId: "order-1",
        orderCreatedAtMs: NOW_MS - 10 * DAY_MS,
        mergeInput: {},
      },
      offsetsDays: [7, 14, 21],
      nowMs: NOW_MS,
    });
    expect(keys).toEqual(["order-1:7"]);
  });

  it("returns all THREE due offsets when evaluated well past day 21", () => {
    const keys = dueOffsetDedupeKeys({
      candidate: {
        recipientKey: "a-1",
        recipient: { name: "x", email: "x@example.com" },
        attendeeId: "a-1",
        submissionId: "s-1",
        orderId: "order-1",
        orderCreatedAtMs: NOW_MS - 30 * DAY_MS,
        mergeInput: {},
      },
      offsetsDays: [7, 14, 21],
      nowMs: NOW_MS,
    });
    expect(keys).toEqual(["order-1:7", "order-1:14", "order-1:21"]);
  });

  it("returns nothing when orderId/orderCreatedAtMs is missing", () => {
    expect(
      dueOffsetDedupeKeys({
        candidate: {
          recipientKey: "a-1",
          recipient: { name: "x", email: "x@example.com" },
          attendeeId: "a-1",
          submissionId: "s-1",
          orderId: null,
          orderCreatedAtMs: null,
          mergeInput: {},
        },
        offsetsDays: [7, 14, 21],
        nowMs: NOW_MS,
      }),
    ).toEqual([]);
  });
});

describe("evaluateUnpaidOffsetsTrigger", () => {
  it("fires ONLY the day-7 reminder for an order exactly 7 days old", async () => {
    seedOrder("order-1", {
      createdAt: { seconds: (NOW_MS - 7 * DAY_MS) / 1000 },
    });
    seedAttendee("order-1");
    const transport = stubTransport();

    const outcome = await evaluateUnpaidOffsetsTrigger(
      baseInput({ transport }),
    );

    expect(outcome.enqueued).toBe(1);
    const rows = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][1].dedupeKey).toBe("order-1:7");
  });

  it("fires the day-14 reminder on a LATER tick, as a NEW row (three distinct rows, one kind)", async () => {
    seedOrder("order-1", {
      createdAt: { seconds: (NOW_MS - 7 * DAY_MS) / 1000 },
    });
    seedAttendee("order-1");
    const transport = stubTransport();

    await evaluateUnpaidOffsetsTrigger(baseInput({ transport }));

    // 7 days later: day-14 offset is now due too.
    const laterOutcome = await evaluateUnpaidOffsetsTrigger(
      baseInput({ transport, nowMs: NOW_MS + 7 * DAY_MS }),
    );
    expect(laterOutcome.enqueued).toBe(1); // only the NEW (day-14) row
    expect(laterOutcome.duplicates).toBe(1); // day-7 collapses as a dup

    const rows = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(2);
    const dedupeKeys = rows
      .map(([, v]) => (v as { dedupeKey: string }).dedupeKey)
      .sort();
    expect(dedupeKeys).toEqual(["order-1:14", "order-1:7"]);
    expect(new Set(rows.map(([, v]) => (v as { kind: string }).kind))).toEqual(
      new Set(["payment-reminder"]),
    );
  });

  it("an order paid between day 7 and day 14 fires ONLY day-7 — the later tick's eligibility re-query excludes it", async () => {
    seedOrder("order-1", {
      createdAt: { seconds: (NOW_MS - 7 * DAY_MS) / 1000 },
    });
    seedAttendee("order-1");
    const transport = stubTransport();

    await evaluateUnpaidOffsetsTrigger(baseInput({ transport }));

    // Order gets paid off before the day-14 tick.
    fake.store.set("Order/order-1", {
      ...fake.store.get("Order/order-1")!,
      paymentStatus: "paid",
    });

    const laterOutcome = await evaluateUnpaidOffsetsTrigger(
      baseInput({ transport, nowMs: NOW_MS + 7 * DAY_MS }),
    );
    expect(laterOutcome.enqueued).toBe(0);
    expect(laterOutcome.duplicates).toBe(0); // the order never even surfaces in the audience now

    const rows = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(1); // only the original day-7 row
  });

  it("an outstanding order whose submission is still pending (no Attendee) fires ZERO reminders, even past day 21", async () => {
    seedOrder("order-1", {
      createdAt: { seconds: (NOW_MS - 30 * DAY_MS) / 1000 },
    });
    // No seedAttendee call — submission was never accepted.
    const transport = stubTransport();

    const outcome = await evaluateUnpaidOffsetsTrigger(
      baseInput({ transport }),
    );

    expect(outcome.enqueued).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
  });
});
