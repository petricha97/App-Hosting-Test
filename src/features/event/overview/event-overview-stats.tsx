import Link from "next/link";

import { formatMoney } from "@/features/pricing/utils";
import type { Currency } from "@/types/collection";
import type { EventOverviewData } from "./event-overview-types";
import { EventOverviewStatCard } from "./event-overview-stat-card";

export function EventOverviewStats({ eventId, data }: { eventId: string; data: EventOverviewData }) {
  const countCard = (title: string, result: EventOverviewData["registered"], hint: React.ReactNode) => (
    <EventOverviewStatCard
      title={title}
      value={"loadError" in result ? "—" : new Intl.NumberFormat("en-US").format(result.value)}
      hint={hint}
      error={"loadError" in result}
    />
  );

  let revenueValue: React.ReactNode = "—";
  let revenueHint: React.ReactNode = "No payment currency configured";
  const revenueError = "loadError" in data.revenue;
  if ("kind" in data.revenue && data.revenue.kind === "currencies") {
    revenueValue = (
      <span className="flex flex-col gap-1 text-xl sm:text-2xl">
        {[...data.revenue.amounts]
          .sort((a, b) => a.currency.localeCompare(b.currency))
          .map((amount) => (
            <span key={amount.currency} className="break-words">
              <span className="mr-2 text-sm text-muted-foreground">{amount.currency}</span>
              {formatMoney(amount.paidMinor, amount.currency as Currency)}
            </span>
          ))}
      </span>
    );
    revenueHint = "Paid order totals are not converted or combined.";
  }

  return (
    <section aria-labelledby="event-overview-stats-heading">
      <h2 id="event-overview-stats-heading" className="sr-only">Event statistics</h2>
      <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {countCard("Registered", data.registered, "Accepted attendees")}
        {countCard("Invited", data.invited, "Invitation emails sent")}
        <EventOverviewStatCard title="Revenue" value={revenueValue} hint={revenueHint} error={revenueError} />
        {countCard(
          "Abandoned",
          data.abandoned,
          <Link className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/dashboard/events/${eventId}/attendees`}>
            Recover via email
          </Link>,
        )}
      </div>
    </section>
  );
}
