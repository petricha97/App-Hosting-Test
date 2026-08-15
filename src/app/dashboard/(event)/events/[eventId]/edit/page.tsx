import { notFound } from "next/navigation";

import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { CreateEventWorkspace } from "@/features/event/create-event-workspace";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";

interface EditEventPageProps {
  params: Promise<{ eventId: string }>;
}

/** Map a stored event period to the form's range shape, tolerating the older
 *  `{date, start_time, end_time}` document format. */
function normalizeRange(period: Record<string, string>) {
  return {
    startDate: period.startDate ?? period.date ?? "",
    startTime: period.startTime ?? period.start_time ?? "",
    endDate: period.endDate ?? period.date ?? "",
    endTime: period.endTime ?? period.end_time ?? "",
  };
}

/** Route: /dashboard/events/[eventId]/edit — the EDIT flow. Server component:
 *  resolves the org scope, loads the event (404 if missing/cross-org), then
 *  renders the single-page workspace pre-filled with the event's current values. */
export default async function DashboardEditEventPage({
  params,
}: EditEventPageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  return (
    <CreateEventWorkspace
      mode="edit"
      eventId={event.id}
      initialValues={{
        name: event.name,
        description: event.description,
        capacity: event.capacity,
        expectedGuests: event.expectedGuests,
        formPath: event.formPath,
        invoicePath: event.invoicePath,
        organizationPath: event.organizationPath,
        timezone: event.timezone,
        allowOverlap: event.allowOverlap,
        status: event.status,
        pageMode: event.pageMode,
        redirectUrl: event.redirectUrl,
        registrationPeriod: event.registrationPeriod,
        periods: event.periods.map(normalizeRange),
      }}
    />
  );
}
