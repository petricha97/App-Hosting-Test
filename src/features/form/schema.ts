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

export const formFieldTypeSchema = z.enum(["text", "email", "textarea"]);

export const formStatusSchema = z.enum(["draft", "published"]);

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
    rows: z.coerce.number().int().min(2).max(12).optional(),
  })
  .transform((field) => ({
    ...field,
    rows: field.type === "textarea" ? field.rows ?? 4 : undefined,
  }));

export const formBuilderSchema = z.object({
  title: z.string().trim().min(1, "Form title is required"),
  status: formStatusSchema,
  fields: z
    .array(formFieldSchema)
    .min(3, "The registration form must include the mandatory fields."),
});

export const storedFormDocumentSchema = z.object({
  eventId: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  title: z.string().trim().optional(),
  status: formStatusSchema.optional(),
  fields: z.array(formFieldSchema).optional(),
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

export function buildFormSubmissionSchema(fields: FormFieldValues[]) {
  const shape: Record<string, z.ZodType<string>> = {};

  for (const field of fields) {
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

    shape[field.key] = field.required
      ? z.string().trim().min(1, `${field.label} is required`)
      : z.string().trim().default("");
  }

  return z.object(shape);
}

export type FormFieldValues = z.infer<typeof formFieldSchema>;
export type FormBuilderValues = z.infer<typeof formBuilderSchema>;
export type FormBuilderInput = z.input<typeof formBuilderSchema>;
export type StoredFormDocumentValues = z.infer<typeof storedFormDocumentSchema>;
export type FormDocumentValues = z.infer<typeof formDocumentSchema>;
export type FormSubmissionValues = z.infer<ReturnType<typeof buildFormSubmissionSchema>>;
export type FormDataDocumentValues = z.infer<typeof formDataDocumentSchema>;
export type FormFieldTypeValues = z.infer<typeof formFieldTypeSchema>;
export type FormStatusValues = z.infer<typeof formStatusSchema>;
