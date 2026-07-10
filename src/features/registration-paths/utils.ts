// Pure display helpers for the registration-paths screen (M3-T1). Kept out
// of the components so the flow-step rules (T1 AC-3: Payment omitted for
// comp/none paths) are unit-testable.

import type { PaymentMethod } from "@/types/collection";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Card",
  invoice: "Invoice",
  comp: "Comp",
  none: "None",
};

// The fixed M3 5-step public flow (custom steps are M4-T2).
export const FLOW_STEP_TITLES = [
  "Personal Information",
  "Ticket & Options",
  "Registration Summary",
  "Payment",
  "Confirmation + QR",
] as const;

// Step 4 (Payment) is skipped entirely for free paths (spec Shared decisions).
export function isPaymentSkipped(paymentMethod: PaymentMethod): boolean {
  return paymentMethod === "comp" || paymentMethod === "none";
}

export interface FlowStep {
  // 1-based display number AFTER omission (comp/none paths renumber 1–4).
  number: number;
  title: string;
}

// Steps for the flow-diagram card: 5 for card/invoice, 4 (no Payment,
// renumbered) for comp/none (T1 AC-3).
export function buildFlowSteps(paymentMethod: PaymentMethod): FlowStep[] {
  const titles = isPaymentSkipped(paymentMethod)
    ? FLOW_STEP_TITLES.filter((title) => title !== "Payment")
    : [...FLOW_STEP_TITLES];

  return titles.map((title, index) => ({ number: index + 1, title }));
}

// Badge copy appended to the flow card for free paths ("Payment skipped —
// Comp" / "Payment skipped — Free" per design §1).
export function paymentSkippedLabel(
  paymentMethod: PaymentMethod,
): string | null {
  if (paymentMethod === "comp") return "Payment skipped — Comp";
  if (paymentMethod === "none") return "Payment skipped — Free";
  return null;
}
