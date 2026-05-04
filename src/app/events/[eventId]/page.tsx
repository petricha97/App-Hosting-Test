import { notFound } from "next/navigation";

import { PublicEventDetail } from "@/features/public-events/components/public-event-detail";
import { extractOrganizationIdFromPath, serializeEvent } from "@/features/event/utils";
import { serializeForm } from "@/features/form/utils";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";
import { getAdminPublishedFormForPublicEvent } from "@/lib/db/adminForm";

interface PublicEventDetailPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function PublicEventDetailPage({
  params,
}: PublicEventDetailPageProps) {
  const { eventId } = await params;
  const event = await getAdminPublishedEventById(eventId);

  if (!event) {
    notFound();
  }

  const form = await getAdminPublishedFormForPublicEvent({
    eventId,
    eventName: event.name,
    organizationId: extractOrganizationIdFromPath(event.organizationPath),
    formPath: event.formPath,
  });

  return (
    <PublicEventDetail
      event={serializeEvent(event)}
      form={form ? serializeForm(form) : null}
    />
  );
}
