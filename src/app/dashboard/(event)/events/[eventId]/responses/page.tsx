// Per-event responses page (M3-T4). Server Component: verifies org ownership
// (404 on cross-org), reads the first bounded page (limit 50, newest first —
// spec AC-9) with the ?status= Firestore filter applied server-side, and
// renders the client browser (search, status filter, CSV export, load more).
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventResponsesBrowser } from "@/features/responses/components/event-responses-browser";
import { resolveResponseTicketLabels } from "@/features/responses/server/ticket-labels";
import { parseStatusFilter } from "@/features/responses/status-utils";
import {
  serializeResponses,
  type SerializedResponse,
} from "@/features/responses/utils";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import {
  FORM_DATA_LIST_LIMIT,
  listAdminFormDataForEvent,
} from "@/lib/db/adminFormData";

export const metadata: Metadata = {
  title: "Responses | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}

export default async function DashboardEventResponsesPage({
  params,
  searchParams,
}: PageProps) {
  const [{ eventId }, { status }] = await Promise.all([params, searchParams]);
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  const statusFilter = parseStatusFilter(status);

  let serializedResponses: SerializedResponse[] = [];
  let initialHasMore = false;
  let loadError = false;
  try {
    const responses = await listAdminFormDataForEvent({
      eventId,
      organizationId: scope.organizationId,
      status: statusFilter,
    });
    const ticketLabels = await resolveResponseTicketLabels(
      responses,
      scope.organizationId,
    );
    serializedResponses = serializeResponses(
      responses,
      new Map([[event.id, event.name]]),
      ticketLabels,
    );
    initialHasMore = responses.length === FORM_DATA_LIST_LIMIT;
  } catch {
    // Shell stays interactive; the browser shows a retryable error panel.
    loadError = true;
  }

  return (
    <EventResponsesBrowser
      eventId={eventId}
      initialResponses={serializedResponses}
      statusFilter={statusFilter}
      initialHasMore={initialHasMore}
      loadError={loadError}
    />
  );
}
