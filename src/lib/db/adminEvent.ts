import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { eventDocumentSchema } from "@/features/event/schema";
import {
  buildOrganizationPathCandidates,
  eventBelongsToOrganization,
  sortEventsByUpdatedAt,
} from "@/features/event/utils";
import type { EventDoc, WithId } from "@/types/collection";

const EVENT_COLLECTION = "Event";

// Bounded page size for the M6-T3 lifecycle-trigger sweep (below) — same
// order of magnitude as every other admin list page in this codebase.
export const PUBLISHED_EVENT_SWEEP_PAGE_LIMIT = 50;

const eventAdminApi = createAdminCollectionApi<EventDoc>(EVENT_COLLECTION);

const {
  getById: getAdminEventById,
  findWhere: findAdminEventsByField,
  update: updateAdminEvent,
} = eventAdminApi;

export { updateAdminEvent };

function parseEvent<T extends EventDoc>(event: T) {
  const result = eventDocumentSchema.safeParse(event);
  return result.success ? result.data : null;
}

export async function getAdminEventsForOrganization(organizationId: string) {
  const matches = await Promise.all(
    buildOrganizationPathCandidates(organizationId).map((path) =>
      findAdminEventsByField("organizationPath", path),
    ),
  );

  const uniqueEvents = new Map<string, WithId<EventDoc>>();

  for (const group of matches) {
    for (const event of group) {
      const parsed = parseEvent(event);
      if (!parsed) continue;
      uniqueEvents.set(event.id, { ...event, ...parsed });
    }
  }

  return sortEventsByUpdatedAt(Array.from(uniqueEvents.values()));
}

export async function getAdminEventForOrganization(
  eventId: string,
  organizationId: string,
) {
  const event = await getAdminEventById(eventId);

  if (!event) {
    return null;
  }

  const parsed = parseEvent(event);

  if (!parsed || !eventBelongsToOrganization(parsed, organizationId)) {
    return null;
  }

  return {
    ...event,
    ...parsed,
  };
}

export async function getAdminPublishedEvents() {
  const events = await findAdminEventsByField("status", "Published");
  const parsedEvents: WithId<EventDoc>[] = [];

  for (const event of events) {
    const parsed = parseEvent(event);
    if (!parsed) continue;

    parsedEvents.push({
      ...event,
      ...parsed,
    });
  }

  return sortEventsByUpdatedAt(parsedEvents);
}

// Bounded, cursor-paginated Published-events page (M6-T3 addition) — the
// lifecycle-trigger sweep's entry point into "which events need
// evaluating", never the unbounded getAdminPublishedEvents() above (spec
// agents/docs/specs/m6-lifecycle-triggers.md §8: bounded reads everywhere,
// resumable across ticks). Index: Event status ASC, updatedAt DESC.
export async function listAdminPublishedEventsPage(input?: {
  limit?: number;
  startAfterUpdatedAtMs?: number;
}): Promise<WithId<EventDoc>[]> {
  let query = adminDb
    .collection(EVENT_COLLECTION)
    .where("status", "==", "Published")
    .orderBy("updatedAt", "desc");

  if (input?.startAfterUpdatedAtMs !== undefined) {
    query = query.startAfter(Timestamp.fromMillis(input.startAfterUpdatedAtMs));
  }

  const snap = await query
    .limit(input?.limit ?? PUBLISHED_EVENT_SWEEP_PAGE_LIMIT)
    .get();

  const events: WithId<EventDoc>[] = [];
  for (const doc of snap.docs) {
    const raw = { id: doc.id, ...(doc.data() as EventDoc) };
    const parsed = parseEvent(raw);
    if (!parsed) continue;
    events.push({ ...raw, ...parsed });
  }
  return events;
}

export async function getAdminPublishedEventById(eventId: string) {
  const event = await getAdminEventById(eventId);

  if (!event) {
    return null;
  }

  const parsed = parseEvent(event);

  if (!parsed || parsed.status !== "Published") {
    return null;
  }

  return {
    ...event,
    ...parsed,
  };
}
