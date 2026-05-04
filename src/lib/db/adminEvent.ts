import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { eventDocumentSchema } from "@/features/event/schema";
import {
  buildOrganizationPathCandidates,
  eventBelongsToOrganization,
  sortEventsByUpdatedAt,
} from "@/features/event/utils";
import type { EventDoc, WithId } from "@/types/collection";

const eventAdminApi = createAdminCollectionApi<EventDoc>("Event");

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
