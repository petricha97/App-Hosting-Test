// M2 order money math — PURE module: no Firebase imports, safe for client
// components, server routes, the finalize transaction, and unit tests.
// Spec: agents/docs/specs/m2-pricing-commerce.md (Shared decisions + T4).
//
// Invariants:
// - Money is integer minor units everywhere. No floats in stored amounts or
//   math; the only float-tolerant boundary is discountValue (a stored promo
//   number like 10 or 8.875), converted once to integer milli-percent.
// - Rounding is HALF-UP, per currency, at EACH derivation step: the discount
//   amount first, then each tax line independently (line-rounded values are
//   summed — QA must NOT expect round-of-sums).
// - Application order is fixed: fee base price -> discount -> taxes.

import type { Currency } from "@/types/collection";

// All currently supported currencies use 2 minor digits. 0-decimal currencies
// (JPY, KRW, ...) are OUT OF SCOPE until added here AND to SUPPORTED_CURRENCIES.
export const CURRENCY_MINOR_DIGITS: Record<Currency, number> = {
  USD: 2,
  GBP: 2,
  EUR: 2,
  SGD: 2,
};

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  assertSafeInteger(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be >= 0, got ${value}`);
  }
}

// Integer half-up division: roundHalfUp(n, d) = round(n / d) with exact-.5
// rounding UP, implemented in integer math (never Math.round on a float
// quotient). Both arguments must be non-negative safe integers, d > 0.
// Example: roundHalfUp(1050, 100) = 11 (10.5 rounds up).
export function roundHalfUp(numerator: number, denominator: number): number {
  assertNonNegativeInteger(numerator, "numerator");
  assertSafeInteger(denominator, "denominator");
  if (denominator <= 0) {
    throw new RangeError(`denominator must be > 0, got ${denominator}`);
  }

  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

export interface PricingFee {
  // Integer minor units, >= 0. 0 = comp fee (displays "Comp").
  basePriceMinor: number;
  currency: Currency;
}

export interface PricingPromotion {
  discountType: "percentage" | "fixed";
  // percentage: percent value (10 = 10%, 8.875 = 8.875%); converted once to
  //   integer milli-percent, then applied in integer math.
  // fixed: MAJOR units interpreted in the ORDER'S currency — no FX. A "£600"
  //   code applied to a USD fee deducts $600 (organizers scope codes to the
  //   right currency; UI copy flags this).
  discountValue: number;
}

export interface PricingTax {
  taxId: string;
  code: string;
  type: "percentage" | "fixed";
  // Percentage only: integer milli-percent (8.875% -> 8875).
  rateMilliPercent: number | null;
  // Fixed only: integer minor units + the currency they are denominated in.
  fixedAmountMinor: number | null;
  fixedCurrency: Currency | null;
  isActive: boolean;
}

// One computed tax line. Percentage lines are always emitted for active
// percentage taxes (amount may be 0, e.g. on a fully discounted order);
// fixed taxes with a non-matching currency are SKIPPED entirely (no line).
export interface ComputedTaxLine {
  taxId: string;
  code: string;
  rateMilliPercent: number | null;
  fixedAmountMinor: number | null;
  amountMinor: number;
}

export interface OrderTotals {
  currency: Currency;
  subtotalMinor: number;
  discountMinor: number;
  taxableBaseMinor: number;
  taxLines: ComputedTaxLine[];
  taxMinor: number;
  totalMinor: number;
}

const MILLI_PERCENT_DENOMINATOR = 100000; // rateMilliPercent per 100% in milli-percent

// Converts a stored percent value (possibly fractional, e.g. 8.875) to integer
// milli-percent exactly once at the boundary. 10 -> 10000, 8.875 -> 8875.
function percentToMilliPercent(percent: number): number {
  const milli = Math.round(percent * 1000);
  assertNonNegativeInteger(milli, "discount percentage (milli-percent)");
  return milli;
}

// Computes an order's full money breakdown per the fixed application order:
//   subtotal = fee.basePriceMinor
//   discount = min(subtotal, computedDiscount)   (total can never go negative)
//   taxableBase = subtotal - discount
//   each active tax line rounds half-up INDEPENDENTLY; taxTotal = sum of lines
//   total = taxableBase + taxTotal
// Inactive taxes never apply; fixed taxes apply only when their currency
// matches the order's. Service fees do not participate in M2.
export function computeOrderTotals(
  fee: PricingFee,
  promotion: PricingPromotion | null | undefined,
  taxes: readonly PricingTax[],
): OrderTotals {
  assertNonNegativeInteger(fee.basePriceMinor, "fee.basePriceMinor");
  const currency = fee.currency;
  const minorDigits = CURRENCY_MINOR_DIGITS[currency];
  if (minorDigits === undefined) {
    throw new RangeError(`Unsupported currency: ${currency}`);
  }

  const subtotalMinor = fee.basePriceMinor;

  // --- Discount (rounds half-up, then clamps at subtotal) ---
  let discountMinor = 0;
  if (promotion) {
    if (promotion.discountValue < 0 || !Number.isFinite(promotion.discountValue)) {
      throw new RangeError(
        `promotion.discountValue must be a finite number >= 0, got ${promotion.discountValue}`,
      );
    }

    let computedDiscount: number;
    if (promotion.discountType === "percentage") {
      const milliPercent = percentToMilliPercent(promotion.discountValue);
      computedDiscount = roundHalfUp(
        subtotalMinor * milliPercent,
        MILLI_PERCENT_DENOMINATOR,
      );
    } else {
      // Fixed: major units in the order's currency -> minor units. Math.round
      // guards float artifacts of the single multiply (e.g. 600.5 * 100).
      computedDiscount = Math.round(promotion.discountValue * 10 ** minorDigits);
      assertNonNegativeInteger(computedDiscount, "fixed discount (minor units)");
    }

    discountMinor = Math.min(subtotalMinor, computedDiscount);
  }

  const taxableBaseMinor = subtotalMinor - discountMinor;

  // --- Tax lines (each rounds half-up independently, then sums) ---
  const taxLines: ComputedTaxLine[] = [];
  for (const tax of taxes) {
    if (!tax.isActive) continue;

    if (tax.type === "percentage") {
      if (tax.rateMilliPercent === null) continue; // malformed doc — skip defensively
      assertNonNegativeInteger(tax.rateMilliPercent, `tax ${tax.code} rateMilliPercent`);
      taxLines.push({
        taxId: tax.taxId,
        code: tax.code,
        rateMilliPercent: tax.rateMilliPercent,
        fixedAmountMinor: null,
        amountMinor: roundHalfUp(
          taxableBaseMinor * tax.rateMilliPercent,
          MILLI_PERCENT_DENOMINATOR,
        ),
      });
    } else {
      // Fixed tax: only applies when denominated in the order's currency.
      if (tax.fixedAmountMinor === null || tax.fixedCurrency !== currency) continue;
      assertNonNegativeInteger(tax.fixedAmountMinor, `tax ${tax.code} fixedAmountMinor`);
      taxLines.push({
        taxId: tax.taxId,
        code: tax.code,
        rateMilliPercent: null,
        fixedAmountMinor: tax.fixedAmountMinor,
        amountMinor: tax.fixedAmountMinor,
      });
    }
  }

  const taxMinor = taxLines.reduce((sum, line) => sum + line.amountMinor, 0);

  return {
    currency,
    subtotalMinor,
    discountMinor,
    taxableBaseMinor,
    taxLines,
    taxMinor,
    totalMinor: taxableBaseMinor + taxMinor,
  };
}

// Narrows a stored EventPromotion's loose discount fields
// (discountType?: string | null, discountValue?: number | null) to a usable
// pricing input. Returns null when the promotion carries no applicable
// discount config — callers then apply no discount (never throw on legacy
// docs; mirrors the spec's ".catch fallback" posture).
export function promotionToPricingInput(promotion: {
  discountType?: string | null;
  discountValue?: number | null;
}): PricingPromotion | null {
  if (
    promotion.discountType !== "percentage" &&
    promotion.discountType !== "fixed"
  ) {
    return null;
  }
  if (
    typeof promotion.discountValue !== "number" ||
    !Number.isFinite(promotion.discountValue) ||
    promotion.discountValue < 0
  ) {
    return null;
  }
  return {
    discountType: promotion.discountType,
    discountValue: promotion.discountValue,
  };
}

// Strict equality of the four order amounts — the finalize transaction's
// PRICE_CHANGED comparison.
export function orderAmountsEqual(
  a: {
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
  },
  b: {
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
  },
): boolean {
  return (
    a.subtotalMinor === b.subtotalMinor &&
    a.discountMinor === b.discountMinor &&
    a.taxMinor === b.taxMinor &&
    a.totalMinor === b.totalMinor
  );
}
