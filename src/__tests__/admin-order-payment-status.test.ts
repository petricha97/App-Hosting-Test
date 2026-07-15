// @vitest-environment node
/**
 * M6-T3 — Order paymentStatus-filtered list (src/lib/db/adminOrder.ts's
 * listAdminOrdersForEventByPaymentStatus). Spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §6/§9 ("genuine DAL gap").
 *
 * Locks:
 *  - equality filter (single status) and `in` filter (array of statuses)
 *    both scope to eventId + organizationId first
 *  - oldest-first ordering (createdAt ASC) — the longest-overdue orders
 *    surface first for the debt-chase trigger
 *  - bounded + cursor-paginated, never a full-collection read
 *  - cross-org / cross-event rows never leak into the page
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { listAdminOrdersForEventByPaymentStatus, ORDER_LIST_LIMIT } =
  await import("@/lib/db/adminOrder");

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

beforeEach(() => {
  fake.reset();
});

describe("listAdminOrdersForEventByPaymentStatus", () => {
  it("filters a single status with a plain equality, oldest first", async () => {
    seedOrder("o-1", {
      paymentStatus: "outstanding",
      createdAt: { seconds: 30 },
    });
    seedOrder("o-2", {
      paymentStatus: "outstanding",
      createdAt: { seconds: 10 },
    });
    seedOrder("o-3", { paymentStatus: "paid", createdAt: { seconds: 5 } });

    const page = await listAdminOrdersForEventByPaymentStatus({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      paymentStatus: "outstanding",
    });

    expect(page.map((o) => o.id)).toEqual(["o-2", "o-1"]);
  });

  it("filters multiple statuses with `in`", async () => {
    seedOrder("o-paid", { paymentStatus: "paid", createdAt: { seconds: 1 } });
    seedOrder("o-comped", {
      paymentStatus: "comped",
      createdAt: { seconds: 2 },
    });
    seedOrder("o-outstanding", {
      paymentStatus: "outstanding",
      createdAt: { seconds: 3 },
    });

    const page = await listAdminOrdersForEventByPaymentStatus({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      paymentStatus: ["paid", "comped"],
    });

    expect(page.map((o) => o.id).sort()).toEqual(["o-comped", "o-paid"]);
  });

  it("never leaks another org's or event's orders", async () => {
    seedOrder("o-mine", {
      paymentStatus: "outstanding",
      createdAt: { seconds: 1 },
    });
    seedOrder("o-other-org", {
      organizationId: "org-other",
      paymentStatus: "outstanding",
      createdAt: { seconds: 2 },
    });
    seedOrder("o-other-event", {
      eventId: "evt-other",
      paymentStatus: "outstanding",
      createdAt: { seconds: 3 },
    });

    const page = await listAdminOrdersForEventByPaymentStatus({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      paymentStatus: "outstanding",
    });

    expect(page.map((o) => o.id)).toEqual(["o-mine"]);
  });

  it("is bounded (default ORDER_LIST_LIMIT) and cursor-paginated", async () => {
    for (let i = 0; i < ORDER_LIST_LIMIT + 5; i += 1) {
      seedOrder(`o-${i}`, {
        paymentStatus: "outstanding",
        createdAt: { seconds: i },
      });
    }

    const firstPage = await listAdminOrdersForEventByPaymentStatus({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      paymentStatus: "outstanding",
      limit: 10,
    });
    expect(firstPage).toHaveLength(10);
    expect(firstPage[0].id).toBe("o-0");
    expect(firstPage[9].id).toBe("o-9");

    const secondPage = await listAdminOrdersForEventByPaymentStatus({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      paymentStatus: "outstanding",
      limit: 10,
      startAfterCreatedAtMs: 9 * 1000,
    });
    expect(secondPage[0].id).toBe("o-10");

    const defaultPage = await listAdminOrdersForEventByPaymentStatus({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      paymentStatus: "outstanding",
    });
    expect(defaultPage).toHaveLength(ORDER_LIST_LIMIT);
  });
});
