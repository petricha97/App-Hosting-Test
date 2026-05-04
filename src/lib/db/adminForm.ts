import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import {
  applyTemplateToLinkedForm,
  extractFormIdFromPath,
  normalizeStoredFormDocument,
  sanitizeFormFieldsForFirestore,
} from "@/features/form/utils";
import type { FormDoc, FormTemplateDoc } from "@/types/collection";

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
}) {
  const matchesSnapshot = await adminDb
    .collection("Form")
    .where("templateLink.templateId", "==", input.templateId)
    .get();
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
  forms: Array<FormDoc & { id: string }>;
}) {
  const updatedIds: string[] = [];

  for (const form of input.forms) {
    const next = applyTemplateToLinkedForm({
      form,
      template: input.template,
      appliedAt: FieldValue.serverTimestamp(),
    });

    await updateAdminForm(form.id, {
      fields: sanitizeFormFieldsForFirestore(next.fields),
      templateLink: next.templateLink,
      updatedAt: FieldValue.serverTimestamp(),
    });

    updatedIds.push(form.id);
  }

  return updatedIds;
}
