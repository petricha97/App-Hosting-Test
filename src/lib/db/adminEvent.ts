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
} = eventAdminApi;

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
