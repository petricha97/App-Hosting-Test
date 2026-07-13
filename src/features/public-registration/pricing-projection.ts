// Pure builder for the M4-T1 TicketPricingTable projection — the
// path-agnostic sibling of listPublicTicketsForPath (M3). No Firebase
// imports: plain inputs with millisecond timestamps so the rules are unit
// testable and the server loader (server/tickets.ts) stays a thin adapter.
//
// Rules (spec agents/docs/specs/m4-website-blocks.md, T1 block 1):
// - Row shows when the ticket is (a) derived-open per M1 (isOpen + inclusive
//   sales window — AC-1) and (b) priced by ≥1 ACTIVE fee in ≥1 currency
//   (AC-2). Eligibility never hides a row — audience names render as a
//   caption instead.
// - Per currency that prices the ticket: MINIMUM basePriceMinor across that
//   ticket's active fees in the currency; marked isFrom when >1 DISTINCT
//   amount exists there (AC-3).
// - Sold-out tickets stay listed with soldOut=true (AC-4) — never hidden.
// - Output is public-safe by construction (AC-7): rows are rebuilt with an
//   exact key list — no capacity, registeredCount, internal ids, or sales
//   timestamps can leak through.

import { isTicketOpen } from "@/features/registration/utils";
import type { Currency } from "@/types/collection";
import type {
  PublicPricingPrice,
  PublicPricingProjection,
  PublicPricingTicket,
} from "@/features/public-registration/types";

export interface PricingProjectionTicketInput {
  id: string;
  name: string;
  code: string;
  capacity: number | null;
  registeredCount: number;
  isOpen: boolean;
  salesStartMs: number | null;
  salesEndMs: number | null;
  registrationTypeIds: string[];
}

export interface PricingProjectionFeeInput {
  ticketTypeId: string;
  registrationTypeId: string | null;
  currency: Currency;
  basePriceMinor: number;
  status: "active" | "archived";
}

export function buildPublicPricingProjection(input: {
  tickets: PricingProjectionTicketInput[];
  fees: PricingProjectionFeeInput[];
  registrationTypes: Array<{ id: string; name: string }>;
  nowMs: number;
}): PublicPricingProjection {
  const typeNameById = new Map(
    input.registrationTypes.map((type) => [type.id, type.name]),
  );

  const activeFeesByTicket = new Map<string, PricingProjectionFeeInput[]>();
  for (const fee of input.fees) {
    if (fee.status !== "active") continue;
    const list = activeFeesByTicket.get(fee.ticketTypeId);
    if (list) {
      list.push(fee);
    } else {
      activeFeesByTicket.set(fee.ticketTypeId, [fee]);
    }
  }

  const currencies: Currency[] = [];
  const rows: PublicPricingTicket[] = [];

  for (const ticket of input.tickets) {
    // AC-1: derived-closed tickets hidden (manual flag, before salesStart,
    // after salesEnd; boundaries inclusive per M1).
    if (
      !isTicketOpen(
        {
          isOpen: ticket.isOpen,
          salesStartMs: ticket.salesStartMs,
          salesEndMs: ticket.salesEndMs,
        },
        input.nowMs,
      )
    ) {
      continue;
    }

    const fees = activeFeesByTicket.get(ticket.id) ?? [];
    // AC-2: no active fee in any currency → hidden.
    if (fees.length === 0) continue;

    // Group amounts by currency, preserving fee order for first-appearance
    // currency ordering.
    const amountsByCurrency = new Map<Currency, number[]>();
    for (const fee of fees) {
      const amounts = amountsByCurrency.get(fee.currency);
      if (amounts) {
        amounts.push(fee.basePriceMinor);
      } else {
        amountsByCurrency.set(fee.currency, [fee.basePriceMinor]);
      }
    }

    const prices: PublicPricingPrice[] = [];
    for (const [currency, amounts] of amountsByCurrency) {
      if (!currencies.includes(currency)) currencies.push(currency);
      const distinct = new Set(amounts);
      prices.push({
        currency,
        minPriceMinor: Math.min(...amounts),
        // AC-3: "from" only when the amounts actually differ.
        isFrom: distinct.size > 1,
      });
    }

    // Exact-key public projection (AC-7): nothing else from the ticket doc
    // can reach the client.
    rows.push({
      name: ticket.name,
      code: ticket.code,
      soldOut:
        ticket.capacity !== null &&
        ticket.capacity - ticket.registeredCount <= 0,
      audienceNames: ticket.registrationTypeIds
        .map((id) => typeNameById.get(id))
        .filter((name): name is string => typeof name === "string"),
      prices,
    });
  }

  return { currencies, tickets: rows };
}
