// Pure, client-safe helpers shared by the attendees workspace (M5-T2):
// tab resolution for the ?tab= deep link and the client-side mirrors of the
// M3 path/ticket eligibility rules the register dialog pre-filters with.
// The SERVER re-validates everything (validateTicketSelection + placeOrder)
// — these mirrors are advisory UI filters only.

import type { PaymentMethod } from "@/types/collection";

export type AttendeesTab = "list" | "abandoned";

export function resolveAttendeesTab(
  value: string | string[] | undefined | null,
): AttendeesTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "abandoned" ? "abandoned" : "list";
}

// Manual registration is offline-payment only (spec T2): card paths render
// disabled with the "public flow" tooltip — no card-entry UI/PCI surface.
export function isManualRegistrationPath(paymentMethod: PaymentMethod): boolean {
  return paymentMethod !== "card";
}

// Mirror of isTicketEligibleForPath (src/features/public-registration/
// server/tickets.ts — server-only module, so the rule is restated here):
// audience set -> the ticket's eligible set contains it OR is empty;
// Any audience -> every ticket.
export function isTicketEligibleForAudience(
  ticketRegistrationTypeIds: string[],
  audienceRegistrationTypeId: string | null,
): boolean {
  if (audienceRegistrationTypeId === null) return true;
  return (
    ticketRegistrationTypeIds.length === 0 ||
    ticketRegistrationTypeIds.includes(audienceRegistrationTypeId)
  );
}

// Mirror of the T1 audience -> registration type rule (resolve or ask):
// - path audience set -> it IS the registration type (no picker);
// - Any + ticket restricted to exactly one type -> that one (no picker);
// - otherwise the organizer picks from the ticket's eligible set (or all
//   event types when unrestricted).
export type RegistrationTypeResolution =
  | { kind: "resolved"; registrationTypeId: string }
  | { kind: "choice"; optionIds: string[] };

export function resolveRegistrationTypeChoice(input: {
  audienceRegistrationTypeId: string | null;
  ticketRegistrationTypeIds: string[];
  eventRegistrationTypeIds: string[];
}): RegistrationTypeResolution {
  if (input.audienceRegistrationTypeId !== null) {
    return {
      kind: "resolved",
      registrationTypeId: input.audienceRegistrationTypeId,
    };
  }
  if (input.ticketRegistrationTypeIds.length === 1) {
    return {
      kind: "resolved",
      registrationTypeId: input.ticketRegistrationTypeIds[0],
    };
  }
  return {
    kind: "choice",
    optionIds:
      input.ticketRegistrationTypeIds.length > 0
        ? input.ticketRegistrationTypeIds
        : input.eventRegistrationTypeIds,
  };
}
