// Payment provider abstraction (M2-T4, decision Q1: simulated provider behind
// an interface). Order finalize routes depend on THIS interface only — a real
// Stripe implementation later is a new class, zero call-site changes.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T4).

import type { Currency } from "@/types/collection";

export interface CreatePaymentInput {
  orderId: string;
  // Integer minor units, server-computed — never client-supplied.
  amountMinor: number;
  currency: Currency;
  // Caller's idempotency key: a repeat call with the same key MUST return the
  // original result and never charge twice (a retry after a failure uses a
  // NEW key / new attempt).
  idempotencyKey: string;
  method: "card";
}

export interface CreatePaymentResult {
  status: "succeeded" | "failed";
  providerPaymentId: string;
  failureReason?: string;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
}
