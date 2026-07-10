// Pure step helpers for the fixed M3 public flow — unit-testable, no React.
// 5 steps for card/invoice paths; 4 for comp/none (Payment omitted entirely
// and the remaining steps renumbered — spec Shared decisions, T3 AC-2).

import type { PaymentMethod, RegistrationDraftStep } from "@/types/collection";

export type FlowStepId =
  | "personal_info"
  | "ticket_options"
  | "summary"
  | "payment"
  | "confirmation";

export interface FlowStep {
  id: FlowStepId;
  // 1-based display number AFTER omission.
  number: number;
  title: string;
}

const ALL_STEPS: Array<{ id: FlowStepId; title: string }> = [
  { id: "personal_info", title: "Personal Information" },
  { id: "ticket_options", title: "Ticket & Options" },
  { id: "summary", title: "Registration Summary" },
  { id: "payment", title: "Payment" },
  { id: "confirmation", title: "Confirmation" },
];

export function isPaymentSkipped(paymentMethod: PaymentMethod): boolean {
  return paymentMethod === "comp" || paymentMethod === "none";
}

export function buildPublicFlowSteps(paymentMethod: PaymentMethod): FlowStep[] {
  return ALL_STEPS.filter(
    (step) => step.id !== "payment" || !isPaymentSkipped(paymentMethod),
  ).map((step, index) => ({ ...step, number: index + 1 }));
}

// Index of a step id within a built flow; -1 when the flow omits it.
export function flowStepIndex(steps: FlowStep[], id: FlowStepId): number {
  return steps.findIndex((step) => step.id === id);
}

// The furthest step index the registrant may VIEW, derived from the draft's
// lastStepReached (= last step COMPLETED). No draft yet → only step 1.
// Steps beyond lastStepReached+1 are not navigable (T3 AC-2) — and the
// header circles are never buttons at all; the Back button is the only
// backward navigation.
export function maxNavigableStepIndex(
  steps: FlowStep[],
  lastStepReached: RegistrationDraftStep | null,
): number {
  if (lastStepReached === null) return 0;
  const completedIndex = flowStepIndex(steps, lastStepReached);
  if (completedIndex < 0) {
    // A "payment" marker on a comp/none flow (config changed mid-flight):
    // treat like summary completed.
    return Math.min(flowStepIndex(steps, "summary") + 1, steps.length - 1);
  }
  return Math.min(completedIndex + 1, steps.length - 1);
}

// Resume landing step: the step after the last completed one.
export function resumeStepIndex(
  steps: FlowStep[],
  lastStepReached: RegistrationDraftStep,
): number {
  return maxNavigableStepIndex(steps, lastStepReached);
}

// Primary button label per step (design §3).
export function primaryActionLabel(
  steps: FlowStep[],
  index: number,
  paymentMethod: PaymentMethod,
): string {
  const step = steps[index];
  if (!step) return "Continue";
  if (step.id === "summary") {
    return isPaymentSkipped(paymentMethod)
      ? "Complete registration"
      : "Confirm & pay";
  }
  if (step.id === "payment") {
    return paymentMethod === "invoice" ? "Confirm registration" : "Pay now";
  }
  return "Continue";
}
