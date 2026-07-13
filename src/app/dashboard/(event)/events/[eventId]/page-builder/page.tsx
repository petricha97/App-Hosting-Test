// Event page builder (M4): loads the page doc for the requested pageKey
// (?path=<pathId> → that path's page, else the default page), plus the LIVE
// editor data the data-bound blocks render — pricing projection, countdown
// target, registration CTA state (spec T1: live org data in the canvas, no
// sample data). All loads are dashboard-scoped and org-checked.
import { notFound } from "next/navigation";

import { EventPageEditorWorkspace } from "@/features/event-pages/components/event-page-editor-workspace";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { resolveEventStartMs } from "@/features/event-pages/countdown";
import { resolveRegistrationCtaState } from "@/features/event-pages/registration-state";
import { listPublicTicketsForEvent } from "@/features/public-registration/server/tickets";
import type { PublicPricingProjection } from "@/features/public-registration/types";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminEventPageForEvent } from "@/lib/db/adminEventPage";
import { getAdminRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import { serializeEventPage } from "@/features/event-pages/utils";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { serializeForm } from "@/features/form/utils";

interface DashboardEventPageBuilderPageProps {
  params: Promise<{ eventId: string }>;
  // Next delivers string[] for repeated params (?path=a&path=b) — normalized
  // to the first value below.
  searchParams: Promise<{ path?: string | string[] }>;
}

export default async function DashboardEventPageBuilderPage({
  params,
  searchParams,
}: DashboardEventPageBuilderPageProps) {
  const { eventId } = await params;
  const { path } = await searchParams;
  const pathParam = Array.isArray(path) ? path[0] : path;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);

  if (!event) {
    notFound();
  }

  const paths = await getAdminRegistrationPathsForEvent({
    eventId,
    organizationId: scope.organizationId,
  });

  // AC-25: ?path= must reference a path of THIS event (inactive is fine —
  // organizers may prepare its page); foreign/unknown ids 404.
  const editingPath = pathParam
    ? paths.find((path) => path.id === pathParam) ?? null
    : null;
  if (pathParam && !editingPath) {
    notFound();
  }

  const pageKey = editingPath?.id ?? "default";

  const [eventPage, defaultEventPage, form] = await Promise.all([
    getAdminEventPageForEvent({
      eventId,
      organizationId: scope.organizationId,
      eventPagePath: event.eventPagePath,
      pageKey,
    }),
    pageKey === "default"
      ? null
      : getAdminEventPageForEvent({
          eventId,
          organizationId: scope.organizationId,
          eventPagePath: event.eventPagePath,
          pageKey: "default",
        }),
    getAdminFormForEvent({
      eventId,
      eventName: event.name,
      organizationId: scope.organizationId,
      formPath: event.formPath,
    }),
  ]);

  // Live canvas data (spec T1) — a load failure degrades the block to its
  // designed empty state; the builder itself must still open.
  let pricingTickets: PublicPricingProjection | null = null;
  try {
    pricingTickets = await listPublicTicketsForEvent({
      eventId,
      organizationId: scope.organizationId,
    });
  } catch (error) {
    console.error("editor pricing projection failed", error);
  }

  const registrationState = resolveRegistrationCtaState({
    hasPublishedForm: form?.status === "published",
    totalPaths: paths.length,
    activePaths: paths.filter((path) => path.isActive).length,
  });

  const eventStartMs = resolveEventStartMs({
    periods: event.periods,
    timezone: event.timezone,
  });

  return (
    <EventPageEditorWorkspace
      eventId={event.id}
      eventName={event.name}
      pageMode={event.pageMode}
      redirectUrl={event.redirectUrl}
      initialEventPage={eventPage ? serializeEventPage(eventPage) : null}
      defaultEventPage={
        pageKey === "default"
          ? eventPage
            ? serializeEventPage(eventPage)
            : null
          : defaultEventPage
            ? serializeEventPage(defaultEventPage)
            : null
      }
      form={form ? serializeForm(form) : null}
      paths={paths.map((path) => ({
        id: path.id,
        name: path.name,
        isActive: path.isActive,
      }))}
      editingPathId={editingPath?.id ?? null}
      pricingTickets={pricingTickets}
      countdown={{
        eventStartIso:
          eventStartMs !== null ? new Date(eventStartMs).toISOString() : null,
        timezone: event.timezone,
      }}
      registrationState={registrationState}
    />
  );
}
