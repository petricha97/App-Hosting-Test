// @vitest-environment node
/**
 * M7-T1 — Finance summary aggregates (src/lib/db/adminOrder.ts's
 * sumAdminOrderTotalsForEvent). Spec:
 * agents/docs/specs/m7-reporting-summaries.md §2/§3.
 *
 * Locks:
 *  - sum() is a Firestore server-side AGGREGATE query — the fake db's
 *    .aggregate() interprets the SAME real AggregateField instances the DAL
 *    builds (AggregateField.sum("amounts.<field>")), so this cross-checks
 *    the exact production call shape, not a stand-in.
 *  - "paid"/"outstanding" sum amounts.totalMinor; "comped" sums
 *    amounts.subtotalMinor (never totalMinor, which is always 0 for a
 *    comped order by construction) — spec §2's central, non-obvious call.
 *  - currency-scoped: a different-currency order never blends into another
 *    currency's sum (spec §4 AC-2).
 *  - pending/failed orders contribute to no sum (spec §2 AC-3).
 *  - cross-org / cross-event orders never leak into a sum (tenancy).
 *  - a zero-match filter sums to 0, never NaN/undefined (spec §2 AC-5).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { sumAdminOrderTotalsForEvent } = await import("@/lib/db/adminOrder");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

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
    paymentMethod: "card",
    paymentStatus: "paid",
    paymentProvider: "simulated",
    providerPaymentId: null,
    idempotencyKey: id,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("sumAdminOrderTotalsForEvent — paid/outstanding sum amounts.totalMinor", () => {
  it("sums totalMinor across every paid order for the (event, org, currency)", async () => {
    seedOrder("o-1", {
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 10000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 10000,
      },
    });
    seedOrder("o-2", {
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 5000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 5000,
      },
    });

    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "paid",
        currency: "USD",
        field: "totalMinor",
      }),
    ).toBe(15000);
  });

  it("sums totalMinor for outstanding orders independently of paid orders", async () => {
    seedOrder("o-1", {
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 10000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 10000,
      },
    });
    seedOrder("o-2", {
      paymentStatus: "outstanding",
      paymentMethod: "invoice",
      amounts: {
        subtotalMinor: 20000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 20000,
      },
    });

    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "outstanding",
        currency: "USD",
        field: "totalMinor",
      }),
    ).toBe(20000);
  });
});

describe("sumAdminOrderTotalsForEvent — comped sums amounts.subtotalMinor, NEVER totalMinor", () => {
  it("comped-via-100%-discount: sums the real pre-discount subtotal, not the $0 total", async () => {
    seedOrder("o-comp", {
      paymentStatus: "comped",
      paymentMethod: "comp",
      amounts: {
        subtotalMinor: 145000,
        discountMinor: 145000,
        taxMinor: 0,
        totalMinor: 0,
      },
    });

    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "comped",
        currency: "USD",
        field: "subtotalMinor",
      }),
    ).toBe(145000);

    // The same comped order's totalMinor is 0 by construction — proves the
    // "Comped value" card row must never read this field.
    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "comped",
        currency: "USD",
        field: "totalMinor",
      }),
    ).toBe(0);
  });

  it("genuinely-free fee (no promo): subtotalMinor is also 0, contributing exactly 0", async () => {
    seedOrder("o-free", {
      paymentStatus: "comped",
      paymentMethod: "comp",
      amounts: {
        subtotalMinor: 0,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
      },
    });

    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "comped",
        currency: "USD",
        field: "subtotalMinor",
      }),
    ).toBe(0);
  });
});

describe("sumAdminOrderTotalsForEvent — pending/failed excluded from every sum", () => {
  it("a pending or failed order never contributes to paid/outstanding/comped sums", async () => {
    seedOrder("o-pending", { paymentStatus: "pending" });
    seedOrder("o-failed", { paymentStatus: "failed" });
    seedOrder("o-paid", {
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 3000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 3000,
      },
    });

    for (const paymentStatus of ["paid", "outstanding", "comped"] as const) {
      const field = paymentStatus === "comped" ? "subtotalMinor" : "totalMinor";
      const expected = paymentStatus === "paid" ? 3000 : 0;
      expect(
        await sumAdminOrderTotalsForEvent({
          eventId: EVENT_ID,
          organizationId: ORG_ID,
          paymentStatus,
          currency: "USD",
          field,
        }),
      ).toBe(expected);
    }
  });
});

describe("sumAdminOrderTotalsForEvent — currency scoping (spec §4)", () => {
  it("never blends a different currency's orders into the queried currency's sum", async () => {
    seedOrder("o-usd", {
      currency: "USD",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 10000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 10000,
      },
    });
    seedOrder("o-gbp", {
      currency: "GBP",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 99999,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 99999,
      },
    });

    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "paid",
        currency: "USD",
        field: "totalMinor",
      }),
    ).toBe(10000);
    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "paid",
        currency: "GBP",
        field: "totalMinor",
      }),
    ).toBe(99999);
  });
});

describe("sumAdminOrderTotalsForEvent — tenancy isolation", () => {
  it("never leaks a different org's orders into the sum (same eventId)", async () => {
    seedOrder("o-mine", {
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 1000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 1000,
      },
    });
    seedOrder("o-other-org", {
      organizationId: "org-other",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 500000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 500000,
      },
    });

    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "paid",
        currency: "USD",
        field: "totalMinor",
      }),
    ).toBe(1000);
  });

  it("never leaks a different event's orders into the sum (same org)", async () => {
    seedOrder("o-mine", {
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 1000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 1000,
      },
    });
    seedOrder("o-other-event", {
      eventId: "evt-other",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 500000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 500000,
      },
    });

    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "paid",
        currency: "USD",
        field: "totalMinor",
      }),
    ).toBe(1000);
  });
});

describe("sumAdminOrderTotalsForEvent — zero orders", () => {
  it("sums to 0, never NaN/undefined, when nothing matches the filter", async () => {
    expect(
      await sumAdminOrderTotalsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        paymentStatus: "paid",
        currency: "USD",
        field: "totalMinor",
      }),
    ).toBe(0);
  });
});

describe("sumAdminOrderTotalsForEvent — aggregate-only read path (M7-T1 §3 AC-4)", () => {
  it("issues ZERO full-document reads — every call is an aggregate sum()", async () => {
    seedOrder("o-1", {
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 1000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 1000,
      },
    });

    await sumAdminOrderTotalsForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      paymentStatus: "paid",
      currency: "USD",
      field: "totalMinor",
    });

    expect(fake.queryDocReads).toBe(0);
  });
});
