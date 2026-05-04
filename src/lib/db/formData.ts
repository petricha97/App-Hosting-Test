import { createCollectionApi } from "@/lib/db/base";
import type { FormDataDoc } from "@/types/collection";

const formDataApi = createCollectionApi<FormDataDoc>("FormData");

export const {
  create: createFormData,
  set: setFormData,
  getById: getFormDataById,
  getAll: getFormData,
  update: updateFormData,
  remove: deleteFormData,
  findWhere: findFormDataByField,
  findMany: findManyFormData,
} = formDataApi;
