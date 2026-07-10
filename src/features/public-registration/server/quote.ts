// Server-computed registration quote (M3-T3 step 3). Read-only twin of
// placeOrder's quote phase: identical inputs (fee resolution, promotion
// derived-availability, active taxes) and identical math (computeOrderTotals)
// with ZERO counter movement — so the summary the registrant confirms always
// matches what the finalize transaction re-computes (T3 AC-5).
//
// Promo secrecy (T2 AC-6/7): every promo failure — unknown code, code-less
// promotion, inactive, not started, expired, exhausted — collapses into ONE
// generic result. No endpoint enumerates promotions and no promo metadata
// beyond the discount effect ever leaves the server.
import "server-only";

import { resolveAdminFeeForOrder } from "@/lib/db/adminFee";
import {
  getAdminEventPromotionByCode,
  getAdminEventPromotionById,
} from "@/lib/db/adminEventPromotion";
import { getAdminActiveTaxesForEvent } from "@/lib/db/adminTax";
import { deriveEventPromotionAvailability } from "@/lib/db/eventPromotionDefaults";
import {
  computeOrderTotals,
  promotionToPricingInput,
  type PricingTax,
} from "@/lib/orders/pricing-math";
import type { Currency } from "@/types/collection";
import type { PublicRegistrationQuote } from "@/features/public-registration/types";

// The one client-facing promo failure message (identical for every cause).
export const GENERIC_PROMO_ERROR = "This code isn't valid.";

export type { PublicRegistrationQuote };

type ActivePromotion = NonNullable<
  Awaited<ReturnType<typeof getAdminEventPromotionById>>
>;

// Resolves a registrant-typed promo code to a currently-available promotion.
// { ok: false } for EVERY failure cause — callers must surface only
// GENERIC_PROMO_ERROR (no oracle distinguishing unknown from exhausted).
export async function resolveActivePromotionByCode(input: {
  eventId: string;
  organizationId: string;
  code: string;
  nowMs?: number;
}): Promise<{ ok: true; promotion: ActivePromotion } | { ok: false }> {
  const promotion = await getAdminEventPromotionByCode({
    eventId: input.eventId,
    organizationId: input.organizationId,
    code: input.code,
  });
  if (!promotion) return { ok: false };

  const availability = deriveEventPromotionAvailability({
    isActive: promotion.isActive,
    validityStartMs: promotion.validityStart
      ? promotion.validityStart.toMillis()
      : null,
    validityEndMs: promotion.validityEnd
      ? promotion.validityEnd.toMillis()
      : null,
    usageCap: promotion.usageCap,
    usedCount: promotion.usedCount,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (availability !== "available") return { ok: false };

  return { ok: true, promotion };
}

export type PublicQuoteResult =
  | { ok: true; quote: PublicRegistrationQuote }
  // NO_FEE: nothing prices this selection (client shows the generic
  // "selection no longer available" surface, back to step 2).
  | { ok: false; code: "NO_FEE" };

// Computes the quote for a (ticket, resolved regType, path currency,
// optional resolved promotion). The promotion, when present, is re-checked
// for availability — a stored promotionId that has since expired simply
// stops discounting (finalize re-validates transactionally anyway).
export async function computePublicRegistrationQuote(input: {
  eventId: string;
  organizationId: string;
  ticketTypeId: string;
  registrationTypeId: string;
  currency: Currency;
  promotionId?: string | null;
  nowMs?: number;
}): Promise<PublicQuoteResult> {
  const nowMs = input.nowMs ?? Date.now();

  const fee = await resolveAdminFeeForOrder({
    eventId: input.eventId,
    organizationId: input.organizationId,
    ticketTypeId: input.ticketTypeId,
    registrationTypeId: input.registrationTypeId,
    currency: input.currency,
  });
  if (!fee) return { ok: false, code: "NO_FEE" };

  let pricingPromotion = null;
  if (input.promotionId) {
    const promotion = await getAdminEventPromotionById(
      input.eventId,
      input.promotionId,
    );
    if (promotion && promotion.organizationId === input.organizationId) {
      const availability = deriveEventPromotionAvailability({
        isActive: promotion.isActive,
        validityStartMs: promotion.validityStart
          ? promotion.validityStart.toMillis()
          : null,
        validityEndMs: promotion.validityEnd
          ? promotion.validityEnd.toMillis()
          : null,
        usageCap: promotion.usageCap,
        usedCount: promotion.usedCount,
        nowMs,
      });
      if (availability === "available") {
        pricingPromotion = promotionToPricingInput(promotion);
      }
    }
  }

  const taxes = await getAdminActiveTaxesForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
  const pricingTaxes: PricingTax[] = taxes.map((tax) => ({
    taxId: tax.id,
    code: tax.code,
    type: tax.type,
    rateMilliPercent: tax.rateMilliPercent,
    fixedAmountMinor: tax.fixedAmountMinor,
    fixedCurrency: tax.fixedCurrency,
    isActive: tax.isActive,
  }));

  const totals = computeOrderTotals(
    { basePriceMinor: fee.basePriceMinor, currency: fee.currency },
    pricingPromotion,
    pricingTaxes,
  );

  return {
    ok: true,
    quote: {
      currency: totals.currency,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      // Public projection: code + amount only (no tax ids/rates internals).
      taxLines: totals.taxLines.map((line) => ({
        code: line.code,
        amountMinor: line.amountMinor,
      })),
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      promoApplied: pricingPromotion !== null && totals.discountMinor > 0,
    },
  };
}
