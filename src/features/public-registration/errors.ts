// Typed-error → surface mapping for the public flow (M3-T3 error table).
// Raw provider/finalize codes never render — the API already maps them to
// stable public codes + friendly copy; this module decides WHERE each one
// surfaces (toast vs banner) and what the stepper does next. Pure module —
// unit-testable, no React.

import type { FlowStepId } from "@/features/public-registration/steps";

export interface FinalizeErrorSurface {
  // "toast" pairs with a step jump; "banner" renders inline above the footer.
  kind: "toast" | "banner";
  message: string;
  // Step the flow returns to (undefined = stay on the current step).
  goToStep?: FlowStepId;
  // Step 2 must refetch availability (sold-out race — T3 AC-9).
  refreshTickets?: boolean;
  // Step 3 must re-quote (PRICE_CHANGED).
  requote?: boolean;
  // The applied promo chip is cleared (expired/exhausted mid-flow).
  clearPromo?: boolean;
}

export function mapFinalizeErrorToSurface(input: {
  status: number;
  code?: string;
  message?: string;
}): FinalizeErrorSurface {
  if (input.status === 429) {
    return {
      kind: "banner",
      message: "Too many attempts — please wait a moment.",
    };
  }

  switch (input.code) {
    case "SOLD_OUT":
    case "TYPE_FULL":
      return {
        kind: "toast",
        message: "That ticket just sold out",
        goToStep: "ticket_options",
        refreshTickets: true,
      };
    case "PRICE_CHANGED":
      return {
        kind: "toast",
        message: "Prices were updated — please review",
        goToStep: "summary",
        requote: true,
      };
    case "PROMO_INVALID":
      return {
        kind: "banner",
        message: input.message ?? "This code isn't valid.",
        goToStep: "ticket_options",
        clearPromo: true,
      };
    case "SELECTION_UNAVAILABLE":
      return {
        kind: "banner",
        message: "This selection is no longer available.",
        goToStep: "ticket_options",
        refreshTickets: true,
      };
    case "PAYMENT_FAILED":
      // Stay on step 4; the server already bumped the attempt counter so the
      // retry runs under a fresh idempotency key.
      return {
        kind: "banner",
        message: input.message ?? "The payment was declined. Please try again.",
      };
    case "OUT_OF_ORDER":
      return {
        kind: "banner",
        message: "Complete the previous steps first.",
        goToStep: "ticket_options",
      };
    default:
      return {
        kind: "banner",
        message: "Something went wrong. Please try again.",
      };
  }
}
