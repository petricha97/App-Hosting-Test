// Server-side data access for the EventPage root collection.
// M4-T2 (agents/docs/specs/m4-website-blocks.md): an event can now own one
// page per pageKey — "default" for the event page plus one per
// RegistrationPath id. Legacy docs without pageKey read as "default" via the
// schema default (AC-27, no backfill). Lookups therefore filter the eventId
// matches by pageKey — the previous "first org-scoped match" was ambiguous
// once >1 page per event exists (spec gap list).
// Uniqueness per (eventId, pageKey) is enforced by the lookup-then-create in
// saveAdminEventPageDraft. pageKey↔path membership validation is the ROUTE's
// job (AC-25) — this module has no cross-collection context.
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

export const DEFAULT_EVENT_PAGE_KEY = "default";

const eventPageAdminApi = createAdminCollectionApi<EventPageDoc>("EventPage");

const {
  create: createAdminEventPage,
  getById: getAdminEventPageById,
  update: updateAdminEventPage,
  remove: removeAdminEventPage,
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
  pageKey = DEFAULT_EVENT_PAGE_KEY,
}: {
  eventId: string;
  organizationId: string;
  eventPagePath?: string;
  pageKey?: string;
}) {
  // event.eventPagePath points at the DEFAULT page only — the id shortcut is
  // never trusted for path pages.
  if (pageKey === DEFAULT_EVENT_PAGE_KEY) {
    const eventPageId = extractEventPageIdFromPath(eventPagePath);

    if (eventPageId) {
      const eventPage = await getAdminEventPageById(eventPageId);

      if (eventPage) {
        const parsed = parseEventPage(eventPage);

        if (
          parsed &&
          parsed.eventId === eventId &&
          parsed.organizationId === organizationId &&
          parsed.pageKey === pageKey
        ) {
          return {
            ...eventPage,
            ...parsed,
          };
        }
      }
    }
  }

  const matches = await findAdminEventPagesByField("eventId", eventId);

  for (const match of matches) {
    if (match.organizationId !== organizationId) continue;

    const parsed = parseEventPage(match);
    if (!parsed || parsed.pageKey !== pageKey) continue;

    return {
      ...match,
      ...parsed,
    };
  }

  return null;
}

export async function saveAdminEventPageDraft({
  eventId,
  organizationId,
  eventPagePath,
  pageKey = DEFAULT_EVENT_PAGE_KEY,
  title,
  draftContent,
}: {
  eventId: string;
  organizationId: string;
  eventPagePath?: string;
  pageKey?: string;
  title: string;
  draftContent: EventPageContentValues;
}) {
  const existing = await getAdminEventPageForEvent({
    eventId,
    organizationId,
    eventPagePath,
    pageKey,
  });

  if (existing) {
    await updateAdminEventPage(existing.id, {
      title,
      draftContent,
      // Normalizes legacy default docs on their next save; a doc is only ever
      // found under its own pageKey, so this never re-keys a page.
      pageKey,
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
    pageKey,
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
  pageKey = DEFAULT_EVENT_PAGE_KEY,
  title,
  draftContent,
}: {
  eventId: string;
  organizationId: string;
  eventPagePath?: string;
  pageKey?: string;
  title: string;
  draftContent: EventPageContentValues;
}) {
  const saved = await saveAdminEventPageDraft({
    eventId,
    organizationId,
    eventPagePath,
    pageKey,
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
  pageKey = DEFAULT_EVENT_PAGE_KEY,
}: {
  eventId: string;
  organizationId: string | null;
  eventPagePath?: string;
  pageKey?: string;
}) {
  if (!organizationId) {
    return null;
  }

  const eventPage = await getAdminEventPageForEvent({
    eventId,
    organizationId,
    eventPagePath,
    pageKey,
  });

  if (!eventPage || eventPage.status !== "published" || !eventPage.publishedContent) {
    return null;
  }

  return eventPage as WithId<EventPageDoc>;
}

// M4-T2: pageKeys that have a page document for this event — drives the
// paths table's Default/Custom "Page" column and the delete-confirm warning.
// Legacy docs (no pageKey field) count as "default".
export async function getAdminEventPageKeysForEvent({
  eventId,
  organizationId,
}: {
  eventId: string;
  organizationId: string;
}): Promise<string[]> {
  const matches = await findAdminEventPagesByField("eventId", eventId);

  const keys = new Set<string>();
  for (const match of matches) {
    if (match.organizationId !== organizationId) continue;
    keys.add(match.pageKey ?? DEFAULT_EVENT_PAGE_KEY);
  }

  return [...keys];
}

// M4-T2 AC-26: delete cascade for registration paths — removes the page
// doc(s) stored under (eventId, pageKey). Orphaned path pages are unreachable
// and would collide when the path id is recreated. Returns the number of
// docs deleted. Never used with pageKey="default" by the cascade caller.
export async function deleteAdminEventPagesForPageKey({
  eventId,
  organizationId,
  pageKey,
}: {
  eventId: string;
  organizationId: string;
  pageKey: string;
}): Promise<number> {
  const matches = await findAdminEventPagesByField("eventId", eventId);

  let deleted = 0;
  for (const match of matches) {
    if (match.organizationId !== organizationId) continue;
    if ((match.pageKey ?? DEFAULT_EVENT_PAGE_KEY) !== pageKey) continue;
    await removeAdminEventPage(match.id);
    deleted += 1;
  }

  return deleted;
}
