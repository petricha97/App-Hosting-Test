import { OrganizationEventDetail } from "@/features/dashboard/components/organization-event-detail";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { loadEventOverview } from "@/features/event/overview";
import { serializeEvent } from "@/features/event/utils";
import { serializeForm } from "@/features/form/utils";
import { serializeEventPromotion } from "@/features/event-promotions/utils";
import { serializePromotionTemplate } from "@/features/promotion-templates/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { getAdminEventPromotionsForEvent } from "@/lib/db/adminEventPromotion";
import { getAdminPromotionTemplatesForOrganization } from "@/lib/db/adminPromotionTemplate";

interface EventDetailPageProps { params: Promise<{ eventId: string }> }

export default async function DashboardEventDetailPage({ params }: EventDetailPageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);

  const [overview, form, eventPromotions, availableTemplates] = await Promise.all([
    event ? loadEventOverview({ event, eventId, organizationId: scope.organizationId }) : null,
    event ? getAdminFormForEvent({ eventId, eventName: event.name, organizationId: scope.organizationId, formPath: event.formPath }) : null,
    event ? getAdminEventPromotionsForEvent(eventId, scope.organizationId) : [],
    event ? getAdminPromotionTemplatesForOrganization(scope.organizationId) : [],
  ]);

  return (
    <OrganizationEventDetail
      event={event ? serializeEvent(event) : null}
      eventId={eventId}
      overview={overview}
      form={form ? serializeForm(form) : null}
      promotions={eventPromotions.map(serializeEventPromotion)}
      availableTemplates={availableTemplates.map(serializePromotionTemplate)}
    />
  );
}
