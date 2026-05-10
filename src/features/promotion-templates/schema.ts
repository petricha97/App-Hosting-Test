// Zod validation schemas for promotion template form data.
// Used both client-side (before submitting the form) and server-side
// (in API routes to validate the incoming request body).
import { z } from "zod";

// Validates a single condition rule (field + operator + value).
export const conditionRuleSchema = z.object({
  field: z.string().min(1, "Field is required"),
  operator: z.string().min(1, "Operator is required"),
  value: z.union([z.string(), z.number()]),
});

// Validates the full promotion template form. discountValue uses a preprocessor
// so that clearing the input (empty string) stores undefined rather than 0.
export const promotionTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
  description: z.string().optional(),
  discountType: z.string().optional(),
  discountValue: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().optional(),
  ),
  conditions: z.array(conditionRuleSchema).default([]),
  isArchived: z.boolean().optional(),
});

export type PromotionTemplateFormValues = z.infer<
  typeof promotionTemplateSchema
>;
