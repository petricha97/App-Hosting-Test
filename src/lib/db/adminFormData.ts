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
