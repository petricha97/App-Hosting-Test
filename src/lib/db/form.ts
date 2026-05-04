import { createCollectionApi } from "@/lib/db/base";
import type { FormDoc } from "@/types/collection";

const formApi = createCollectionApi<FormDoc>("Form");

export const {
  create: createForm,
  set: setForm,
  getById: getFormById,
  getAll: getForms,
  update: updateForm,
  remove: deleteForm,
  findWhere: findFormsByField,
  findMany: findManyForms,
} = formApi;
