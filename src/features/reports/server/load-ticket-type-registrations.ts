// Server-side orchestration for the "Registrations by ticket type" chart
// (spec §1, §3). This layer never touches Firestore directly — it only calls
// src/lib/db/ functions and shapes the results into the plain
// { label, count }[] the presentational chart component needs (pre-sorted,
// "No ticket type" bucket appended last only when non-zero).
//
// BACKEND DEPENDENCY (flagged for Backend review, M7-T1 parallel dispatch):
// this calls `countAdminAttendeesForEvent` with an optional `ticketTypeId`
// filter (including explicit `null` for the "No ticket type" bucket) per the
// spec's Gap analysis: "extend countAdminAttendeesForEvent with an optional
// ticketTypeId filter ... or add a sibling method — Backend/FS's naming
// call." At the time this file was written, the shipped
// `countAdminAttendeesForEvent` (src/lib/db/adminAttendee.ts) only accepts
// `status`/`checkInState`. This file is written against the EXACT extended
// signature the spec/design doc describe; if Backend ships a differently
// named sibling method instead, only the two call sites below need updating.
import "server-only";

import { countAdminAttendeesForEvent } from "@/lib/db/adminAttendee";
import { getAdminTicketTypesForEvent } from "@/lib/db/adminTicketType";
import type { TicketTypeRegistrationRow } from "@/features/reports/types";

const NO_TICKET_TYPE_LABEL = "No ticket type";

export async function loadTicketTypeRegistrations(input: {
  eventId: string;
  organizationId: string;
}): Promise<TicketTypeRegistrationRow[]> {
  const ticketTypes = await getAdminTicketTypesForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });

  // Run every count in parallel (spec §3 AC-2): one call per ticket type
  // (creation-order stable, matching getAdminTicketTypesForEvent's own
  // createdAt-asc order) plus one call for the "No ticket type" bucket.
  const [counts, noTicketTypeCount] = await Promise.all([
    Promise.all(
      ticketTypes.map((ticketType) =>
        countAdminAttendeesForEvent({
          eventId: input.eventId,
          organizationId: input.organizationId,
          status: "accepted",
          ticketTypeId: ticketType.id,
        }),
      ),
    ),
    countAdminAttendeesForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      status: "accepted",
      ticketTypeId: null,
    }),
  ]);

  const rows: TicketTypeRegistrationRow[] = ticketTypes.map(
    (ticketType, index) => ({
      label: ticketType.name,
      count: counts[index],
    }),
  );

  // Stable sort (Array.prototype.sort is stable per ES2019+): rows with
  // equal counts keep the ticket types' original creation-order (spec §1:
  // "ties broken by the ticket type's existing list order").
  const sorted = [...rows].sort((a, b) => b.count - a.count);

  // Appended LAST, only when its count is > 0 (spec §1: "never a phantom
  // zero row") — never re-sorted into the main list.
  if (noTicketTypeCount > 0) {
    sorted.push({ label: NO_TICKET_TYPE_LABEL, count: noTicketTypeCount });
  }

  return sorted;
}
