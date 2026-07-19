import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import {
  applyTemplateToLinkedForm,
  extractFormIdFromPath,
  normalizeStoredFormDocument,
  sanitizeFormFieldsForFirestore,
} from "@/features/form/utils";
import type { FormDoc, FormTemplateDoc } from "@/types/collection";

const formAdminApi = createAdminCollectionApi<FormDoc>("Form");

export const MAX_TEMPLATE_APPLY_FORMS = 500;

export class TemplateApplyLimitError extends Error {
  readonly code = "TEMPLATE_APPLY_LIMIT_EXCEEDED";

  constructor(readonly maxForms = MAX_TEMPLATE_APPLY_FORMS) {
    super(`A template can be applied to at most ${maxForms} forms at once`);
    this.name = "TemplateApplyLimitError";
  }
}

export class TemplateApplyIneligibleFormError extends Error {
  readonly code = "TEMPLATE_APPLY_INELIGIBLE_FORM";

  constructor() {
    super("Cannot apply template to an ineligible form");
    this.name = "TemplateApplyIneligibleFormError";
  }
}

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
    if (
      candidate.eventId !== input.eventId ||
      candidate.organizationId !== input.organizationId
    ) {
      continue;
    }

    const parsed = parseStoredForm(candidate, input);

    if (parsed) return parsed;
  }

  const linkedFormId = extractFormIdFromPath(input.formPath);

  if (!linkedFormId) {
    return null;
  }

  const linkedForm = await getAdminFormById(linkedFormId);

  if (!linkedForm) {
    return null;
  }

  if (
    linkedForm.eventId !== input.eventId ||
    linkedForm.organizationId !== input.organizationId
  ) {
    return null;
  }

  return parseStoredForm(linkedForm, input);
}

export async function getAdminPublishedFormForEvent(input: {
  eventId: string;
  eventName: string;
  organizationId: string;
  formPath?: string;
}) {
  const form = await getAdminFormForEvent(input);

  if (!form || form.status !== "published") {
    return null;
  }

  return form;
}

export async function getAdminPublishedFormForPublicEvent(input: {
  eventId: string;
  eventName: string;
  organizationId?: string | null;
  formPath?: string;
}) {
  const directMatches = await findAdminFormsByField("eventId", input.eventId);

  for (const candidate of directMatches) {
    if (
      candidate.eventId !== input.eventId ||
      (input.organizationId != null &&
        candidate.organizationId !== input.organizationId)
    ) {
      continue;
    }

    const parsed = normalizeStoredFormDocument(candidate, {
      eventId: input.eventId,
      eventName: input.eventName,
      organizationId: input.organizationId ?? candidate.organizationId ?? "",
    });

    if (parsed && parsed.status === "published") {
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

  if (
    linkedForm.eventId !== input.eventId ||
    (input.organizationId != null &&
      linkedForm.organizationId !== input.organizationId)
  ) {
    return null;
  }

  const parsed = normalizeStoredFormDocument(linkedForm, {
    eventId: input.eventId,
    eventName: input.eventName,
    organizationId: input.organizationId ?? linkedForm.organizationId ?? "",
  });

  if (!parsed || parsed.status !== "published") {
    return null;
  }

  return parsed;
}

export async function getAdminFormsForOrganization(organizationId: string) {
  const matches = await findAdminFormsByField("organizationId", organizationId);
  return matches
    .map((form) =>
      normalizeStoredFormDocument(form, {
        eventId: form.eventId ?? "",
        organizationId,
        eventName: form.title ?? "Event",
      }),
    )
    .filter((form): form is NonNullable<typeof form> => Boolean(form));
}

export async function getAdminLinkedFormsForTemplate(input: {
  templateId: string;
  organizationId: string;
  limit?: number;
}) {
  let query = adminDb
    .collection("Form")
    .where("templateLink.templateId", "==", input.templateId);

  if (input.limit !== undefined) {
    query = query.limit(input.limit);
  }

  const matchesSnapshot = await query.get();
  const matches = matchesSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as FormDoc),
  }));

  return matches
    .map((form) =>
      normalizeStoredFormDocument(form, {
        eventId: form.eventId ?? "",
        organizationId: input.organizationId,
        eventName: form.title ?? "Event",
      }),
    )
    .filter((form) => Boolean(form))
    .filter(
      (form) =>
        form!.organizationId === input.organizationId &&
        form!.templateLink?.templateId === input.templateId,
    ) as NonNullable<
    ReturnType<typeof normalizeStoredFormDocument>
  >[];
}

export async function detachAdminFormFromTemplate(input: {
  form: Awaited<ReturnType<typeof getAdminFormById>>;
}) {
  if (!input.form) {
    return;
  }

  const fields = input.form.fields.map((field) =>
    field.origin === "template"
      ? {
          ...field,
          origin: "event" as const,
          isMandatory: false,
          sourceTemplateFieldId: undefined,
          rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
        }
      : {
          ...field,
          origin: field.origin ?? (field.isMandatory ? "mandatory" : "event"),
          rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
        },
  );

  await updateAdminForm(input.form.id, {
    fields: sanitizeFormFieldsForFirestore(fields),
    templateLink: {
      ...(input.form.templateLink ?? {
        templateId: "",
        templateVersion: 1,
        appliedAt: FieldValue.serverTimestamp(),
      }),
      detached: true,
      appliedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function applyAdminTemplateToForms(input: {
  template: FormTemplateDoc & { id: string };
  forms: Array<{ id: string }>;
}) {
  if (input.forms.length > MAX_TEMPLATE_APPLY_FORMS) {
    throw new TemplateApplyLimitError();
  }

  const forms = await Promise.all(
    input.forms.map((form) => getAdminFormById(form.id)),
  );

  const events = await Promise.all(
    forms.map((form) =>
      form?.eventId
        ? getAdminEventForOrganization(
            form.eventId,
            input.template.organizationId,
          )
        : Promise.resolve(null),
    ),
  );

  if (
    forms.some(
      (form, index) =>
        !form ||
        form.organizationId !== input.template.organizationId ||
        form.templateLink?.templateId !== input.template.id ||
        form.templateLink.detached ||
        !events[index],
    )
  ) {
    throw new TemplateApplyIneligibleFormError();
  }

  const eligibleForms = forms as Array<NonNullable<(typeof forms)[number]>>;
  const batch = adminDb.batch();

  for (const form of eligibleForms) {
    const next = applyTemplateToLinkedForm({
      form,
      template: input.template,
      appliedAt: FieldValue.serverTimestamp(),
    });

    batch.update(adminDb.collection("Form").doc(form.id), {
      fields: sanitizeFormFieldsForFirestore(next.fields),
      templateLink: next.templateLink,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // One bounded batch is intentional: chunking would make propagation only
  // atomic per chunk and could leave a template partially applied.
  await batch.commit();

  return eligibleForms.map((form) => form.id);
}
