// Server-side data access layer for the PromotionTemplate Firestore collection.
// Uses the Firebase Admin SDK (via createAdminCollectionApi) so it bypasses
// Firestore security rules — safe to call only from Server Components and API routes.
import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { adminDb } from "@/app/lib/firestore";
import { normalizePromoCodeUpper } from "@/lib/db/adminEventPromotion";
import type { PromotionTemplateDoc } from "@/types/collection";

const promotionTemplateAdminApi =
  createAdminCollectionApi<PromotionTemplateDoc>("PromotionTemplate");

const {
  create: createAdminPromotionTemplate,
  getById: getAdminPromotionTemplateById,
  update: updateAdminPromotionTemplate,
  remove: deleteAdminPromotionTemplate,
  findWhere: findAdminPromotionTemplatesByField,
} = promotionTemplateAdminApi;

export {
  createAdminPromotionTemplate,
  getAdminPromotionTemplateById,
  updateAdminPromotionTemplate,
  deleteAdminPromotionTemplate,
};

// Returns all non-archived templates belonging to the given org, sorted newest first.
export async function getAdminPromotionTemplatesForOrganization(
  organizationId: string,
) {
  const templates = await findAdminPromotionTemplatesByField(
    "organizationId",
    organizationId,
  );

  return templates
    .filter((t) => !t.isArchived)
    .sort((a, b) => {
      const aSeconds =
        typeof a.updatedAt === "object" &&
        a.updatedAt &&
        "seconds" in a.updatedAt
          ? Number(a.updatedAt.seconds)
          : 0;
      const bSeconds =
        typeof b.updatedAt === "object" &&
        b.updatedAt &&
        "seconds" in b.updatedAt
          ? Number(b.updatedAt.seconds)
          : 0;
      return bSeconds - aSeconds;
    });
}

// Cascades updated template fields to all EventPromotion subcollection docs that
// reference this template and have inheritFromParent = true.
// Uses collectionGroup to query across all events in one pass.
// Batches writes in groups of 500 to stay within Firestore's batch limit.
// Includes enablePromoCode and promoCode so those fields stay in sync too.
//
// REQUIRES a Firestore composite index on the EventPromotion collectionGroup:
//   fields: templateId (ASC), organizationId (ASC), inheritFromParent (ASC)
// Create it in the Firebase console or add it to firestore.indexes.json.
export async function applyTemplateToInheritingEvents(
  templateId: string,
  organizationId: string,
  fields: {
    name: string;
    description?: string | null;
    discountType?: string | null;
    discountValue?: number | null;
    conditions: { field: string; operator: string; value: string | number }[];
    enablePromoCode: boolean;
    promoCode?: string | null;
  },
): Promise<number> {
  const snap = await adminDb
    .collectionGroup("EventPromotion")
    .where("templateId", "==", templateId)
    .where("organizationId", "==", organizationId)
    .where("inheritFromParent", "==", true)
    .get();

  if (snap.empty) return 0;

  const BATCH_SIZE = 500;
  const docs = snap.docs;
  let updated = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = adminDb.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);

    for (const d of chunk) {
      batch.update(d.ref, {
        ...fields,
        // Cascades rewrite promoCode, so the normalized lookup copy is
        // re-stamped in the same write (M3 review S4).
        promoCodeUpper: normalizePromoCodeUpper(fields.promoCode),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    updated += chunk.length;
  }

  return updated;
}

type TemplateFields = {
  name: string;
  description?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  conditions: { field: string; operator: string; value: string | number }[];
  enablePromoCode: boolean;
  promoCode?: string | null;
};

// Cascades template fields to a specific set of events.
// Events that have inheritFromParent = false are skipped unless overwriteCustom is true.
// When overwriting a custom event, inheritFromParent is restored to true.
export async function applyTemplateToSpecificEvents(
  templateId: string,
  organizationId: string,
  eventIds: string[],
  fields: TemplateFields,
  options: { overwriteCustom: boolean },
): Promise<{ updated: number; skippedCustom: string[]; skippedMissing: string[] }> {
  if (eventIds.length === 0) {
    return { updated: 0, skippedCustom: [], skippedMissing: [] };
  }

  // Fetch all EventPromotion docs for this template across the org in one pass.
  const snap = await adminDb
    .collectionGroup("EventPromotion")
    .where("templateId", "==", templateId)
    .where("organizationId", "==", organizationId)
    .get();

  // Map eventId → the promotion doc for quick lookup.
  const promotionByEventId = new Map<string, QueryDocumentSnapshot>();
  for (const doc of snap.docs) {
    const parentEventId = doc.ref.parent.parent?.id;
    if (parentEventId) promotionByEventId.set(parentEventId, doc);
  }

  const skippedCustom: string[] = [];
  const skippedMissing: string[] = [];
  const docsToUpdate: QueryDocumentSnapshot[] = [];

  for (const eventId of eventIds) {
    const doc = promotionByEventId.get(eventId);
    if (!doc) {
      skippedMissing.push(eventId);
      continue;
    }
    const data = doc.data() as { inheritFromParent: boolean };
    if (!data.inheritFromParent && !options.overwriteCustom) {
      skippedCustom.push(eventId);
      continue;
    }
    docsToUpdate.push(doc);
  }

  const BATCH_SIZE = 500;
  let updated = 0;

  for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
    const batch = adminDb.batch();
    const chunk = docsToUpdate.slice(i, i + BATCH_SIZE);
    for (const d of chunk) {
      batch.update(d.ref, {
        ...fields,
        // Same S4 stamp as applyTemplateToInheritingEvents.
        promoCodeUpper: normalizePromoCodeUpper(fields.promoCode),
        inheritFromParent: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    updated += chunk.length;
  }

  return { updated, skippedCustom, skippedMissing };
}

// Fetches a single template and enforces org ownership — returns null if the
// template does not exist or belongs to a different organization.
export async function getAdminPromotionTemplateForOrganization(
  templateId: string,
  organizationId: string,
) {
  const template = await getAdminPromotionTemplateById(templateId);

  if (!template || template.organizationId !== organizationId) {
    return null;
  }

  return template;
}
