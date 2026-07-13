// M2-T4 payment lifecycle orchestration (review B-1).
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T4 "Lifecycle").
//
// placeOrder is the single entry point that connects the pricing quote, the
// PaymentProvider, and the finalize transaction (createAdminOrderWithFinalize):
//
//   1. Idempotent replay: an order already stored for this (org, event, key)
//      is returned as-is — no re-quote, no provider call, no counter moves.
//   2. Quote: resolve the fee (specific-regType fee wins over "All types";
//      archived/missing -> NO_FEE), validate the promotion (derived-active per
//      T2: isActive + validity window + cap), read the active taxes, and
//      compute the totals from Firestore state via computeOrderTotals.
//      CLIENT-SUPPLIED AMOUNTS NEVER ENTER THIS MODULE (spec AC-1).
//   3. Method -> status:
//      - totalMinor === 0 -> finalize `comped`, NO provider call (AC-5).
//        Stored method: the caller's "none" is preserved (organizer-recorded
//        free order); anything else is recorded as "comp".
//      - invoice        -> finalize `outstanding`, NO provider call (AC-6).
//      - card           -> provider.createPayment (idempotency key = the
//        order's key); success -> finalize `paid` with providerPaymentId;
//        decline -> the order is KEPT as a terminal `failed` record WITHOUT
//        any finalize side-effects — counters never move for a failed charge
//        (AC-6; recordAdminFailedOrder writes no counter increments). Retry
//        is a new attempt under a NEW idempotency key.
//      - comp/none with a non-zero total -> INVALID_METHOD (comp is defined
//        as totalMinor === 0 via comp fee or 100% discount).
//   4. Finalize re-reads + re-validates everything inside one transaction and
//      compares against the quoted amounts (PRICE_CHANGED on drift).
//
// NOTE (M3): if finalize fails AFTER a successful card charge (e.g. SOLD_OUT
// race on the last seat), the simulated charge is simply reported as the
// finalize error. A real provider integration must void/refund the payment
// intent at that point — TODO(M3-T3) alongside the public checkout wiring.
import "server-only";

import { resolveAdminFeeForOrder } from "@/lib/db/adminFee";
import { getAdminEventPromotionById } from "@/lib/db/adminEventPromotion";
import {
  createAdminOrderWithFinalize,
  getAdminOrderByIdempotencyKey,
  recordAdminFailedOrder,
  type OrderFinalizeErrorCode,
} from "@/lib/db/adminOrder";
import { getAdminActiveTaxesForEvent } from "@/lib/db/adminTax";
import { deriveEventPromotionAvailability } from "@/lib/db/eventPromotionDefaults";
import { orderIdFromIdempotencyKey } from "@/lib/orders/order-id";
import {
  computeOrderTotals,
  promotionToPricingInput,
  type PricingTax,
} from "@/lib/orders/pricing-math";
import type { PaymentProvider } from "@/lib/payments/payment-provider";
import type {
  Currency,
  OrderAmounts,
  OrderDoc,
  PaymentMethod,
  WithId,
} from "@/types/collection";

export type PlaceOrderErrorCode =
  | OrderFinalizeErrorCode
  // No active fee prices this (ticket, regType-or-all, currency) — routes
  // respond 400 (spec AC-3; archived fees are excluded by resolution).
  | "NO_FEE"
  // comp/none requested for an order whose total is not zero.
  | "INVALID_METHOD"
  // The card charge was declined; the order is persisted as `failed` and
  // returned in `order`. Counters are untouched.
  | "PAYMENT_FAILED";

export type PlaceOrderResult =
  | {
      ok: true;
      orderId: string;
      order: WithId<OrderDoc>;
      // false = idempotent replay (this call created nothing and moved no
      // counters — the original order is returned).
      created: boolean;
    }
  | {
      ok: false;
      code: PlaceOrderErrorCode;
      message: string;
      // Present for PAYMENT_FAILED: the persisted failed order record.
      order?: WithId<OrderDoc>;
    };

export interface PlaceOrderInput {
  organizationId: string;
  eventId: string;
  // Caller-scoped idempotency key; the deterministic Order doc ID is derived
  // from (org, event, key), so repeats/double-submits collapse to one order.
  idempotencyKey: string;
  // null until M3-T3 wires public registration submissions.
  submissionId?: string | null;
  ticketTypeId: string;
  registrationTypeId: string;
  // Resolved promotion id (code -> id resolution is the caller's job; M3-T3).
  promotionId?: string | null;
  currency: Currency;
  paymentMethod: PaymentMethod;
  provider: PaymentProvider;
  // Injectable clock for promo-validity tests. Defaults to now.
  now?: Date;
}

function fail(
  code: PlaceOrderErrorCode,
  message: string,
  order?: WithId<OrderDoc>,
): PlaceOrderResult {
  return { ok: false, code, message, ...(order ? { order } : {}) };
}

// Replay pass-through: an existing order for the key is returned verbatim —
// a previously failed charge replays as PAYMENT_FAILED (never silently
// upgraded to success), everything else as an ok/created:false result.
function replayResult(order: WithId<OrderDoc>): PlaceOrderResult {
  if (order.paymentStatus === "failed") {
    return fail(
      "PAYMENT_FAILED",
      "The payment for this order was declined. Retry with a new attempt.",
      order,
    );
  }
  return { ok: true, orderId: order.id, order, created: false };
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const now = input.now ?? new Date();
  const orderId = orderIdFromIdempotencyKey({
    organizationId: input.organizationId,
    eventId: input.eventId,
    idempotencyKey: input.idempotencyKey,
  });

  // --- 1. Idempotent replay (spec AC-7): never re-quote or re-charge. ---
  const existing = await getAdminOrderByIdempotencyKey({
    organizationId: input.organizationId,
    eventId: input.eventId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) return replayResult(existing);

  // --- 2. Quote from current Firestore state (spec lifecycle step 1). ---
  const fee = await resolveAdminFeeForOrder({
    eventId: input.eventId,
    organizationId: input.organizationId,
    ticketTypeId: input.ticketTypeId,
    registrationTypeId: input.registrationTypeId,
    currency: input.currency,
  });
  if (!fee) {
    return fail(
      "NO_FEE",
      "No active fee prices this ticket, registration type and currency.",
    );
  }

  let promotion: Awaited<
    ReturnType<typeof getAdminEventPromotionById>
  > = null;
  if (input.promotionId) {
    const promo = await getAdminEventPromotionById(
      input.eventId,
      input.promotionId,
    );
    if (!promo || promo.organizationId !== input.organizationId) {
      return fail("INVALID_REFERENCE", "Promotion not found.");
    }
    const availability = deriveEventPromotionAvailability({
      isActive: promo.isActive,
      validityStartMs: promo.validityStart
        ? promo.validityStart.toMillis()
        : null,
      validityEndMs: promo.validityEnd ? promo.validityEnd.toMillis() : null,
      usageCap: promo.usageCap,
      usedCount: promo.usedCount,
      nowMs: now.getTime(),
    });
    if (availability === "exhausted") {
      return fail("PROMO_EXHAUSTED", "This promotion has been fully used.");
    }
    if (availability !== "available") {
      return fail("PROMO_EXPIRED", "This promotion is not currently valid.");
    }
    promotion = promo;
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

  const pricingPromotion = promotion
    ? promotionToPricingInput(promotion)
    : null;
  const totals = computeOrderTotals(
    { basePriceMinor: fee.basePriceMinor, currency: fee.currency },
    pricingPromotion,
    pricingTaxes,
  );
  const amounts: OrderAmounts = {
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
  };

  const finalizeBase = {
    organizationId: input.organizationId,
    eventId: input.eventId,
    idempotencyKey: input.idempotencyKey,
    submissionId: input.submissionId ?? null,
    ticketTypeId: input.ticketTypeId,
    registrationTypeId: input.registrationTypeId,
    feeId: fee.id,
    promotionId: input.promotionId ?? null,
    currency: fee.currency,
    expectedAmounts: amounts,
    now,
  };

  // --- 3. Method -> status (spec lifecycle step 2, ACs 5/6). ---

  // Comp: any zero-total order finalizes `comped` with NO provider call —
  // via a comp fee, a 100% discount, or an explicit comp/none method.
  if (totals.totalMinor === 0) {
    const finalized = await createAdminOrderWithFinalize({
      ...finalizeBase,
      // "none" marks an organizer-recorded free order; every other method
      // collapses to "comp" once the total is zero (spec T4 entity notes).
      paymentMethod: input.paymentMethod === "none" ? "none" : "comp",
      paymentStatus: "comped",
      providerPaymentId: null,
    });
    return finalized;
  }

  if (input.paymentMethod === "comp" || input.paymentMethod === "none") {
    return fail(
      "INVALID_METHOD",
      "Comp orders require a zero total; this order has an amount due.",
    );
  }

  // Invoice: finalize immediately as outstanding — no provider call.
  if (input.paymentMethod === "invoice") {
    return createAdminOrderWithFinalize({
      ...finalizeBase,
      paymentMethod: "invoice",
      paymentStatus: "outstanding",
      providerPaymentId: null,
    });
  }

  // Card: charge first, then finalize on success. The provider is idempotent
  // on the same key, and the pre-flight replay check above guarantees a key
  // that already produced an order never reaches this call again.
  const payment = await input.provider.createPayment({
    orderId,
    amountMinor: totals.totalMinor,
    currency: fee.currency,
    idempotencyKey: input.idempotencyKey,
    method: "card",
  });

  if (payment.status === "failed") {
    // Spec: "order kept, counters untouched" — persist the failed attempt
    // WITHOUT the finalize transaction, so no counter can possibly move.
    const failed = await recordAdminFailedOrder({
      organizationId: input.organizationId,
      eventId: input.eventId,
      idempotencyKey: input.idempotencyKey,
      submissionId: input.submissionId ?? null,
      ticketTypeId: input.ticketTypeId,
      registrationTypeId: input.registrationTypeId,
      feeId: fee.id,
      promotionId: input.promotionId ?? null,
      taxIds: totals.taxLines.map((line) => line.taxId),
      currency: fee.currency,
      amounts,
      snapshot: {
        feeName: fee.name,
        basePriceMinor: fee.basePriceMinor,
        promoCode:
          pricingPromotion && promotion ? (promotion.promoCode ?? null) : null,
        discountType: pricingPromotion?.discountType ?? null,
        discountValue: pricingPromotion?.discountValue ?? null,
        taxLines: totals.taxLines,
      },
      providerPaymentId: payment.providerPaymentId,
      now,
    });
    return fail(
      "PAYMENT_FAILED",
      payment.failureReason ?? "The card payment was declined.",
      failed.order,
    );
  }

  return createAdminOrderWithFinalize({
    ...finalizeBase,
    paymentMethod: "card",
    paymentStatus: "paid",
    providerPaymentId: payment.providerPaymentId,
  });
}
