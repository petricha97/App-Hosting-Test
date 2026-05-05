import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import {
  eventPageDocumentSchema,
  type EventPageContentValues,
} from "@/features/event-pages/schema";
import {
  buildEventPagePath,
  buildEventPageStoragePrefix,
  extractEventPageIdFromPath,
} from "@/features/event-pages/utils";
import type { EventPageDoc, WithId } from "@/types/collection";

const eventPageAdminApi = createAdminCollectionApi<EventPageDoc>("EventPage");

const {
  create: createAdminEventPage,
  getById: getAdminEventPageById,
  update: updateAdminEventPage,
  findWhere: findAdminEventPagesByField,
} = eventPageAdminApi;

function parseEventPage<T extends EventPageDoc>(eventPage: T) {
  const result = eventPageDocumentSchema.safeParse(eventPage);
  return result.success ? result.data : null;
}

export async function getAdminEventPageForEvent({
  eventId,
  organizationId,
  eventPagePath,
}: {
  eventId: string;
  organizationId: string;
  eventPagePath?: string;
}) {
  const eventPageId = extractEventPageIdFromPath(eventPagePath);

  if (eventPageId) {
    const eventPage = await getAdminEventPageById(eventPageId);

    if (eventPage) {
      const parsed = parseEventPage(eventPage);

      if (
        parsed &&
        parsed.eventId === eventId &&
        parsed.organizationId === organizationId
      ) {
        return {
          ...eventPage,
          ...parsed,
        };
      }
    }
  }

  const matches = await findAdminEventPagesByField("eventId", eventId);
  const scopedMatch = matches.find(
    (eventPage) => eventPage.organizationId === organizationId,
  );

  if (!scopedMatch) {
    return null;
  }

  const parsed = parseEventPage(scopedMatch);
  if (!parsed) {
    return null;
  }

  return {
    ...scopedMatch,
    ...parsed,
  };
}

export async function saveAdminEventPageDraft({
  eventId,
  organizationId,
  eventPagePath,
  title,
  draftContent,
}: {
  eventId: string;
  organizationId: string;
  eventPagePath?: string;
  title: string;
  draftContent: EventPageContentValues;
}) {
  const existing = await getAdminEventPageForEvent({
    eventId,
    organizationId,
    eventPagePath,
  });

  if (existing) {
    await updateAdminEventPage(existing.id, {
      title,
      draftContent,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      id: existing.id,
      path: buildEventPagePath(existing.id),
    };
  }

  const id = await createAdminEventPage({
    eventId,
    organizationId,
    title,
    status: "draft",
    storagePrefix: buildEventPageStoragePrefix(organizationId, eventId),
    draftContent,
    publishedContent: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  } as EventPageDoc);

  return {
    id,
    path: buildEventPagePath(id),
  };
}

export async function publishAdminEventPage({
  eventId,
  organizationId,
  eventPagePath,
  title,
  draftContent,
}: {
  eventId: string;
  organizationId: string;
  eventPagePath?: string;
  title: string;
  draftContent: EventPageContentValues;
}) {
  const saved = await saveAdminEventPageDraft({
    eventId,
    organizationId,
    eventPagePath,
    title,
    draftContent,
  });

  await updateAdminEventPage(saved.id, {
    title,
    status: "published",
    draftContent,
    publishedContent: draftContent,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return saved;
}

export async function getAdminPublishedEventPageForEvent({
  eventId,
  organizationId,
  eventPagePath,
}: {
  eventId: string;
  organizationId: string | null;
  eventPagePath?: string;
}) {
  if (!organizationId) {
    return null;
  }

  const eventPage = await getAdminEventPageForEvent({
    eventId,
    organizationId,
    eventPagePath,
  });

  if (!eventPage || eventPage.status !== "published" || !eventPage.publishedContent) {
    return null;
  }

  return eventPage as WithId<EventPageDoc>;
}
