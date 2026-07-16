// M6-T4 — TicketPricingTable block, email-safe render (spec §1 table). The
// web version is already a semantic <table> but styled with Tailwind
// utilities (rounded corners, a `hidden sm:block`/`sm:hidden` responsive
// card/table swap) Outlook's Word engine does not honor — this is a
// from-scratch plain table with inline styles and no responsive alternate
// layout (one table for every client — a fully acceptable, common email
// pattern; spec §1).
//
// FRESHNESS DIVERGENCE (spec §1 AC-9): `pricing` is a SNAPSHOT the caller
// resolved at render/send time — this module never fetches and never
// re-reads. A ticket price changed after a send does not retroactively
// change an already-delivered email; only a fresh render reflects the new
// price.
import "server-only";

import { escapeHtml } from "@/lib/email/merge-tags";
import { formatFeePrice } from "@/features/pricing/utils";
import type {
  PublicPricingProjection,
  PublicPricingTicket,
} from "@/features/public-registration/types";
import type { Currency } from "@/types/collection";

import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedLongText, escapedShortText } from "./text-utils";

const DEFAULT_EMPTY_MESSAGE = "Tickets will be announced soon.";

function priceLabel(ticket: PublicPricingTicket, currency: Currency): string {
  const price = ticket.prices.find((entry) => entry.currency === currency);
  if (!price) return "—";
  const amount = formatFeePrice(price.minPriceMinor, price.currency);
  return price.isFrom ? `from ${amount}` : amount;
}

export function renderTicketPricingTableBlockHtml(
  props: Record<string, unknown>,
  pricing: PublicPricingProjection | null | undefined,
): string {
  const title = escapedShortText(props.title);
  const intro = escapedLongText(props.intro);
  const emptyMessageRaw = escapedShortText(props.emptyMessage);
  const emptyMessage =
    emptyMessageRaw.length > 0 ? emptyMessageRaw : DEFAULT_EMPTY_MESSAGE;

  const headHtml =
    (title
      ? `<h2 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${title}</h2>`
      : "") +
    (intro
      ? `<p style="margin:0;font-size:14px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${intro}</p>`
      : "");

  const tickets = pricing?.tickets ?? [];
  const currencies = pricing?.currencies ?? [];

  if (tickets.length === 0) {
    return emailBlockCard(
      `${headHtml}<p style="margin-top:16px;font-size:14px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${emptyMessage}</p>`,
    );
  }

  const headerCellsHtml =
    `<th align="left" style="padding:0 8px 10px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_BLOCK_COLORS.disabledText};">Ticket</th>` +
    `<th align="left" style="padding:0 8px 10px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_BLOCK_COLORS.disabledText};">Availability</th>` +
    currencies
      .map(
        (currency) =>
          `<th align="right" style="padding:0 0 10px 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_BLOCK_COLORS.disabledText};">${escapeHtml(currency)}</th>`,
      )
      .join("");

  const rowsHtml = tickets
    .map((ticket) => {
      // Ticket/fee data flows from Firestore (TicketType/Fee docs), not
      // directly from a block prop the write-time schema above validates —
      // still escaped here (spec §3.1 step 3's "every interpolation site",
      // independent of source) before ever reaching HTML.
      const name = escapeHtml(ticket.name);
      const code = escapeHtml(ticket.code);
      const audience =
        ticket.audienceNames.length > 0
          ? escapeHtml(`For ${ticket.audienceNames.join(", ")}`)
          : "";
      // Enum-shaped boolean -> a fixed, pre-built HTML fragment (switch/
      // lookup, never a ternary embedded INSIDE a style attribute) — spec
      // §3.1 step 2's "mapped, in code, to a fixed, reviewed set of inline
      // styles... via switch/lookup only" applied literally: the branch
      // happens in plain control flow, not inside a template interpolation.
      const availabilityHtml = ticket.soldOut
        ? `<span style="font-size:12px;font-weight:700;color:${EMAIL_BLOCK_COLORS.disabledText};">Sold out</span>`
        : `<span style="font-size:12px;font-weight:700;color:${EMAIL_BLOCK_COLORS.accentBg};">Open</span>`;

      const priceCells = currencies
        .map(
          (currency) =>
            `<td align="right" style="padding:12px 0 12px 8px;font-size:14px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};border-top:1px solid ${EMAIL_BLOCK_COLORS.border};">${escapeHtml(priceLabel(ticket, currency))}</td>`,
        )
        .join("");

      return (
        `<tr>` +
        `<td style="padding:12px 8px 12px 0;border-top:1px solid ${EMAIL_BLOCK_COLORS.border};">` +
        `<p style="margin:0;font-size:14px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${name}</p>` +
        `<p style="margin:2px 0 0 0;font-size:12px;color:${EMAIL_BLOCK_COLORS.disabledText};">${code}</p>` +
        (audience
          ? `<p style="margin:2px 0 0 0;font-size:12px;color:${EMAIL_BLOCK_COLORS.disabledText};">${audience}</p>`
          : "") +
        `</td>` +
        `<td style="padding:12px 8px;border-top:1px solid ${EMAIL_BLOCK_COLORS.border};">${availabilityHtml}</td>` +
        priceCells +
        `</tr>`
      );
    })
    .join("");

  const tableHtml =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:16px;">` +
    `<thead><tr>${headerCellsHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;

  return emailBlockCard(`${headHtml}${tableHtml}`);
}

export function ticketPricingTableBlockTextLines(
  props: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  const title = typeof props.title === "string" ? props.title.trim() : "";
  const intro = typeof props.intro === "string" ? props.intro.trim() : "";
  if (title) lines.push(title);
  if (intro) lines.push(intro);
  // Spec §3.3's own literal example for a non-text-bearing block: a short
  // descriptive line pointing back at the live page rather than trying to
  // reproduce the whole table as text.
  lines.push("View current ticket pricing: {event_url}");
  return lines;
}
