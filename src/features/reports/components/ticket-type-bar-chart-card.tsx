// "Registrations by ticket type" card (design §1): header + the presentational
// bar chart, with its own loading skeleton, empty state (zero ticket types),
// and error state (independent from the finance card, spec §5).
import { Ticket } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { TicketTypeBarChart } from "@/features/reports/components/ticket-type-bar-chart";
import type { TicketTypeRegistrationRow } from "@/features/reports/types";

export interface TicketTypeBarChartCardProps {
  eventId: string;
  rows: TicketTypeRegistrationRow[];
  loadError: boolean;
  onRetry: () => void;
}

export function TicketTypeBarChartCard({
  eventId,
  rows,
  loadError,
  onRetry,
}: TicketTypeBarChartCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Registrations by ticket type
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loadError ? (
          <EntityTableError
            entityLabel="ticket-type registrations"
            onRetry={onRetry}
          />
        ) : rows.length === 0 ? (
          <EntityEmptyState
            icon={Ticket}
            title="No ticket types yet"
            description="Create a ticket type to start tracking registrations by offer."
            actionLabel="Go to Tickets"
            href={`/dashboard/events/${encodeURIComponent(eventId)}/tickets`}
          />
        ) : (
          <TicketTypeBarChart rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}

// Route-level loading.tsx composes this (design §1): 4 representative rows,
// label+value skeleton + bar-shaped skeleton matching Progress's own chrome.
export function TicketTypeBarChartCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Registrations by ticket type
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
