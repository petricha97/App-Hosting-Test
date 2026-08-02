import { FileStack } from "lucide-react";

import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { EventOverview } from "@/features/event/overview";
import type { EventOverviewData } from "@/features/event/overview/event-overview-types";
import type { SerializedEvent } from "@/features/event/utils";

interface OrganizationEventDetailProps {
  event: SerializedEvent | null;
  eventId: string;
  overview: EventOverviewData | null;
}

export function OrganizationEventDetail({ event, eventId, overview }: OrganizationEventDetailProps) {
  if (!event || !overview) {
    return (
      <DashboardEmptyState
        icon={FileStack}
        title="Event not found in this organization"
        description="The requested event either does not exist or does not belong to the active workspace."
        primaryAction={{ label: "Back to Events", href: "/dashboard/events" }}
        secondaryAction={{ label: "Create Event", href: "/dashboard/events/new", variant: "outline" }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <EventOverview eventId={eventId} data={overview} />
      <section aria-labelledby="event-diagnostics-heading" className="rounded-2xl border border-border bg-card p-5">
        <h2 id="event-diagnostics-heading" className="text-xl font-semibold">Current event data</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-3">
          <div><dt className="text-sm font-medium text-muted-foreground">Organization path</dt><dd className="mt-1 break-all text-sm">{event.organizationPath}</dd></div>
          <div><dt className="text-sm font-medium text-muted-foreground">Page mode</dt><dd className="mt-1 text-sm">{event.pageMode === "redirect" ? `Redirect to ${event.redirectUrl || "missing URL"}` : event.pageMode === "custom" ? "Custom event page builder is enabled." : "Default public event page is enabled."}</dd></div>
          <div><dt className="text-sm font-medium text-muted-foreground">Overlap rule</dt><dd className="mt-1 text-sm">{event.allowOverlap ? "Scheduling overlap is allowed." : "Scheduling overlap is blocked."}</dd></div>
        </dl>
      </section>
    </div>
  );
}
