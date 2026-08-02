import type { FieldValue, Timestamp } from "firebase/firestore";
import { z } from "zod";

export const VARIABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function normalizeVariableKey(input: string) {
  return input
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .toUpperCase();
}

const firestoreTimestampSchema = z.custom<Timestamp | FieldValue>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    ("seconds" in value ||
      typeof (value as { toDate?: unknown }).toDate === "function"),
  "Expected a Firestore timestamp-like value",
);

export const variableScopeSchema = z.enum(["organization", "event"]);

export const variableKeySchema = z
  .string()
  .trim()
  .min(1, "Variable key is required")
  .transform(normalizeVariableKey)
  .refine(
    (value) => VARIABLE_KEY_PATTERN.test(value),
    "Use letters, numbers, and underscores only, starting with a letter",
  );

export const variableValueSchema = z
  .string()
  .trim()
  .min(1, "Variable value is required")
  .max(2000, "Variable value is too long");

export const variableDescriptionSchema = z
  .string()
  .trim()
  .max(200, "Description is too long")
  .optional()
  .transform((value) => value ?? "");

export const variablePayloadSchema = z.object({
  key: variableKeySchema,
  value: variableValueSchema,
  description: variableDescriptionSchema,
});

export const variableDocumentSchema = z.object({
  organizationId: z.string().trim().min(1),
  scope: variableScopeSchema,
  eventId: z.string().trim().min(1).optional(),
  key: variableKeySchema,
  value: variableValueSchema,
  description: z.string().default(""),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export type VariablePayload = z.infer<typeof variablePayloadSchema>;
