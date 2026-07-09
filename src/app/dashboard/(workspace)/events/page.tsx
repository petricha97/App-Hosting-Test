import { OrganizationEventsBrowser } from "@/features/dashboard/components/organization-events-browser";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import { serializeEvents } from "@/features/event/utils";

export default async function DashboardEventsPage() {
  const scope = await getDashboardScope();
  const events = await getAdminEventsForOrganization(scope.organizationId);

  return (
    <OrganizationEventsBrowser
      initialEvents={serializeEvents(events)}
      workspaceName={scope.organization?.name ?? null}
    />
  );
}
