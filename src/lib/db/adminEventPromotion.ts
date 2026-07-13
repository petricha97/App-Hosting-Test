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

// Normalized promo-code form stored alongside promoCode (promoCodeUpper) so
// the public lookup can be a case-robust Firestore EQUALITY (M3 review S4).
// Every DAL write path that touches promoCode stamps it (create/update here,
// template cascades in adminPromotionTemplate.ts).
export function normalizePromoCodeUpper(
  promoCode: string | null | undefined,
): string | null {
  const normalized = (promoCode ?? "").trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

// M3-T2/T3 — server-only promo code resolution for the public quote/finalize
// flow (added by fullstack-dev, flagged for Backend review). Spec: "resolution
// promoCode (uppercase-normalized, exact match) → EventPromotion with
// enablePromoCode == true, server-side only".
//
// Primary lookup is the spec's equality query on the DAL-stamped
// promoCodeUpper field (equality-only filters — no composite index needed,
// Firestore merges the single-field indexes). LEGACY FALLBACK ONLY: docs
// written before M3 lack promoCodeUpper and cannot be equality-matched, so a
// miss falls back to the original bounded in-memory case-insensitive scan —
// restricted to docs MISSING the field (docs that have it were already
// covered by the equality query). The fallback bound (50) is a safety cap;
// per-event promotion counts are tiny, and every doc written/updated since
// M3 carries the field.
//
// NEVER expose this through any endpoint that could enumerate promotions:
// callers must collapse every failure (null here, inactive, expired,
// exhausted) into ONE generic client message (spec T2 AC-6/7).
const PROMO_CODE_LOOKUP_LIMIT = 50;

export async function getAdminEventPromotionByCode(input: {
  eventId: string;
  organizationId: string;
  code: string;
}): Promise<WithId<EventPromotionWithDefaults> | null> {
  const normalized = normalizePromoCodeUpper(input.code);
  if (!normalized) return null;

  // Spec lookup: equality + limit(2) (the second slot only detects dupes;
  // first match wins either way).
  const exact = await eventPromotionCol(input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("enablePromoCode", "==", true)
    .where("promoCodeUpper", "==", normalized)
    .limit(2)
    .get();
  if (!exact.empty) {
    const d = exact.docs[0];
    return applyEventPromotionReadDefaults({
      id: d.id,
      ...(d.data() as EventPromotionDoc),
    });
  }

  // Legacy fallback: bounded scan for pre-M3 docs that never got
  // promoCodeUpper stamped. Docs WITH the field are skipped — the equality
  // query above is authoritative for them.
  const legacy = await eventPromotionCol(input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("enablePromoCode", "==", true)
    .limit(PROMO_CODE_LOOKUP_LIMIT)
    .get();

  for (const d of legacy.docs) {
    const doc = d.data() as EventPromotionDoc;
    if (doc.promoCodeUpper !== undefined) continue;
    if (normalizePromoCodeUpper(doc.promoCode) === normalized) {
      return applyEventPromotionReadDefaults({ id: d.id, ...doc });
    }
  }

  return null;
}

// Creates a new EventPromotion doc in the subcollection and returns its ID.
// usedCount is server-owned: whatever the caller passes is overwritten with 0.
// promoCodeUpper is DAL-stamped from promoCode (S4) — never caller-supplied.
export async function createAdminEventPromotion(
  eventId: string,
  data: EventPromotionDoc,
): Promise<string> {
  const ref = await eventPromotionCol(eventId).add({
    ...data,
    promoCodeUpper: normalizePromoCodeUpper(data.promoCode),
    usedCount: 0,
  });
  return ref.id;
}

// Server-owned fields no update payload may touch. usedCount belongs
// exclusively to the finalize transaction (spec M2-T2 AC-7); the identity /
// audit fields are set once at create; promoCodeUpper is DERIVED from
// promoCode by this DAL (S4), never accepted from callers.
const EVENT_PROMOTION_UPDATE_BLOCKLIST = [
  "usedCount",
  "organizationId",
  "createdAt",
  "promoCodeUpper",
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

  // Keep the normalized lookup copy in sync whenever promoCode changes (S4).
  // Payloads that don't touch promoCode leave promoCodeUpper untouched.
  if ("promoCode" in data) {
    sanitized.promoCodeUpper = normalizePromoCodeUpper(data.promoCode);
  }

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
