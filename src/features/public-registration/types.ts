// Client-safe types shared by the public multi-step registration flow
// (M3-T3): the API projections the stepper consumes and the serialized flow
// config the server page hands across the RSC boundary. NO Firebase imports.

import type {
  Currency,
  PaymentMethod,
  RegistrationDraftStep,
} from "@/types/collection";
import type { FormFieldValues } from "@/features/form/schema";

// Coarse public capacity bucket — exact counts never leave the server.
export type PublicTicketAvailability = "available" | "low" | "sold_out";

// One radio-card option from GET /registration/tickets (public-safe
// projection — no capacities, counts, fee ids or raw eligibility arrays).
export interface PublicTicketOption {
  id: string;
  name: string;
  code: string;
  // Exact price for unambiguous tickets; for ambiguous tickets (options
  // present) this is the MINIMUM across the options — a "from" price the
  // client replaces with the picked option's exact price (T2 AC-5).
  priceMinor: number;
  currency: Currency;
  availability: PublicTicketAvailability;
  // Present ONLY for Any-audience paths whose ticket is ambiguous: the
  // "Register as" picker options, each with its server-resolved price so the
  // displayed price always matches the eventual quote for that pick.
  registrationTypeOptions?: Array<{ id: string; name: string; priceMinor: number }>;
}

export interface PublicQuoteTaxLine {
  code: string;
  amountMinor: number;
}

// Server-computed quote (POST /registration/quote) — the ONLY money the
// client ever displays (T3 AC-5).
export interface PublicRegistrationQuote {
  currency: Currency;
  subtotalMinor: number;
  discountMinor: number;
  taxLines: PublicQuoteTaxLine[];
  taxMinor: number;
  totalMinor: number;
  promoApplied: boolean;
}

// Flow config the register page hands to the client stepper. paymentMethod /
// currency here are DISPLAY ONLY — finalize re-reads them from the path doc
// server-side (T3 AC-6).
export interface SerializedFlowPath {
  id: string;
  name: string;
  paymentMethod: PaymentMethod;
  currency: Currency;
}

// GET /registration/draft resume payload.
export interface DraftResumeState {
  draftId: string;
  pathId: string;
  lastStepReached: RegistrationDraftStep;
  stepAnswers: Record<string, string>;
  ticketTypeId: string | null;
  registrationTypeId: string | null;
  promoApplied: boolean;
}

// POST /registration/finalize success payload.
export interface FinalizeSuccess {
  registrationRef: string;
  orderRef: string;
  paymentStatus: string;
  amounts: {
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
  currency: Currency;
}

// Commerce field configs pulled off the published form for step 2 display.
export type CommerceFieldConfig = Pick<
  FormFieldValues,
  "label" | "helpText" | "placeholder" | "required"
>;

// ============================================================================
// M4-T1 — TicketPricingTable block (path-agnostic pricing projection).
// Public-safe by construction (M4 AC-7): name/code/price/currency/
// availability/audience-names ONLY — never capacity, registeredCount, raw
// internal ids, or sales timestamps.
// ============================================================================

// One ticket price in one currency: the MINIMUM basePriceMinor across the
// ticket's active fees in that currency; isFrom when >1 distinct amount
// prices it there (per-registration-type fees differ) — rendered "from $X".
export interface PublicPricingPrice {
  currency: Currency;
  minPriceMinor: number;
  isFrom: boolean;
}

// One row of the public pricing table. Sold-out tickets are included and
// badged (M3 parity) — only derived-closed / unpriced tickets are hidden.
export interface PublicPricingTicket {
  name: string;
  code: string;
  soldOut: boolean;
  // Names of the audiences the ticket is restricted to; empty = everyone.
  // Eligibility never hides rows here — the register flow enforces it.
  audienceNames: string[];
  prices: PublicPricingPrice[];
}

export interface PublicPricingProjection {
  // Currencies in first-appearance order across the rows — the table columns.
  currencies: Currency[];
  tickets: PublicPricingTicket[];
}
