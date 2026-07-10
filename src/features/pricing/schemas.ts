// Zod schemas for M2 pricing (fees, taxes, discount settings), shared by the
// API routes (payload schemas) and the dialogs (form schemas + builders).
// Spec: agents/docs/specs/m2-pricing-commerce.md.
//
// Money crosses the wire as INTEGER MINOR UNITS and tax rates as INTEGER
// MILLI-PERCENT — the decimal-string parsing below happens once at the form
// boundary in pure integer math (no float multiplication), so no float ever
// reaches a payload or the DAL. Server-owned fields (organizationId, eventId,
// usedCount, timestamps) are absent from every payload schema; Zod strips
// unknown keys, so client-supplied values can never reach the DAL.

import { z } from "zod";

import {
  entityNameSchema,
  isRealCalendarDate,
  SALES_DATE_PATTERN,
} from "@/features/registration/schemas";
import {
  isValidRegistrationCode,
  normalizeRegistrationCode,
} from "@/lib/db/registrationCode";
import { SUPPORTED_CURRENCIES } from "@/types/collection";

export const PRICE_MESSAGE =
  "Enter a non-negative amount with at most 2 decimals, e.g. 750.00.";
// Sanity ceiling in MAJOR units (1 billion) — keeps prices meaningful integers
// far below Number.MAX_SAFE_INTEGER after minor-unit conversion.
export const MAX_PRICE_MAJOR = 1_000_000_000;
export const MAX_PRICE_MINOR = MAX_PRICE_MAJOR * 100;
export const PRICE_MAX_MESSAGE = "Price cannot exceed 1,000,000,000.";

export const RATE_MESSAGE =
  "Enter a rate between 0 and 100 with at most 3 decimals, e.g. 8.875.";

export const CODE_MESSAGE =
  "Use 2-12 characters: letters, digits, hyphen or slash, starting with a letter or digit.";

// Field-level 409 for the active-fee uniqueness rule (spec M2-T1 AC-3).
export const FEE_DUPLICATE_MESSAGE =
  "A fee for this ticket, registration type and currency already exists";

export const USAGE_CAP_MESSAGE = "Cap must be a whole number of at least 1.";
export const MAX_USAGE_CAP = 1_000_000;
export const USAGE_CAP_MAX_MESSAGE = "Cap cannot exceed 1,000,000.";
export const VALIDITY_ORDER_MESSAGE =
  "End date must be on or after the start date.";

// Sentinel used by the fee dialog's registration-type Select for the
// "All registration types" option (Radix Select items cannot be empty).
export const ALL_REGISTRATION_TYPES = "all";

const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const RATE_PATTERN = /^\d{1,3}(\.\d{1,3})?$/;

// "750.00" -> 75000, "750" -> 75000, "0" -> 0. Pure integer math: the whole
// and fractional parts are parsed separately so no float multiplication can
// introduce artifacts. Returns null for anything that is not a non-negative
// amount with <= 2 decimals (or above the sanity ceiling).
export function parsePriceInputToMinor(value: string): number | null {
  const trimmed = value.trim();
  if (!PRICE_PATTERN.test(trimmed)) return null;

  const [whole, fraction = ""] = trimmed.split(".");
  const minor =
    Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor > MAX_PRICE_MINOR) return null;
  return minor;
}

// 75000 -> "750.00" (prefills the fee dialog's major-units price input).
export function formatMinorAsPriceInput(minor: number): string {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

// "8.875" -> 8875, "20" -> 20000, "100" -> 100000. Integer math, <= 3 decimal
// places, 0-100% inclusive. Returns null for invalid input.
export function parseRateInputToMilliPercent(value: string): number | null {
  const trimmed = value.trim();
  if (!RATE_PATTERN.test(trimmed)) return null;

  const [whole, fraction = ""] = trimmed.split(".");
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, "0").slice(0, 3));
  if (milli > 100_000) return null;
  return milli;
}

// 8875 -> "8.875", 20000 -> "20" (prefills the tax dialog's rate input).
export function formatMilliPercentAsRateInput(milliPercent: number): string {
  const whole = Math.floor(milliPercent / 1000);
  const fraction = String(milliPercent % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

const currencySchema = z.enum(SUPPORTED_CURRENCIES);

// Validates the raw code input (case-insensitively) without transforming it —
// used by the tax RHF form schema (mirrors M1's private codeInputSchema).
const taxCodeInputSchema = z
  .string()
  .min(1, "Code is required.")
  .refine((value) => isValidRegistrationCode(value), CODE_MESSAGE);

// Event-local calendar date "YYYY-MM-DD" (same storage rule as M1 sales
// windows: the route converts to UTC instants in the event timezone).
const calendarDateSchema = z
  .string()
  .regex(SALES_DATE_PATTERN, "Use a valid calendar date.")
  .refine(isRealCalendarDate, "Use a valid calendar date.")
  .nullable();

// ---------------------------------------------------------------------------
// API payload schemas (client + server share these; routes own the cross-doc
// checks: ticket/regType membership, fee uniqueness, tax code uniqueness,
// usage cap >= usedCount, order-reference delete blocks).
// ---------------------------------------------------------------------------

export const feePayloadSchema = z.object({
  name: entityNameSchema,
  ticketTypeId: z.string().min(1, "Choose a ticket."),
  // null = all registration types (stored explicitly as null).
  registrationTypeId: z.string().min(1).nullable(),
  currency: currencySchema,
  basePriceMinor: z
    .number(PRICE_MESSAGE)
    .int(PRICE_MESSAGE)
    .min(0, PRICE_MESSAGE)
    .max(MAX_PRICE_MINOR, PRICE_MAX_MESSAGE),
  status: z.enum(["active", "archived"]).default("active"),
});

export type FeePayload = z.output<typeof feePayloadSchema>;

const taxPayloadBase = {
  name: entityNameSchema,
  code: taxCodeInputSchema.transform(normalizeRegistrationCode),
  isActive: z.boolean().default(true),
};

// Exactly one type-specific field group per tax (discriminated union) — the
// DAL forces the unused group to null on write.
export const taxPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    ...taxPayloadBase,
    type: z.literal("percentage"),
    rateMilliPercent: z
      .number(RATE_MESSAGE)
      .int(RATE_MESSAGE)
      .min(0, RATE_MESSAGE)
      .max(100_000, RATE_MESSAGE),
  }),
  z.object({
    ...taxPayloadBase,
    type: z.literal("fixed"),
    fixedAmountMinor: z
      .number(PRICE_MESSAGE)
      .int(PRICE_MESSAGE)
      .min(0, PRICE_MESSAGE)
      .max(MAX_PRICE_MINOR, PRICE_MAX_MESSAGE),
    fixedCurrency: currencySchema,
  }),
]);

export type TaxPayload = z.output<typeof taxPayloadSchema>;

// Lightweight PATCH shape for the Taxes tab's inline Active toggle
// (spec M2-T3 AC-3) — strict so it never shadows a malformed full payload.
export const taxActiveToggleSchema = z.strictObject({
  isActive: z.boolean(),
});

// The M2-new discount fields ONLY (spec M2-T2). usedCount is deliberately
// absent: it is server-owned and the DAL strips it defensively as well.
export const discountSettingsPayloadSchema = z
  .object({
    level: z.enum(["event", "partner"]),
    validityStart: calendarDateSchema,
    validityEnd: calendarDateSchema,
    usageCap: z
      .number(USAGE_CAP_MESSAGE)
      .int(USAGE_CAP_MESSAGE)
      .min(1, USAGE_CAP_MESSAGE)
      .max(MAX_USAGE_CAP, USAGE_CAP_MAX_MESSAGE)
      .nullable(),
    isActive: z.boolean(),
  })
  .refine(
    // Calendar-date strings compare lexicographically; equal dates are a
    // valid single-day window (inclusive boundaries).
    (value) =>
      !value.validityStart ||
      !value.validityEnd ||
      value.validityEnd >= value.validityStart,
    { message: VALIDITY_ORDER_MESSAGE, path: ["validityEnd"] },
  );

export type DiscountSettingsPayload = z.output<
  typeof discountSettingsPayloadSchema
>;

// ---------------------------------------------------------------------------
// Dialog form schemas (React Hook Form) + payload builders. Prices and rates
// are text inputs validated as decimal strings, converted to integers once.
// ---------------------------------------------------------------------------

export const feeFormSchema = z.object({
  name: entityNameSchema,
  ticketTypeId: z.string().min(1, "Choose a ticket."),
  // ALL_REGISTRATION_TYPES sentinel = "All registration types".
  registrationTypeId: z.string().min(1),
  currency: currencySchema,
  price: z
    .string()
    .refine((value) => parsePriceInputToMinor(value) !== null, PRICE_MESSAGE),
  active: z.boolean(),
});

export type FeeFormValues = z.infer<typeof feeFormSchema>;

export function buildFeePayload(values: FeeFormValues) {
  return {
    name: values.name.trim(),
    ticketTypeId: values.ticketTypeId,
    registrationTypeId:
      values.registrationTypeId === ALL_REGISTRATION_TYPES
        ? null
        : values.registrationTypeId,
    currency: values.currency,
    // Validated by the schema refine above — never null here.
    basePriceMinor: parsePriceInputToMinor(values.price) ?? 0,
    status: values.active ? "active" : "archived",
  };
}

export const taxFormSchema = z
  .object({
    name: entityNameSchema,
    code: taxCodeInputSchema,
    type: z.enum(["percentage", "fixed"]),
    rate: z.string(),
    fixedAmount: z.string(),
    fixedCurrency: currencySchema,
    isActive: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "percentage") {
      if (parseRateInputToMilliPercent(value.rate) === null) {
        ctx.addIssue({ code: "custom", message: RATE_MESSAGE, path: ["rate"] });
      }
      return;
    }
    if (parsePriceInputToMinor(value.fixedAmount) === null) {
      ctx.addIssue({
        code: "custom",
        message: PRICE_MESSAGE,
        path: ["fixedAmount"],
      });
    }
  });

export type TaxFormValues = z.infer<typeof taxFormSchema>;

export function buildTaxPayload(values: TaxFormValues) {
  const base = {
    name: values.name.trim(),
    code: normalizeRegistrationCode(values.code),
    isActive: values.isActive,
  };
  if (values.type === "percentage") {
    return {
      ...base,
      type: "percentage" as const,
      rateMilliPercent: parseRateInputToMilliPercent(values.rate) ?? 0,
    };
  }
  return {
    ...base,
    type: "fixed" as const,
    fixedAmountMinor: parsePriceInputToMinor(values.fixedAmount) ?? 0,
    fixedCurrency: values.fixedCurrency,
  };
}

export const discountSettingsFormSchema = z
  .object({
    level: z.enum(["event", "partner"]),
    validityStart: z.string(),
    validityEnd: z.string(),
    limitUsage: z.boolean(),
    usageCap: z.string(),
    isActive: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.limitUsage) {
      const parsed = Number(value.usageCap);
      if (
        value.usageCap.trim() === "" ||
        !Number.isInteger(parsed) ||
        parsed < 1
      ) {
        ctx.addIssue({
          code: "custom",
          message: USAGE_CAP_MESSAGE,
          path: ["usageCap"],
        });
      } else if (parsed > MAX_USAGE_CAP) {
        ctx.addIssue({
          code: "custom",
          message: USAGE_CAP_MAX_MESSAGE,
          path: ["usageCap"],
        });
      }
    }
    if (
      value.validityStart &&
      value.validityEnd &&
      value.validityEnd < value.validityStart
    ) {
      ctx.addIssue({
        code: "custom",
        message: VALIDITY_ORDER_MESSAGE,
        path: ["validityEnd"],
      });
    }
  });

export type DiscountSettingsFormValues = z.infer<
  typeof discountSettingsFormSchema
>;

export function buildDiscountSettingsPayload(
  values: DiscountSettingsFormValues,
) {
  return {
    level: values.level,
    validityStart: values.validityStart || null,
    validityEnd: values.validityEnd || null,
    usageCap: values.limitUsage ? Number(values.usageCap) : null,
    isActive: values.isActive,
  };
}
