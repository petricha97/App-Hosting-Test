import { FormTemplateBuilderWorkspace } from "@/features/form/components/form-template-builder-workspace";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";

export default async function DashboardNewFormTemplatePage() {
  const scope = await getDashboardScope();

  return (
    <FormTemplateBuilderWorkspace
      organizationName={scope.organization?.name ?? "Current workspace"}
      initialTemplate={null}
    />
  );
}
