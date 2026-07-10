// Server-side data access layer for the EventPromotion subcollection.
// Path: Event/{eventId}/EventPromotion/{promotionId}
// Uses the Firebase Admin SDK directly because subcollection paths are dynamic
// and cannot use the generic createAdminCollectionApi helper.
//
// M2-T2: reads apply the migration-safe defaults for the six additive fields
// (level, validityStart/End, usageCap, usedCount, isActive) via
// eventPromotionDefaults.ts, and updates STRIP the server-owned fields —
// usedCount is only ever mutated by the M2-T4 order-finalize transaction
// (adminOrder.ts) / future cancellation decrement.
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/app/lib/firestore";
import {
  applyEventPromotionReadDefaults,
  type EventPromotionWithDefaults,
} from "@/lib/db/eventPromotionDefaults";
import type { EventPromotionDoc, WithId } from "@/types/collection";

// Returns the subcollection reference for a given event.
function eventPromotionCol(eventId: string) {
  return adminDb.collection("Event").doc(eventId).collection("EventPromotion");
}

// Fetches all promotions attached to an event, filtered by org to prevent
// cross-org data leakage. M2 defaults applied on every doc.
export async function getAdminEventPromotionsForEvent(
  eventId: string,
  organizationId: string,
): Promise<WithId<EventPromotionWithDefaults>[]> {
  const snap = await eventPromotionCol(eventId)
    .where("organizationId", "==", organizationId)
    .get();

  return snap.docs.map((d) =>
    applyEventPromotionReadDefaults({
      id: d.id,
      ...(d.data() as EventPromotionDoc),
    }),
  );
}

// Fetches a single event promotion doc by ID. M2 defaults applied.
// NOTE: not org-scoped — callers must have already verified event ownership
// via getAdminEventForOrganization (existing route convention).
export async function getAdminEventPromotionById(
  eventId: string,
  promotionId: string,
): Promise<WithId<EventPromotionWithDefaults> | null> {
  const snap = await eventPromotionCol(eventId).doc(promotionId).get();
  if (!snap.exists) return null;
  return applyEventPromotionReadDefaults({
    id: snap.id,
    ...(snap.data() as EventPromotionDoc),
  });
}

// Creates a new EventPromotion doc in the subcollection and returns its ID.
// usedCount is server-owned: whatever the caller passes is overwritten with 0.
export async function createAdminEventPromotion(
  eventId: string,
  data: EventPromotionDoc,
): Promise<string> {
  const ref = await eventPromotionCol(eventId).add({
    ...data,
    usedCount: 0,
  });
  return ref.id;
}

// Server-owned fields no update payload may touch. usedCount belongs
// exclusively to the finalize transaction (spec M2-T2 AC-7); the identity /
// audit fields are set once at create.
const EVENT_PROMOTION_UPDATE_BLOCKLIST = [
  "usedCount",
  "organizationId",
  "createdAt",
] as const;

// Update payload (review S-2): callers pass PLAIN values — validity bounds as
// epoch millis (validityStartMs/validityEndMs) — and this DAL mints the admin
// Timestamps and stamps updatedAt itself, so routes need no firebase-admin
// import and no admin<->client Timestamp casts. Legacy forms are still
// accepted for back-compat (pre-cast validityStart/validityEnd Timestamps via
// Partial<EventPromotionDoc>, and an explicit updatedAt sentinel, which is
// simply superseded by the DAL's own server timestamp).
export type UpdateAdminEventPromotionInput = Partial<
  Omit<EventPromotionDoc, "updatedAt">
> & {
  updatedAt?: FieldValue;
  validityStartMs?: number | null;
  validityEndMs?: number | null;
};

// Converts an epoch-millis bound to the stored client-typed Timestamp. Admin
// Timestamp is wire-identical to the client class (seconds/nanoseconds) but
// structurally lacks toJSON — one documented cast, HERE, instead of one per
// route (review S-2).
function msToStoredTimestamp(ms: number | null) {
  return ms === null
    ? null
    : (Timestamp.fromMillis(ms) as unknown as Exclude<
        EventPromotionDoc["validityStart"],
        undefined
      >);
}

// Partially updates an existing EventPromotion doc (e.g. toggling
// inheritFromParent or editing event-level fields without touching the parent
// template). Server-owned fields are STRIPPED from the payload, never
// applied; updatedAt is ALWAYS stamped server-side here.
export async function updateAdminEventPromotion(
  eventId: string,
  promotionId: string,
  data: UpdateAdminEventPromotionInput,
): Promise<void> {
  const sanitized: Record<string, unknown> = { ...data };
  for (const field of EVENT_PROMOTION_UPDATE_BLOCKLIST) {
    delete sanitized[field];
  }

  // Millis form wins over a (legacy) pre-cast Timestamp for the same bound.
  if (data.validityStartMs !== undefined) {
    sanitized.validityStart = msToStoredTimestamp(data.validityStartMs);
  }
  if (data.validityEndMs !== undefined) {
    sanitized.validityEnd = msToStoredTimestamp(data.validityEndMs);
  }
  delete sanitized.validityStartMs;
  delete sanitized.validityEndMs;

  // The DAL owns the audit stamp — any caller-supplied updatedAt is replaced.
  sanitized.updatedAt = FieldValue.serverTimestamp();

  await eventPromotionCol(eventId).doc(promotionId).update(sanitized);
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
): Promise<(WithId<EventPromotionWithDefaults> & { eventId: string })[]> {
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
