// Workspace responses page (M3-T4). Server Component: resolves the dashboard
// scope, reads the bounded, Firestore-filtered response list (?status= and
// ?event= drive the query — spec AC-5, no in-memory status filtering) and
// renders the client browser. Legacy pre-M3 docs carry no status field: they
// appear under "Any" and read as "New" via the read-time defaults
// (documented divergence, no backfill).
import { OrganizationResponsesBrowser } from "@/features/responses/components/organization-responses-browser";
import { resolveResponseTicketLabels } from "@/features/responses/server/ticket-labels";
import { parseStatusFilter } from "@/features/responses/status-utils";
import { serializeResponses } from "@/features/responses/utils";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import {
  listAdminFormDataForEvent,
  listAdminFormDataForOrganization,
} from "@/lib/db/adminFormData";
import type { SerializedResponse } from "@/features/responses/utils";
import type { ResponsesEventOption } from "@/features/responses/components/organization-responses-browser";

interface PageProps {
  searchParams: Promise<{ status?: string | string[]; event?: string | string[] }>;
}

export default async function DashboardResponsesPage({
  searchParams,
}: PageProps) {
  const { status, event } = await searchParams;
  const { organization, organizationId } = await getDashboardScope();

  const statusFilter = parseStatusFilter(status);
  const eventParam = Array.isArray(event) ? event[0] : event;

  let serializedResponses: SerializedResponse[] = [];
  let eventOptions: ResponsesEventOption[] = [];
  let eventFilter: string | undefined;
  let loadError = false;
  try {
    const events = await getAdminEventsForOrganization(organizationId);
    eventOptions = events.map((eventDoc) => ({
      id: eventDoc.id,
      name: eventDoc.name,
    }));
    // Only org-owned events are valid filters — a foreign/unknown id is
    // ignored (never queried), so nothing leaks across tenants.
    eventFilter = eventOptions.some((option) => option.id === eventParam)
      ? eventParam
      : undefined;

    const responses = eventFilter
      ? await listAdminFormDataForEvent({
          eventId: eventFilter,
          organizationId,
          status: statusFilter,
        })
      : await listAdminFormDataForOrganization({
          organizationId,
          status: statusFilter,
        });

    const ticketLabels = await resolveResponseTicketLabels(
      responses,
      organizationId,
    );
    const eventNamesById = new Map(
      eventOptions.map((option) => [option.id, option.name]),
    );
    serializedResponses = serializeResponses(
      responses,
      eventNamesById,
      ticketLabels,
    );
  } catch {
    // Shell stays interactive; the browser shows a retryable error panel.
    loadError = true;
  }

  return (
    <OrganizationResponsesBrowser
      responses={serializedResponses}
      events={eventOptions}
      workspaceName={organization?.name ?? null}
      statusFilter={statusFilter}
      eventFilter={eventFilter}
      loadError={loadError}
    />
  );
}
