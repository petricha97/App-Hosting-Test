// Zod schemas for M3-T1 registration paths, shared by the API routes
// (payload schemas) and the dialog (form schema + payload builder).
// Spec: agents/docs/specs/m3-registration-paths.md (T1).
//
// Server-owned fields (organizationId, eventId, timestamps) are intentionally
// absent from the payload schema — Zod strips unknown keys by default, so
// client-supplied values can never reach the DAL. Cross-doc rules stay in the
// routes: per-event code uniqueness (409) and audience membership (400).

import { z } from "zod";

import {
  CODE_FORMAT_MESSAGE,
  registrationCodeSchema,
} from "@/features/registration/schemas";
import {
  isValidRegistrationCode,
  normalizeRegistrationCode,
} from "@/lib/db/registrationCode";
import { SUPPORTED_CURRENCIES } from "@/types/collection";

// Path names are longer than the M1 80-char entity names on purpose:
// organizers type the "2." / "2.1" flow numbering into the name (spec T1).
export const PATH_NAME_MAX = 120;
export const PATH_NAME_MESSAGE = `Keep the name under ${PATH_NAME_MAX} characters.`;
export const SORT_ORDER_MESSAGE =
  "Sort order must be a whole number of at least 0.";
// Sanity ceiling — keeps sortOrder a meaningful integer, mirroring MAX_CAPACITY.
export const MAX_SORT_ORDER = 1_000_000;
export const SORT_ORDER_MAX_MESSAGE = "Sort order cannot exceed 1,000,000.";
export const PATH_CODE_DUPLICATE_MESSAGE =
  "This code is already used by another path.";
export const PATH_AUDIENCE_MESSAGE =
  "The selected registration type does not belong to this event";

export const PAYMENT_METHODS = ["card", "invoice", "comp", "none"] as const;

const pathNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(PATH_NAME_MAX, PATH_NAME_MESSAGE);

const sortOrderSchema = z
  .number(SORT_ORDER_MESSAGE)
  .int(SORT_ORDER_MESSAGE)
  .min(0, SORT_ORDER_MESSAGE)
  .max(MAX_SORT_ORDER, SORT_ORDER_MAX_MESSAGE);

// ---------------------------------------------------------------------------
// API payload schemas
// ---------------------------------------------------------------------------

export const registrationPathPayloadSchema = z.object({
  name: pathNameSchema,
  code: registrationCodeSchema,
  // null = "Any" audience; a value must belong to this event (route-checked).
  audienceRegistrationTypeId: z.string().min(1).nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  currency: z.enum(SUPPORTED_CURRENCIES),
  isActive: z.boolean(),
  // Optional: omitted -> the DAL defaults to max+1 within the event (T1).
  // The dialog always sends it (prefilled max+1 on create).
  sortOrder: sortOrderSchema.optional(),
});

export type RegistrationPathPayload = z.output<
  typeof registrationPathPayloadSchema
>;

// Lightweight PATCH shapes for the table's inline controls — strict so a
// malformed full payload can never be misread as a toggle (M2 tax convention).
export const pathActiveToggleSchema = z.strictObject({
  isActive: z.boolean(),
});

export const pathSortOrderSchema = z.strictObject({
  sortOrder: sortOrderSchema,
});

// ---------------------------------------------------------------------------
// Dialog form schema (React Hook Form). Audience uses a sentinel for "Any"
// (Radix Select can't carry null); sortOrder is a text input.
// ---------------------------------------------------------------------------

export const ANY_AUDIENCE = "__any__";

export const registrationPathFormSchema = z.object({
  name: pathNameSchema,
  code: z
    .string()
    .min(1, "Code is required.")
    .refine((value) => isValidRegistrationCode(value), CODE_FORMAT_MESSAGE),
  audienceRegistrationTypeId: z.string().min(1),
  paymentMethod: z.enum(PAYMENT_METHODS),
  currency: z.enum(SUPPORTED_CURRENCIES),
  sortOrder: z
    .string()
    .refine((value) => {
      const parsed = Number(value);
      return (
        value.trim() !== "" &&
        Number.isInteger(parsed) &&
        parsed >= 0 &&
        parsed <= MAX_SORT_ORDER
      );
    }, SORT_ORDER_MESSAGE),
  isActive: z.boolean(),
});

export type RegistrationPathFormValues = z.infer<
  typeof registrationPathFormSchema
>;

// Form values -> API payload. Normalization here keeps what the user sees in
// the dialog and what the server stores in lockstep.
export function buildRegistrationPathPayload(
  values: RegistrationPathFormValues,
): RegistrationPathPayload {
  return {
    name: values.name.trim(),
    code: normalizeRegistrationCode(values.code),
    audienceRegistrationTypeId:
      values.audienceRegistrationTypeId === ANY_AUDIENCE
        ? null
        : values.audienceRegistrationTypeId,
    paymentMethod: values.paymentMethod,
    currency: values.currency,
    isActive: values.isActive,
    sortOrder: Number(values.sortOrder),
  };
}
