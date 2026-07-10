import { nanoid } from "nanoid";
import type { FieldValue, Timestamp } from "firebase/firestore";

import {
  buildDefaultFormTitle,
  createMandatoryFormFields,
} from "@/features/form/default-fields";
import type {
  FormBuilderValues,
  FormTemplateLinkValues,
  FormFieldTypeValues,
  FormFieldValues,
} from "@/features/form/schema";
import {
  COMMERCE_FIELD_KEYS,
  formTemplateDocumentSchema,
  isCommerceFieldType,
  storedFormDocumentSchema,
  storedFormTemplateDocumentSchema,
} from "@/features/form/schema";
import type {
  FormDoc,
  FormFieldDoc,
  FormTemplateDoc,
  WithId,
} from "@/types/collection";

export interface SerializedTimestamp {
  seconds: number | null;
  nanoseconds: number | null;
  isoString: string | null;
}

export type SerializedForm = Omit<
  WithId<FormDoc>,
  "createdAt" | "updatedAt" | "templateLink"
> & {
  createdAt: SerializedTimestamp | null;
  updatedAt: SerializedTimestamp | null;
  templateLink?: Omit<NonNullable<FormDoc["templateLink"]>, "appliedAt"> & {
    appliedAt: SerializedTimestamp | null;
  };
};

export type SerializedFormTemplate = Omit<
  WithId<FormTemplateDoc>,
  "createdAt" | "updatedAt"
> & {
  createdAt: SerializedTimestamp | null;
  updatedAt: SerializedTimestamp | null;
};

const fieldTypeDefaults: Record<
  FormFieldTypeValues,
  Pick<FormFieldValues, "label" | "placeholder"> & { rows?: number }
> = {
  text: {
    label: "Short text",
    placeholder: "Type your answer",
  },
  email: {
    label: "Email field",
    placeholder: "name@example.com",
  },
  textarea: {
    label: "Long answer",
    placeholder: "Type more details",
    rows: 4,
  },
  // M3-T2 commerce fields (event-only): fixed keys, defaults per design §2.
  "ticket-selector": {
    label: "Select your ticket",
    placeholder: "",
  },
  "promo-code": {
    label: "Promo code",
    placeholder: "Enter a promo code",
  },
};

export function createCustomFormField(
  type: FormFieldTypeValues,
  order: number,
  origin: FormFieldValues["origin"] = "event",
): FormFieldValues {
  const id = nanoid(10);
  const defaults = fieldTypeDefaults[type];
  const commerce = isCommerceFieldType(type);
  // Commerce fields carry FIXED keys (ticket / promo_code) — the public flow
  // addresses them by key. Commerce fields are always event-origin.
  const key = isCommerceFieldType(type)
    ? COMMERCE_FIELD_KEYS[type]
    : `field_${id}`;

  return {
    id: `field-${id}`,
    key,
    label: defaults.label,
    type,
    placeholder: defaults.placeholder,
    helpText: "",
    // Ticket selector defaults to required (spec T2); promo code is always
    // optional (enforced by the schema transform as well).
    required: type === "ticket-selector",
    isMandatory: false,
    order,
    origin: commerce ? "event" : origin,
    sourceTemplateFieldId: undefined,
    rows: type === "textarea" ? defaults.rows ?? 4 : undefined,
  };
}

export function reorderFormFields(fields: FormFieldValues[]) {
  return fields.map((field, index) => ({
    ...field,
    order: index,
    rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
  }));
}

export function sanitizeFormFieldsForFirestore(fields: FormFieldValues[]) {
  return reorderFormFields(fields).map((field) => {
    const baseField = {
      ...field,
      ...(field.sourceTemplateFieldId
        ? { sourceTemplateFieldId: field.sourceTemplateFieldId }
        : {}),
    };

    if (field.type === "textarea") {
      return {
        ...baseField,
        rows: field.rows ?? 4,
      };
    }

    const { rows: _rows, sourceTemplateFieldId: _sourceTemplateFieldId, ...rest } = baseField;
    return rest;
  });
}

function normalizeField(
  field: Partial<FormFieldDoc>,
  index: number,
): FormFieldValues | null {
  if (!field.id || !field.key || !field.label || !field.type) {
    return null;
  }

  return {
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    placeholder: field.placeholder ?? "",
    helpText: field.helpText ?? "",
    required: field.isMandatory ? true : Boolean(field.required),
    isMandatory: Boolean(field.isMandatory),
    order: Number.isFinite(field.order) ? Number(field.order) : index,
    origin: field.isMandatory
      ? "mandatory"
      : field.origin ?? "event",
    sourceTemplateFieldId: field.sourceTemplateFieldId?.trim() || undefined,
    rows:
      field.type === "textarea"
        ? Number.isFinite(field.rows)
          ? Number(field.rows)
          : 4
        : undefined,
  };
}

export function ensureMandatoryFields(
  rawFields: Array<Partial<FormFieldDoc>> = [],
): FormFieldValues[] {
  const normalizedCustomFields = rawFields
    .map(normalizeField)
    .filter((field): field is FormFieldValues => field !== null);

  const matchedMandatoryFieldIds = new Set<string>();
  const mandatoryFields = createMandatoryFormFields().map((field, index) => {
    const existing = normalizedCustomFields.find(
      (candidate) =>
        candidate.id === field.id ||
        candidate.key === field.key ||
        candidate.sourceTemplateFieldId === field.id,
    );

    if (existing) {
      matchedMandatoryFieldIds.add(existing.id);
    }

    return {
      ...field,
      label: existing?.label?.trim() || field.label,
      placeholder: existing?.placeholder ?? field.placeholder,
      helpText: existing?.helpText ?? "",
      order: index,
      origin:
        existing?.origin === "template"
          ? "template"
          : field.origin,
      sourceTemplateFieldId:
        existing?.origin === "template"
          ? existing.sourceTemplateFieldId ?? existing.id
          : undefined,
    };
  });

  const customFields = normalizedCustomFields.filter(
    (field) =>
      !matchedMandatoryFieldIds.has(field.id) &&
      !mandatoryFields.some(
        (mandatory) =>
          mandatory.key === field.key ||
          mandatory.id === field.id ||
          field.sourceTemplateFieldId === mandatory.id,
      ),
  );

  return reorderFormFields([...mandatoryFields, ...customFields]);
}

export function buildInitialFormDraft(eventName: string): FormBuilderValues {
  return {
    title: buildDefaultFormTitle(eventName),
    status: "draft",
    fields: createMandatoryFormFields(),
  };
}

export function buildInitialTemplateDraft(templateTitle = "Registration template") {
  return {
    title: templateTitle,
    description: "",
    status: "active" as const,
    fields: createMandatoryFormFields().map((field) => ({
      ...field,
      origin: "template" as const,
      sourceTemplateFieldId: field.id,
    })),
  };
}

export function buildFormDraftFromTemplate(
  eventName: string,
  template: SerializedFormTemplate,
) {
  return {
    title: buildDefaultFormTitle(eventName),
    status: "draft" as const,
    fields: reorderFormFields(
      template.fields.map((field) => ({
        ...field,
        id: `linked-${field.id}-${nanoid(6)}`,
        origin: "template" as const,
        sourceTemplateFieldId: field.id,
        rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
      })),
    ),
  };
}

export function extractFormIdFromPath(formPath: string | undefined) {
  if (!formPath) {
    return null;
  }

  const trimmedPath = formPath.trim().replace(/^\/+/, "");
  const segments = trimmedPath.split("/").filter(Boolean);

  if (segments.length < 2) {
    return null;
  }

  const [collectionSegment, idSegment] = segments;

  if (!["form", "forms"].includes(collectionSegment.toLowerCase())) {
    return null;
  }

  return idSegment || null;
}

export function normalizeStoredFormDocument(
  rawForm: Partial<FormDoc> & { id: string },
  context: {
    eventId: string;
    organizationId: string;
    eventName: string;
  },
) {
  const parsed = storedFormDocumentSchema.safeParse(rawForm);

  if (!parsed.success) {
    return null;
  }

  const candidate = parsed.data;
  const createdAt = candidate.createdAt ?? null;
  const updatedAt = candidate.updatedAt ?? null;

  if (!createdAt || !updatedAt) {
    return null;
  }

  return {
    id: rawForm.id,
    eventId: candidate.eventId?.trim() || context.eventId,
    organizationId: candidate.organizationId?.trim() || context.organizationId,
    title: candidate.title?.trim() || buildDefaultFormTitle(context.eventName),
    status: candidate.status ?? "draft",
    fields: ensureMandatoryFields(candidate.fields ?? []),
    templateLink: candidate.templateLink,
    createdAt,
    updatedAt,
  } satisfies WithId<FormDoc>;
}

function serializeTimestamp(
  value:
    | FormDoc["createdAt"]
    | FormDoc["updatedAt"]
    | FormTemplateDoc["createdAt"]
    | FormTemplateDoc["updatedAt"],
): SerializedTimestamp | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const seconds = "seconds" in value ? Number(value.seconds) : null;
  const nanoseconds = "nanoseconds" in value ? Number(value.nanoseconds) : null;
  const isoString =
    typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate().toISOString()
      : seconds !== null
        ? new Date(seconds * 1000).toISOString()
        : null;

  return {
    seconds,
    nanoseconds,
    isoString,
  };
}

export function serializeForm(form: WithId<FormDoc>): SerializedForm {
  return {
    ...form,
    createdAt: serializeTimestamp(form.createdAt),
    updatedAt: serializeTimestamp(form.updatedAt),
    templateLink: form.templateLink
      ? {
          ...form.templateLink,
          appliedAt: serializeTimestamp(form.templateLink.appliedAt),
        }
      : undefined,
  };
}

export function normalizeStoredFormTemplateDocument(
  rawTemplate: Partial<FormTemplateDoc> & { id: string },
  organizationId: string,
) {
  const parsed = storedFormTemplateDocumentSchema.safeParse(rawTemplate);

  if (!parsed.success) {
    return null;
  }

  const candidate = parsed.data;
  const createdAt = candidate.createdAt ?? null;
  const updatedAt = candidate.updatedAt ?? null;

  if (!createdAt || !updatedAt) {
    return null;
  }

  const normalizedFields = ensureMandatoryFields(candidate.fields ?? []).map(
    (field) => ({
      ...field,
      origin: "template" as const,
      sourceTemplateFieldId: field.sourceTemplateFieldId ?? field.id,
    }),
  );

  const template = {
    id: rawTemplate.id,
    organizationId: candidate.organizationId?.trim() || organizationId,
    title: candidate.title?.trim() || "Registration template",
    description: candidate.description?.trim() || "",
    status: candidate.status ?? "active",
    version: candidate.version ?? 1,
    fields: normalizedFields,
    createdAt,
    updatedAt,
  } satisfies WithId<FormTemplateDoc>;

  const validated = formTemplateDocumentSchema.safeParse(template);
  return validated.success ? template : null;
}

export function serializeFormTemplate(
  template: WithId<FormTemplateDoc>,
): SerializedFormTemplate {
  return {
    ...template,
    createdAt: serializeTimestamp(template.createdAt),
    updatedAt: serializeTimestamp(template.updatedAt),
  };
}

export function isTemplateManagedField(
  field: Pick<FormFieldValues, "origin">,
  templateLink?:
    | Pick<FormTemplateLinkValues, "templateId" | "templateVersion" | "detached">
    | null,
) {
  return field.origin === "template" && Boolean(templateLink) && !templateLink?.detached;
}

export function cloneTemplateFieldsForEvent(
  template: Pick<FormTemplateDoc, "fields">,
) {
  return reorderFormFields(
    template.fields.map((field) => ({
      ...field,
      id: `linked-${field.id}-${nanoid(6)}`,
      origin: "template" as const,
      sourceTemplateFieldId: field.id,
      rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
    })),
  );
}

export function applyTemplateToLinkedForm(input: {
  form: WithId<FormDoc>;
  template: WithId<FormTemplateDoc>;
  appliedAt: Timestamp | FieldValue;
}) {
  // M3-T2 guard (T2 AC-3): the template cascade must never insert, remove or
  // edit commerce fields on a linked form. templateBuilderSchema already
  // rejects commerce types at save, but a stale/tampered template doc must
  // not propagate them either — filter defensively. Event-origin commerce
  // fields on the form itself flow through `eventFields` untouched below.
  const templateFields = input.template.fields.filter(
    (field) => !isCommerceFieldType(field.type),
  );
  const templateFieldIds = new Set(templateFields.map((field) => field.id));
  const existingTemplateFields = input.form.fields.filter(
    (field) => field.origin === "template",
  );
  const eventFields = input.form.fields
    .filter((field) => field.origin !== "template")
    .map((field) => ({
      ...field,
      origin: field.origin ?? (field.isMandatory ? "mandatory" : "event"),
      rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
    }));

  const preservedRemovedTemplateFields = existingTemplateFields
    .filter(
      (field) =>
        !field.sourceTemplateFieldId ||
        !templateFieldIds.has(field.sourceTemplateFieldId),
    )
    .map((field) => ({
      ...field,
      origin: "event" as const,
      isMandatory: false,
      sourceTemplateFieldId: undefined,
      rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
    }));

  const nextTemplateFields = templateFields.map((templateField) => {
    const existing = existingTemplateFields.find(
      (field) => field.sourceTemplateFieldId === templateField.id,
    );

    return {
      ...templateField,
      id: existing?.id ?? `linked-${templateField.id}-${nanoid(6)}`,
      origin: "template" as const,
      sourceTemplateFieldId: templateField.id,
      rows:
        templateField.type === "textarea" ? templateField.rows ?? 4 : undefined,
    };
  });

  return {
    fields: reorderFormFields([
      ...nextTemplateFields,
      ...preservedRemovedTemplateFields,
      ...eventFields,
    ]),
    templateLink: {
      templateId: input.template.id,
      templateVersion: input.template.version,
      detached: false,
      appliedAt: input.appliedAt,
    },
  };
}
