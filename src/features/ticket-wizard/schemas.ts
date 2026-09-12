// Zod schema for the M9-T1 "Create ticket" wizard's atomic submit payload.
// Spec: agents/docs/specs/m9-ticket-wizard.md §3.1.
//
// New feature folder — deliberately NOT appended to
// src/features/registration/schemas.ts or src/features/pricing/schemas.ts
// (spec §7). This schema needs constants from BOTH of those modules
// (entityNameSchema / registrationCodeSchema / capacitySchema /
// SALES_DATE_PATTERN / isRealCalendarDate / MAX_TICKET_REGISTRATION_TYPES /
// REGISTRATION_TYPE_SELECTION_MESSAGE / SALES_WINDOW_ORDER_MESSAGE from
// registration/schemas.ts; MAX_PRICE_MINOR from pricing/schemas.ts) — and
// pricing/schemas.ts already imports FROM registration/schemas.ts, so a new
// module importing from registration/schemas.ts back into pricing/schemas.ts
// would be circular. A fresh leaf module avoids that without touching either
// existing file's import graph.
//
// Server-owned fields (registeredCount, organizationId, eventId,
// timestamps, and — deliberately — registrationTypeIds itself, which the
// route always DERIVES from `prices` server-side, see below) are absent
// from this schema; Zod strips unknown keys by default, matching every
// other M1/M2 payload schema's convention, so a client-supplied
// registrationTypeIds/organizationId/etc. can never reach the DAL.
//
// This file is pure (no Firebase import) — safe to import from the new
// route AND from client components (the wizard dialog / step forms).
import { z } from "zod";

import {
  CAPACITY_MAX_MESSAGE,
  CAPACITY_MESSAGE,
  capacitySchema,
  CODE_FORMAT_MESSAGE,
  entityNameSchema,
  isRealCalendarDate,
  MAX_CAPACITY,
  MAX_TICKET_REGISTRATION_TYPES,
  REGISTRATION_TYPE_SELECTION_MESSAGE,
  registrationCodeSchema,
  SALES_DATE_PATTERN,
  SALES_WINDOW_ORDER_MESSAGE,
} from "@/features/registration/schemas";
import { MAX_PRICE_MINOR, PRICE_MESSAGE } from "@/features/pricing/schemas";

// Locally-rebuilt calendar-date schema (mirrors how pricing/schemas.ts
// builds its own private calendarDateSchema, §3.1): registration/
// schemas.ts's equivalent (salesDateSchema) is a private, UNEXPORTED const,
// so every other consumer that needs the identical shape/messages rebuilds
// it from the two exported pieces (SALES_DATE_PATTERN + isRealCalendarDate)
// rather than duplicating the regex/round-trip-validity logic by hand.
const calendarDateSchema = z
  .string()
  .regex(SALES_DATE_PATTERN, "Use a valid calendar date.")
  .refine(isRealCalendarDate, "Use a valid calendar date.")
  .nullable();

export const ticketWithPricingPayloadSchema = z
  .object({
    // Identical field set to ticketTypePayloadSchema minus
    // registrationTypeIds (that moves into `prices` below, coupled to
    // price — spec §2 Step 1/Step 2 split).
    name: entityNameSchema,
    code: registrationCodeSchema,
    capacity: capacitySchema,
    // Event-local calendar dates; the route converts them to UTC instants
    // using the event's timezone (same rule/messages as
    // ticketTypePayloadSchema.salesStart/salesEnd).
    salesStart: calendarDateSchema,
    salesEnd: calendarDateSchema,
    isOpen: z.boolean(),
    prices: z
      .array(
        z.object({
          // null is reserved for a future "All registration types" row
          // (Fee-model parity with Fee.registrationTypeId === null) — v1 UI
          // never sends null; a non-null id must belong to this event,
          // re-verified inside the transaction regardless (spec §4).
          registrationTypeId: z.string().min(1).nullable(),
          // Same integer-minor-units contract as Fee.basePriceMinor: >= 0,
          // <= MAX_PRICE_MINOR. 0 is a valid, deliberate "Comp" price.
          basePriceMinor: z.number().int().min(0).max(MAX_PRICE_MINOR),
        }),
      )
      // Same ceiling as ticketTypePayloadSchema.registrationTypeIds — one
      // price row per eligible registration type, same reasoning (bounds
      // both the payload size AND the per-id membership reads in §4).
      .max(MAX_TICKET_REGISTRATION_TYPES, REGISTRATION_TYPE_SELECTION_MESSAGE)
      .default([]),
  })
  .refine(
    // Calendar-date strings compare lexicographically; equal dates are a
    // valid single-day window (inclusive boundaries) — same rule as
    // ticketTypePayloadSchema.
    (value) =>
      !value.salesStart ||
      !value.salesEnd ||
      value.salesEnd >= value.salesStart,
    { message: SALES_WINDOW_ORDER_MESSAGE, path: ["salesEnd"] },
  )
  .refine(
    // Reject duplicate registrationTypeId entries (including two `null`s) —
    // the wizard UI can never produce this (one row per registration
    // type), but the payload is client-controlled, so the route must not
    // silently accept/collapse a tampered duplicate into two Fee docs for
    // the same combination.
    (value) => {
      const keys = value.prices.map((p) => p.registrationTypeId ?? "\0null");
      return new Set(keys).size === keys.length;
    },
    {
      message: "Each registration type can only be priced once",
      path: ["prices"],
    },
  );

export type TicketWithPricingPayload = z.output<
  typeof ticketWithPricingPayloadSchema
>;

// Re-exported so the wizard's client-side RHF step schemas (below, and the
// wizard components) can import everything they need from this one module
// instead of reaching back into both registration/schemas.ts and
// pricing/schemas.ts individually — this file is the wizard feature's single
// schema entry point.
export {
  CAPACITY_MAX_MESSAGE,
  CAPACITY_MESSAGE,
  capacitySchema,
  CODE_FORMAT_MESSAGE,
  entityNameSchema,
  isRealCalendarDate,
  MAX_CAPACITY,
  MAX_TICKET_REGISTRATION_TYPES,
  REGISTRATION_TYPE_SELECTION_MESSAGE,
  registrationCodeSchema,
  SALES_DATE_PATTERN,
  SALES_WINDOW_ORDER_MESSAGE,
} from "@/features/registration/schemas";
export {
  formatMinorAsPriceInput,
  MAX_PRICE_MAJOR,
  MAX_PRICE_MINOR,
  parsePriceInputToMinor,
  PRICE_MAX_MESSAGE,
  PRICE_MESSAGE,
} from "@/features/pricing/schemas";

// --- Full-Stack: wizard step RHF schemas go below this line ---

import {
  isValidRegistrationCode,
  normalizeRegistrationCode as normalizeCode,
} from "@/lib/db/registrationCode";
import { parsePriceInputToMinor as parsePriceInputToMinorLocal } from "@/features/pricing/schemas";

// Locked per spec §0: the wizard never shows a currency picker — every price
// row it collects is in this one fixed currency. Kept as a client-safe
// constant here (NOT imported from adminTicketTypeWithPricing.ts, which is
// "server-only" and would break the client bundle) so every wizard component
// references the single source of truth instead of a re-typed "USD" literal.
export const WIZARD_DEFAULT_CURRENCY = "USD" as const;

// ---------------------------------------------------------------------------
// Step 1 — Ticket details (RHF form schema).
//
// Deliberately the SAME field/validation shape as ticketTypeFormSchema
// (src/features/registration/schemas.ts) MINUS registrationTypeIds, which
// this wizard moves to Step 2, coupled to price (spec §2). The capacity
// superRefine and sales-window-order superRefine below are re-implemented
// (not imported) because ticketTypeFormSchema's own validateCapacityField
// helper is a private, unexported function in that module — same "rebuild
// from exported primitives" convention this file's header already documents
// for calendarDateSchema.
// ---------------------------------------------------------------------------
export const ticketWizardDetailsFormSchema = z
  .object({
    name: entityNameSchema,
    // Un-normalized input schema (matches registration/schemas.ts's private
    // codeInputSchema convention) — normalization to canonical uppercase
    // happens once, in buildTicketWizardDetailsPayload below.
    code: z
      .string()
      .min(1, "Code is required.")
      .refine((value) => isValidRegistrationCode(value), CODE_FORMAT_MESSAGE),
    limitCapacity: z.boolean(),
    capacity: z.string(),
    scheduleSales: z.boolean(),
    salesStart: z.string(),
    salesEnd: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.limitCapacity) {
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
      } else if (parsed > MAX_CAPACITY) {
        ctx.addIssue({
          code: "custom",
          message: CAPACITY_MAX_MESSAGE,
          path: ["capacity"],
        });
      }
    }
  })
  .superRefine((value, ctx) => {
    if (!value.scheduleSales) return;
    for (const field of ["salesStart", "salesEnd"] as const) {
      if (value[field] && !isRealCalendarDate(value[field])) {
        ctx.addIssue({
          code: "custom",
          message: "Use a valid calendar date.",
          path: [field],
        });
      }
    }
    if (
      value.salesStart &&
      value.salesEnd &&
      value.salesEnd < value.salesStart
    ) {
      ctx.addIssue({
        code: "custom",
        message: SALES_WINDOW_ORDER_MESSAGE,
        path: ["salesEnd"],
      });
    }
  });

export type TicketWizardDetailsFormValues = z.infer<
  typeof ticketWizardDetailsFormSchema
>;

// Step 1 form values -> the ticket-fields portion of the final POST payload
// (everything ticketWithPricingPayloadSchema needs except `prices`, which
// Step 2's audience rows supply separately — see
// buildTicketWithPricingRequestPayload below).
export function buildTicketWizardDetailsPayload(
  values: TicketWizardDetailsFormValues,
) {
  return {
    name: values.name.trim(),
    code: normalizeCode(values.code),
    capacity: values.limitCapacity ? Number(values.capacity) : null,
    salesStart: values.scheduleSales ? values.salesStart || null : null,
    salesEnd: values.scheduleSales ? values.salesEnd || null : null,
    isOpen: true,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — Audience + price row (client-side-only shape; not sent as-is).
//
// One row per RegistrationType shown in the table (real rows only — no "All
// registration types" sentinel, spec §2). `included` drives whether `price`
// is required: an unchecked row's price is never validated or sent.
// ---------------------------------------------------------------------------
export interface TicketWizardAudienceRow {
  registrationTypeId: string;
  name: string;
  code: string;
  included: boolean;
  // Major-unit decimal string, e.g. "750.00" — same input convention as the
  // Fee dialog's price field (pricing/schemas.ts's parsePriceInputToMinor).
  price: string;
  // A draft default gets a real id only when the organiser explicitly continues.
  isDefaultDraft?: boolean;
  capacity?: number | null;
}

// Required-price-when-checked validation (spec §6 edge case 5): the wire
// contract has no way to represent "included but unpriced," so this is
// enforced client-side before Step 3 is reachable, not by the route. Returns
// a map of registrationTypeId -> error message for every checked row whose
// price does not parse as a valid amount.
export function validateTicketWizardAudienceRows(
  rows: readonly TicketWizardAudienceRow[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  const includedCount = rows.filter((row) => row.included).length;
  if (includedCount === 0)
    errors.audience = "Select at least one registration type.";
  if (includedCount > MAX_TICKET_REGISTRATION_TYPES)
    errors.audience = REGISTRATION_TYPE_SELECTION_MESSAGE;
  for (const row of rows) {
    if (row.included && parsePriceInputToMinorLocal(row.price) === null) {
      errors[row.registrationTypeId] = PRICE_MESSAGE;
    }
  }
  return errors;
}

// Assembles the exact POST body for /tickets/with-pricing from Step 1's
// values and Step 2's rows — unchecked rows are dropped entirely (they were
// never part of the ticket's audience), matching how the route derives
// TicketType.registrationTypeIds from `prices` alone (spec §3.1).
export function buildTicketWithPricingRequestPayload(
  details: TicketWizardDetailsFormValues,
  rows: readonly TicketWizardAudienceRow[],
) {
  return {
    ...buildTicketWizardDetailsPayload(details),
    prices: rows
      .filter((row) => row.included)
      .map((row) => ({
        registrationTypeId: row.registrationTypeId,
        basePriceMinor: parsePriceInputToMinorLocal(row.price) ?? 0,
      })),
  };
}
