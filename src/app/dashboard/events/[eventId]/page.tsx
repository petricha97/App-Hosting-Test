import { OrganizationEventDetail } from "@/features/dashboard/components/organization-event-detail";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { serializeEvent } from "@/features/event/utils";

interface EventDetailPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventDetailPage({
  params,
}: EventDetailPageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);

  return <OrganizationEventDetail event={event ? serializeEvent(event) : null} />;
}
