import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FormTemplatesBrowser } from "@/features/form/components/form-templates-browser";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { serializeFormTemplate } from "@/features/form/utils";
import { getAdminLinkedFormsForTemplate } from "@/lib/db/adminForm";
import { getAdminFormTemplatesForOrganization } from "@/lib/db/adminFormTemplate";

export default async function DashboardFormTemplatesPage() {
  const scope = await getDashboardScope();
  const templates = await getAdminFormTemplatesForOrganization(scope.organizationId);

  const templateCards = await Promise.all(
    templates.map(async (template) => {
      const linkedForms = await getAdminLinkedFormsForTemplate({
        templateId: template.id,
        organizationId: scope.organizationId,
      });

      return {
        template: serializeFormTemplate(template),
        linkedCount: linkedForms.filter((form) => !form.templateLink?.detached).length,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end sm:items-center">
        <Button asChild variant="outline">
          <Link href="/dashboard/forms">Back to forms</Link>
        </Button>
        <Button asChild>
          <Link href="/dashboard/forms/templates/new">New template</Link>
        </Button>
      </div>

      <FormTemplatesBrowser templates={templateCards} />
    </div>
  );
}
