import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { OrganizationVariablesPage } from "@/features/variables/components/organization-variables-page";
import { buildOrganizationBuiltInVariables, serializeVariable } from "@/features/variables/utils";
import { getAdminVariablesForOrganization } from "@/lib/db/adminVariable";

export default async function DashboardVariablesPage() {
  const scope = await getDashboardScope();
  const variables = await getAdminVariablesForOrganization(scope.organizationId);

  return (
    <OrganizationVariablesPage
      canManage={scope.userDoc.permissions.includes("write:events")}
      builtIns={buildOrganizationBuiltInVariables(scope.organization ?? null)}
      initialVariables={variables.map(serializeVariable)}
    />
  );
}
