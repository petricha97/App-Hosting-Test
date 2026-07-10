// Ticket Types screen (M1-T2). Server Component: verifies org ownership
// (404 on cross-org), fetches tickets + registration types via the admin DAL
// (the reg types feed the toolbar filter and the dialog's eligibility
// checkboxes), and renders the client workspace.
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import {
  serializeFee,
  type SerializedFee,
} from "@/features/pricing/types";
import { TicketTypesWorkspace } from "@/features/registration/components/ticket-types-workspace";
import {
  serializeRegistrationType,
  serializeTicketType,
  type SerializedRegistrationType,
  type SerializedTicketType,
} from "@/features/registration/types";
import { resolveEventTimeZone } from "@/features/registration/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminFeesForEvent } from "@/lib/db/adminFee";
import { getAdminRegistrationTypesForEvent } from "@/lib/db/adminRegistrationType";
import { getAdminTicketTypesForEvent } from "@/lib/db/adminTicketType";

export const metadata: Metadata = {
  title: "Ticket Types | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventTicketTypesPage({ params }: PageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  let tickets: SerializedTicketType[] = [];
  let registrationTypes: SerializedRegistrationType[] = [];
  let fees: SerializedFee[] = [];
  let loadError = false;
  try {
    const [ticketDocs, registrationTypeDocs, feeDocs] = await Promise.all([
      getAdminTicketTypesForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      getAdminRegistrationTypesForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      // Feeds the Price column (M2-T1 AC-12): fee-derived display instead of "—".
      getAdminFeesForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
    ]);
    tickets = ticketDocs.map(serializeTicketType);
    registrationTypes = registrationTypeDocs.map(serializeRegistrationType);
    fees = feeDocs.map(serializeFee);
  } catch {
    // Shell stays interactive; the workspace shows a retryable error panel.
    loadError = true;
  }

  return (
    <TicketTypesWorkspace
      eventId={eventId}
      tickets={tickets}
      registrationTypes={registrationTypes}
      fees={fees}
      timeZone={resolveEventTimeZone(event.timezone)}
      loadError={loadError}
    />
  );
}
