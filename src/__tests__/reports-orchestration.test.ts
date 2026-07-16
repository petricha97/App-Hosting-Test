/**
 * M7-T1 — reports orchestration layer (src/features/reports/server/*).
 * Spec: agents/docs/specs/m7-reporting-summaries.md §1/§2/§3/§4.
 *
 * These tests mock the DAL (src/lib/db/*) directly — this layer's own job is
 * PRESENTATION SHAPING (sorting, the "No ticket type" bucket, per-currency
 * grouping), not Firestore query correctness (already covered by Backend's
 * admin-attendee.test.ts / admin-order-finance-sums.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const countAdminAttendeesForEvent = vi.fn();
const getAdminTicketTypesForEvent = vi.fn();
const sumAdminOrderTotalsForEvent = vi.fn();
const getAdminRegistrationPathsForEvent = vi.fn();
const getAdminEventPromotionsForEvent = vi.fn();

vi.mock("@/lib/db/adminAttendee", () => ({
  countAdminAttendeesForEvent: (...args: unknown[]) =>
    countAdminAttendeesForEvent(...args),
}));
vi.mock("@/lib/db/adminTicketType", () => ({
  getAdminTicketTypesForEvent: (...args: unknown[]) =>
    getAdminTicketTypesForEvent(...args),
}));
vi.mock("@/lib/db/adminOrder", () => ({
  sumAdminOrderTotalsForEvent: (...args: unknown[]) =>
    sumAdminOrderTotalsForEvent(...args),
}));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathsForEvent: (...args: unknown[]) =>
    getAdminRegistrationPathsForEvent(...args),
}));
vi.mock("@/lib/db/adminEventPromotion", () => ({
  getAdminEventPromotionsForEvent: (...args: unknown[]) =>
    getAdminEventPromotionsForEvent(...args),
}));

const { loadTicketTypeRegistrations } =
  await import("@/features/reports/server/load-ticket-type-registrations");
const { loadFinanceSummary } =
  await import("@/features/reports/server/load-finance-summary");

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadTicketTypeRegistrations", () => {
  it("sorts rows descending by count, ties by ticket-type creation order (spec §1 AC-1)", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([
      { id: "tt-a", name: "Early bird" },
      { id: "tt-b", name: "Standard" },
      { id: "tt-c", name: "VIP" },
      { id: "tt-d", name: "Sponsor" },
    ]);
    countAdminAttendeesForEvent.mockImplementation(
      async ({ ticketTypeId }: { ticketTypeId: string | null }) => {
        const counts: Record<string, number> = {
          "tt-a": 97,
          "tt-b": 13,
          "tt-c": 3,
          "tt-d": 1,
        };
        return ticketTypeId === null ? 0 : counts[ticketTypeId];
      },
    );

    const rows = await loadTicketTypeRegistrations({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toEqual([
      { label: "Early bird", count: 97 },
      { label: "Standard", count: 13 },
      { label: "VIP", count: 3 },
      { label: "Sponsor", count: 1 },
    ]);
  });

  it("keeps a zero-registration ticket type as a labeled row (spec §1 AC-2)", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([
      { id: "tt-a", name: "Sold out" },
      { id: "tt-b", name: "GC super early bird" },
    ]);
    countAdminAttendeesForEvent.mockImplementation(
      async ({ ticketTypeId }: { ticketTypeId: string | null }) =>
        ticketTypeId === "tt-a" ? 5 : 0,
    );

    const rows = await loadTicketTypeRegistrations({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toEqual([
      { label: "Sold out", count: 5 },
      { label: "GC super early bird", count: 0 },
    ]);
  });

  it("appends the No ticket type bucket last, only when its count is > 0 (spec §1 AC-5)", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([
      { id: "tt-a", name: "Standard" },
    ]);
    countAdminAttendeesForEvent.mockImplementation(
      async ({ ticketTypeId }: { ticketTypeId: string | null }) =>
        ticketTypeId === null ? 4 : 10,
    );

    const rows = await loadTicketTypeRegistrations({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toEqual([
      { label: "Standard", count: 10 },
      { label: "No ticket type", count: 4 },
    ]);
  });

  it("omits the No ticket type bucket entirely when its count is 0", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([
      { id: "tt-a", name: "Standard" },
    ]);
    countAdminAttendeesForEvent.mockResolvedValue(0);

    const rows = await loadTicketTypeRegistrations({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toEqual([{ label: "Standard", count: 0 }]);
  });

  it("returns an empty array for zero ticket types (chart's own empty state, spec §1 AC-6)", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([]);
    countAdminAttendeesForEvent.mockResolvedValue(0);

    const rows = await loadTicketTypeRegistrations({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toEqual([]);
  });
});

describe("loadFinanceSummary", () => {
  it("returns null when the event has zero RegistrationPath docs (spec §4 AC-3)", async () => {
    getAdminRegistrationPathsForEvent.mockResolvedValue([]);
    getAdminEventPromotionsForEvent.mockResolvedValue([]);

    const data = await loadFinanceSummary({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(data).toBeNull();
    expect(sumAdminOrderTotalsForEvent).not.toHaveBeenCalled();
  });

  it("renders a single currency section unchanged in shape (spec §4 AC-1)", async () => {
    getAdminRegistrationPathsForEvent.mockResolvedValue([{ currency: "USD" }]);
    getAdminEventPromotionsForEvent.mockResolvedValue([
      { usedCount: 3 },
      { usedCount: 0 },
    ]);
    sumAdminOrderTotalsForEvent.mockImplementation(
      async ({
        paymentStatus,
        field,
      }: {
        paymentStatus: string;
        field: string;
      }) => {
        if (paymentStatus === "paid") return 10000;
        if (paymentStatus === "outstanding") return 5000;
        if (paymentStatus === "comped" && field === "subtotalMinor")
          return 2000;
        return 0;
      },
    );

    const data = await loadFinanceSummary({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(data).toEqual({
      currencies: [
        {
          currency: "USD",
          paidMinor: 10000,
          outstandingMinor: 5000,
          compedMinor: 2000,
        },
      ],
      discountCodesUsed: 1,
    });
  });

  it("scopes each currency's sums independently — a GBP sum never blends into USD (spec §4 AC-2)", async () => {
    getAdminRegistrationPathsForEvent.mockResolvedValue([
      { currency: "USD" },
      { currency: "GBP" },
      { currency: "USD" }, // duplicate currency across two paths — deduped
    ]);
    getAdminEventPromotionsForEvent.mockResolvedValue([]);
    sumAdminOrderTotalsForEvent.mockImplementation(
      async ({
        currency,
        paymentStatus,
      }: {
        currency: string;
        paymentStatus: string;
      }) => {
        if (currency === "USD" && paymentStatus === "paid") return 10000;
        if (currency === "GBP" && paymentStatus === "paid") return 7500;
        return 0;
      },
    );

    const data = await loadFinanceSummary({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(data?.currencies).toEqual([
      { currency: "GBP", paidMinor: 7500, outstandingMinor: 0, compedMinor: 0 },
      {
        currency: "USD",
        paidMinor: 10000,
        outstandingMinor: 0,
        compedMinor: 0,
      },
    ]);
  });

  it("counts distinct discount codes used (usedCount >= 1), not total redemptions (spec §2 AC-4)", async () => {
    getAdminRegistrationPathsForEvent.mockResolvedValue([{ currency: "USD" }]);
    getAdminEventPromotionsForEvent.mockResolvedValue([
      { usedCount: 6 },
      { usedCount: 1 },
      { usedCount: 0 },
    ]);
    sumAdminOrderTotalsForEvent.mockResolvedValue(0);

    const data = await loadFinanceSummary({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(data?.discountCodesUsed).toBe(2);
  });

  it("zero orders of any kind renders every money row at 0, not NaN/undefined (spec §2 AC-5)", async () => {
    getAdminRegistrationPathsForEvent.mockResolvedValue([{ currency: "USD" }]);
    getAdminEventPromotionsForEvent.mockResolvedValue([]);
    sumAdminOrderTotalsForEvent.mockResolvedValue(0);

    const data = await loadFinanceSummary({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(data).toEqual({
      currencies: [
        { currency: "USD", paidMinor: 0, outstandingMinor: 0, compedMinor: 0 },
      ],
      discountCodesUsed: 0,
    });
  });
});
