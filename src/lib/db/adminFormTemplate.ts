import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { normalizeStoredFormTemplateDocument } from "@/features/form/utils";
import type { FormTemplateDoc } from "@/types/collection";

const templateAdminApi = createAdminCollectionApi<FormTemplateDoc>("FormTemplate");

const {
  create: createAdminFormTemplate,
  getById: getAdminFormTemplateById,
  update: updateAdminFormTemplate,
  findWhere: findAdminFormTemplatesByField,
} = templateAdminApi;

export {
  createAdminFormTemplate,
  getAdminFormTemplateById,
  updateAdminFormTemplate,
};

export async function getAdminFormTemplatesForOrganization(organizationId: string) {
  const matches = await findAdminFormTemplatesByField("organizationId", organizationId);
  return matches
    .map((template) =>
      normalizeStoredFormTemplateDocument(template, organizationId),
    )
    .filter((template): template is NonNullable<typeof template> => Boolean(template))
    .sort((left, right) => {
      const leftSeconds =
        typeof left.updatedAt === "object" && left.updatedAt && "seconds" in left.updatedAt
          ? Number(left.updatedAt.seconds)
          : 0;
      const rightSeconds =
        typeof right.updatedAt === "object" && right.updatedAt && "seconds" in right.updatedAt
          ? Number(right.updatedAt.seconds)
          : 0;
      return rightSeconds - leftSeconds;
    });
}

export async function getAdminActiveFormTemplatesForOrganization(
  organizationId: string,
) {
  const templates = await getAdminFormTemplatesForOrganization(organizationId);
  return templates.filter((template) => template.status === "active");
}

export async function getAdminFormTemplateForOrganization(
  templateId: string,
  organizationId: string,
) {
  const template = await getAdminFormTemplateById(templateId);

  if (!template || template.organizationId !== organizationId) {
    return null;
  }

  return normalizeStoredFormTemplateDocument(template, organizationId);
}
