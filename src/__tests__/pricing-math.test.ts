/**
 * M2 pricing & commerce — pure money math.
 * Spec: agents/docs/specs/m2-pricing-commerce.md.
 *
 * The "Worked examples (normative)" table is implemented VERBATIM below, plus
 * the extra pinned cases and the M2-T3 AC-5 tax-math cases. Also covers the
 * pure finalize-transaction parts: promotion availability derivation
 * (M2-T2 AC-3 truth table), migration-safe read defaults (M2-T2 AC-5), and
 * deterministic order IDs (M2-T4 AC-7).
 */
import { describe, expect, it } from "vitest";

import {
  applyEventPromotionReadDefaults,
  deriveEventPromotionAvailability,
} from "@/lib/db/eventPromotionDefaults";
import { orderIdFromIdempotencyKey } from "@/lib/orders/order-id";
import {
  CURRENCY_MINOR_DIGITS,
  computeOrderTotals,
  orderAmountsEqual,
  promotionToPricingInput,
  roundHalfUp,
  type PricingTax,
} from "@/lib/orders/pricing-math";
import type { EventPromotionDoc } from "@/types/collection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TAX_NY: PricingTax = {
  taxId: "tax-ny",
  code: "TAX-NY",
  type: "percentage",
  rateMilliPercent: 8875, // 8.875%
  fixedAmountMinor: null,
  fixedCurrency: null,
  isActive: true,
};

const VAT_UK_INACTIVE: PricingTax = {
  taxId: "tax-vat-uk",
  code: "VAT-UK",
  type: "percentage",
  rateMilliPercent: 20000, // 20.00%
  fixedAmountMinor: null,
  fixedCurrency: null,
  isActive: false,
};

const FIXED_GBP_TAX: PricingTax = {
  taxId: "tax-fixed-gbp",
  code: "LEVY-UK",
  type: "fixed",
  rateMilliPercent: null,
  fixedAmountMinor: 250,
  fixedCurrency: "GBP",
  isActive: true,
};

// ---------------------------------------------------------------------------
// roundHalfUp — integer half-up division (Shared decisions)
// ---------------------------------------------------------------------------

describe("roundHalfUp", () => {
  it("rounds exact .5 UP (10% of 105 minor units = 10.5 -> 11)", () => {
    expect(roundHalfUp(105 * 10000, 100000)).toBe(11);
  });

  it("rounds below .5 down", () => {
    // 8.875% of 85500 = 7588.125 -> 7588
    expect(roundHalfUp(85500 * 8875, 100000)).toBe(7588);
  });

  it("rounds above .5 up", () => {
    expect(roundHalfUp(7, 4)).toBe(2); // 1.75 -> 2
  });

  it("handles zero numerator", () => {
    expect(roundHalfUp(0, 100000)).toBe(0);
  });

  it("is exact on integer quotients", () => {
    expect(roundHalfUp(95000 * 10000, 100000)).toBe(9500);
  });

  it("rejects non-integer and negative inputs", () => {
    expect(() => roundHalfUp(1.5, 10)).toThrow(RangeError);
    expect(() => roundHalfUp(-1, 10)).toThrow(RangeError);
    expect(() => roundHalfUp(10, 0)).toThrow(RangeError);
  });
});

describe("CURRENCY_MINOR_DIGITS", () => {
  it("covers the four supported currencies with 2 minor digits", () => {
    expect(CURRENCY_MINOR_DIGITS).toEqual({ USD: 2, GBP: 2, EUR: 2, SGD: 2 });
  });
});

// ---------------------------------------------------------------------------
// Worked examples (normative table — implemented verbatim)
// ---------------------------------------------------------------------------

describe("computeOrderTotals — worked examples (normative)", () => {
  it("#1 Plain card: GC-SEB×Delegate×USD 75000, no discount, no tax -> 75000", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 75000, currency: "USD" },
      null,
      [],
    );
    expect(totals.subtotalMinor).toBe(75000);
    expect(totals.discountMinor).toBe(0);
    expect(totals.taxableBaseMinor).toBe(75000);
    expect(totals.taxMinor).toBe(0);
    expect(totals.totalMinor).toBe(75000);
  });

  it("#2 % + tax: GC-EB×Delegate×USD 95000, GCUS10 10%, TAX-NY 8.875% -> 93088", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 95000, currency: "USD" },
      { discountType: "percentage", discountValue: 10 },
      [TAX_NY],
    );
    expect(totals.discountMinor).toBe(9500);
    expect(totals.taxableBaseMinor).toBe(85500);
    // 8.875% of 85500 = 7588.125, half-up rounds DOWN here.
    expect(totals.taxMinor).toBe(7588);
    expect(totals.totalMinor).toBe(93088);
    expect(totals.taxLines).toEqual([
      {
        taxId: "tax-ny",
        code: "TAX-NY",
        rateMilliPercent: 8875,
        fixedAmountMinor: null,
        amountMinor: 7588,
      },
    ]);
  });

  it("#3 Fixed + cap: GC-EB×Delegate×GBP 78000, £600GCUS fixed 600 -> 60000 off, total 18000", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 78000, currency: "GBP" },
      { discountType: "fixed", discountValue: 600 },
      [],
    );
    expect(totals.discountMinor).toBe(60000);
    expect(totals.taxableBaseMinor).toBe(18000);
    expect(totals.taxMinor).toBe(0);
    expect(totals.totalMinor).toBe(18000);
  });

  it("#3 cap arithmetic: usedCount 1 -> 2 under cap 3; 4th use is exhausted", () => {
    // The counter increment itself is transactional (adminOrder.ts); the pure
    // cap check the transaction uses is derived availability:
    const base = {
      isActive: true,
      validityStartMs: null,
      validityEndMs: null,
      usageCap: 3,
      nowMs: Date.UTC(2026, 6, 10),
    };
    expect(deriveEventPromotionAvailability({ ...base, usedCount: 1 })).toBe(
      "available",
    );
    expect(deriveEventPromotionAvailability({ ...base, usedCount: 2 })).toBe(
      "available",
    );
    expect(deriveEventPromotionAvailability({ ...base, usedCount: 3 })).toBe(
      "exhausted",
    );
  });

  it("#4 Partner comp: NGC-EB×Delegate×USD 145000, HARVEYAI/C100 100%, TAX-NY -> total 0", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 145000, currency: "USD" },
      { discountType: "percentage", discountValue: 100 },
      [TAX_NY],
    );
    expect(totals.discountMinor).toBe(145000);
    expect(totals.taxableBaseMinor).toBe(0);
    // 8.875% of 0 = 0 — the line exists but charges nothing.
    expect(totals.taxMinor).toBe(0);
    expect(totals.totalMinor).toBe(0);
  });
});

describe("computeOrderTotals — extra pinned cases", () => {
  it("fixed 600 on a 50000 fee clamps to 50000 (total 0 -> comped)", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 50000, currency: "USD" },
      { discountType: "fixed", discountValue: 600 },
      [],
    );
    expect(totals.discountMinor).toBe(50000);
    expect(totals.totalMinor).toBe(0);
  });

  it("10% of 105 = 10.5 -> 11 (half-up)", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 105, currency: "USD" },
      { discountType: "percentage", discountValue: 10 },
      [],
    );
    expect(totals.discountMinor).toBe(11);
    expect(totals.totalMinor).toBe(94);
  });

  it("comp fee (basePriceMinor 0, no promo) -> total 0", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 0, currency: "USD" },
      null,
      [TAX_NY],
    );
    expect(totals.subtotalMinor).toBe(0);
    expect(totals.taxMinor).toBe(0);
    expect(totals.totalMinor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tax math (M2-T3 AC-5)
// ---------------------------------------------------------------------------

describe("computeOrderTotals — tax lines", () => {
  it("20% of 0 = 0", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 0, currency: "GBP" },
      null,
      [{ ...VAT_UK_INACTIVE, isActive: true }],
    );
    expect(totals.taxMinor).toBe(0);
  });

  it("skips fixed taxes on currency mismatch (no line at all)", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 10000, currency: "USD" },
      null,
      [FIXED_GBP_TAX],
    );
    expect(totals.taxLines).toEqual([]);
    expect(totals.taxMinor).toBe(0);
  });

  it("applies fixed taxes when the currency matches", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 10000, currency: "GBP" },
      null,
      [FIXED_GBP_TAX],
    );
    expect(totals.taxLines).toEqual([
      {
        taxId: "tax-fixed-gbp",
        code: "LEVY-UK",
        rateMilliPercent: null,
        fixedAmountMinor: 250,
        amountMinor: 250,
      },
    ]);
    expect(totals.totalMinor).toBe(10250);
  });

  it("skips inactive taxes entirely", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 10000, currency: "GBP" },
      null,
      [VAT_UK_INACTIVE],
    );
    expect(totals.taxLines).toEqual([]);
    expect(totals.taxMinor).toBe(0);
  });

  it("sums LINE-ROUNDED values, not round-of-sums", () => {
    // taxableBase 105: two 10% taxes -> each line 10.5 -> 11; sum 22.
    // Round-of-sums would give round(21.0) = 21 — must NOT happen.
    const tenPercent = (id: string): PricingTax => ({
      taxId: id,
      code: id.toUpperCase(),
      type: "percentage",
      rateMilliPercent: 10000,
      fixedAmountMinor: null,
      fixedCurrency: null,
      isActive: true,
    });
    const totals = computeOrderTotals(
      { basePriceMinor: 105, currency: "USD" },
      null,
      [tenPercent("t1"), tenPercent("t2")],
    );
    expect(totals.taxLines.map((l) => l.amountMinor)).toEqual([11, 11]);
    expect(totals.taxMinor).toBe(22);
    expect(totals.totalMinor).toBe(127);
  });

  it("handles fractional percentage rates exactly (8.875% stored as 8875)", () => {
    const totals = computeOrderTotals(
      { basePriceMinor: 85500, currency: "USD" },
      null,
      [TAX_NY],
    );
    expect(totals.taxMinor).toBe(7588);
  });
});

// ---------------------------------------------------------------------------
// Promotion narrowing + amount comparison (finalize's pure parts)
// ---------------------------------------------------------------------------

describe("promotionToPricingInput", () => {
  it("passes through valid percentage/fixed configs", () => {
    expect(
      promotionToPricingInput({ discountType: "percentage", discountValue: 10 }),
    ).toEqual({ discountType: "percentage", discountValue: 10 });
    expect(
      promotionToPricingInput({ discountType: "fixed", discountValue: 600 }),
    ).toEqual({ discountType: "fixed", discountValue: 600 });
  });

  it("returns null for legacy/loose configs instead of throwing", () => {
    expect(promotionToPricingInput({})).toBeNull();
    expect(
      promotionToPricingInput({ discountType: "bogus", discountValue: 10 }),
    ).toBeNull();
    expect(
      promotionToPricingInput({ discountType: "percentage", discountValue: null }),
    ).toBeNull();
    expect(
      promotionToPricingInput({ discountType: "fixed", discountValue: -5 }),
    ).toBeNull();
  });
});

describe("orderAmountsEqual", () => {
  const amounts = {
    subtotalMinor: 95000,
    discountMinor: 9500,
    taxMinor: 7588,
    totalMinor: 93088,
  };

  it("matches identical breakdowns", () => {
    expect(orderAmountsEqual(amounts, { ...amounts })).toBe(true);
  });

  it("flags any drifted component (PRICE_CHANGED trigger)", () => {
    expect(orderAmountsEqual(amounts, { ...amounts, totalMinor: 93089 })).toBe(
      false,
    );
    expect(orderAmountsEqual(amounts, { ...amounts, discountMinor: 0 })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// EventPromotion M2 defaults + derived Active truth table (M2-T2 AC-3/AC-5)
// ---------------------------------------------------------------------------

function legacyPromotionDoc(): EventPromotionDoc {
  // A pre-M2 doc: none of the six additive fields present.
  return {
    organizationId: "org-1",
    templateId: "tpl-1",
    inheritFromParent: true,
    name: "Early bird",
    discountType: "percentage",
    discountValue: 10,
    conditions: [],
    enablePromoCode: true,
    promoCode: "GCUS10",
    createdAt: { seconds: 0, nanoseconds: 0 } as never,
    updatedAt: { seconds: 0, nanoseconds: 0 } as never,
  };
}

describe("applyEventPromotionReadDefaults", () => {
  it("defaults all six fields on legacy docs (uncapped, no window, event level, active)", () => {
    const parsed = applyEventPromotionReadDefaults(legacyPromotionDoc());
    expect(parsed.level).toBe("event");
    expect(parsed.validityStart).toBeNull();
    expect(parsed.validityEnd).toBeNull();
    expect(parsed.usageCap).toBeNull();
    expect(parsed.usedCount).toBe(0);
    expect(parsed.isActive).toBe(true);
  });

  it("preserves stored values", () => {
    const parsed = applyEventPromotionReadDefaults({
      ...legacyPromotionDoc(),
      level: "partner",
      usageCap: 3,
      usedCount: 1,
      isActive: false,
    });
    expect(parsed.level).toBe("partner");
    expect(parsed.usageCap).toBe(3);
    expect(parsed.usedCount).toBe(1);
    expect(parsed.isActive).toBe(false);
  });

  it("degrades malformed values to defaults instead of throwing", () => {
    const parsed = applyEventPromotionReadDefaults({
      ...legacyPromotionDoc(),
      level: "weird" as never,
      usageCap: 0, // < 1 is invalid -> uncapped
      usedCount: -2 as never, // negative -> 0
    });
    expect(parsed.level).toBe("event");
    expect(parsed.usageCap).toBeNull();
    expect(parsed.usedCount).toBe(0);
  });
});

describe("deriveEventPromotionAvailability — truth table", () => {
  const now = Date.UTC(2026, 6, 15); // Jul 15 2026
  const before = Date.UTC(2026, 6, 1);
  const after = Date.UTC(2026, 7, 31, 23, 59, 59, 999);
  const base = {
    isActive: true,
    validityStartMs: null as number | null,
    validityEndMs: null as number | null,
    usageCap: null as number | null,
    usedCount: 0,
    nowMs: now,
  };

  it("isActive false -> inactive, regardless of validity/cap", () => {
    expect(deriveEventPromotionAvailability({ ...base, isActive: false })).toBe(
      "inactive",
    );
  });

  it("before validityStart -> not-started", () => {
    expect(
      deriveEventPromotionAvailability({
        ...base,
        validityStartMs: Date.UTC(2026, 7, 1),
      }),
    ).toBe("not-started");
  });

  it("after validityEnd -> expired even when isActive is true", () => {
    expect(
      deriveEventPromotionAvailability({ ...base, validityEndMs: before }),
    ).toBe("expired");
  });

  it("validity bounds are inclusive", () => {
    expect(
      deriveEventPromotionAvailability({
        ...base,
        validityStartMs: now,
        validityEndMs: now,
      }),
    ).toBe("available");
  });

  it("cap reached -> exhausted even when isActive is true", () => {
    expect(
      deriveEventPromotionAvailability({ ...base, usageCap: 3, usedCount: 3 }),
    ).toBe("exhausted");
  });

  it("uncapped never exhausts", () => {
    expect(
      deriveEventPromotionAvailability({ ...base, usedCount: 999999 }),
    ).toBe("available");
  });

  it("all gates pass -> available", () => {
    expect(
      deriveEventPromotionAvailability({
        ...base,
        validityStartMs: before,
        validityEndMs: after,
        usageCap: 3,
        usedCount: 1,
      }),
    ).toBe("available");
  });
});

// ---------------------------------------------------------------------------
// Deterministic order IDs (M2-T4 AC-7 pure part)
// ---------------------------------------------------------------------------

describe("orderIdFromIdempotencyKey", () => {
  it("is deterministic for the same (org, event, key) tuple", () => {
    const a = orderIdFromIdempotencyKey({
      organizationId: "org-1",
      eventId: "evt-1",
      idempotencyKey: "key-123",
    });
    const b = orderIdFromIdempotencyKey({
      organizationId: "org-1",
      eventId: "evt-1",
      idempotencyKey: "key-123",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scopes keys per tenant + event (no cross-tenant collisions)", () => {
    const base = {
      organizationId: "org-1",
      eventId: "evt-1",
      idempotencyKey: "key-123",
    };
    expect(
      orderIdFromIdempotencyKey({ ...base, organizationId: "org-2" }),
    ).not.toBe(orderIdFromIdempotencyKey(base));
    expect(orderIdFromIdempotencyKey({ ...base, eventId: "evt-2" })).not.toBe(
      orderIdFromIdempotencyKey(base),
    );
    expect(
      orderIdFromIdempotencyKey({ ...base, idempotencyKey: "key-124" }),
    ).not.toBe(orderIdFromIdempotencyKey(base));
  });

  it("has no separator ambiguity between tuple parts", () => {
    expect(
      orderIdFromIdempotencyKey({
        organizationId: "org-1",
        eventId: "a b",
        idempotencyKey: "c",
      }),
    ).not.toBe(
      orderIdFromIdempotencyKey({
        organizationId: "org-1",
        eventId: "a",
        idempotencyKey: "b c",
      }),
    );
  });
});
