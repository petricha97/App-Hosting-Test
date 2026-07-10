/**
 * M2 — pricing schema + conversion tests.
 * Spec: agents/docs/specs/m2-pricing-commerce.md (T1 AC-2, T3 AC-2, T2 AC-6).
 *
 * Locks the decimal-string boundaries: major-unit prices -> integer minor
 * units (<= 2dp), decimal rates -> integer milli-percent (<= 3dp, 0-100%),
 * and the discount-settings validation rules.
 */
import { describe, expect, it } from "vitest";

import {
  buildDiscountSettingsPayload,
  buildFeePayload,
  buildTaxPayload,
  discountSettingsPayloadSchema,
  feePayloadSchema,
  formatMilliPercentAsRateInput,
  formatMinorAsPriceInput,
  parsePriceInputToMinor,
  parseRateInputToMilliPercent,
  taxPayloadSchema,
} from "@/features/pricing/schemas";

describe("parsePriceInputToMinor — major units to integer minor units", () => {
  it("parses whole and 2-decimal amounts exactly", () => {
    expect(parsePriceInputToMinor("750.00")).toBe(75000);
    expect(parsePriceInputToMinor("750")).toBe(75000);
    expect(parsePriceInputToMinor("950.5")).toBe(95050);
    expect(parsePriceInputToMinor("0")).toBe(0);
    expect(parsePriceInputToMinor("0.01")).toBe(1);
  });

  it("is exact where float multiplication would not be (e.g. 19.99)", () => {
    // 19.99 * 100 === 1998.9999999999998 in floats — integer parsing avoids it.
    expect(parsePriceInputToMinor("19.99")).toBe(1999);
  });

  it("rejects more than 2 decimals, negatives, and junk", () => {
    expect(parsePriceInputToMinor("750.005")).toBeNull();
    expect(parsePriceInputToMinor("-1")).toBeNull();
    expect(parsePriceInputToMinor("")).toBeNull();
    expect(parsePriceInputToMinor("1,000")).toBeNull();
    expect(parsePriceInputToMinor("abc")).toBeNull();
    expect(parsePriceInputToMinor("1e3")).toBeNull();
  });

  it("rejects amounts above the sanity ceiling", () => {
    expect(parsePriceInputToMinor("1000000000")).toBe(100_000_000_000);
    expect(parsePriceInputToMinor("1000000001")).toBeNull();
  });

  it("round-trips with formatMinorAsPriceInput", () => {
    expect(formatMinorAsPriceInput(75000)).toBe("750.00");
    expect(formatMinorAsPriceInput(1999)).toBe("19.99");
    expect(formatMinorAsPriceInput(0)).toBe("0.00");
    expect(parsePriceInputToMinor(formatMinorAsPriceInput(95050))).toBe(95050);
  });
});

describe("parseRateInputToMilliPercent — decimal rate to integer milli-percent", () => {
  it("parses up to 3 decimals exactly", () => {
    expect(parseRateInputToMilliPercent("8.875")).toBe(8875);
    expect(parseRateInputToMilliPercent("20")).toBe(20000);
    expect(parseRateInputToMilliPercent("20.00")).toBe(20000);
    expect(parseRateInputToMilliPercent("0")).toBe(0);
    expect(parseRateInputToMilliPercent("100")).toBe(100000);
    expect(parseRateInputToMilliPercent("0.001")).toBe(1);
  });

  it("rejects >3 decimals, >100%, negatives, junk", () => {
    expect(parseRateInputToMilliPercent("8.8751")).toBeNull();
    expect(parseRateInputToMilliPercent("100.001")).toBeNull();
    expect(parseRateInputToMilliPercent("101")).toBeNull();
    expect(parseRateInputToMilliPercent("-5")).toBeNull();
    expect(parseRateInputToMilliPercent("")).toBeNull();
    expect(parseRateInputToMilliPercent("abc")).toBeNull();
  });

  it("round-trips with formatMilliPercentAsRateInput", () => {
    expect(formatMilliPercentAsRateInput(8875)).toBe("8.875");
    expect(formatMilliPercentAsRateInput(20000)).toBe("20");
    expect(formatMilliPercentAsRateInput(8800)).toBe("8.8");
    expect(parseRateInputToMilliPercent(formatMilliPercentAsRateInput(8875))).toBe(
      8875,
    );
  });
});

describe("feePayloadSchema", () => {
  const base = {
    name: "GC-EB Delegate USD",
    ticketTypeId: "tt-1",
    registrationTypeId: null,
    currency: "USD",
    basePriceMinor: 95000,
  };

  it("accepts a valid payload and defaults status to active", () => {
    const parsed = feePayloadSchema.parse(base);
    expect(parsed.status).toBe("active");
    expect(parsed.registrationTypeId).toBeNull();
  });

  it("strips server-owned fields (organizationId, eventId, createdAt)", () => {
    const parsed = feePayloadSchema.parse({
      ...base,
      organizationId: "org-evil",
      eventId: "evt-evil",
      createdAt: "now",
    });
    expect("organizationId" in parsed).toBe(false);
    expect("eventId" in parsed).toBe(false);
    expect("createdAt" in parsed).toBe(false);
  });

  it("rejects non-integer, negative prices and unknown currencies", () => {
    expect(feePayloadSchema.safeParse({ ...base, basePriceMinor: 950.5 }).success).toBe(false);
    expect(feePayloadSchema.safeParse({ ...base, basePriceMinor: -1 }).success).toBe(false);
    expect(feePayloadSchema.safeParse({ ...base, currency: "JPY" }).success).toBe(false);
  });

  it("rejects names outside 1-80 chars", () => {
    expect(feePayloadSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(
      feePayloadSchema.safeParse({ ...base, name: "x".repeat(81) }).success,
    ).toBe(false);
  });
});

describe("buildFeePayload — form values to API payload", () => {
  it("converts the ALL sentinel to null and the price to minor units", () => {
    const payload = buildFeePayload({
      name: "  GC-EB Delegate USD  ",
      ticketTypeId: "tt-1",
      registrationTypeId: "all",
      currency: "USD",
      price: "950.00",
      active: true,
    });
    expect(payload).toEqual({
      name: "GC-EB Delegate USD",
      ticketTypeId: "tt-1",
      registrationTypeId: null,
      currency: "USD",
      basePriceMinor: 95000,
      status: "active",
    });
  });

  it("keeps a specific registration type and maps inactive to archived", () => {
    const payload = buildFeePayload({
      name: "GC-EB",
      ticketTypeId: "tt-1",
      registrationTypeId: "rt-1",
      currency: "GBP",
      price: "0",
      active: false,
    });
    expect(payload.registrationTypeId).toBe("rt-1");
    expect(payload.basePriceMinor).toBe(0);
    expect(payload.status).toBe("archived");
  });
});

describe("taxPayloadSchema — discriminated union", () => {
  it("accepts a percentage tax and normalizes the code to uppercase", () => {
    const parsed = taxPayloadSchema.parse({
      name: "UK VAT",
      code: "vat-uk",
      type: "percentage",
      rateMilliPercent: 20000,
    });
    expect(parsed.code).toBe("VAT-UK");
    expect(parsed.isActive).toBe(true);
  });

  it("accepts a fixed tax with amount + currency", () => {
    const parsed = taxPayloadSchema.parse({
      name: "Card levy",
      code: "LEVY-GB",
      type: "fixed",
      fixedAmountMinor: 250,
      fixedCurrency: "GBP",
      isActive: false,
    });
    expect(parsed.type).toBe("fixed");
    expect(parsed.isActive).toBe(false);
  });

  it("rejects mixed / incomplete groups", () => {
    expect(
      taxPayloadSchema.safeParse({
        name: "UK VAT",
        code: "VAT-UK",
        type: "percentage",
        // missing rateMilliPercent
      }).success,
    ).toBe(false);
    expect(
      taxPayloadSchema.safeParse({
        name: "Levy",
        code: "LEVY",
        type: "fixed",
        fixedAmountMinor: 250,
        // missing fixedCurrency
      }).success,
    ).toBe(false);
  });

  it("rejects fractional milli-percent and out-of-range rates", () => {
    const base = { name: "UK VAT", code: "VAT-UK", type: "percentage" };
    expect(
      taxPayloadSchema.safeParse({ ...base, rateMilliPercent: 8875.5 }).success,
    ).toBe(false);
    expect(
      taxPayloadSchema.safeParse({ ...base, rateMilliPercent: 100001 }).success,
    ).toBe(false);
    expect(
      taxPayloadSchema.safeParse({ ...base, rateMilliPercent: -1 }).success,
    ).toBe(false);
  });
});

describe("buildTaxPayload — form values to API payload", () => {
  const formBase = {
    name: "New York Sales Tax",
    code: "tax-ny",
    rate: "8.875",
    fixedAmount: "",
    fixedCurrency: "USD" as const,
    isActive: true,
  };

  it("percentage: converts the decimal rate to milli-percent", () => {
    const payload = buildTaxPayload({ ...formBase, type: "percentage" });
    expect(payload).toEqual({
      name: "New York Sales Tax",
      code: "TAX-NY",
      type: "percentage",
      rateMilliPercent: 8875,
      isActive: true,
    });
  });

  it("fixed: converts the amount to minor units in its currency", () => {
    const payload = buildTaxPayload({
      ...formBase,
      type: "fixed",
      fixedAmount: "2.50",
      fixedCurrency: "GBP",
    });
    expect(payload).toEqual({
      name: "New York Sales Tax",
      code: "TAX-NY",
      type: "fixed",
      fixedAmountMinor: 250,
      fixedCurrency: "GBP",
      isActive: true,
    });
  });
});

describe("discountSettingsPayloadSchema (T2 AC-6/AC-7)", () => {
  const base = {
    level: "event",
    validityStart: "2026-08-01",
    validityEnd: "2026-08-31",
    usageCap: 3,
    isActive: true,
  };

  it("accepts a valid payload; equal dates are a valid single-day window", () => {
    expect(discountSettingsPayloadSchema.safeParse(base).success).toBe(true);
    expect(
      discountSettingsPayloadSchema.safeParse({
        ...base,
        validityEnd: "2026-08-01",
      }).success,
    ).toBe(true);
  });

  it("rejects validityEnd before validityStart", () => {
    const result = discountSettingsPayloadSchema.safeParse({
      ...base,
      validityStart: "2026-08-31",
      validityEnd: "2026-08-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(
      discountSettingsPayloadSchema.safeParse({
        ...base,
        validityStart: "2026-02-31",
      }).success,
    ).toBe(false);
  });

  it("usageCap must be an integer >= 1 or null", () => {
    expect(
      discountSettingsPayloadSchema.safeParse({ ...base, usageCap: 0 }).success,
    ).toBe(false);
    expect(
      discountSettingsPayloadSchema.safeParse({ ...base, usageCap: 2.5 }).success,
    ).toBe(false);
    expect(
      discountSettingsPayloadSchema.safeParse({ ...base, usageCap: null }).success,
    ).toBe(true);
  });

  it("strips usedCount from the payload (server-owned, AC-7)", () => {
    const parsed = discountSettingsPayloadSchema.parse({
      ...base,
      usedCount: 999,
    });
    expect("usedCount" in parsed).toBe(false);
  });

  it("rejects unknown levels", () => {
    expect(
      discountSettingsPayloadSchema.safeParse({ ...base, level: "global" })
        .success,
    ).toBe(false);
  });
});

describe("buildDiscountSettingsPayload", () => {
  it("maps empty dates to null and the usage switch to a cap or null", () => {
    expect(
      buildDiscountSettingsPayload({
        level: "partner",
        validityStart: "",
        validityEnd: "2026-08-31",
        limitUsage: true,
        usageCap: "3",
        isActive: false,
      }),
    ).toEqual({
      level: "partner",
      validityStart: null,
      validityEnd: "2026-08-31",
      usageCap: 3,
      isActive: false,
    });
    expect(
      buildDiscountSettingsPayload({
        level: "event",
        validityStart: "",
        validityEnd: "",
        limitUsage: false,
        usageCap: "7",
        isActive: true,
      }).usageCap,
    ).toBeNull();
  });
});
