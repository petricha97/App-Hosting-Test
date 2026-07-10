// Pure, client-safe price display resolution for the step-2 radio-cards
// (T2 AC-5, review S1). Ambiguous Any-audience tickets carry per-type prices
// in registrationTypeOptions; the card shows:
// - the picked option's EXACT price once this ticket is selected and a
//   "Register as" type is chosen (always equal to the eventual quote);
// - otherwise a "From <min>" label when the option prices differ;
// - otherwise the single shared price.
// Unambiguous tickets always show their exact server-resolved price.

import { formatFeePrice } from "@/features/pricing/utils";
import type { PublicTicketOption } from "@/features/public-registration/types";

export interface TicketDisplayPrice {
  label: string;
  // True when the label is a "From" lower bound (pick pending, prices vary).
  isFromPrice: boolean;
}

export function ticketDisplayPrice(
  ticket: PublicTicketOption,
  selectedTicketId: string | null,
  selectedRegistrationTypeId: string | null,
): TicketDisplayPrice {
  const options = ticket.registrationTypeOptions;
  if (options && options.length > 0) {
    if (ticket.id === selectedTicketId && selectedRegistrationTypeId) {
      const picked = options.find(
        (option) => option.id === selectedRegistrationTypeId,
      );
      if (picked) {
        return {
          label: formatFeePrice(picked.priceMinor, ticket.currency),
          isFromPrice: false,
        };
      }
    }
    const prices = options.map((option) => option.priceMinor);
    if (Math.min(...prices) !== Math.max(...prices)) {
      return {
        label: `From ${formatFeePrice(Math.min(...prices), ticket.currency)}`,
        isFromPrice: true,
      };
    }
  }
  return {
    label: formatFeePrice(ticket.priceMinor, ticket.currency),
    isFromPrice: false,
  };
}

// Whether the "Register as" <option> labels should carry each type's price —
// only when the prices actually differ (uniform prices would be noise).
export function registrationTypeOptionsHaveMixedPrices(
  ticket: PublicTicketOption,
): boolean {
  const options = ticket.registrationTypeOptions;
  if (!options || options.length === 0) return false;
  const prices = options.map((option) => option.priceMinor);
  return Math.min(...prices) !== Math.max(...prices);
}
