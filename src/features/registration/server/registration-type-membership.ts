// Route-owned validation helper (M1-T2 AC-7): every id in a ticket's
// registrationTypeIds must reference a registration type of the SAME event.
// Shared by the ticket create and update routes.
//
// Membership is checked with a direct scoped doc get PER ID (not against a
// truncated list read) so validity never depends on how many registration
// types the event has accumulated. The read count is bounded by the payload
// schema's MAX_TICKET_REGISTRATION_TYPES cap on the array.
import "server-only";

import { getAdminRegistrationTypeForEvent } from "@/lib/db/adminRegistrationType";

// Returns the ids that do NOT belong to this event (empty array = all valid).
export async function findUnknownRegistrationTypeIds(input: {
  eventId: string;
  organizationId: string;
  registrationTypeIds: string[];
}): Promise<string[]> {
  if (input.registrationTypeIds.length === 0) {
    return [];
  }

  const uniqueIds = [...new Set(input.registrationTypeIds)];
  const results = await Promise.all(
    uniqueIds.map(async (registrationTypeId) => {
      // Scoped getter returns null for missing docs AND docs belonging to
      // another event/org — any unresolved id is rejected.
      const doc = await getAdminRegistrationTypeForEvent({
        registrationTypeId,
        eventId: input.eventId,
        organizationId: input.organizationId,
      });
      return doc === null ? registrationTypeId : null;
    }),
  );

  return results.filter((id): id is string => id !== null);
}
