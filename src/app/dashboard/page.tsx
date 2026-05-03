import { OrganizationEventOverview } from "@/features/dashboard/components/organization-event-overview";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import { serializeEvents } from "@/features/event/utils";

export default async function DashboardOverviewPage() {
  const scope = await getDashboardScope();
  const events = await getAdminEventsForOrganization(scope.organizationId);

  return (
    <OrganizationEventOverview
      initialEvents={serializeEvents(events)}
      workspaceName={scope.organization?.name ?? null}
    />
  );
}
