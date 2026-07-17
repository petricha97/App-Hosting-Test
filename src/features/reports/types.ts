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

// ============================================================================
// M7-T2 — Report templates library
// Spec: agents/docs/specs/m7-report-templates.md
// Design: agents/docs/design/m7-report-templates.md
// ============================================================================

// One row of a report template's output. Every value is ALREADY the exact
// string the CSV cell needs (raw ISO datetime strings, pre-formatted money
// via formatMoney, "" for empty/null) — the Run table applies its own
// display formatting (human dates) on top of these same raw values at
// render time (design §3: "two different serializations of the same
// field, by design"). Keyed by each template's column `key` (templates.ts).
export type ReportRow = Record<string, string>;

// One "Run" page (limit 50 + cursor, spec D2). `nextCursorMs` is the last
// row's ordering-field millis (null when the page was empty); `hasMore`
// mirrors every other admin list's "page.length === limit" convention.
export interface ReportPage {
  rows: ReportRow[];
  nextCursorMs: number | null;
  hasMore: boolean;
}
