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

// Validates the full promotion template form.
// discountValue uses a preprocessor so that clearing the input (empty string)
// stores undefined rather than 0.
// When enablePromoCode is true, promoCode must be a non-empty string.
// When enablePromoCode is false, promoCode is optional (auto-apply mode).
export const promotionTemplateSchema = z
  .object({
    name: z.string().min(1, "Template name is required"),
    description: z.string().optional(),
    discountType: z.string().optional(),
    discountValue: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().optional(),
    ),
    conditions: z.array(conditionRuleSchema).default([]),
    // true  = attendee must type the code to apply the promotion
    // false = promotion auto-applies when conditions are met
    enablePromoCode: z.boolean().default(false),
    promoCode: z.string().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // promoCode is required (and must be non-empty) when enablePromoCode is on.
      if (data.enablePromoCode) {
        return (
          typeof data.promoCode === "string" && data.promoCode.trim().length > 0
        );
      }
      return true;
    },
    {
      message: "Promo code is required when 'Enable promo code' is turned on.",
      path: ["promoCode"],
    },
  );

export type PromotionTemplateFormValues = z.infer<
  typeof promotionTemplateSchema
>;
