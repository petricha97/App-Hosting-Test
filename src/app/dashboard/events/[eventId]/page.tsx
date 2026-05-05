import { OrganizationEventDetail } from "@/features/dashboard/components/organization-event-detail";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { serializeEvent } from "@/features/event/utils";
import { serializeForm } from "@/features/form/utils";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { getAdminEventPageForEvent } from "@/lib/db/adminEventPage";
import { serializeEventPage } from "@/features/event-pages/utils";

interface EventDetailPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventDetailPage({
  params,
}: EventDetailPageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);
  const form = event
    ? await getAdminFormForEvent({
        eventId,
        eventName: event.name,
        organizationId: scope.organizationId,
        formPath: event.formPath,
      })
    : null;
  const eventPage = event
    ? await getAdminEventPageForEvent({
        eventId,
        organizationId: scope.organizationId,
        eventPagePath: event.eventPagePath,
      })
    : null;

  return (
    <OrganizationEventDetail
      event={event ? serializeEvent(event) : null}
      form={form ? serializeForm(form) : null}
      eventPage={eventPage ? serializeEventPage(eventPage) : null}
    />
  );
}
