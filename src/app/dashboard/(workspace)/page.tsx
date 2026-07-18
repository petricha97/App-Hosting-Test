import { OrganizationEventOverview } from "@/features/dashboard/components/organization-event-overview";
import { WorkspaceLoadError } from "@/features/dashboard/components/workspace-load-error";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { loadWorkspaceSummary } from "@/features/dashboard/server/load-workspace-summary";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import { serializeEvent, serializeEvents } from "@/features/event/utils";

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT")
  );
}

export default async function DashboardOverviewPage() {
  let scope: Awaited<ReturnType<typeof getDashboardScope>>;
  let events: Awaited<ReturnType<typeof getAdminEventsForOrganization>>;

  try {
    scope = await getDashboardScope();
    events = await getAdminEventsForOrganization(scope.organizationId);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    return <WorkspaceLoadError />;
  }

  const summary = await loadWorkspaceSummary({
    organizationId: scope.organizationId,
    events,
  });

  return (
    <OrganizationEventOverview
      initialEvents={serializeEvents(events)}
      summary={{
        ...summary,
        quickActionEvent: summary.quickActionEvent
          ? serializeEvent(summary.quickActionEvent)
          : null,
      }}
      workspaceName={scope.organization?.name ?? null}
    />
  );
}
