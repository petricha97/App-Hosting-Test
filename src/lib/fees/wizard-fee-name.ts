// Deterministic Fee.name generator for the M9-T1 "Create ticket" wizard.
// Spec: agents/docs/specs/m9-ticket-wizard.md §4.3.
//
// Why this exists: the wizard collects no free-text "fee name" input — Step
// 2 is only an include-checkbox + a price per registration-type row — so the
// route has to synthesize a name for every Fee it creates. `Fee.name` is a
// required 1-80 char field (entityNameSchema, src/features/registration/
// schemas.ts), so the synthesized string must always fit that bound, not
// just "usually" fit it.
//
// Pure function, no Firebase import — unit-testable standalone and safe to
// import from either the admin DAL (src/lib/db/adminTicketTypeWithPricing.ts)
// or a future client-side live-preview without pulling firebase-admin into a
// client bundle.
import type { Currency } from "@/types/collection";

// Display label for a Fee.registrationTypeId === null row (Fee-model parity
// with the existing Fees tab's "All registration types" convention) — v1
// wizard UI never actually emits a null price row (spec §2), but the DAL
// still needs a label for the forward-compat case.
export const WIZARD_ALL_REGISTRATION_TYPES_LABEL = "All types";

const MAX_FEE_NAME_LENGTH = 80;

// Builds "{ticketName} — {registrationTypeLabel} ({currency})", truncating
// ONLY the ticket/registration-type name portion when the full string would
// exceed Fee.name's 80-char bound.
//
// The trailing "(USD)" currency suffix is NEVER dropped or shortened, even
// under truncation: it is the one thing that distinguishes two otherwise
// identically-named fees on the same ticket in the Fees table (e.g. the same
// ticket priced in two currencies via the pre-existing, unmodified Pricing
// screen). If truncation ever ate the suffix instead of the name, two
// generated fee names could collide even though they price different
// currencies — silently reintroducing the exact ambiguity Fee.name's 80-char
// bound (and this whole naming scheme) exists to avoid. So the suffix length
// is reserved FIRST, and only the remaining budget is given to the name.
export function generateWizardFeeName(
  ticketName: string,
  registrationTypeLabel: string,
  currency: Currency,
): string {
  const suffix = ` (${currency})`;
  const namePortion = `${ticketName} — ${registrationTypeLabel}`;
  const full = `${namePortion}${suffix}`;

  if (full.length <= MAX_FEE_NAME_LENGTH) {
    return full;
  }

  // Reserve the suffix's exact length first, then truncate the name portion
  // to whatever budget remains. trimEnd() avoids a dangling space directly
  // before the suffix when the cut lands mid-whitespace.
  const maxNamePortionLength = Math.max(0, MAX_FEE_NAME_LENGTH - suffix.length);
  const truncatedNamePortion = namePortion
    .slice(0, maxNamePortionLength)
    .trimEnd();
  return `${truncatedNamePortion}${suffix}`;
}
