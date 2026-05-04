import type { FormFieldValues } from "@/features/form/schema";

const mandatoryFieldDefinitions: Array<
  Pick<FormFieldValues, "id" | "key" | "label" | "type" | "placeholder">
> = [
  {
    id: "mandatory-first-name",
    key: "first_name",
    label: "First name",
    type: "text",
    placeholder: "Enter your first name",
  },
  {
    id: "mandatory-last-name",
    key: "last_name",
    label: "Last name",
    type: "text",
    placeholder: "Enter your last name",
  },
  {
    id: "mandatory-email",
    key: "email",
    label: "Email",
    type: "email",
    placeholder: "Enter your email address",
  },
];

export function createMandatoryFormFields(): FormFieldValues[] {
  return mandatoryFieldDefinitions.map((field, index) => ({
    ...field,
    helpText: "",
    required: true,
    isMandatory: true,
    order: index,
    origin: "mandatory",
    sourceTemplateFieldId: undefined,
    rows: undefined,
  }));
}

export function buildDefaultFormTitle(eventName: string) {
  const trimmedName = eventName.trim();
  return trimmedName ? `${trimmedName} Registration` : "Event Registration";
}
