// @vitest-environment node
/**
 * M4-T1 — path-agnostic pricing projection for the TicketPricingTable block
 * (src/features/public-registration/pricing-projection.ts).
 * Spec ACs: 1 (derived-open filter, inclusive boundaries), 2 (priced filter,
 * per-currency gaps), 3 (min-across-fees "from" rule), 4 (sold-out badged not
 * hidden), 7 (exact-key public safety).
 */
import { describe, expect, it } from "vitest";

import {
  buildPublicPricingProjection,
  type PricingProjectionFeeInput,
  type PricingProjectionTicketInput,
} from "@/features/public-registration/pricing-projection";

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);

function ticket(
  overrides: Partial<PricingProjectionTicketInput> = {},
): PricingProjectionTicketInput {
  return {
    id: "tick-1",
    name: "General Admission",
    code: "GA",
    capacity: 100,
    registeredCount: 10,
    isOpen: true,
    salesStartMs: null,
    salesEndMs: null,
    registrationTypeIds: [],
    ...overrides,
  };
}

function fee(
  overrides: Partial<PricingProjectionFeeInput> = {},
): PricingProjectionFeeInput {
  return {
    ticketTypeId: "tick-1",
    registrationTypeId: null,
    currency: "USD",
    basePriceMinor: 12000,
    status: "active",
    ...overrides,
  };
}

describe("buildPublicPricingProjection — visibility rules", () => {
  it("hides derived-closed tickets: manual close, before salesStart, after salesEnd (AC-1)", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({ id: "closed", code: "CLOSED", isOpen: false }),
        ticket({ id: "future", code: "FUTURE", salesStartMs: NOW + 1 }),
        ticket({ id: "past", code: "PAST", salesEndMs: NOW - 1 }),
        ticket({ id: "open", code: "OPEN" }),
      ],
      fees: ["closed", "future", "past", "open"].map((id) =>
        fee({ ticketTypeId: id }),
      ),
      registrationTypes: [],
      nowMs: NOW,
    });

    expect(result.tickets.map((row) => row.code)).toEqual(["OPEN"]);
  });

  it("is open AT salesStart and AT salesEnd exactly (inclusive boundaries, M1 rule reuse)", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({ id: "at-start", code: "ATSTART", salesStartMs: NOW }),
        ticket({ id: "at-end", code: "ATEND", salesEndMs: NOW }),
      ],
      fees: [
        fee({ ticketTypeId: "at-start" }),
        fee({ ticketTypeId: "at-end" }),
      ],
      registrationTypes: [],
      nowMs: NOW,
    });

    expect(result.tickets.map((row) => row.code)).toEqual(["ATSTART", "ATEND"]);
  });

  it("hides tickets with no active fee in any currency; archived fees never price (AC-2)", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({ id: "unpriced", code: "UNPRICED" }),
        ticket({ id: "archived-only", code: "ARCH" }),
        ticket({ id: "priced", code: "PRICED" }),
      ],
      fees: [
        fee({ ticketTypeId: "archived-only", status: "archived" }),
        fee({ ticketTypeId: "priced" }),
      ],
      registrationTypes: [],
      nowMs: NOW,
    });

    expect(result.tickets.map((row) => row.code)).toEqual(["PRICED"]);
  });

  it("keeps sold-out tickets listed with soldOut=true and a visible price (AC-4)", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({ id: "full", code: "FULL", capacity: 10, registeredCount: 10 }),
        ticket({
          id: "over",
          code: "OVER",
          capacity: 10,
          registeredCount: 12,
        }),
        ticket({ id: "unlimited", code: "UNLIM", capacity: null }),
      ],
      fees: ["full", "over", "unlimited"].map((id) =>
        fee({ ticketTypeId: id }),
      ),
      registrationTypes: [],
      nowMs: NOW,
    });

    expect(
      result.tickets.map((row) => [row.code, row.soldOut]),
    ).toEqual([
      ["FULL", true],
      ["OVER", true],
      ["UNLIM", false],
    ]);
    expect(result.tickets[0].prices).toHaveLength(1);
  });

  it("does not hide audience-restricted tickets; audience names render as caption data", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({ id: "vip", code: "VIP", registrationTypeIds: ["rt-1", "rt-x"] }),
      ],
      fees: [fee({ ticketTypeId: "vip" })],
      registrationTypes: [{ id: "rt-1", name: "Delegate" }],
      nowMs: NOW,
    });

    expect(result.tickets).toHaveLength(1);
    // Unknown ids are dropped, not leaked.
    expect(result.tickets[0].audienceNames).toEqual(["Delegate"]);
  });
});

describe("buildPublicPricingProjection — price rules (AC-2/3)", () => {
  it("uses min across fees with isFrom only when >1 DISTINCT amount exists per currency", () => {
    const result = buildPublicPricingProjection({
      tickets: [ticket()],
      fees: [
        fee({ registrationTypeId: "rt-1", basePriceMinor: 15000 }),
        fee({ registrationTypeId: null, basePriceMinor: 12000 }),
        // Equal amounts in GBP → exact price, not "from".
        fee({ currency: "GBP", registrationTypeId: "rt-1", basePriceMinor: 9000 }),
        fee({ currency: "GBP", registrationTypeId: "rt-2", basePriceMinor: 9000 }),
      ],
      registrationTypes: [],
      nowMs: NOW,
    });

    expect(result.tickets[0].prices).toEqual([
      { currency: "USD", minPriceMinor: 12000, isFrom: true },
      { currency: "GBP", minPriceMinor: 9000, isFrom: false },
    ]);
  });

  it("omits currencies a ticket is not priced in, while the projection still lists them as columns", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({ id: "both", code: "BOTH" }),
        ticket({ id: "usd-only", code: "USDONLY" }),
      ],
      fees: [
        fee({ ticketTypeId: "both", currency: "USD", basePriceMinor: 100 }),
        fee({ ticketTypeId: "both", currency: "EUR", basePriceMinor: 200 }),
        fee({ ticketTypeId: "usd-only", currency: "USD", basePriceMinor: 300 }),
      ],
      registrationTypes: [],
      nowMs: NOW,
    });

    expect(result.currencies).toEqual(["USD", "EUR"]);
    const usdOnly = result.tickets.find((row) => row.code === "USDONLY");
    expect(usdOnly?.prices.map((price) => price.currency)).toEqual(["USD"]);
  });

  it("orders currencies by first appearance across rows", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({ id: "t1", code: "T1" }),
        ticket({ id: "t2", code: "T2" }),
      ],
      fees: [
        fee({ ticketTypeId: "t1", currency: "GBP" }),
        fee({ ticketTypeId: "t2", currency: "USD" }),
        fee({ ticketTypeId: "t2", currency: "GBP" }),
      ],
      registrationTypes: [],
      nowMs: NOW,
    });

    expect(result.currencies).toEqual(["GBP", "USD"]);
  });
});

describe("buildPublicPricingProjection — public safety (AC-7)", () => {
  it("emits EXACTLY the public keys — no ids, capacity, counts, or sales timestamps", () => {
    const result = buildPublicPricingProjection({
      tickets: [
        ticket({
          registrationTypeIds: ["rt-1"],
          capacity: 5,
          registeredCount: 3,
          salesStartMs: NOW - 1000,
          salesEndMs: NOW + 1000,
        }),
      ],
      fees: [fee()],
      registrationTypes: [{ id: "rt-1", name: "Delegate" }],
      nowMs: NOW,
    });

    expect(Object.keys(result).sort()).toEqual(["currencies", "tickets"]);
    const row = result.tickets[0];
    expect(Object.keys(row).sort()).toEqual([
      "audienceNames",
      "code",
      "name",
      "prices",
      "soldOut",
    ]);
    for (const price of row.prices) {
      expect(Object.keys(price).sort()).toEqual([
        "currency",
        "isFrom",
        "minPriceMinor",
      ]);
    }
    // Audience is exposed as NAMES only — never raw registration type ids.
    expect(row.audienceNames).toEqual(["Delegate"]);
  });
});
