import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import {
  extractFormIdFromPath,
  normalizeStoredFormDocument,
} from "@/features/form/utils";
import type { FormDoc } from "@/types/collection";

const formAdminApi = createAdminCollectionApi<FormDoc>("Form");

const {
  create: createAdminForm,
  getById: getAdminFormById,
  update: updateAdminForm,
  findWhere: findAdminFormsByField,
} = formAdminApi;

export { createAdminForm, getAdminFormById, updateAdminForm };

function parseStoredForm(
  form: Partial<FormDoc> & { id: string },
  context: {
    eventId: string;
    organizationId: string;
    eventName: string;
  },
) {
  return normalizeStoredFormDocument(form, context);
}

export async function getAdminFormForEvent(input: {
  eventId: string;
  eventName: string;
  organizationId: string;
  formPath?: string;
}) {
  const directMatches = await findAdminFormsByField("eventId", input.eventId);

  for (const candidate of directMatches) {
    const parsed = parseStoredForm(candidate, input);

    if (parsed && parsed.organizationId === input.organizationId) {
      return parsed;
    }
  }

  const linkedFormId = extractFormIdFromPath(input.formPath);

  if (!linkedFormId) {
    return null;
  }

  const linkedForm = await getAdminFormById(linkedFormId);

  if (!linkedForm) {
    return null;
  }

  return parseStoredForm(linkedForm, input);
}
