// Server-side orchestration for the finance summary card (spec §2, §3, §4).
// This layer never touches Firestore directly — it only calls src/lib/db/
// functions and shapes the results into the per-currency FinanceCardData
// shape the presentational card needs (currency enumeration, per-currency
// money sums, the currency-agnostic discount-codes-used count).
//
// BACKEND DEPENDENCY (flagged for Backend review, M7-T1 parallel dispatch):
// this calls a NEW DAL function, `sumAdminOrderTotalsForEvent`, that does not
// exist in src/lib/db/adminOrder.ts as of this file being written. Per the
// spec's Gap analysis ("new sumAdminOrderTotalsForEvent({ eventId,
// organizationId, paymentStatus, currency }) using Firestore's sum()
// aggregate over amounts.totalMinor (for Paid/Outstanding) and a variant
// summing amounts.subtotalMinor (for Comped value) — could be one method
// with a field selector, or two thin wrappers; Backend's call"), this file is
// written against a SINGLE method with an explicit `field` selector:
//
//   sumAdminOrderTotalsForEvent(input: {
//     eventId: string;
//     organizationId: string;
//     paymentStatus: PaymentStatus;
//     currency: Currency;
//     field: "totalMinor" | "subtotalMinor";
//   }): Promise<number>
//
// If Backend ships two thin wrappers instead (e.g.
// sumAdminOrderTotalMinorForEvent / sumAdminOrderSubtotalMinorForEvent), only
// the three call sites below need updating — the shaping logic is unaffected.
import "server-only";

import { getAdminEventPromotionsForEvent } from "@/lib/db/adminEventPromotion";
import { sumAdminOrderTotalsForEvent } from "@/lib/db/adminOrder";
import { getAdminRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import type {
  CurrencyFinanceSection,
  FinanceCardData,
} from "@/features/reports/types";
import type { Currency } from "@/types/collection";

async function loadCurrencySection(input: {
  eventId: string;
  organizationId: string;
  currency: Currency;
}): Promise<CurrencyFinanceSection> {
  const [paidMinor, outstandingMinor, compedMinor] = await Promise.all([
    sumAdminOrderTotalsForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      paymentStatus: "paid",
      currency: input.currency,
      field: "totalMinor",
    }),
    sumAdminOrderTotalsForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      paymentStatus: "outstanding",
      currency: input.currency,
      field: "totalMinor",
    }),
    // Comped value sums subtotalMinor, never totalMinor (spec §2 — a comped
    // order's totalMinor is always 0 by construction).
    sumAdminOrderTotalsForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      paymentStatus: "comped",
      currency: input.currency,
      field: "subtotalMinor",
    }),
  ]);

  return {
    currency: input.currency,
    paidMinor,
    outstandingMinor,
    compedMinor,
  };
}

// Returns null when the event has zero RegistrationPath docs (spec §4: no
// currency to enumerate -> the finance card's own empty state, not a crash).
export async function loadFinanceSummary(input: {
  eventId: string;
  organizationId: string;
}): Promise<FinanceCardData | null> {
  const [paths, promotions] = await Promise.all([
    getAdminRegistrationPathsForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }),
    getAdminEventPromotionsForEvent(input.eventId, input.organizationId),
  ]);

  // Distinct currencies this event actually sells in (spec §4), sorted for a
  // deterministic, stable render order across page loads.
  const currencies = Array.from(
    new Set(paths.map((path) => path.currency)),
  ).sort();

  if (currencies.length === 0) {
    return null;
  }

  const sections = await Promise.all(
    currencies.map((currency) =>
      loadCurrencySection({
        eventId: input.eventId,
        organizationId: input.organizationId,
        currency,
      }),
    ),
  );

  // Distinct codes used at least once (spec §2) — not total redemptions, not
  // a sum of usedCount.
  const discountCodesUsed = promotions.filter(
    (promotion) => promotion.usedCount >= 1,
  ).length;

  return {
    currencies: sections,
    discountCodesUsed,
  };
}
