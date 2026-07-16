/**
 * M7-T1 — QA regression: end-to-end arithmetic verification for the
 * Reports screen (spec agents/docs/specs/m7-reporting-summaries.md §1/§2/§4).
 *
 * Unlike reports-orchestration.test.ts (which mocks every DAL call and only
 * proves the orchestration layer's SHAPING logic) and admin-order-finance-sums
 * .test.ts / admin-attendee.test.ts (which exercise one DAL function at a
 * time with small fixtures), this file seeds ONE realistic, comprehensive
 * fixture directly into the fake Firestore store and drives it through the
 * REAL DAL (src/lib/db/adminAttendee.ts, adminOrder.ts, adminTicketType.ts,
 * adminRegistrationPath.ts, adminEventPromotion.ts) and the REAL orchestration
 * loaders (loadTicketTypeRegistrations, loadFinanceSummary) with nothing
 * mocked except the Firestore module boundary itself — the same posture as a
 * QA hand-computation check against the full pipeline, not a unit test of any
 * one layer in isolation.
 *
 * Fixture (hand-computed expectations below):
 *  - 3 ticket types: "Early Bird" (5 accepted, 1 cancelled), "Standard"
 *    (3 accepted), "VIP" (0 accepted).
 *  - 2 accepted attendees with ticketTypeId: null ("No ticket type" bucket).
 *  - 1 pending (not-yet-accepted) FormData-only registrant simulated by
 *    simply NOT seeding an Attendee doc for it — proves the metric only ever
 *    reads Attendee, never a submission count.
 *  - Orders across 2 currencies (USD, GBP) and every payment status
 *    (paid, outstanding, comped x2 flavors, pending, failed).
 *  - 3 EventPromotion docs: usedCount 6, usedCount 1, usedCount 0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { loadTicketTypeRegistrations } =
  await import("@/features/reports/server/load-ticket-type-registrations");
const { loadFinanceSummary } =
  await import("@/features/reports/server/load-finance-summary");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const OTHER_ORG_ID = "org-2";
const OTHER_EVENT_ID = "evt-2";

function seedTicketType(id: string, name: string, createdAtMs: number): void {
  fake.store.set(`TicketType/${id}`, {
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    name,
    createdAt: { toMillis: () => createdAtMs, seconds: createdAtMs / 1000 },
  });
}

let attendeeSeq = 0;
function seedAttendee(
  overrides: Record<string, unknown> = {},
  eventId: string = EVENT_ID,
  organizationId: string = ORG_ID,
): void {
  const id = `att-${attendeeSeq++}`;
  fake.store.set(`Attendee/${id}`, {
    eventId,
    organizationId,
    submissionId: `sub-${id}`,
    orderId: null,
    ticketTypeId: "tt-early",
    registrationTypeId: "rt-1",
    status: "accepted",
    checkInState: "not-checked-in",
    createdAt: { toMillis: () => 0, seconds: 0 },
    ...overrides,
  });
}

let orderSeq = 0;
function seedOrder(
  overrides: Record<string, unknown> = {},
  eventId: string = EVENT_ID,
  organizationId: string = ORG_ID,
): void {
  const id = `ord-${orderSeq++}`;
  fake.store.set(`Order/${id}`, {
    eventId,
    organizationId,
    submissionId: `sub-${id}`,
    ticketTypeId: "tt-early",
    registrationTypeId: "rt-1",
    feeId: "fee-1",
    promotionId: null,
    taxIds: [],
    currency: "USD",
    amounts: {
      subtotalMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
    },
    paymentMethod: "card",
    paymentStatus: "paid",
    paymentProvider: "simulated",
    createdAt: { toMillis: () => 0, seconds: 0 },
    updatedAt: { toMillis: () => 0, seconds: 0 },
    ...overrides,
  });
}

function seedRegistrationPath(
  id: string,
  currency: string,
  sortOrder: number,
): void {
  fake.store.set(`RegistrationPath/${id}`, {
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    currency,
    sortOrder,
  });
}

function seedPromotion(id: string, usedCount: number): void {
  fake.store.set(`Event/${EVENT_ID}/EventPromotion/${id}`, {
    organizationId: ORG_ID,
    code: id,
    usedCount,
  });
}

beforeEach(() => {
  fake.reset();
  attendeeSeq = 0;
  orderSeq = 0;
});

describe("M7-T1 — full-pipeline arithmetic against a realistic seeded fixture", () => {
  it("computes exactly the hand-derived ticket-type registration counts", async () => {
    seedTicketType("tt-early", "Early Bird", 1000);
    seedTicketType("tt-standard", "Standard", 2000);
    seedTicketType("tt-vip", "VIP", 3000);

    // Early Bird: 5 accepted + 1 cancelled (excluded).
    for (let i = 0; i < 5; i++) {
      seedAttendee({ ticketTypeId: "tt-early", status: "accepted" });
    }
    seedAttendee({ ticketTypeId: "tt-early", status: "cancelled" });

    // Standard: 3 accepted.
    for (let i = 0; i < 3; i++) {
      seedAttendee({ ticketTypeId: "tt-standard", status: "accepted" });
    }

    // VIP: zero attendees at all (ticket type exists, never registered).

    // "No ticket type" bucket: 2 accepted, legacy null ticketTypeId.
    seedAttendee({ ticketTypeId: null, status: "accepted" });
    seedAttendee({ ticketTypeId: null, status: "accepted" });

    // Cross-org / cross-event noise that must never leak into these counts.
    seedAttendee(
      { ticketTypeId: "tt-early", status: "accepted" },
      EVENT_ID,
      OTHER_ORG_ID,
    );
    seedAttendee(
      { ticketTypeId: "tt-early", status: "accepted" },
      OTHER_EVENT_ID,
      ORG_ID,
    );

    const rows = await loadTicketTypeRegistrations({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    // Hand-computed: descending by count (5, 3, 0), "No ticket type"
    // ALWAYS last regardless of its own count (2 > VIP's 0, but still last).
    expect(rows).toEqual([
      { label: "Early Bird", count: 5 },
      { label: "Standard", count: 3 },
      { label: "VIP", count: 0 },
      { label: "No ticket type", count: 2 },
    ]);
  });

  it("computes exactly the hand-derived finance sums across 2 currencies and every payment status", async () => {
    seedRegistrationPath("path-usd", "USD", 1);
    seedRegistrationPath("path-gbp", "GBP", 2);

    // ---- USD orders ----
    // Paid: 10000 + 5500 = 15500
    seedOrder({
      currency: "USD",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 10000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 10000,
      },
    });
    seedOrder({
      currency: "USD",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 5000,
        discountMinor: 0,
        taxMinor: 500,
        totalMinor: 5500,
      },
    });
    // Outstanding: 20000
    seedOrder({
      currency: "USD",
      paymentStatus: "outstanding",
      amounts: {
        subtotalMinor: 20000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 20000,
      },
    });
    // Comped via 100%-discount (non-zero subtotal, zero total) — the
    // stress-tested case: comped value must reflect the real subtotal.
    seedOrder({
      currency: "USD",
      paymentStatus: "comped",
      promotionId: "promo-100off",
      amounts: {
        subtotalMinor: 14500,
        discountMinor: 14500,
        taxMinor: 0,
        totalMinor: 0,
      },
    });
    // Comped via genuinely-free fee (both subtotal and total are 0).
    seedOrder({
      currency: "USD",
      paymentStatus: "comped",
      amounts: {
        subtotalMinor: 0,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
      },
    });
    // Pending and failed — must contribute to NOTHING, even though they
    // reference a real promotionId.
    seedOrder({
      currency: "USD",
      paymentStatus: "pending",
      promotionId: "promo-6uses",
      amounts: {
        subtotalMinor: 3000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 3000,
      },
    });
    seedOrder({
      currency: "USD",
      paymentStatus: "failed",
      promotionId: "promo-6uses",
      amounts: {
        subtotalMinor: 4000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 4000,
      },
    });

    // ---- GBP orders ----
    seedOrder({
      currency: "GBP",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 8000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 8000,
      },
    });
    seedOrder({
      currency: "GBP",
      paymentStatus: "outstanding",
      amounts: {
        subtotalMinor: 6000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 6000,
      },
    });
    seedOrder({
      currency: "GBP",
      paymentStatus: "comped",
      promotionId: "promo-6uses",
      amounts: {
        subtotalMinor: 9000,
        discountMinor: 9000,
        taxMinor: 0,
        totalMinor: 0,
      },
    });

    // Cross-org / cross-event noise — must never blend into these sums.
    seedOrder(
      {
        currency: "USD",
        paymentStatus: "paid",
        amounts: {
          subtotalMinor: 999999,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 999999,
        },
      },
      EVENT_ID,
      OTHER_ORG_ID,
    );
    seedOrder(
      {
        currency: "USD",
        paymentStatus: "paid",
        amounts: {
          subtotalMinor: 888888,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 888888,
        },
      },
      OTHER_EVENT_ID,
      ORG_ID,
    );

    // Discount codes: 6-use, 1-use, never-used.
    seedPromotion("promo-6uses", 6);
    seedPromotion("promo-1use", 1);
    seedPromotion("promo-unused", 0);

    const data = await loadFinanceSummary({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(data).not.toBeNull();
    // Currencies sorted ascending ("GBP" < "USD").
    expect(data?.currencies).toEqual([
      {
        currency: "GBP",
        paidMinor: 8000,
        outstandingMinor: 6000,
        compedMinor: 9000,
      },
      {
        currency: "USD",
        paidMinor: 15500,
        outstandingMinor: 20000,
        compedMinor: 14500, // NOT 0 — the discount-driven comp's real subtotal.
      },
    ]);
    // Distinct codes with >=1 use: promo-6uses + promo-1use = 2, NOT the sum
    // of usedCount (6+1=7) and NOT counting promo-unused.
    expect(data?.discountCodesUsed).toBe(2);
  });
});
