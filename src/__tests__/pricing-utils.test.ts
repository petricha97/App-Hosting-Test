/**
 * M2 — pricing display utils.
 * Spec: agents/docs/specs/m2-pricing-commerce.md.
 *
 * Locks: tab resolution (?tab= fallback), money formatting incl. the "Comp"
 * convention (T1 AC-1), rate formatting with 3rd-decimal trimming (T3 AC-1),
 * discount Valid/Used cells + derived Active (T2 AC-2/AC-3), and the ticket
 * Price column display rules (T1 AC-12).
 */
import { describe, expect, it } from "vitest";

import type { SerializedFee } from "@/features/pricing/types";
import {
  formatDiscountAmount,
  formatFeePrice,
  formatMoney,
  formatRate,
  formatTaxRate,
  formatUsageLabel,
  formatValidityLabel,
  getTicketPriceDisplay,
  isDiscountCurrentlyActive,
  resolvePricingTab,
} from "@/features/pricing/utils";

describe("resolvePricingTab", () => {
  it("passes through the four valid tabs", () => {
    expect(resolvePricingTab("fees")).toBe("fees");
    expect(resolvePricingTab("discounts")).toBe("discounts");
    expect(resolvePricingTab("taxes")).toBe("taxes");
    expect(resolvePricingTab("service-fees")).toBe("service-fees");
  });

  it("defaults invalid / missing values to fees", () => {
    expect(resolvePricingTab(undefined)).toBe("fees");
    expect(resolvePricingTab(null)).toBe("fees");
    expect(resolvePricingTab("")).toBe("fees");
    expect(resolvePricingTab("orders")).toBe("fees");
    expect(resolvePricingTab(42)).toBe("fees");
  });
});

describe("formatMoney / formatFeePrice — per-currency, Comp on 0", () => {
  it("formats minor units per currency (prototype rows)", () => {
    expect(formatMoney(95000, "USD")).toBe("$950.00");
    expect(formatMoney(78000, "GBP")).toBe("£780.00");
    expect(formatMoney(145000, "USD")).toBe("$1,450.00");
  });

  it('renders "Comp" for basePriceMinor 0 — never "$0.00"', () => {
    expect(formatFeePrice(0, "USD")).toBe("Comp");
    expect(formatFeePrice(0, "GBP")).toBe("Comp");
    expect(formatFeePrice(75000, "USD")).toBe("$750.00");
  });
});

describe("formatRate — milli-percent, >=2dp, trim trailing zero beyond 2dp", () => {
  it("reproduces the prototype rows", () => {
    expect(formatRate(20000)).toBe("20.00%");
    expect(formatRate(8875)).toBe("8.875%");
  });

  it("trims a trailing zero in the 3rd place only", () => {
    expect(formatRate(8870)).toBe("8.87%");
    expect(formatRate(8800)).toBe("8.80%");
    expect(formatRate(0)).toBe("0.00%");
    expect(formatRate(100000)).toBe("100.00%");
  });
});

describe("formatTaxRate — percentage vs fixed cells", () => {
  it("formats percentage taxes as rates and fixed taxes as money", () => {
    expect(
      formatTaxRate({
        id: "t1",
        name: "VAT",
        code: "VAT-UK",
        type: "percentage",
        rateMilliPercent: 20000,
        fixedAmountMinor: null,
        fixedCurrency: null,
        isActive: false,
      }),
    ).toBe("20.00%");
    expect(
      formatTaxRate({
        id: "t2",
        name: "Levy",
        code: "LEVY-GB",
        type: "fixed",
        rateMilliPercent: null,
        fixedAmountMinor: 250,
        fixedCurrency: "GBP",
        isActive: true,
      }),
    ).toBe("£2.50");
  });
});

describe("formatDiscountAmount (T2 AC-1)", () => {
  it("renders percentages by type — 100% stays a percentage", () => {
    expect(formatDiscountAmount("percentage", 10)).toBe("10%");
    expect(formatDiscountAmount("percentage", 100)).toBe("100%");
    expect(formatDiscountAmount("percentage", 8.875)).toBe("8.875%");
  });

  it("renders fixed amounts as bare 2dp numbers (no currency of their own)", () => {
    expect(formatDiscountAmount("fixed", 600)).toBe("600.00");
    expect(formatDiscountAmount("fixed", 1250.5)).toBe("1,250.50");
  });

  it("degrades legacy/loose configs to an em dash", () => {
    expect(formatDiscountAmount(null, 10)).toBe("—");
    expect(formatDiscountAmount("bogus", 10)).toBe("—");
    expect(formatDiscountAmount("percentage", null)).toBe("—");
  });
});

describe("formatValidityLabel (T2 AC-2)", () => {
  const timeZone = "UTC";
  const nowMs = Date.UTC(2026, 6, 10); // Jul 10 2026 — same year as bounds
  const aug1 = Date.UTC(2026, 7, 1);
  const aug31 = Date.UTC(2026, 7, 31, 23, 59, 59, 999);

  it("covers all four shapes", () => {
    expect(
      formatValidityLabel(
        { validityStartMs: null, validityEndMs: aug31 },
        { timeZone, nowMs },
      ),
    ).toBe("→ Aug 31");
    expect(
      formatValidityLabel(
        { validityStartMs: aug1, validityEndMs: null },
        { timeZone, nowMs },
      ),
    ).toBe("Aug 1 →");
    expect(
      formatValidityLabel(
        { validityStartMs: aug1, validityEndMs: aug31 },
        { timeZone, nowMs },
      ),
    ).toBe("Aug 1 → Aug 31");
    expect(
      formatValidityLabel(
        { validityStartMs: null, validityEndMs: null },
        { timeZone, nowMs },
      ),
    ).toBe("—");
  });

  it("renders in the event timezone", () => {
    // Aug 31 23:59:59.999 SGT is Aug 31 15:59 UTC — must still say Aug 31 in SGT.
    const sgtEnd = Date.UTC(2026, 7, 31, 15, 59, 59, 999);
    expect(
      formatValidityLabel(
        { validityStartMs: null, validityEndMs: sgtEnd },
        { timeZone: "Asia/Singapore", nowMs },
      ),
    ).toBe("→ Aug 31");
  });
});

describe("formatUsageLabel (T2 AC-2)", () => {
  it('renders "used / cap" when capped, bare used when uncapped', () => {
    expect(formatUsageLabel(1, 3)).toBe("1 / 3");
    expect(formatUsageLabel(0, null)).toBe("0");
    expect(formatUsageLabel(7, 7)).toBe("7 / 7");
  });
});

describe("isDiscountCurrentlyActive — derived badge (T2 AC-3)", () => {
  const nowMs = Date.UTC(2026, 6, 10);
  const base = {
    isActive: true,
    validityStartMs: null as number | null,
    validityEndMs: null as number | null,
    usageCap: null as number | null,
    usedCount: 0,
  };

  it("is true when every gate passes", () => {
    expect(isDiscountCurrentlyActive(base, nowMs)).toBe(true);
  });

  it('shows "No" when manually inactive', () => {
    expect(isDiscountCurrentlyActive({ ...base, isActive: false }, nowMs)).toBe(
      false,
    );
  });

  it('expired codes show "No" even when isActive is true', () => {
    expect(
      isDiscountCurrentlyActive(
        { ...base, validityEndMs: Date.UTC(2026, 5, 30) },
        nowMs,
      ),
    ).toBe(false);
  });

  it('exhausted codes show "No" even when isActive is true', () => {
    expect(
      isDiscountCurrentlyActive({ ...base, usageCap: 3, usedCount: 3 }, nowMs),
    ).toBe(false);
    expect(
      isDiscountCurrentlyActive({ ...base, usageCap: 3, usedCount: 2 }, nowMs),
    ).toBe(true);
  });

  it("not-yet-started windows are inactive", () => {
    expect(
      isDiscountCurrentlyActive(
        { ...base, validityStartMs: Date.UTC(2026, 7, 1) },
        nowMs,
      ),
    ).toBe(false);
  });
});

describe("getTicketPriceDisplay — ticket Price column (T1 AC-12)", () => {
  function fee(overrides: Partial<SerializedFee>): SerializedFee {
    return {
      id: "fee-1",
      name: "Fee",
      ticketTypeId: "tt-1",
      registrationTypeId: null,
      currency: "USD",
      basePriceMinor: 95000,
      status: "active",
      ...overrides,
    };
  }

  it("returns null when no fee prices the ticket (cell renders — link)", () => {
    expect(getTicketPriceDisplay("tt-1", [])).toBeNull();
    expect(
      getTicketPriceDisplay("tt-1", [fee({ ticketTypeId: "tt-other" })]),
    ).toBeNull();
  });

  it("ignores archived fees entirely", () => {
    expect(
      getTicketPriceDisplay("tt-1", [fee({ status: "archived" })]),
    ).toBeNull();
  });

  it("single active fee -> that price, no extra", () => {
    expect(getTicketPriceDisplay("tt-1", [fee({})])).toEqual({
      label: "$950.00",
      extra: null,
      title: undefined,
    });
  });

  it('single comp fee -> "Comp"', () => {
    expect(
      getTicketPriceDisplay("tt-1", [fee({ basePriceMinor: 0 })])?.label,
    ).toBe("Comp");
  });

  it('multiple fees -> lowest price + "+N more" with a full tooltip', () => {
    const display = getTicketPriceDisplay("tt-1", [
      fee({ id: "f1", basePriceMinor: 95000, currency: "USD" }),
      fee({ id: "f2", basePriceMinor: 78000, currency: "GBP" }),
      fee({ id: "f3", basePriceMinor: 145000, currency: "USD" }),
    ]);
    expect(display).toEqual({
      label: "£780.00",
      extra: "+2 more",
      title: "£780.00, $950.00, $1,450.00",
    });
  });

  it("a comp fee among several is the lowest and renders Comp", () => {
    const display = getTicketPriceDisplay("tt-1", [
      fee({ id: "f1", basePriceMinor: 95000 }),
      fee({ id: "f2", basePriceMinor: 0 }),
    ]);
    expect(display?.label).toBe("Comp");
    expect(display?.extra).toBe("+1 more");
  });
});
