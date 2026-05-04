import { createCollectionApi } from "@/lib/db/base";
import type { FormTemplateDoc } from "@/types/collection";

const formTemplateApi = createCollectionApi<FormTemplateDoc>("FormTemplate");

export const {
  create: createFormTemplate,
  set: setFormTemplate,
  getById: getFormTemplateById,
  getAll: getFormTemplates,
  update: updateFormTemplate,
  remove: deleteFormTemplate,
  findWhere: findFormTemplatesByField,
  findMany: findManyFormTemplates,
} = formTemplateApi;
