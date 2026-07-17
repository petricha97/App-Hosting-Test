// Shared ticket-type/registration-type id -> name join for the Order &
// transaction details / Abandoned registration details report loaders
// (spec §2/§3, agents/docs/specs/m7-report-templates.md): OrderDoc and
// RegistrationDraftDoc only carry raw ids, not display names. Built ONCE per
// Run/export invocation via one bounded list call each, then applied
// per-row in memory — never an N+1 per-row lookup (spec §2 AC-3).
import "server-only";

import { getAdminRegistrationTypesForEvent } from "@/lib/db/adminRegistrationType";
import { getAdminTicketTypesForEvent } from "@/lib/db/adminTicketType";

// Deleted-while-referenced ticket/registration types are currently
// unreachable (M1-T2 AC-11's delete-block-while-referenced rule) but the
// fallback is documented the same way M7-T1 §1 documents its own
// unreachable case.
export const TYPE_NAME_FALLBACK = "—";

export interface TypeNameMaps {
  ticketTypeNames: Map<string, string>;
  registrationTypeNames: Map<string, string>;
}

export async function loadTypeNameMaps(input: {
  eventId: string;
  organizationId: string;
}): Promise<TypeNameMaps> {
  const [ticketTypes, registrationTypes] = await Promise.all([
    getAdminTicketTypesForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }),
    getAdminRegistrationTypesForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }),
  ]);

  return {
    ticketTypeNames: new Map(ticketTypes.map((t) => [t.id, t.name])),
    registrationTypeNames: new Map(
      registrationTypes.map((t) => [t.id, t.name]),
    ),
  };
}
