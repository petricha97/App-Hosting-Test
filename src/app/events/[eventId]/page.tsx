import { notFound, redirect } from "next/navigation";

import { PublicEventDetail } from "@/features/public-events/components/public-event-detail";
import { extractOrganizationIdFromPath, serializeEvent } from "@/features/event/utils";
import { serializeForm } from "@/features/form/utils";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";
import { getAdminPublishedFormForPublicEvent } from "@/lib/db/adminForm";
import { getAdminPublishedEventPageForEvent } from "@/lib/db/adminEventPage";
import { serializeEventPage } from "@/features/event-pages/utils";
import { PublicCustomEventPage } from "@/features/public-events/components/public-custom-event-page";

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

  if (event.pageMode === "redirect" && event.redirectUrl) {
    redirect(event.redirectUrl);
  }

  const organizationId = extractOrganizationIdFromPath(event.organizationPath);
  const publishedEventPage =
    event.pageMode === "custom"
      ? await getAdminPublishedEventPageForEvent({
          eventId,
          organizationId,
          eventPagePath: event.eventPagePath,
        })
      : null;

  if (event.pageMode === "custom" && publishedEventPage) {
    return (
      <PublicCustomEventPage
        event={serializeEvent(event)}
        form={form ? serializeForm(form) : null}
        eventPage={serializeEventPage(publishedEventPage)}
      />
    );
  }

  return (
    <PublicEventDetail
      event={serializeEvent(event)}
      form={form ? serializeForm(form) : null}
    />
  );
}
