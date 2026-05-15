// Server-side data access layer for the EventPromotion subcollection.
// Path: Event/{eventId}/EventPromotion/{promotionId}
// Uses the Firebase Admin SDK directly because subcollection paths are dynamic
// and cannot use the generic createAdminCollectionApi helper.
import "server-only";

import type { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/app/lib/firestore";
import type { EventPromotionDoc, WithId } from "@/types/collection";

// Returns the subcollection reference for a given event.
function eventPromotionCol(eventId: string) {
  return adminDb.collection("Event").doc(eventId).collection("EventPromotion");
}

// Fetches all promotions attached to an event, filtered by org to prevent
// cross-org data leakage, sorted newest first.
export async function getAdminEventPromotionsForEvent(
  eventId: string,
  organizationId: string,
): Promise<WithId<EventPromotionDoc>[]> {
  const snap = await eventPromotionCol(eventId)
    .where("organizationId", "==", organizationId)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as EventPromotionDoc),
  }));
}

// Fetches a single event promotion doc by ID.
export async function getAdminEventPromotionById(
  eventId: string,
  promotionId: string,
): Promise<WithId<EventPromotionDoc> | null> {
  const snap = await eventPromotionCol(eventId).doc(promotionId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as EventPromotionDoc) };
}

// Creates a new EventPromotion doc in the subcollection and returns its ID.
export async function createAdminEventPromotion(
  eventId: string,
  data: EventPromotionDoc,
): Promise<string> {
  const ref = await eventPromotionCol(eventId).add(data);
  return ref.id;
}

// Partially updates an existing EventPromotion doc (e.g. toggling inheritFromParent
// or editing event-level fields without touching the parent template).
export async function updateAdminEventPromotion(
  eventId: string,
  promotionId: string,
  data: Partial<EventPromotionDoc> & { updatedAt: FieldValue },
): Promise<void> {
  await eventPromotionCol(eventId).doc(promotionId).update(data);
}

// Removes an EventPromotion doc, detaching the template from the event.
export async function deleteAdminEventPromotion(
  eventId: string,
  promotionId: string,
): Promise<void> {
  await eventPromotionCol(eventId).doc(promotionId).delete();
}

// Returns all EventPromotion docs across every event in the org.
// Fetches per-event subcollection in parallel rather than using a collectionGroup query,
// so no extra Firestore index is required — each per-event query uses the auto-indexed
// organizationId field on a regular (non-group) collection path.
// eventIds is the list of all event IDs in the org (provided by the caller to avoid
// a second org-level fetch inside this function).
export async function getAdminAllEventPromotionsForOrg(
  organizationId: string,
  eventIds: string[],
): Promise<(WithId<EventPromotionDoc> & { eventId: string })[]> {
  if (eventIds.length === 0) return [];

  // Fetch all events' promotions in parallel — safe for typical org sizes.
  const results = await Promise.all(
    eventIds.map(async (eventId) => {
      const docs = await getAdminEventPromotionsForEvent(
        eventId,
        organizationId,
      );
      // Tag each doc with its parent eventId so the caller can join to event names.
      return docs.map((d) => ({ ...d, eventId }));
    }),
  );

  return results.flat();
}
