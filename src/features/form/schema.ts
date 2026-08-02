import type { FieldValue, Timestamp } from "firebase/firestore";
import { z } from "zod";

const firestoreTimestampSchema = z.custom<Timestamp | FieldValue>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    ("seconds" in value ||
      typeof (value as { toDate?: unknown }).toDate === "function"),
  "Expected a Firestore timestamp-like value",
);

export const formFieldTypeSchema = z.enum([
  "text",
  "email",
  "number",
  "date",
  "textarea",
  // M3-T2 commerce field types — EVENT-ONLY, never valid in templates
  // (templateBuilderSchema rejects them below).
  "ticket-selector",
  "promo-code",
]);
export const formFieldOriginSchema = z.enum(["mandatory", "template", "event"]);

// M3-T2 — commerce field rules (spec: agents/docs/specs/m3-registration-paths.md).
// At most ONE field of each commerce type per form; keys are FIXED so the
// draft/order pipeline can address them; promo-code is ALWAYS optional.
export const COMMERCE_FIELD_TYPES = ["ticket-selector", "promo-code"] as const;
export type CommerceFieldType = (typeof COMMERCE_FIELD_TYPES)[number];

export const COMMERCE_FIELD_KEYS: Record<CommerceFieldType, string> = {
  "ticket-selector": "ticket",
  "promo-code": "promo_code",
};

export function isCommerceFieldType(
  type: string,
): type is CommerceFieldType {
  return (COMMERCE_FIELD_TYPES as readonly string[]).includes(type);
}

// Fields that render as regular question inputs (step 1 of the public flow /
// the flat legacy form). Commerce fields travel through the draft/order
// pipeline instead of the submission record.
export function getNonCommerceFields<T extends { type: string }>(
  fields: T[],
): T[] {
  return fields.filter((field) => !isCommerceFieldType(field.type));
}

// Refine helper shared by the builder schemas: rejects a second field of
// either commerce type (T2 AC-2 — builder blocks AND server Zod rejects).
function refineSingleCommerceField(
  fields: Array<{ type: string }>,
  ctx: z.RefinementCtx,
) {
  for (const type of COMMERCE_FIELD_TYPES) {
    const count = fields.filter((field) => field.type === type).length;
    if (count > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message:
          type === "ticket-selector"
            ? "Only one ticket selector is allowed per form."
            : "Only one promo code field is allowed per form.",
      });
    }
  }
}

export const formStatusSchema = z.enum(["draft", "published"]);
export const formTemplateStatusSchema = z.enum(["active", "archived"]);

export const formFieldSchema = z
  .object({
    id: z.string().trim().min(1, "Field id is required"),
    key: z.string().trim().min(1, "Field key is required"),
    label: z.string().trim().min(1, "Field label is required"),
    type: formFieldTypeSchema,
    placeholder: z.string().default(""),
    helpText: z.string().default(""),
    required: z.boolean().default(false),
    isMandatory: z.boolean().default(false),
    order: z.coerce.number().int().min(0).default(0),
    origin: formFieldOriginSchema.default("event"),
    sourceTemplateFieldId: z.string().trim().min(1).optional(),
    rows: z.coerce.number().int().min(2).max(12).optional(),
  })
  .transform((field) => {
    if (isCommerceFieldType(field.type)) {
      // Commerce fields carry NORMALIZED invariants regardless of what the
      // caller sent: fixed key, event origin, never mandatory/template-managed,
      // promo-code always optional (T2). Server-side normalization means a
      // tampered payload cannot smuggle a commerce field under another key.
      return {
        ...field,
        key: COMMERCE_FIELD_KEYS[field.type],
        origin: "event" as const,
        isMandatory: false,
        sourceTemplateFieldId: undefined,
        required: field.type === "promo-code" ? false : field.required,
        rows: undefined,
      };
    }

    return {
      ...field,
      rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
    };
  });

export const formBuilderSchema = z.object({
  title: z.string().trim().min(1, "Form title is required"),
  status: formStatusSchema,
  fields: z
    .array(formFieldSchema)
    .min(3, "The registration form must include the mandatory fields.")
    .superRefine(refineSingleCommerceField),
});

export const formTemplateLinkSchema = z.object({
  templateId: z.string().trim().min(1, "Template id is required"),
  templateVersion: z.coerce.number().int().min(1, "Template version is required"),
  detached: z.boolean().default(false),
  appliedAt: firestoreTimestampSchema,
});

export const storedFormDocumentSchema = z.object({
  eventId: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  title: z.string().trim().optional(),
  status: formStatusSchema.optional(),
  fields: z.array(formFieldSchema).optional(),
  templateLink: formTemplateLinkSchema.optional(),
  createdAt: firestoreTimestampSchema.optional(),
  updatedAt: firestoreTimestampSchema.optional(),
});

export const formDocumentSchema = storedFormDocumentSchema.extend({
  eventId: z.string().trim().min(1, "Event id is required"),
  organizationId: z.string().trim().min(1, "Organization id is required"),
  title: z.string().trim().min(1, "Form title is required"),
  status: formStatusSchema,
  fields: z
    .array(formFieldSchema)
    .min(3, "The registration form must include the mandatory fields."),
  templateLink: formTemplateLinkSchema.optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const templateBuilderSchema = z.object({
  title: z.string().trim().min(1, "Template title is required"),
  description: z.string().trim().default(""),
  status: formTemplateStatusSchema,
  fields: z
    .array(formFieldSchema)
    // M3-T2: templates are org-level and reusable across events; commerce
    // fields bind to event-scoped TicketTypes/EventPromotions, so they are
    // rejected here outright (T2 AC-3).
    .superRefine((fields, ctx) => {
      if (fields.some((field) => isCommerceFieldType(field.type))) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message:
            "Ticket selector and promo code fields are event-only and cannot be part of a template.",
        });
      }
    }),
});

export const storedFormTemplateDocumentSchema = z.object({
  organizationId: z.string().trim().optional(),
  title: z.string().trim().optional(),
  description: z.string().trim().optional(),
  status: formTemplateStatusSchema.optional(),
  version: z.coerce.number().int().min(1).optional(),
  fields: z.array(formFieldSchema).optional(),
  createdAt: firestoreTimestampSchema.optional(),
  updatedAt: firestoreTimestampSchema.optional(),
});

export const formTemplateDocumentSchema = storedFormTemplateDocumentSchema.extend({
  organizationId: z.string().trim().min(1, "Organization id is required"),
  title: z.string().trim().min(1, "Template title is required"),
  description: z.string().trim().default(""),
  status: formTemplateStatusSchema,
  version: z.coerce.number().int().min(1),
  fields: z.array(formFieldSchema),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const formSubmissionDataSchema = z.record(z.string(), z.string());

export const formDataDocumentSchema = z.object({
  formId: z.string().trim().min(1, "Form id is required"),
  eventId: z.string().trim().min(1, "Event id is required"),
  organizationId: z.string().trim().min(1, "Organization id is required"),
  submission: formSubmissionDataSchema,
  submittedAt: firestoreTimestampSchema,
});

function isNumericFieldValue(value: string) {
  return /^-?\d+(\.\d+)?$/.test(value);
}

function isDateFieldValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function buildFormSubmissionSchema(fields: FormFieldValues[]) {
  const shape: Record<string, z.ZodType<string>> = {};

  for (const field of fields) {
    // M3-T2 backward compat: commerce field values travel through the
    // draft/order pipeline, never the flat submission record. Excluding them
    // here keeps existing published forms (and the legacy flat submit route)
    // parsing exactly as before.
    if (isCommerceFieldType(field.type)) {
      continue;
    }

    if (field.type === "email") {
      shape[field.key] = field.required
        ? z
            .string()
            .trim()
            .min(1, `${field.label} is required`)
            .email("Enter a valid email address")
        : z
            .string()
            .trim()
            .refine(
              (value) => value.length === 0 || /\S+@\S+\.\S+/.test(value),
              "Enter a valid email address",
            )
            .default("");
      continue;
    }

    if (field.type === "number") {
      shape[field.key] = field.required
        ? z
            .string()
            .trim()
            .min(1, `${field.label} is required`)
            .refine(isNumericFieldValue, "Enter a valid number")
        : z
            .string()
            .trim()
            .refine(
              (value) => value.length === 0 || isNumericFieldValue(value),
              "Enter a valid number",
            )
            .default("");
      continue;
    }

    if (field.type === "date") {
      shape[field.key] = field.required
        ? z
            .string()
            .trim()
            .min(1, `${field.label} is required`)
            .refine(isDateFieldValue, "Enter a valid date")
        : z
            .string()
            .trim()
            .refine(
              (value) => value.length === 0 || isDateFieldValue(value),
              "Enter a valid date",
            )
            .default("");
      continue;
    }

    shape[field.key] = field.required
      ? z.string().trim().min(1, `${field.label} is required`)
      : z.string().trim().default("");
  }

  return z.object(shape);
}

export type FormFieldValues = z.infer<typeof formFieldSchema>;
export type FormBuilderValues = z.infer<typeof formBuilderSchema>;
export type FormBuilderInput = z.input<typeof formBuilderSchema>;
export type FormTemplateLinkValues = z.infer<typeof formTemplateLinkSchema>;
export type StoredFormDocumentValues = z.infer<typeof storedFormDocumentSchema>;
export type FormDocumentValues = z.infer<typeof formDocumentSchema>;
export type TemplateBuilderValues = z.infer<typeof templateBuilderSchema>;
export type TemplateBuilderInput = z.input<typeof templateBuilderSchema>;
export type StoredFormTemplateDocumentValues = z.infer<
  typeof storedFormTemplateDocumentSchema
>;
export type FormTemplateDocumentValues = z.infer<typeof formTemplateDocumentSchema>;
export type FormSubmissionValues = z.infer<ReturnType<typeof buildFormSubmissionSchema>>;
export type FormDataDocumentValues = z.infer<typeof formDataDocumentSchema>;
export type FormFieldTypeValues = z.infer<typeof formFieldTypeSchema>;
export type FormFieldOriginValues = z.infer<typeof formFieldOriginSchema>;
export type FormStatusValues = z.infer<typeof formStatusSchema>;
export type FormTemplateStatusValues = z.infer<typeof formTemplateStatusSchema>;
