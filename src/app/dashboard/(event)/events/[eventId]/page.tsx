import { OrganizationEventDetail } from "@/features/dashboard/components/organization-event-detail";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { loadEventOverview } from "@/features/event/overview";
import { serializeEvent } from "@/features/event/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";

interface EventDetailPageProps { params: Promise<{ eventId: string }> }

export default async function DashboardEventDetailPage({ params }: EventDetailPageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);

  const overview = event
    ? await loadEventOverview({ event, eventId, organizationId: scope.organizationId })
    : null;

  return (
    <OrganizationEventDetail
      event={event ? serializeEvent(event) : null}
      eventId={eventId}
      overview={overview}
    />
  );
}
