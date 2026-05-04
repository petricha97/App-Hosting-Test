import { notFound } from "next/navigation";

import { FormTemplateBuilderWorkspace } from "@/features/form/components/form-template-builder-workspace";
import { TemplateLinkedFormsManager } from "@/features/form/components/template-linked-forms-manager";
import { serializeFormTemplate } from "@/features/form/utils";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminLinkedFormsForTemplate } from "@/lib/db/adminForm";
import { getAdminFormTemplateForOrganization } from "@/lib/db/adminFormTemplate";

interface DashboardFormTemplateDetailPageProps {
  params: Promise<{ templateId: string }>;
}

export default async function DashboardFormTemplateDetailPage({
  params,
}: DashboardFormTemplateDetailPageProps) {
  const { templateId } = await params;
  const scope = await getDashboardScope();
  const template = await getAdminFormTemplateForOrganization(
    templateId,
    scope.organizationId,
  );

  if (!template) {
    notFound();
  }

  const linkedForms = await getAdminLinkedFormsForTemplate({
    templateId,
    organizationId: scope.organizationId,
  });

  const linkedFormSummaries = await Promise.all(
    linkedForms.map(async (form) => {
      const event = form.eventId
        ? await getAdminEventForOrganization(form.eventId, scope.organizationId)
        : null;

      return {
        id: form.id,
        title: form.title,
        eventId: form.eventId,
        eventName: event?.name ?? "Unknown event",
        eventStatus: event?.status ?? "Draft",
        formStatus: form.status,
        templateVersion: form.templateLink?.templateVersion ?? 1,
        detached: Boolean(form.templateLink?.detached),
        updateAvailable:
          !form.templateLink?.detached &&
          (form.templateLink?.templateVersion ?? 0) < template.version,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <FormTemplateBuilderWorkspace
        organizationName={scope.organization?.name ?? "Current workspace"}
        initialTemplate={serializeFormTemplate(template)}
      />
      <TemplateLinkedFormsManager
        templateId={template.id}
        templateVersion={template.version}
        linkedForms={linkedFormSummaries}
      />
    </div>
  );
}
