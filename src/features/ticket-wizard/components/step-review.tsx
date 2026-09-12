"use client";

// Read-only publication summary uses the same payload builder as submission so
// hidden or disabled options cannot leave misleading dates or quantities here.
import { formatFeePrice } from "@/features/pricing/utils";
import {
  buildTicketWizardDetailsPayload,
  parsePriceInputToMinor,
  WIZARD_DEFAULT_CURRENCY,
  type TicketWizardAudienceRow,
  type TicketWizardDetailsFormValues,
} from "@/features/ticket-wizard/schemas";

interface StepReviewProps {
  details: TicketWizardDetailsFormValues;
  rows: TicketWizardAudienceRow[];
  timeZone: string;
}

/** Shows the exact ticket details, chosen audiences, and prices that will be published. */
export function StepReview({ details, rows, timeZone }: StepReviewProps) {
  const ticket = buildTicketWizardDetailsPayload(details);
  const sales =
    !ticket.salesStart && !ticket.salesEnd
      ? "Starts on publish · No end date"
      : `${ticket.salesStart || "Starts on publish"} → ${ticket.salesEnd || "No end date"}`;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Ready to publish</h3>
        <p className="text-sm text-muted-foreground">
          Check the details before making this ticket available.
        </p>
      </div>
      <dl className="divide-y divide-border rounded-lg border border-border px-4 text-sm">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">Ticket</dt>
          <dd className="break-words text-right font-medium">{ticket.name}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">Ticket quantity</dt>
          <dd>
            {ticket.capacity === null
              ? "Unlimited"
              : `${ticket.capacity} tickets`}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">Sales</dt>
          <dd className="text-right">
            {sales}
            {ticket.salesStart || ticket.salesEnd ? (
              <span className="block text-xs text-muted-foreground">
                {timeZone}
              </span>
            ) : null}
          </dd>
        </div>
        {rows
          .filter((row) => row.included)
          .map((row) => (
            <div
              key={row.registrationTypeId}
              className="flex justify-between gap-4 py-3"
            >
              <dt className="break-words text-muted-foreground">
                {row.name}
                {row.capacity != null ? (
                  <span className="block text-xs">
                    Audience limit: {row.capacity} across all tickets
                  </span>
                ) : null}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatFeePrice(
                  parsePriceInputToMinor(row.price) ?? 0,
                  WIZARD_DEFAULT_CURRENCY,
                )}
              </dd>
            </div>
          ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        You can pause sales after publishing. Sales dates and ticket quantity
        still apply.
      </p>
    </div>
  );
}
