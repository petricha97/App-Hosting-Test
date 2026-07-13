// @vitest-environment node
/**
 * M2-T4 AC-14 — SimulatedPaymentProvider behind the PaymentProvider interface.
 * Spec: agents/docs/specs/m2-pricing-commerce.md (decision Q1).
 *
 * Locks: instant success by default, the documented deterministic decline
 * trigger (amountMinor % 100 === 99, overridable via injected failWhen), and
 * idempotency — a repeat call with the same idempotencyKey returns the
 * ORIGINAL result and never registers a second charge.
 */
import { describe, expect, it } from "vitest";

import type {
  CreatePaymentInput,
  PaymentProvider,
} from "@/lib/payments/payment-provider";
import {
  defaultSimulatedFailure,
  SIMULATED_DECLINE_REASON,
  SimulatedPaymentProvider,
} from "@/lib/payments/simulated-payment-provider";

function input(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    orderId: "ord-1",
    amountMinor: 93088,
    currency: "USD",
    idempotencyKey: "key-1",
    method: "card",
    ...overrides,
  };
}

describe("SimulatedPaymentProvider", () => {
  it("succeeds instantly by default with a provider payment id", async () => {
    const provider = new SimulatedPaymentProvider();

    const result = await provider.createPayment(input());

    expect(result.status).toBe("succeeded");
    expect(result.providerPaymentId).toMatch(/^sim_/);
    expect(result.failureReason).toBeUndefined();
    expect(provider.chargeAttempts).toBe(1);
  });

  it("declines deterministically when the minor amount ends in 99", async () => {
    const provider = new SimulatedPaymentProvider();

    const result = await provider.createPayment(
      input({ amountMinor: 95099, idempotencyKey: "key-fail" }),
    );

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe(SIMULATED_DECLINE_REASON);
    expect(result.providerPaymentId).toMatch(/^sim_/);
  });

  it("documents the default trigger as a pure predicate", () => {
    expect(defaultSimulatedFailure(input({ amountMinor: 99 }))).toBe(true);
    expect(defaultSimulatedFailure(input({ amountMinor: 100 }))).toBe(false);
    expect(defaultSimulatedFailure(input({ amountMinor: 0 }))).toBe(false);
  });

  it("honors an injected failWhen flag over the default trigger", async () => {
    const provider = new SimulatedPaymentProvider({ failWhen: () => true });

    const result = await provider.createPayment(input({ amountMinor: 100 }));

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe(SIMULATED_DECLINE_REASON);
  });

  it("is idempotent: a repeat key returns the ORIGINAL result, one charge only", async () => {
    const provider = new SimulatedPaymentProvider();

    const first = await provider.createPayment(input());
    const repeat = await provider.createPayment(input());

    expect(repeat).toBe(first); // same result object — same providerPaymentId
    expect(provider.chargeAttempts).toBe(1); // never double-charges
  });

  it("replays failed results for the same key too (retry = NEW key)", async () => {
    const provider = new SimulatedPaymentProvider();

    const failed = await provider.createPayment(
      input({ amountMinor: 95099, idempotencyKey: "key-fail" }),
    );
    const repeat = await provider.createPayment(
      input({ amountMinor: 95099, idempotencyKey: "key-fail" }),
    );
    const retry = await provider.createPayment(
      input({ amountMinor: 95000, idempotencyKey: "key-retry" }),
    );

    expect(repeat).toBe(failed);
    expect(retry.status).toBe("succeeded");
    expect(provider.chargeAttempts).toBe(2); // fail + retry, repeat not counted
  });

  it("distinct keys are distinct charges with distinct provider ids", async () => {
    const provider = new SimulatedPaymentProvider();

    const a = await provider.createPayment(input({ idempotencyKey: "key-a" }));
    const b = await provider.createPayment(input({ idempotencyKey: "key-b" }));

    expect(a.providerPaymentId).not.toBe(b.providerPaymentId);
    expect(provider.chargeAttempts).toBe(2);
  });

  it("is consumable through the PaymentProvider interface (Q1 swap point)", async () => {
    // Call sites depend on the interface only — a Stripe implementation later
    // slots in with zero call-site changes.
    const provider: PaymentProvider = new SimulatedPaymentProvider();

    const result = await provider.createPayment(input());

    expect(result.status).toBe("succeeded");
  });
});
