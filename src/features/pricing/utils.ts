// Pure display helpers for the M2 pricing screens. No Firebase imports —
// safe for client components, server pages, and tests.
// Spec: agents/docs/specs/m2-pricing-commerce.md.

import { deriveEventPromotionAvailability } from "@/lib/db/eventPromotionDefaults";
import { formatSalesDate } from "@/features/registration/utils";
import type { SerializedDiscount, SerializedFee, SerializedTax } from "@/features/pricing/types";
import type { Currency } from "@/types/collection";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const PRICING_TABS = [
  "fees",
  "discounts",
  "taxes",
  "service-fees",
] as const;

export type PricingTab = (typeof PRICING_TABS)[number];

// Default / invalid / missing ?tab= values resolve to "fees" (design §1).
export function resolvePricingTab(value: unknown): PricingTab {
  return PRICING_TABS.includes(value as PricingTab)
    ? (value as PricingTab)
    : "fees";
}

// ---------------------------------------------------------------------------
// Money / rates
// ---------------------------------------------------------------------------

// Symbol prefix shown inside the fee dialog's price input.
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  SGD: "S$",
};

// Fixed locale so server and client render identically (no hydration drift).
// All supported currencies use 2 minor digits; the division below is display
// only — stored amounts stay integer minor units.
export function formatMoney(minorUnits: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minorUnits / 100);
}

// Fee-price display convention: basePriceMinor 0 renders "Comp" wherever a
// fee price displays — never "$0.00" (spec Shared decisions).
export function formatFeePrice(
  minorUnits: number,
  currency: Currency,
): string {
  return minorUnits === 0 ? "Comp" : formatMoney(minorUnits, currency);
}

// Integer milli-percent -> "20.00%" / "8.875%": always at least 2 decimals,
// a third only when significant (trim a trailing zero beyond 2dp, spec T3).
export function formatRate(rateMilliPercent: number): string {
  const whole = Math.floor(rateMilliPercent / 1000);
  const fraction = String(rateMilliPercent % 1000).padStart(3, "0");
  const trimmed = fraction.endsWith("0") ? fraction.slice(0, 2) : fraction;
  return `${whole}.${trimmed}%`;
}

// Rate cell for the Taxes tab: percentage rate or the fixed amount formatted
// in its own currency.
export function formatTaxRate(tax: SerializedTax): string {
  if (tax.type === "percentage") {
    return tax.rateMilliPercent !== null ? formatRate(tax.rateMilliPercent) : "—";
  }
  return tax.fixedAmountMinor !== null && tax.fixedCurrency !== null
    ? formatMoney(tax.fixedAmountMinor, tax.fixedCurrency)
    : "—";
}

// ---------------------------------------------------------------------------
// Discounts (read projection of EventPromotion)
// ---------------------------------------------------------------------------

// Amount cell: "10%" / "8.875%" by percentage type; fixed amounts render as a
// bare 2dp number because a fixed discount has NO currency of its own — it is
// applied in each order's currency (no FX, spec Shared decisions).
export function formatDiscountAmount(
  discountType: string | null,
  discountValue: number | null,
): string {
  if (
    (discountType !== "percentage" && discountType !== "fixed") ||
    typeof discountValue !== "number" ||
    !Number.isFinite(discountValue)
  ) {
    return "—";
  }
  if (discountType === "percentage") {
    return `${discountValue}%`;
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(discountValue);
}

// Valid cell (spec T2 AC-2): "→ Aug 31" / "Aug 1 →" / "Aug 1 → Aug 31" / "—",
// dates rendered in the event timezone.
export function formatValidityLabel(
  discount: Pick<SerializedDiscount, "validityStartMs" | "validityEndMs">,
  options: { timeZone: string; nowMs?: number },
): string {
  const nowMs = options.nowMs ?? Date.now();
  const { validityStartMs, validityEndMs } = discount;

  const start =
    validityStartMs !== null
      ? formatSalesDate(validityStartMs, options.timeZone, nowMs)
      : null;
  const end =
    validityEndMs !== null
      ? formatSalesDate(validityEndMs, options.timeZone, nowMs)
      : null;

  if (start && end) return `${start} → ${end}`;
  if (start) return `${start} →`;
  if (end) return `→ ${end}`;
  return "—";
}

// Used cell (spec T2 AC-2): "used / cap" when capped, bare "used" when not.
export function formatUsageLabel(usedCount: number, usageCap: number | null): string {
  return usageCap === null ? String(usedCount) : `${usedCount} / ${usageCap}`;
}

// Displayed "Active" badge is DERIVED: isActive && withinValidity && !capExhausted
// (single source: deriveEventPromotionAvailability, truth-table tested).
export function isDiscountCurrentlyActive(
  discount: Pick<
    SerializedDiscount,
    "isActive" | "validityStartMs" | "validityEndMs" | "usageCap" | "usedCount"
  >,
  nowMs: number,
): boolean {
  return (
    deriveEventPromotionAvailability({
      isActive: discount.isActive,
      validityStartMs: discount.validityStartMs,
      validityEndMs: discount.validityEndMs,
      usageCap: discount.usageCap,
      usedCount: discount.usedCount,
      nowMs,
    }) === "available"
  );
}

// ---------------------------------------------------------------------------
// Ticket Price column (M1 tickets screen, spec T1 AC-12)
// ---------------------------------------------------------------------------

export interface TicketPriceDisplay {
  // Lowest active fee price, or "Comp" when that fee is 0.
  label: string;
  // "+N more" when multiple active fees (currencies/regTypes) price the ticket.
  extra: string | null;
  // Tooltip listing every active price when there are several.
  title: string | undefined;
}

// null = no active fee prices this ticket -> the cell renders "—" linking to
// Pricing. Multiple fees compare on raw minor units (no FX) — the tooltip
// carries the full per-currency list so the shorthand is never misleading.
export function getTicketPriceDisplay(
  ticketTypeId: string,
  fees: readonly SerializedFee[],
): TicketPriceDisplay | null {
  const active = fees
    .filter((fee) => fee.ticketTypeId === ticketTypeId && fee.status === "active")
    .sort((a, b) => a.basePriceMinor - b.basePriceMinor);

  if (active.length === 0) return null;

  const [lowest] = active;
  return {
    label: formatFeePrice(lowest.basePriceMinor, lowest.currency),
    extra: active.length > 1 ? `+${active.length - 1} more` : null,
    title:
      active.length > 1
        ? active
            .map((fee) => formatFeePrice(fee.basePriceMinor, fee.currency))
            .join(", ")
        : undefined,
  };
}
