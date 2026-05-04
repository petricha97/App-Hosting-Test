import { nanoid } from "nanoid";

import {
  buildDefaultFormTitle,
  createMandatoryFormFields,
} from "@/features/form/default-fields";
import type {
  FormBuilderValues,
  FormFieldTypeValues,
  FormFieldValues,
} from "@/features/form/schema";
import { storedFormDocumentSchema } from "@/features/form/schema";
import type { FormDoc, FormFieldDoc, WithId } from "@/types/collection";

export interface SerializedTimestamp {
  seconds: number | null;
  nanoseconds: number | null;
  isoString: string | null;
}

export type SerializedForm = Omit<WithId<FormDoc>, "createdAt" | "updatedAt"> & {
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
};

export function createCustomFormField(
  type: FormFieldTypeValues,
  order: number,
): FormFieldValues {
  const id = nanoid(10);
  const defaults = fieldTypeDefaults[type];

  return {
    id: `field-${id}`,
    key: `field_${id}`,
    label: defaults.label,
    type,
    placeholder: defaults.placeholder,
    helpText: "",
    required: false,
    isMandatory: false,
    order,
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
    if (field.type === "textarea") {
      return {
        ...field,
        rows: field.rows ?? 4,
      };
    }

    const { rows: _rows, ...rest } = field;
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

  const mandatoryFields = createMandatoryFormFields().map((field, index) => {
    const existing = normalizedCustomFields.find(
      (candidate) =>
        candidate.id === field.id ||
        candidate.key === field.key ||
        (candidate.isMandatory && candidate.type === field.type),
    );

    return {
      ...field,
      label: existing?.label?.trim() || field.label,
      placeholder: existing?.placeholder ?? field.placeholder,
      helpText: existing?.helpText ?? "",
      order: index,
    };
  });

  const customFields = normalizedCustomFields.filter(
    (field) => !mandatoryFields.some((mandatory) => mandatory.id === field.id),
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
    createdAt,
    updatedAt,
  } satisfies WithId<FormDoc>;
}

function serializeTimestamp(
  value: FormDoc["createdAt"] | FormDoc["updatedAt"],
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
  };
}
