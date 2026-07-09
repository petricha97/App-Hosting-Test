import { notFound } from "next/navigation";

import { EventFormTemplateChooser } from "@/features/form/components/event-form-template-chooser";
import { FormBuilderWorkspace } from "@/features/form/components/form-builder-workspace";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { serializeForm, serializeFormTemplate } from "@/features/form/utils";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import {
  getAdminActiveFormTemplatesForOrganization,
  getAdminFormTemplateForOrganization,
} from "@/lib/db/adminFormTemplate";

interface EventFormBuilderPageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ mode?: string; templateId?: string }>;
}

export default async function DashboardEventFormBuilderPage({
  params,
  searchParams,
}: EventFormBuilderPageProps) {
  const { eventId } = await params;
  const { mode, templateId } = await searchParams;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);

  if (!event) {
    notFound();
  }

  const form = await getAdminFormForEvent({
    eventId,
    eventName: event.name,
    organizationId: scope.organizationId,
    formPath: event.formPath,
  });

  const selectedTemplate = form?.templateLink?.templateId
    ? await getAdminFormTemplateForOrganization(
        form.templateLink.templateId,
        scope.organizationId,
      )
    : !form && templateId
      ? await getAdminFormTemplateForOrganization(templateId, scope.organizationId)
      : null;

  if (!form && !selectedTemplate && mode !== "scratch") {
    const templates = await getAdminActiveFormTemplatesForOrganization(
      scope.organizationId,
    );

    return (
      <EventFormTemplateChooser
        eventId={eventId}
        eventName={event.name}
        templates={templates.map((template) => serializeFormTemplate(template))}
      />
    );
  }

  return (
    <FormBuilderWorkspace
      eventId={eventId}
      eventName={event.name}
      organizationId={scope.organizationId}
      organizationName={scope.organization?.name ?? "Current workspace"}
      initialForm={form ? serializeForm(form) : null}
      initialTemplate={
        selectedTemplate ? serializeFormTemplate(selectedTemplate) : null
      }
    />
  );
}
