import { notFound } from "next/navigation";

import { FormBuilderWorkspace } from "@/features/form/components/form-builder-workspace";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { serializeForm } from "@/features/form/utils";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";

interface EventFormBuilderPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventFormBuilderPage({
  params,
}: EventFormBuilderPageProps) {
  const { eventId } = await params;
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

  return (
    <FormBuilderWorkspace
      eventId={eventId}
      eventName={event.name}
      organizationId={scope.organizationId}
      organizationName={scope.organization?.name ?? "Current workspace"}
      initialForm={form ? serializeForm(form) : null}
    />
  );
}
