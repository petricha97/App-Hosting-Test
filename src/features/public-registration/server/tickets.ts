// Public ticket projection + step-2 selection validation for the multi-step
// registration flow (M3-T2 AC-4/5, T3 AC-4).
//
// Which tickets show (spec T2): tickets of the event where
//   (a) eligibility matches the path's audience — registrationTypeIds
//       contains it OR is empty; Any-audience paths list all tickets;
//   (b) derived-open per M1 (isOpen + sales window) — closed tickets HIDDEN;
//   (c) an active Fee prices (ticket, audience-or-null, path.currency) —
//       unpriced tickets HIDDEN.
// Capacity-full tickets render DISABLED with "Sold out" — never hidden.
//
// AMBIGUOUS Any-audience tickets (T2 AC-5, review S1): the price depends on
// the "Register as" choice (specific fee wins over the "All types" fee per
// M2), so the fee is resolved PER CHOOSABLE TYPE and each option carries its
// own priceMinor. Types with no resolvable fee are excluded from the picker
// (choosing them could never be quoted); a ticket with zero priceable types
// stays hidden. The card-level priceMinor is the MINIMUM across options — a
// "from" price until the registrant picks, after which the client shows the
// picked option's exact price, which finalize/quote will reproduce.
//
// PUBLIC-SAFE PROJECTION: the response never carries registeredCount,
// capacity, raw registrationTypeIds, sales timestamps or org internals —
// only what the radio-cards render (id/name/code/price/availability) plus
// the registration-type CHOICES (id+name) an ambiguous Any-audience ticket
// needs for its "Register as" picker.
import "server-only";

import { isTicketOpen } from "@/features/registration/utils";
import { resolveAdminFeeForOrder } from "@/lib/db/adminFee";
import { getAdminRegistrationTypesForEvent } from "@/lib/db/adminRegistrationType";
import {
  getAdminTicketTypesForEvent,
  getAdminTicketTypeForEvent,
} from "@/lib/db/adminTicketType";
import type {
  RegistrationPathDoc,
  RegistrationTypeDoc,
  TicketTypeDoc,
  WithId,
} from "@/types/collection";
import type {
  PublicTicketAvailability,
  PublicTicketOption,
} from "@/features/public-registration/types";

const LOW_CAPACITY_THRESHOLD = 5;

export type { PublicTicketAvailability, PublicTicketOption };

function toMs(value: { toMillis?: () => number } | null): number | null {
  return value && typeof value.toMillis === "function" ? value.toMillis() : null;
}

export function deriveTicketAvailability(
  ticket: Pick<TicketTypeDoc, "capacity" | "registeredCount">,
): PublicTicketAvailability {
  if (ticket.capacity === null) return "available";
  const left = ticket.capacity - ticket.registeredCount;
  if (left <= 0) return "sold_out";
  if (left <= LOW_CAPACITY_THRESHOLD) return "low";
  return "available";
}

// Eligibility per the path audience: audience set → the ticket's eligible
// set contains it OR is empty (unrestricted); Any audience → every ticket.
export function isTicketEligibleForPath(
  ticket: Pick<TicketTypeDoc, "registrationTypeIds">,
  path: Pick<RegistrationPathDoc, "audienceRegistrationTypeId">,
): boolean {
  const audience = path.audienceRegistrationTypeId;
  if (audience === null) return true;
  return (
    ticket.registrationTypeIds.length === 0 ||
    ticket.registrationTypeIds.includes(audience)
  );
}

// Registration type used for PRICE RESOLUTION of an UNAMBIGUOUS ticket on
// the tickets list (the quote/finalize re-resolve with the registrant's
// actual choice, which for these tickets is forced to the same value):
// - audience set → the audience;
// - Any + ticket restricted to exactly one type → that type.
// Ambiguous tickets never reach this function — they are priced PER
// CHOOSABLE TYPE in listPublicTicketsForPath (T2 AC-5, review S1); the ""
// return is a defensive fallback that matches only an "All types" fee.
export function resolvePricingRegistrationTypeId(
  ticket: Pick<TicketTypeDoc, "registrationTypeIds">,
  path: Pick<RegistrationPathDoc, "audienceRegistrationTypeId">,
): string {
  if (path.audienceRegistrationTypeId !== null) {
    return path.audienceRegistrationTypeId;
  }
  if (ticket.registrationTypeIds.length === 1) {
    return ticket.registrationTypeIds[0];
  }
  return "";
}

// The T1 audience → order registrationTypeId rule, used by draft step-2
// validation and finalize:
// - audience set → it IS the order's registration type (client choice ignored);
// - Any + exactly one eligible type on the ticket → that one;
// - Any + multiple/unrestricted → the registrant's choice, which must belong
//   to the eligible set (or to the event's types when unrestricted).
export type ResolveRegistrationTypeResult =
  | { ok: true; registrationTypeId: string }
  | { ok: false; reason: "choice_required" | "invalid_choice" };

export function resolveRegistrationTypeForSelection(input: {
  path: Pick<RegistrationPathDoc, "audienceRegistrationTypeId">;
  ticket: Pick<TicketTypeDoc, "registrationTypeIds">;
  requestedRegistrationTypeId: string | null;
  eventRegistrationTypeIds: string[];
}): ResolveRegistrationTypeResult {
  const audience = input.path.audienceRegistrationTypeId;
  if (audience !== null) {
    return { ok: true, registrationTypeId: audience };
  }

  const eligible = input.ticket.registrationTypeIds;
  if (eligible.length === 1) {
    return { ok: true, registrationTypeId: eligible[0] };
  }

  const allowed = eligible.length > 0 ? eligible : input.eventRegistrationTypeIds;
  const requested = input.requestedRegistrationTypeId;
  if (!requested) {
    return { ok: false, reason: "choice_required" };
  }
  if (!allowed.includes(requested)) {
    return { ok: false, reason: "invalid_choice" };
  }
  return { ok: true, registrationTypeId: requested };
}

// Builds the public tickets list for a path (GET tickets endpoint).
export async function listPublicTicketsForPath(input: {
  eventId: string;
  organizationId: string;
  path: WithId<RegistrationPathDoc>;
  nowMs?: number;
}): Promise<PublicTicketOption[]> {
  const nowMs = input.nowMs ?? Date.now();
  const [tickets, registrationTypes] = await Promise.all([
    getAdminTicketTypesForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }),
    getAdminRegistrationTypesForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }),
  ]);

  const typeById = new Map<string, WithId<RegistrationTypeDoc>>(
    registrationTypes.map((type) => [type.id, type]),
  );

  const options: PublicTicketOption[] = [];

  for (const ticket of tickets) {
    if (!isTicketEligibleForPath(ticket, input.path)) continue;
    if (
      !isTicketOpen(
        {
          isOpen: ticket.isOpen,
          salesStartMs: toMs(ticket.salesStart),
          salesEndMs: toMs(ticket.salesEnd),
        },
        nowMs,
      )
    ) {
      continue;
    }

    const ambiguous =
      input.path.audienceRegistrationTypeId === null &&
      ticket.registrationTypeIds.length !== 1;

    if (!ambiguous) {
      const fee = await resolveAdminFeeForOrder({
        eventId: input.eventId,
        organizationId: input.organizationId,
        ticketTypeId: ticket.id,
        registrationTypeId: resolvePricingRegistrationTypeId(ticket, input.path),
        currency: input.path.currency,
      });
      if (!fee) continue; // unpriced in the path currency → hidden

      options.push({
        id: ticket.id,
        name: ticket.name,
        code: ticket.code,
        priceMinor: fee.basePriceMinor,
        currency: input.path.currency,
        availability: deriveTicketAvailability(ticket),
      });
      continue;
    }

    // Ambiguous (Any audience, multiple/unrestricted eligible types): price
    // per choosable type so the card can always show the exact price of the
    // registrant's "Register as" pick (T2 AC-5, review S1). Fee resolution
    // is specific-wins per M2, so types WITH a specific fee can differ from
    // the "All types" fee — the divergence the old ""-resolution missed.
    const choiceIds =
      ticket.registrationTypeIds.length > 0
        ? ticket.registrationTypeIds
        : registrationTypes.map((type) => type.id);

    const registrationTypeOptions: Array<{
      id: string;
      name: string;
      priceMinor: number;
    }> = [];
    for (const choiceId of choiceIds) {
      const type = typeById.get(choiceId);
      if (!type) continue;
      const fee = await resolveAdminFeeForOrder({
        eventId: input.eventId,
        organizationId: input.organizationId,
        ticketTypeId: ticket.id,
        registrationTypeId: choiceId,
        currency: input.path.currency,
      });
      // Fee-less types are excluded — selecting them could never be quoted
      // (step-2 validation would NO_FEE them anyway).
      if (!fee) continue;
      registrationTypeOptions.push({
        id: type.id,
        name: type.name,
        priceMinor: fee.basePriceMinor,
      });
    }

    // No choosable type priced in the path currency → hidden, same rule as
    // an unpriced unambiguous ticket.
    if (registrationTypeOptions.length === 0) continue;

    options.push({
      id: ticket.id,
      name: ticket.name,
      code: ticket.code,
      // "From" price until the pick — the client swaps in the picked
      // option's exact price (ticket-price.ts).
      priceMinor: Math.min(
        ...registrationTypeOptions.map((option) => option.priceMinor),
      ),
      currency: input.path.currency,
      availability: deriveTicketAvailability(ticket),
      registrationTypeOptions,
    });
  }

  return options;
}

// Step-2 server validation (T3 AC-4 — client prefilters are advisory only):
// the selected ticket must exist in this event, be eligible for the path,
// derived-open, and priced in the path currency for the resolved
// registration type. Returns everything the caller needs to persist.
export type ValidateTicketSelectionResult =
  | {
      ok: true;
      ticket: WithId<TicketTypeDoc>;
      registrationTypeId: string;
      soldOut: boolean;
    }
  | {
      ok: false;
      code:
        | "INVALID_TICKET"
        | "TICKET_CLOSED"
        | "NO_FEE"
        | "CHOICE_REQUIRED"
        | "INVALID_CHOICE";
    };

export async function validateTicketSelection(input: {
  eventId: string;
  organizationId: string;
  path: WithId<RegistrationPathDoc>;
  ticketTypeId: string;
  requestedRegistrationTypeId: string | null;
  nowMs?: number;
}): Promise<ValidateTicketSelectionResult> {
  const nowMs = input.nowMs ?? Date.now();

  const ticket = await getAdminTicketTypeForEvent({
    ticketTypeId: input.ticketTypeId,
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
  if (!ticket || !isTicketEligibleForPath(ticket, input.path)) {
    return { ok: false, code: "INVALID_TICKET" };
  }

  if (
    !isTicketOpen(
      {
        isOpen: ticket.isOpen,
        salesStartMs: toMs(ticket.salesStart),
        salesEndMs: toMs(ticket.salesEnd),
      },
      nowMs,
    )
  ) {
    return { ok: false, code: "TICKET_CLOSED" };
  }

  const registrationTypes = await getAdminRegistrationTypesForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
  const resolved = resolveRegistrationTypeForSelection({
    path: input.path,
    ticket,
    requestedRegistrationTypeId: input.requestedRegistrationTypeId,
    eventRegistrationTypeIds: registrationTypes.map((type) => type.id),
  });
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.reason === "choice_required" ? "CHOICE_REQUIRED" : "INVALID_CHOICE",
    };
  }

  const fee = await resolveAdminFeeForOrder({
    eventId: input.eventId,
    organizationId: input.organizationId,
    ticketTypeId: ticket.id,
    registrationTypeId: resolved.registrationTypeId,
    currency: input.path.currency,
  });
  if (!fee) return { ok: false, code: "NO_FEE" };

  return {
    ok: true,
    ticket,
    registrationTypeId: resolved.registrationTypeId,
    soldOut: deriveTicketAvailability(ticket) === "sold_out",
  };
}
