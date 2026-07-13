// SimulatedPaymentProvider — the M2 implementation of PaymentProvider.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T4, decision Q1).
//
// Behavior (documented per spec):
// - Instant "succeeded" by default.
// - Deterministic failure trigger for tests and demos: an amount whose minor
//   units end in 99 (amountMinor % 100 === 99) is declined — overridable by
//   injecting `failWhen` in the constructor.
// - Idempotent: a repeat call with the same idempotencyKey returns the ORIGINAL
//   result object (same providerPaymentId, same status — including failures)
//   and never registers a second charge attempt. Retrying after a failure is
//   a NEW attempt under a NEW idempotency key, matching the order lifecycle.
// - State is per-instance and in-memory: sufficient for the simulated provider
//   because order idempotency is ultimately owned by the Firestore finalize
//   transaction (deterministic Order doc IDs); this layer just guarantees the
//   provider contract for repeat calls within a request lifecycle and tests.

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
} from "@/lib/payments/payment-provider";

export const SIMULATED_DECLINE_REASON = "simulated_decline";

// Default deterministic decline trigger: minor amount ends in 99.
export function defaultSimulatedFailure(input: CreatePaymentInput): boolean {
  return input.amountMinor % 100 === 99;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  private readonly resultsByKey = new Map<string, CreatePaymentResult>();
  private readonly failWhen: (input: CreatePaymentInput) => boolean;
  private attempts = 0;

  constructor(options: {
    failWhen?: (input: CreatePaymentInput) => boolean;
  } = {}) {
    this.failWhen = options.failWhen ?? defaultSimulatedFailure;
  }

  // Number of REAL charge attempts made (idempotent repeats do not count) —
  // lets tests assert "one provider charge" for double submits.
  get chargeAttempts(): number {
    return this.attempts;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const existing = this.resultsByKey.get(input.idempotencyKey);
    if (existing) {
      // Idempotent repeat: original result, no new charge.
      return existing;
    }

    this.attempts += 1;
    const providerPaymentId = `sim_${this.attempts.toString(36)}_${input.orderId}`;

    const result: CreatePaymentResult = this.failWhen(input)
      ? {
          status: "failed",
          providerPaymentId,
          failureReason: SIMULATED_DECLINE_REASON,
        }
      : { status: "succeeded", providerPaymentId };

    this.resultsByKey.set(input.idempotencyKey, result);
    return result;
  }
}
