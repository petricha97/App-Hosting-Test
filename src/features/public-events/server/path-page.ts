// M4-T2 public path-page resolution for /events/[eventId]?path=<pathId>.
// AC-21/23: the param resolves to a page only when it references an ACTIVE
// registration path of THIS event that has a PUBLISHED custom page. Anything
// else — inactive, foreign-event, unknown path, draft-only page — returns
// null and the caller renders the default event-page behavior (marketing
// surface degrades gracefully; never a 404, unlike /register?path=).
import "server-only";

import { getAdminPublishedEventPageForEvent } from "@/lib/db/adminEventPage";
import { getAdminRegistrationPathForEvent } from "@/lib/db/adminRegistrationPath";
import type { EventPageDoc, WithId } from "@/types/collection";

export interface ResolvedPublicPathPage {
  pathId: string;
  page: WithId<EventPageDoc>;
}

export async function resolvePublicPathPage(input: {
  eventId: string;
  organizationId: string | null;
  pathParam: string | undefined;
}): Promise<ResolvedPublicPathPage | null> {
  if (!input.pathParam || !input.organizationId) {
    return null;
  }

  // Org+event-scoped lookup: foreign/unknown ids come back null (IDOR-safe).
  const path = await getAdminRegistrationPathForEvent({
    pathId: input.pathParam,
    eventId: input.eventId,
    organizationId: input.organizationId,
  });

  // Inactive paths' pages are never publicly reachable (AC-23).
  if (!path || !path.isActive) {
    return null;
  }

  const page = await getAdminPublishedEventPageForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
    pageKey: path.id,
  });

  if (!page) {
    return null;
  }

  return { pathId: path.id, page };
}
