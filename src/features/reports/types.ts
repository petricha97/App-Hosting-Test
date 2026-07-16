// Plain-data shapes for the M7-T1 reports screen. No Firebase imports — safe
// for client components, server pages, and tests.
// Spec: agents/docs/specs/m7-reporting-summaries.md
// Design: agents/docs/design/m7-reporting-summaries.md

import type { Currency } from "@/types/collection";

// §1 / §6 AC-2 — the exact plain shape the bar chart accepts. Pre-sorted
// descending by count (ties by ticket-type creation order), with the
// synthetic "No ticket type" bucket appended last only when its count > 0.
export interface TicketTypeRegistrationRow {
  label: string;
  count: number;
}

// §2 / §4 — one currency's three money rows (all in minor units, that
// currency's own scope only — never blended across currencies).
export interface CurrencyFinanceSection {
  currency: Currency;
  paidMinor: number;
  outstandingMinor: number;
  compedMinor: number;
}

// §2 / §4 — the finance card's full data shape. `null` at the loader level
// (not here) signals the zero-currency empty state; this type only describes
// the "at least one currency" shape.
export interface FinanceCardData {
  currencies: CurrencyFinanceSection[];
  // Currency-agnostic (§2): rendered once, below every currency section.
  discountCodesUsed: number;
}
