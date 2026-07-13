// @vitest-environment node
/**
 * M2-T4 — placeOrder payment lifecycle orchestration (review B-1).
 * Spec: agents/docs/specs/m2-pricing-commerce.md (T4 lifecycle, ACs 3-7).
 *
 * The DAL is mocked at the module boundary (same convention as the route
 * tests); the REAL SimulatedPaymentProvider is used so the provider contract
 * (idempotency, decline trigger, chargeAttempts) is exercised end-to-end.
 *
 * Locks every method -> status row of the normative worked-examples table:
 *  - card  -> paid (provider charged once, providerPaymentId recorded)
 *  - card declined -> failed record persisted, NO finalize call (counters
 *    can never move), PAYMENT_FAILED returned with the persisted order
 *  - invoice -> outstanding, NO provider call
 *  - comp / 100% discount / comp fee (totalMinor === 0) -> comped, NO
 *    provider call (AC-5), organizer "none" method preserved
 *  - idempotent replay pass-through: an existing order short-circuits the
 *    whole lifecycle (no quote, no charge, no finalize); a failed order
 *    replays as PAYMENT_FAILED, never as success
 *  - quote-stage gates: NO_FEE, PROMO_EXPIRED / PROMO_EXHAUSTED,
 *    cross-org promotion -> INVALID_REFERENCE, comp with amount due ->
 *    INVALID_METHOD — all BEFORE any provider charge
 *  - amounts handed to finalize are server-computed (worked example 2
 *    verified verbatim: 95000 / 9500 / 7588 / 93088)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminOrderByIdempotencyKey,
  createAdminOrderWithFinalize,
  recordAdminFailedOrder,
  resolveAdminFeeForOrder,
  getAdminActiveTaxesForEvent,
  getAdminEventPromotionById,
} = vi.hoisted(() => ({
  getAdminOrderByIdempotencyKey: vi.fn(),
  createAdminOrderWithFinalize: vi.fn(),
  recordAdminFailedOrder: vi.fn(),
  resolveAdminFeeForOrder: vi.fn(),
  getAdminActiveTaxesForEvent: vi.fn(),
  getAdminEventPromotionById: vi.fn(),
}));

vi.mock("@/lib/db/adminOrder", () => ({
  getAdminOrderByIdempotencyKey,
  createAdminOrderWithFinalize,
  recordAdminFailedOrder,
}));
vi.mock("@/lib/db/adminFee", () => ({ resolveAdminFeeForOrder }));
vi.mock("@/lib/db/adminTax", () => ({ getAdminActiveTaxesForEvent }));
vi.mock("@/lib/db/adminEventPromotion", () => ({
  getAdminEventPromotionById,
}));

import { placeOrder, type PlaceOrderInput } from "@/lib/orders/place-order";
import { orderIdFromIdempotencyKey } from "@/lib/orders/order-id";
import { SimulatedPaymentProvider } from "@/lib/payments/simulated-payment-provider";

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const KEY = "attempt-1";

// Worked example 2: GC-EB × Delegate × USD 95000.
const feeUsd = {
  id: "fee-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "GC-EB Delegate USD",
  ticketTypeId: "tt-1",
  registrationTypeId: "rt-1",
  currency: "USD",
  basePriceMinor: 95000,
  status: "active",
};

const taxNy = {
  id: "tax-ny",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "New York Sales Tax",
  code: "TAX-NY",
  type: "percentage",
  rateMilliPercent: 8875,
  fixedAmountMinor: null,
  fixedCurrency: null,
  isActive: true,
};

// GCUS10 10%, cap 3, used 1 — available.
const promo10 = {
  id: "promo-1",
  organizationId: ORG_ID,
  name: "GCUS10",
  promoCode: "GCUS10",
  discountType: "percentage",
  discountValue: 10,
  level: "event",
  validityStart: null,
  validityEnd: null,
  usageCap: 3,
  usedCount: 1,
  isActive: true,
};

function baseInput(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    idempotencyKey: KEY,
    ticketTypeId: "tt-1",
    registrationTypeId: "rt-1",
    promotionId: null,
    currency: "USD",
    paymentMethod: "card",
    provider: new SimulatedPaymentProvider(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminOrderByIdempotencyKey.mockResolvedValue(null);
  resolveAdminFeeForOrder.mockResolvedValue(feeUsd);
  getAdminActiveTaxesForEvent.mockResolvedValue([]);
  getAdminEventPromotionById.mockResolvedValue(promo10);
  createAdminOrderWithFinalize.mockImplementation(async (input) => ({
    ok: true,
    orderId: "final-order-id",
    order: { id: "final-order-id", ...input },
    created: true,
  }));
  recordAdminFailedOrder.mockImplementation(async (input) => ({
    orderId: "failed-order-id",
    order: { id: "failed-order-id", ...input, paymentStatus: "failed" },
    created: true,
  }));
});

describe("placeOrder — card lifecycle (worked examples 1 & 2)", () => {
  it("card success finalizes `paid` with the provider payment id (example 1)", async () => {
    resolveAdminFeeForOrder.mockResolvedValue({
      ...feeUsd,
      basePriceMinor: 75000,
    });
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(baseInput({ provider }));

    expect(result.ok).toBe(true);
    expect(provider.chargeAttempts).toBe(1);
    expect(createAdminOrderWithFinalize).toHaveBeenCalledTimes(1);
    const finalizeInput = createAdminOrderWithFinalize.mock.calls[0][0];
    expect(finalizeInput.paymentMethod).toBe("card");
    expect(finalizeInput.paymentStatus).toBe("paid");
    expect(finalizeInput.providerPaymentId).toMatch(/^sim_/);
    expect(finalizeInput.expectedAmounts).toEqual({
      subtotalMinor: 75000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 75000,
    });
  });

  it("computes % discount + tax server-side exactly (example 2: 93088) and charges the TOTAL", async () => {
    getAdminActiveTaxesForEvent.mockResolvedValue([taxNy]);
    const provider = new SimulatedPaymentProvider();
    const createPayment = vi.spyOn(provider, "createPayment");

    const result = await placeOrder(
      baseInput({ provider, promotionId: "promo-1" }),
    );

    expect(result.ok).toBe(true);
    // 95000 - 9500 = 85500; 8.875% of 85500 = 7588.125 -> 7588 (half-up down).
    expect(createAdminOrderWithFinalize.mock.calls[0][0].expectedAmounts).toEqual({
      subtotalMinor: 95000,
      discountMinor: 9500,
      taxMinor: 7588,
      totalMinor: 93088,
    });
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 93088,
        currency: "USD",
        idempotencyKey: KEY,
        method: "card",
        orderId: orderIdFromIdempotencyKey({
          organizationId: ORG_ID,
          eventId: EVENT_ID,
          idempotencyKey: KEY,
        }),
      }),
    );
  });

  it("card decline persists a `failed` record and NEVER calls finalize (AC-6: counters untouched)", async () => {
    getAdminActiveTaxesForEvent.mockResolvedValue([taxNy]);
    const provider = new SimulatedPaymentProvider({ failWhen: () => true });

    const result = await placeOrder(
      baseInput({ provider, promotionId: "promo-1" }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PAYMENT_FAILED",
      order: { id: "failed-order-id", paymentStatus: "failed" },
    });
    // The finalize transaction — the ONLY writer of counters — never ran.
    expect(createAdminOrderWithFinalize).not.toHaveBeenCalled();
    expect(recordAdminFailedOrder).toHaveBeenCalledTimes(1);
    const failedInput = recordAdminFailedOrder.mock.calls[0][0];
    expect(failedInput.amounts).toEqual({
      subtotalMinor: 95000,
      discountMinor: 9500,
      taxMinor: 7588,
      totalMinor: 93088,
    });
    // Full audit snapshot travels with the failed record too.
    expect(failedInput.snapshot).toMatchObject({
      feeName: "GC-EB Delegate USD",
      basePriceMinor: 95000,
      promoCode: "GCUS10",
      discountType: "percentage",
      discountValue: 10,
    });
    expect(failedInput.snapshot.taxLines).toHaveLength(1);
    expect(failedInput.providerPaymentId).toMatch(/^sim_/);
  });

  it("passes a post-charge finalize failure through (SOLD_OUT race)", async () => {
    createAdminOrderWithFinalize.mockResolvedValue({
      ok: false,
      code: "SOLD_OUT",
      message: "This ticket is sold out.",
    });
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(baseInput({ provider }));

    expect(result).toEqual({
      ok: false,
      code: "SOLD_OUT",
      message: "This ticket is sold out.",
    });
    expect(provider.chargeAttempts).toBe(1);
    expect(recordAdminFailedOrder).not.toHaveBeenCalled();
  });
});

describe("placeOrder — invoice and comp rows (worked examples 3 & 4)", () => {
  it("invoice finalizes `outstanding` with NO provider call (example 3: fixed discount clamps at 60000)", async () => {
    resolveAdminFeeForOrder.mockResolvedValue({
      ...feeUsd,
      currency: "GBP",
      basePriceMinor: 78000,
    });
    getAdminEventPromotionById.mockResolvedValue({
      ...promo10,
      promoCode: "£600GCUS",
      discountType: "fixed",
      discountValue: 600,
    });
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(
      baseInput({
        provider,
        currency: "GBP",
        paymentMethod: "invoice",
        promotionId: "promo-1",
      }),
    );

    expect(result.ok).toBe(true);
    expect(provider.chargeAttempts).toBe(0);
    const finalizeInput = createAdminOrderWithFinalize.mock.calls[0][0];
    expect(finalizeInput.paymentMethod).toBe("invoice");
    expect(finalizeInput.paymentStatus).toBe("outstanding");
    expect(finalizeInput.providerPaymentId).toBeNull();
    expect(finalizeInput.expectedAmounts).toEqual({
      subtotalMinor: 78000,
      discountMinor: 60000,
      taxMinor: 0,
      totalMinor: 18000,
    });
  });

  it("100% discount finalizes `comped` with NO provider call (example 4; AC-5)", async () => {
    resolveAdminFeeForOrder.mockResolvedValue({
      ...feeUsd,
      basePriceMinor: 145000,
    });
    getAdminEventPromotionById.mockResolvedValue({
      ...promo10,
      promoCode: "HARVEYAI/C100",
      discountValue: 100,
      usageCap: 7,
      usedCount: 0,
    });
    getAdminActiveTaxesForEvent.mockResolvedValue([taxNy]);
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(
      baseInput({ provider, paymentMethod: "comp", promotionId: "promo-1" }),
    );

    expect(result.ok).toBe(true);
    expect(provider.chargeAttempts).toBe(0);
    const finalizeInput = createAdminOrderWithFinalize.mock.calls[0][0];
    expect(finalizeInput.paymentMethod).toBe("comp");
    expect(finalizeInput.paymentStatus).toBe("comped");
    // 8.875% of a zero taxable base is 0 — tax line exists but charges nothing.
    expect(finalizeInput.expectedAmounts).toEqual({
      subtotalMinor: 145000,
      discountMinor: 145000,
      taxMinor: 0,
      totalMinor: 0,
    });
  });

  it("a comp FEE (basePriceMinor 0) requested as card still finalizes `comped`, method `comp`, no charge", async () => {
    resolveAdminFeeForOrder.mockResolvedValue({ ...feeUsd, basePriceMinor: 0 });
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(baseInput({ provider }));

    expect(result.ok).toBe(true);
    expect(provider.chargeAttempts).toBe(0);
    const finalizeInput = createAdminOrderWithFinalize.mock.calls[0][0];
    expect(finalizeInput.paymentMethod).toBe("comp");
    expect(finalizeInput.paymentStatus).toBe("comped");
  });

  it("preserves the organizer-recorded `none` method on zero-total orders", async () => {
    resolveAdminFeeForOrder.mockResolvedValue({ ...feeUsd, basePriceMinor: 0 });

    await placeOrder(baseInput({ paymentMethod: "none" }));

    expect(createAdminOrderWithFinalize.mock.calls[0][0].paymentMethod).toBe(
      "none",
    );
    expect(createAdminOrderWithFinalize.mock.calls[0][0].paymentStatus).toBe(
      "comped",
    );
  });

  it("rejects comp/none methods when an amount is actually due (INVALID_METHOD)", async () => {
    const provider = new SimulatedPaymentProvider();

    const comp = await placeOrder(
      baseInput({ provider, paymentMethod: "comp" }),
    );
    const none = await placeOrder(
      baseInput({ provider, paymentMethod: "none" }),
    );

    expect(comp).toMatchObject({ ok: false, code: "INVALID_METHOD" });
    expect(none).toMatchObject({ ok: false, code: "INVALID_METHOD" });
    expect(provider.chargeAttempts).toBe(0);
    expect(createAdminOrderWithFinalize).not.toHaveBeenCalled();
  });
});

describe("placeOrder — idempotent replay pass-through (AC-7)", () => {
  it("returns the existing order without re-quoting, re-charging or re-finalizing", async () => {
    const existing = {
      id: "existing-id",
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      idempotencyKey: KEY,
      paymentStatus: "paid",
    };
    getAdminOrderByIdempotencyKey.mockResolvedValue(existing);
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(baseInput({ provider }));

    expect(result).toEqual({
      ok: true,
      orderId: "existing-id",
      order: existing,
      created: false,
    });
    expect(provider.chargeAttempts).toBe(0);
    expect(resolveAdminFeeForOrder).not.toHaveBeenCalled();
    expect(createAdminOrderWithFinalize).not.toHaveBeenCalled();
    expect(recordAdminFailedOrder).not.toHaveBeenCalled();
  });

  it("replays a FAILED order as PAYMENT_FAILED — never silently upgraded to success", async () => {
    const failed = {
      id: "failed-id",
      paymentStatus: "failed",
      idempotencyKey: KEY,
    };
    getAdminOrderByIdempotencyKey.mockResolvedValue(failed);
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(baseInput({ provider }));

    expect(result).toMatchObject({
      ok: false,
      code: "PAYMENT_FAILED",
      order: failed,
    });
    expect(provider.chargeAttempts).toBe(0);
    expect(createAdminOrderWithFinalize).not.toHaveBeenCalled();
    expect(recordAdminFailedOrder).not.toHaveBeenCalled();
  });
});

describe("placeOrder — quote-stage gates (all BEFORE any charge)", () => {
  it("returns NO_FEE when no active fee prices the combination (AC-3)", async () => {
    resolveAdminFeeForOrder.mockResolvedValue(null);
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(baseInput({ provider }));

    expect(result).toMatchObject({ ok: false, code: "NO_FEE" });
    expect(provider.chargeAttempts).toBe(0);
    expect(createAdminOrderWithFinalize).not.toHaveBeenCalled();
  });

  it("returns PROMO_EXPIRED for an inactive or out-of-window promotion (AC-4)", async () => {
    getAdminEventPromotionById.mockResolvedValue({
      ...promo10,
      isActive: false,
    });
    const provider = new SimulatedPaymentProvider();

    const result = await placeOrder(
      baseInput({ provider, promotionId: "promo-1" }),
    );

    expect(result).toMatchObject({ ok: false, code: "PROMO_EXPIRED" });
    expect(provider.chargeAttempts).toBe(0);
  });

  it("returns PROMO_EXPIRED past validityEnd (injectable clock)", async () => {
    getAdminEventPromotionById.mockResolvedValue({
      ...promo10,
      validityEnd: { toMillis: () => Date.UTC(2026, 7, 31) },
    });

    const result = await placeOrder(
      baseInput({ promotionId: "promo-1", now: new Date(Date.UTC(2026, 8, 1)) }),
    );

    expect(result).toMatchObject({ ok: false, code: "PROMO_EXPIRED" });
  });

  it("returns PROMO_EXHAUSTED at the usage cap (example 3's 4th use)", async () => {
    getAdminEventPromotionById.mockResolvedValue({
      ...promo10,
      usageCap: 3,
      usedCount: 3,
    });

    const result = await placeOrder(baseInput({ promotionId: "promo-1" }));

    expect(result).toMatchObject({ ok: false, code: "PROMO_EXHAUSTED" });
    expect(createAdminOrderWithFinalize).not.toHaveBeenCalled();
  });

  it("returns INVALID_REFERENCE for a cross-org promotion (IDOR — existence never leaks)", async () => {
    getAdminEventPromotionById.mockResolvedValue({
      ...promo10,
      organizationId: "org-other",
    });

    const result = await placeOrder(baseInput({ promotionId: "promo-1" }));

    expect(result).toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
  });
});
