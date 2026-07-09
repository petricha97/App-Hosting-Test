import { OrganizationResponsesBrowser } from "@/features/responses/components/organization-responses-browser";
import { serializeResponses } from "@/features/responses/utils";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import { getAdminFormDataForOrganization } from "@/lib/db/adminFormData";

export default async function DashboardResponsesPage() {
  const { organization, organizationId } = await getDashboardScope();
  const [responses, events] = await Promise.all([
    getAdminFormDataForOrganization(organizationId),
    getAdminEventsForOrganization(organizationId),
  ]);

  const eventNamesById = new Map(events.map((event) => [event.id, event.name]));
  const serializedResponses = serializeResponses(responses, eventNamesById);

  return (
    <OrganizationResponsesBrowser
      initialResponses={serializedResponses}
      workspaceName={organization?.name ?? null}
    />
  );
}
