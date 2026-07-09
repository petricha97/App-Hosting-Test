import type { ReactNode } from "react";
import { Suspense } from "react";

import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getEventBarDateLabel } from "@/features/event/utils";
import { EventNotFound } from "@/features/event/components/event-not-found";
import { EventShell } from "@/features/event/components/event-shell";

interface EventWorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ eventId: string }>;
}

async function EventWorkspaceContent({
  eventId,
  children,
}: {
  eventId: string;
  children: ReactNode;
}) {
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  // Missing event and wrong-org event share one screen so event existence
  // never leaks across workspaces. Rendered from the layout, before any
  // sub-page renders.
  if (!event) {
    return <EventNotFound />;
  }

  return (
    <EventShell
      eventId={eventId}
      event={{
        id: event.id,
        name: event.name,
        status: event.status,
        dateLabel: getEventBarDateLabel(event),
        venue: null,
      }}
    >
      {children}
    </EventShell>
  );
}

export default async function EventWorkspaceLayout({
  children,
  params,
}: EventWorkspaceLayoutProps) {
  const { eventId } = await params;

  return (
    // The sidebar only needs eventId, so the shell chrome (sidebar + event-bar
    // skeleton) streams immediately while the event document resolves.
    <Suspense fallback={<EventShell eventId={eventId} event={undefined} />}>
      <EventWorkspaceContent eventId={eventId}>{children}</EventWorkspaceContent>
    </Suspense>
  );
}
