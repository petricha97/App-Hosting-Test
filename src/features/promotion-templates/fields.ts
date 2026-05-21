// Static configuration for the promotion template form fields.
// promotionTemplateFields drives the generic input rendering in the dialog.
// CONDITION_FIELD_OPTIONS lists the attendee fields that can be used in conditions.
import type { PromotionTemplateFormValues } from "@/features/promotion-templates/schema";

export interface TemplateField {
  key: keyof Omit<PromotionTemplateFormValues, "conditions" | "isArchived">;
  label: string;
  type?: "text" | "number" | "textarea";
  placeholder?: string;
  disabledOnEdit?: boolean;
}

export const promotionTemplateFields: TemplateField[] = [
  {
    key: "name",
    label: "Template Name",
    placeholder: "e.g. SG60",
  },
  {
    key: "discountType",
    label: "Discount Type",
    placeholder: "Flat or Percentage",
  },
  {
    key: "discountValue",
    label: "Discount Value",
    type: "number",
    placeholder: "e.g. 20",
  },
  {
    key: "description",
    label: "Description",
    type: "textarea",
  },
];

export const CONDITION_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "age", label: "Age" },
  { key: "nationality", label: "Nationality" },
  { key: "memberType", label: "Member Type" },
];
