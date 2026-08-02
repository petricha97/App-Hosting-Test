import { serializeEvents } from "@/features/event/utils";
import { OrganizationEventsBrowser } from "@/features/dashboard/components/organization-events-browser";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";

export default async function DashboardEventsPage({
  searchParams,
}: {
  searchParams?: Promise<{ debug?: string | string[] }>;
}) {
  const scope = await getDashboardScope();
  const events = await getAdminEventsForOrganization(scope.organizationId);
  const resolvedSearchParams = await searchParams;
  const showDebugPayload = resolvedSearchParams?.debug !== undefined;

  return (
    <OrganizationEventsBrowser
      initialEvents={serializeEvents(events)}
      workspaceName={scope.organization?.name ?? null}
      showDebugPayload={showDebugPayload}
    />
  );
}
