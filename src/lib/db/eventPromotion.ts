// Client-side data access layer for the EventPromotion subcollection.
// Path: Event/{eventId}/EventPromotion/{promotionId}
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T2) — closes the audit
// gap noted in agents/docs/data-models/baseline.md (repo-pair convention).
//
// READ-ONLY on purpose: authoritative CRUD stays on the admin API routes
// (adminEventPromotion.ts) and firestore.rules denies all client writes to
// EventPromotion — usedCount in particular is server-owned and only mutated
// by the order-finalize transaction. Reads apply the same migration-safe
// M2 defaults as the admin repo via eventPromotionDefaults.ts.
//
// Uses the client SDK directly because subcollection paths are dynamic and
// cannot use the generic createCollectionApi helper (root collections only).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  applyEventPromotionReadDefaults,
  type EventPromotionWithDefaults,
} from "@/lib/db/eventPromotionDefaults";
import type { EventPromotionDoc, WithId } from "@/types/collection";

// Per-event promotion lists are small; safety bound, not pagination
// (mirrors the admin repo's read surface + baseline bounded-read policy).
export const EVENT_PROMOTION_LIST_LIMIT = 50;

function eventPromotionCol(eventId: string) {
  return collection(db, "Event", eventId, "EventPromotion");
}

// Fetches the promotions attached to an event, org-scoped in the query to
// prevent cross-org data leakage (and to satisfy the org-membership read rule
// in firestore.rules). M2 defaults applied on every doc.
export async function getEventPromotionsForEvent(
  eventId: string,
  organizationId: string,
  maxResults: number = EVENT_PROMOTION_LIST_LIMIT,
): Promise<WithId<EventPromotionWithDefaults>[]> {
  const snap = await getDocs(
    query(
      eventPromotionCol(eventId),
      where("organizationId", "==", organizationId),
      limit(maxResults),
    ),
  );

  return snap.docs.map((d) =>
    applyEventPromotionReadDefaults({
      id: d.id,
      ...(d.data() as EventPromotionDoc),
    }),
  );
}

// Fetches a single event promotion doc by ID with M2 defaults applied.
// Returns null when missing OR when it belongs to another org (treat as
// not-found, never as forbidden — IDOR-safe, mirrors the admin getters).
export async function getEventPromotionById(
  eventId: string,
  promotionId: string,
  organizationId: string,
): Promise<WithId<EventPromotionWithDefaults> | null> {
  const snap = await getDoc(doc(eventPromotionCol(eventId), promotionId));
  if (!snap.exists()) return null;

  const data = snap.data() as EventPromotionDoc;
  if (data.organizationId !== organizationId) return null;

  return applyEventPromotionReadDefaults({ id: snap.id, ...data });
}
