import { notFound } from "next/navigation";

import { EventPageEditorWorkspace } from "@/features/event-pages/components/event-page-editor-workspace";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminEventPageForEvent } from "@/lib/db/adminEventPage";
import { serializeEventPage } from "@/features/event-pages/utils";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { serializeForm } from "@/features/form/utils";

interface DashboardEventPageBuilderPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventPageBuilderPage({
  params,
}: DashboardEventPageBuilderPageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);

  if (!event) {
    notFound();
  }

  const eventPage = await getAdminEventPageForEvent({
    eventId,
    organizationId: scope.organizationId,
    eventPagePath: event.eventPagePath,
  });
  const form = await getAdminFormForEvent({
    eventId,
    eventName: event.name,
    organizationId: scope.organizationId,
    formPath: event.formPath,
  });

  return (
    <EventPageEditorWorkspace
      eventId={event.id}
      eventName={event.name}
      pageMode={event.pageMode}
      redirectUrl={event.redirectUrl}
      initialEventPage={eventPage ? serializeEventPage(eventPage) : null}
      form={form ? serializeForm(form) : null}
    />
  );
}
