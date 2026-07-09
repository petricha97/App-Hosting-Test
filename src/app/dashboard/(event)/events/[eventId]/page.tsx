import { OrganizationEventDetail } from "@/features/dashboard/components/organization-event-detail";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { serializeEvent } from "@/features/event/utils";
import { serializeForm } from "@/features/form/utils";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { getAdminEventPageForEvent } from "@/lib/db/adminEventPage";
import { serializeEventPage } from "@/features/event-pages/utils";
import { getAdminEventPromotionsForEvent } from "@/lib/db/adminEventPromotion";
import { getAdminPromotionTemplatesForOrganization } from "@/lib/db/adminPromotionTemplate";
import { serializeEventPromotion } from "@/features/event-promotions/utils";
import { serializePromotionTemplate } from "@/features/promotion-templates/utils";

interface EventDetailPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventDetailPage({
  params,
}: EventDetailPageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();

  // Resolve the event first — if it doesn't exist or belong to this org,
  // we skip all subcollection and related-data fetches.
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  // Only fetch event-related data when the event exists to avoid unnecessary reads.
  const [form, eventPage, eventPromotions, availableTemplates] =
    await Promise.all([
      event
        ? getAdminFormForEvent({
            eventId,
            eventName: event.name,
            organizationId: scope.organizationId,
            formPath: event.formPath,
          })
        : null,
      event
        ? getAdminEventPageForEvent({
            eventId,
            organizationId: scope.organizationId,
            eventPagePath: event.eventPagePath,
          })
        : null,
      event
        ? getAdminEventPromotionsForEvent(eventId, scope.organizationId)
        : [],
      event
        ? getAdminPromotionTemplatesForOrganization(scope.organizationId)
        : [],
    ]);

  return (
    <OrganizationEventDetail
      event={event ? serializeEvent(event) : null}
      form={form ? serializeForm(form) : null}
      eventPage={eventPage ? serializeEventPage(eventPage) : null}
      eventId={eventId}
      promotions={eventPromotions.map(serializeEventPromotion)}
      availableTemplates={availableTemplates.map(serializePromotionTemplate)}
    />
  );
}
