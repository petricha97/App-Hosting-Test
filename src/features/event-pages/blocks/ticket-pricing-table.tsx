"use client";

// M4-T1 block 1 — Ticket & Pricing table. Data is INJECTED (never fetched
// here and never author-entered): the server page passes the live
// path-agnostic projection through createEventPagePuckConfig, so prices are
// re-read on every public request (AC-6) and a fetch failure degrades to the
// empty state (AC-8). All props render as React text (AC-17).
//
// Layout (design §1): semantic table ≥640px, stacked cards below — two
// sibling trees toggled with `hidden sm:block` / `sm:hidden` (display:none
// removes the hidden copy from the a11y tree, so screen readers hear one).

import { formatFeePrice } from "@/features/pricing/utils";
import type {
  PublicPricingProjection,
  PublicPricingTicket,
} from "@/features/public-registration/types";
import type { Currency } from "@/types/collection";

export const PRICING_TABLE_DEFAULT_EMPTY_MESSAGE =
  "Tickets will be announced soon.";

interface TicketPricingTableBlockProps {
  title: string;
  intro: string;
  emptyMessage: string;
  // null = data unavailable (load failure or no injection) → empty state.
  projection: PublicPricingProjection | null;
  // Editor-only hint under the empty state ("Add tickets & fees…").
  editorHint?: boolean;
}

function priceLabel(
  ticket: PublicPricingTicket,
  currency: Currency,
): string {
  const price = ticket.prices.find((entry) => entry.currency === currency);
  if (!price) return "—";
  const amount = formatFeePrice(price.minPriceMinor, price.currency);
  return price.isFrom ? `from ${amount}` : amount;
}

function AvailabilityBadge({ soldOut }: { soldOut: boolean }) {
  return soldOut ? (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
      Sold out
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
      Open
    </span>
  );
}

function TicketNameCell({ ticket }: { ticket: PublicPricingTicket }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-950">{ticket.name}</p>
      <p className="font-mono text-xs text-slate-500">{ticket.code}</p>
      {ticket.audienceNames.length > 0 ? (
        <p className="mt-1 text-xs leading-5 text-slate-500">
          For {ticket.audienceNames.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export function TicketPricingTableBlock({
  title,
  intro,
  emptyMessage,
  projection,
  editorHint = false,
}: TicketPricingTableBlockProps) {
  const tickets = projection?.tickets ?? [];
  const currencies = projection?.currencies ?? [];
  const resolvedEmptyMessage =
    emptyMessage.trim().length > 0
      ? emptyMessage
      : PRICING_TABLE_DEFAULT_EMPTY_MESSAGE;

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 sm:px-8">
      <div className="max-w-2xl">
        <h3 className="text-2xl font-semibold text-slate-950">{title}</h3>
        {intro ? (
          <p className="mt-3 text-sm leading-7 text-slate-600">{intro}</p>
        ) : null}
      </div>

      {tickets.length === 0 ? (
        // AC-5: empty state, never a broken/blank table.
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
          <p className="text-sm leading-7 text-slate-600">
            {resolvedEmptyMessage}
          </p>
          {editorHint ? (
            <p className="mt-2 text-xs leading-6 text-slate-500">
              Editor hint: this event has no open, priced tickets yet — add
              tickets &amp; fees under Pricing to fill this table.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {/* ≥640px: semantic table */}
          <div className="mt-6 hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{title} — ticket prices</caption>
              <thead>
                <tr className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    Ticket
                  </th>
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    Availability
                  </th>
                  {currencies.map((currency) => (
                    <th
                      scope="col"
                      key={currency}
                      className="pb-3 pl-4 text-right font-semibold"
                    >
                      {currency}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr
                    key={ticket.code}
                    className="border-t border-slate-200 align-top"
                  >
                    <td className="py-4 pr-4">
                      <TicketNameCell ticket={ticket} />
                    </td>
                    <td className="py-4 pr-4">
                      <AvailabilityBadge soldOut={ticket.soldOut} />
                    </td>
                    {currencies.map((currency) => (
                      <td
                        key={currency}
                        className="py-4 pl-4 text-right text-sm font-semibold tabular-nums text-slate-950"
                      >
                        {priceLabel(ticket, currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* <640px: stacked cards, identical content (AC-18) */}
          <ul className="mt-6 space-y-3 sm:hidden">
            {tickets.map((ticket) => (
              <li
                key={ticket.code}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <TicketNameCell ticket={ticket} />
                  <AvailabilityBadge soldOut={ticket.soldOut} />
                </div>
                <div className="mt-3 space-y-1">
                  {ticket.prices.map((price) => (
                    <p
                      key={price.currency}
                      className="flex items-baseline justify-between text-sm"
                    >
                      <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                        {price.currency}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-950">
                        {priceLabel(ticket, price.currency)}
                      </span>
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
