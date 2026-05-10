// Server-side data access layer for the PromotionTemplate Firestore collection.
// Uses the Firebase Admin SDK (via createAdminCollectionApi) so it bypasses
// Firestore security rules — safe to call only from Server Components and API routes.
import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
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
