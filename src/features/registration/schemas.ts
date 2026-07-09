// Zod schemas for the M1 registration spine, shared by the API routes
// (payload schemas) and the dialogs (form schemas + payload builders).
// Spec: agents/docs/specs/m1-registration-spine.md.
//
// Server-owned fields (organizationId, eventId, registeredCount, timestamps)
// are intentionally absent from the payload schemas — Zod strips unknown keys
// by default, so client-supplied values can never reach the DAL.

import { z } from "zod";

import {
  isValidRegistrationCode,
  normalizeRegistrationCode,
} from "@/lib/db/registrationCode";

export const CODE_FORMAT_MESSAGE =
  "Use 2-12 characters: letters, digits, hyphen or slash, starting with a letter or digit.";
export const SALES_WINDOW_ORDER_MESSAGE =
  "Sales end must be on or after sales start.";
export const CAPACITY_MESSAGE = "Capacity must be a whole number of at least 1.";
// Sanity ceiling: keeps capacity a meaningful integer instead of an arbitrary
// double (1e308-scale values would still be "valid" without it).
export const MAX_CAPACITY = 1_000_000;
export const CAPACITY_MAX_MESSAGE = "Capacity cannot exceed 1,000,000.";
// Bounds the per-ticket restriction list AND the number of per-id membership
// lookups the ticket routes perform (registration-type-membership.ts).
export const MAX_TICKET_REGISTRATION_TYPES = 25;
export const REGISTRATION_TYPE_SELECTION_MESSAGE = `Select at most ${MAX_TICKET_REGISTRATION_TYPES} registration types.`;

export const entityNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(80, "Keep the name under 80 characters.");

// Validates the raw input (case-insensitively, via normalization) without
// transforming it — used directly by the RHF form schemas.
const codeInputSchema = z
  .string()
  .min(1, "Code is required.")
  .refine((value) => isValidRegistrationCode(value), CODE_FORMAT_MESSAGE);

// API-side code schema: validate, then normalize to the canonical uppercase
// storage form so routes and repos always see the same value.
export const registrationCodeSchema = codeInputSchema.transform(
  normalizeRegistrationCode,
);

// null = Unlimited; numeric capacity must be an integer >= 1 (0 is invalid)
// and <= MAX_CAPACITY.
export const capacitySchema = z
  .number(CAPACITY_MESSAGE)
  .int(CAPACITY_MESSAGE)
  .min(1, CAPACITY_MESSAGE)
  .max(MAX_CAPACITY, CAPACITY_MAX_MESSAGE)
  .nullable();

// ---------------------------------------------------------------------------
// API payload schemas (client + server share these; routes own the cross-doc
// checks: code uniqueness, capacity >= registeredCount, registrationTypeIds
// membership).
// ---------------------------------------------------------------------------

export const registrationTypePayloadSchema = z.object({
  name: entityNameSchema,
  code: registrationCodeSchema,
  capacity: capacitySchema,
});

export type RegistrationTypePayload = z.output<
  typeof registrationTypePayloadSchema
>;

export const SALES_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Round-trip validity check: "2026-02-31" and "2026-13-01" match the shape
// regex, but Date.UTC would silently roll them over to a DIFFERENT day
// (Mar 3 / Jan 1 next year) before persisting. A date is only valid when its
// parts survive the UTC round trip unchanged.
export function isRealCalendarDate(value: string): boolean {
  if (!SALES_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

const salesDateSchema = z
  .string()
  .regex(SALES_DATE_PATTERN, "Use a valid calendar date.")
  .refine(isRealCalendarDate, "Use a valid calendar date.")
  .nullable();

export const ticketTypePayloadSchema = z
  .object({
    name: entityNameSchema,
    code: registrationCodeSchema,
    capacity: capacitySchema,
    // Event-local calendar dates; the route converts them to UTC instants
    // using the event's timezone. null = no bound.
    salesStart: salesDateSchema,
    salesEnd: salesDateSchema,
    isOpen: z.boolean(),
    // Empty = unrestricted ("All registration types").
    registrationTypeIds: z
      .array(z.string().min(1))
      .max(MAX_TICKET_REGISTRATION_TYPES, REGISTRATION_TYPE_SELECTION_MESSAGE)
      .default([]),
  })
  .refine(
    // Calendar-date strings compare lexicographically; equal dates are a
    // valid single-day window (inclusive boundaries).
    (value) =>
      !value.salesStart || !value.salesEnd || value.salesEnd >= value.salesStart,
    { message: SALES_WINDOW_ORDER_MESSAGE, path: ["salesEnd"] },
  );

export type TicketTypePayload = z.output<typeof ticketTypePayloadSchema>;

// ---------------------------------------------------------------------------
// Dialog form schemas (React Hook Form). Capacity is a Switch + text input
// pair; sales dates are native date inputs where "" means no bound.
// ---------------------------------------------------------------------------

const capacityFormFields = {
  limitCapacity: z.boolean(),
  capacity: z.string(),
};

function validateCapacityField(
  value: { limitCapacity: boolean; capacity: string },
  ctx: z.RefinementCtx,
) {
  if (!value.limitCapacity) {
    return;
  }

  const parsed = Number(value.capacity);
  if (
    value.capacity.trim() === "" ||
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    ctx.addIssue({
      code: "custom",
      message: CAPACITY_MESSAGE,
      path: ["capacity"],
    });
    return;
  }

  if (parsed > MAX_CAPACITY) {
    ctx.addIssue({
      code: "custom",
      message: CAPACITY_MAX_MESSAGE,
      path: ["capacity"],
    });
  }
}

export const registrationTypeFormSchema = z
  .object({
    name: entityNameSchema,
    code: codeInputSchema,
    ...capacityFormFields,
  })
  .superRefine(validateCapacityField);

export type RegistrationTypeFormValues = z.infer<
  typeof registrationTypeFormSchema
>;

export const ticketTypeFormSchema = z
  .object({
    name: entityNameSchema,
    code: codeInputSchema,
    ...capacityFormFields,
    salesStart: z.string(),
    salesEnd: z.string(),
    isOpen: z.boolean(),
    registrationTypeIds: z
      .array(z.string())
      .max(MAX_TICKET_REGISTRATION_TYPES, REGISTRATION_TYPE_SELECTION_MESSAGE),
  })
  .superRefine(validateCapacityField)
  .superRefine((value, ctx) => {
    if (value.salesStart && value.salesEnd && value.salesEnd < value.salesStart) {
      ctx.addIssue({
        code: "custom",
        message: SALES_WINDOW_ORDER_MESSAGE,
        path: ["salesEnd"],
      });
    }
  });

export type TicketTypeFormValues = z.infer<typeof ticketTypeFormSchema>;

// Form values -> API payload. Normalization here keeps what the user sees in
// the dialog and what the server stores in lockstep.
export function buildRegistrationTypePayload(
  values: RegistrationTypeFormValues,
) {
  return {
    name: values.name.trim(),
    code: normalizeRegistrationCode(values.code),
    capacity: values.limitCapacity ? Number(values.capacity) : null,
  };
}

export function buildTicketTypePayload(values: TicketTypeFormValues) {
  return {
    name: values.name.trim(),
    code: normalizeRegistrationCode(values.code),
    capacity: values.limitCapacity ? Number(values.capacity) : null,
    salesStart: values.salesStart || null,
    salesEnd: values.salesEnd || null,
    isOpen: values.isOpen,
    registrationTypeIds: values.registrationTypeIds,
  };
}
