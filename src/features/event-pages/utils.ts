import type { EventPageDoc, WithId } from "@/types/collection";
import type { EventPageContentValues } from "@/features/event-pages/schema";

export interface SerializedEventPage {
  id: string;
  eventId: string;
  organizationId: string;
  title: string;
  status: "draft" | "published";
  storagePrefix: string;
  draftContent: EventPageContentValues;
  publishedContent: EventPageContentValues | null;
  createdAtSeconds: number | null;
  updatedAtSeconds: number | null;
}

export function buildEventPageStoragePrefix(
  organizationId: string,
  eventId: string,
) {
  return `organizations/${organizationId}/events/${eventId}/event-pages`;
}

export function buildEventPagePath(eventPageId: string) {
  return `EventPage/${eventPageId}`;
}

export function extractEventPageIdFromPath(path?: string) {
  if (!path) {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

export function serializeEventPage(
  eventPage: WithId<EventPageDoc>,
): SerializedEventPage {
  const createdAtSeconds =
    typeof eventPage.createdAt === "object" &&
    eventPage.createdAt !== null &&
    "seconds" in eventPage.createdAt
      ? Number(eventPage.createdAt.seconds)
      : null;
  const updatedAtSeconds =
    typeof eventPage.updatedAt === "object" &&
    eventPage.updatedAt !== null &&
    "seconds" in eventPage.updatedAt
      ? Number(eventPage.updatedAt.seconds)
      : null;

  return {
    id: eventPage.id,
    eventId: eventPage.eventId,
    organizationId: eventPage.organizationId,
    title: eventPage.title,
    status: eventPage.status,
    storagePrefix: eventPage.storagePrefix,
    draftContent: eventPage.draftContent as EventPageContentValues,
    publishedContent:
      (eventPage.publishedContent as EventPageContentValues | null) ?? null,
    createdAtSeconds,
    updatedAtSeconds,
  };
}
