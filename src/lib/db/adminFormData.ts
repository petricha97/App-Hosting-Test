import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { FormDataDoc } from "@/types/collection";

const formDataAdminApi = createAdminCollectionApi<FormDataDoc>("FormData");

export const {
  create: createAdminFormData,
  set: setAdminFormData,
  getById: getAdminFormDataById,
  getAll: getAdminFormData,
  update: updateAdminFormData,
  remove: deleteAdminFormData,
  findWhere: findAdminFormDataByField,
  findMany: findAdminManyFormData,
} = formDataAdminApi;

export async function getAdminFormDataForOrganization(organizationId: string) {
  const responses = await findAdminFormDataByField("organizationId", organizationId);

  return [...responses].sort((left, right) => {
    const leftSeconds =
      typeof left.submittedAt === "object" &&
      left.submittedAt !== null &&
      "seconds" in left.submittedAt
        ? Number(left.submittedAt.seconds)
        : 0;
    const rightSeconds =
      typeof right.submittedAt === "object" &&
      right.submittedAt !== null &&
      "seconds" in right.submittedAt
        ? Number(right.submittedAt.seconds)
        : 0;

    return rightSeconds - leftSeconds;
  });
}
