// @vitest-environment node
/**
 * M7-T2 — Order & transaction details report loader.
 * Spec: agents/docs/specs/m7-report-templates.md §2.
 * DAL: getAdminOrdersForEvent extended with startAfterCreatedAtMs
 * (agents/docs/data-models/m7-report-templates.md §1 — shipped signature
 * this loader is written against).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { loadOrderTransactionsPage, loadOrderTransactionsExport } =
  await import("@/features/reports/server/load-order-transactions");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function seedTicketType(id: string, name: string) {
  fake.store.set(`TicketType/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name,
    code: id.toUpperCase(),
    capacity: null,
    registeredCount: 0,
    salesStart: null,
    salesEnd: null,
    isOpen: true,
    registrationTypeIds: [],
    createdAt: { seconds: 0 },
    updatedAt: { seconds: 0 },
  });
}

function seedRegistrationType(id: string, name: string) {
  fake.store.set(`RegistrationType/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name,
    code: id.toUpperCase(),
    capacity: null,
    registeredCount: 0,
    createdAt: { seconds: 0 },
    updatedAt: { seconds: 0 },
  });
}

function seedOrder(id: string, overrides: Record<string, unknown> = {}) {
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
      subtotalMinor: 10000,
      discountMinor: 500,
      taxMinor: 800,
      totalMinor: 10300,
    },
    snapshot: {
      feeName: "Early Bird",
      basePriceMinor: 10000,
      promoCode: "SAVE5",
      discountType: "fixed",
      discountValue: 500,
      taxLines: [],
    },
    paymentMethod: "card",
    paymentStatus: "paid",
    paymentProvider: "simulated",
    providerPaymentId: "pi_123",
    idempotencyKey: id,
    createdAt: { seconds: 1, toDate: () => new Date(1000) },
    updatedAt: { seconds: 1, toDate: () => new Date(1000) },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
  seedTicketType("tt-1", "General Admission");
  seedRegistrationType("rt-1", "Delegate");
});

describe("loadOrderTransactionsPage — column output (spec §2)", () => {
  it("renders every column, resolving ticket/registration type names and formatting money", async () => {
    seedOrder("o-1");

    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0]).toEqual({
      orderId: "o-1",
      submissionId: "sub-o-1",
      ticketType: "General Admission",
      registrationType: "Delegate",
      feeName: "Early Bird",
      currency: "USD",
      subtotal: "$100.00",
      discount: "$5.00",
      tax: "$8.00",
      total: "$103.00",
      promoCode: "SAVE5",
      paymentMethod: "Card",
      paymentStatus: "Paid",
      providerPaymentId: "pi_123",
      createdAt: new Date(1000).toISOString(),
    });
  });

  it("pending and failed orders DO appear, with their real paymentStatus (AC-2)", async () => {
    seedOrder("o-pending", {
      paymentStatus: "pending",
      createdAt: { seconds: 2 },
    });
    seedOrder("o-failed", {
      paymentStatus: "failed",
      createdAt: { seconds: 3 },
    });

    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    const statuses = page.rows.map((r) => r.paymentStatus).sort();
    expect(statuses).toEqual(["Failed", "Pending"]);
  });

  it("falls back to '—' when a ticket/registration type id no longer resolves", async () => {
    seedOrder("o-1", { ticketTypeId: "tt-missing" });

    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].ticketType).toBe("—");
  });

  it("empty promoCode/submissionId/providerPaymentId render as empty strings", async () => {
    seedOrder("o-1", {
      submissionId: null,
      providerPaymentId: null,
      snapshot: {
        feeName: "Standard",
        basePriceMinor: 10000,
        promoCode: null,
        discountType: null,
        discountValue: null,
        taxLines: [],
      },
    });

    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].submissionId).toBe("");
    expect(page.rows[0].providerPaymentId).toBe("");
    expect(page.rows[0].promoCode).toBe("");
  });

  it("renders the FROZEN snapshot even after the live Fee/Promotion name changes (AC-4)", async () => {
    seedOrder("o-1", {
      snapshot: {
        feeName: "Frozen Fee Name",
        basePriceMinor: 10000,
        promoCode: "FROZEN10",
        discountType: "fixed",
        discountValue: 1000,
        taxLines: [],
      },
    });
    // Simulate the live Fee doc's name having since changed — the loader
    // never reads Fee/EventPromotion docs at all, so this is a structural
    // guarantee, not a stale-cache coincidence.
    fake.store.set("Fee/fee-1", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Renamed Fee",
    });

    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].feeName).toBe("Frozen Fee Name");
    expect(page.rows[0].promoCode).toBe("FROZEN10");
  });
});

describe("loadOrderTransactionsPage — id->name join called once per invocation (AC-3)", () => {
  it("resolves 3 distinct ticket types correctly with one list call each", async () => {
    seedTicketType("tt-2", "VIP");
    seedTicketType("tt-3", "Student");
    seedOrder("o-1", { ticketTypeId: "tt-1", createdAt: { seconds: 1 } });
    seedOrder("o-2", { ticketTypeId: "tt-2", createdAt: { seconds: 2 } });
    seedOrder("o-3", { ticketTypeId: "tt-3", createdAt: { seconds: 3 } });

    const readsBefore = fake.queryDocReads;
    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    const readsAfter = fake.queryDocReads;

    expect(page.rows.map((r) => r.ticketType).sort()).toEqual([
      "General Admission",
      "Student",
      "VIP",
    ]);
    // 1 Order query + 1 TicketType query + 1 RegistrationType query.
    expect(readsAfter - readsBefore).toBe(3);
  });
});

describe("loadOrderTransactionsExport — 1000-row cap (spec §2 AC-6)", () => {
  it("a 1200-order fixture exports exactly 1000 rows, no error", async () => {
    for (let i = 0; i < 1200; i += 1) {
      seedOrder(`o-${i}`, { createdAt: { seconds: i } });
    }

    const rows = await loadOrderTransactionsExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toHaveLength(1000);
  });
});

describe("loadOrderTransactionsPage — empty state (AC-5)", () => {
  it("zero orders returns zero rows, not a crash", async () => {
    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
