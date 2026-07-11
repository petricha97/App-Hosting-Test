// Public event page. M4 additions:
// - ?path=<pathId> renders that path's PUBLISHED custom page when it exists
//   (T2 AC-21); invalid/inactive/foreign/draft-only params are ignored and
//   the default behavior renders (AC-22/23) — never a 404 here.
// - Custom pages get LIVE data injected per request (T1): pricing projection
//   (AC-6), countdown target from the event doc (AC-9), and the registration
//   CTA state. A pricing fetch failure degrades the block to its empty state
//   and is logged — the page never 500s because of one block (AC-8).
import { notFound, redirect } from "next/navigation";

import { PublicEventDetail } from "@/features/public-events/components/public-event-detail";
import { extractOrganizationIdFromPath, serializeEvent } from "@/features/event/utils";
import { serializeForm } from "@/features/form/utils";
import { resolveEventStartMs } from "@/features/event-pages/countdown";
import { resolveRegistrationCtaState } from "@/features/event-pages/registration-state";
import { serializePublicEventPage } from "@/features/event-pages/utils";
import { resolvePublicPathPage } from "@/features/public-events/server/path-page";
import { listPublicTicketsForEvent } from "@/features/public-registration/server/tickets";
import type { PublicPricingProjection } from "@/features/public-registration/types";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";
import { getAdminPublishedFormForPublicEvent } from "@/lib/db/adminForm";
import { getAdminPublishedEventPageForEvent } from "@/lib/db/adminEventPage";
import { getAdminRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import { PublicCustomEventPage } from "@/features/public-events/components/public-custom-event-page";

interface PublicEventDetailPageProps {
  params: Promise<{ eventId: string }>;
  // Next delivers string[] for repeated params (?path=a&path=b) — normalized
  // to the first value below.
  searchParams: Promise<{ path?: string | string[] }>;
}

export default async function PublicEventDetailPage({
  params,
  searchParams,
}: PublicEventDetailPageProps) {
  const { eventId } = await params;
  const { path } = await searchParams;
  const pathParam = Array.isArray(path) ? path[0] : path;
  const event = await getAdminPublishedEventById(eventId);

  if (!event) {
    notFound();
  }

  const organizationId = extractOrganizationIdFromPath(event.organizationPath);

  const form = await getAdminPublishedFormForPublicEvent({
    eventId,
    eventName: event.name,
    organizationId,
    formPath: event.formPath,
  });

  // AC-21: a published path page wins over the default behavior (including
  // redirect mode — the fallback list in AC-22 only applies when the path
  // has no published page).
  const pathPage = await resolvePublicPathPage({
    eventId,
    organizationId,
    pathParam,
  });

  if (event.pageMode === "redirect" && event.redirectUrl && !pathPage) {
    redirect(event.redirectUrl);
  }

  const publishedEventPage =
    pathPage?.page ??
    (event.pageMode === "custom"
      ? await getAdminPublishedEventPageForEvent({
          eventId,
          organizationId,
          eventPagePath: event.eventPagePath,
        })
      : null);

  if (publishedEventPage) {
    // Live block data — fetched per request, never frozen into the page doc.
    let pricingTickets: PublicPricingProjection | null = null;
    let totalPaths = 0;
    let activePaths = 0;

    if (organizationId) {
      try {
        pricingTickets = await listPublicTicketsForEvent({
          eventId,
          organizationId,
        });
      } catch (error) {
        // AC-8: one block's data failure never breaks the page.
        console.error("event pricing projection failed", error);
        pricingTickets = null;
      }

      try {
        const paths = await getAdminRegistrationPathsForEvent({
          eventId,
          organizationId,
        });
        totalPaths = paths.length;
        activePaths = paths.filter((path) => path.isActive).length;
      } catch (error) {
        console.error("registration paths lookup failed", error);
      }
    }

    const registrationState = resolveRegistrationCtaState({
      hasPublishedForm: Boolean(form),
      totalPaths,
      activePaths,
    });

    const eventStartMs = resolveEventStartMs({
      periods: event.periods,
      timezone: event.timezone,
    });

    // On a path page the CTA keeps the visitor on that path (AC-21).
    const registerHref = pathPage
      ? `/events/${eventId}/register?path=${encodeURIComponent(pathPage.pathId)}`
      : `/events/${eventId}/register`;

    return (
      <PublicCustomEventPage
        event={serializeEvent(event)}
        form={form ? serializeForm(form) : null}
        // SEC-M4-1: public projection only (id/title/publishedContent) —
        // draftContent, storagePrefix, and organizationId never reach the
        // anonymous RSC payload.
        eventPage={serializePublicEventPage(publishedEventPage)}
        pricingTickets={pricingTickets}
        countdown={{
          eventStartIso:
            eventStartMs !== null ? new Date(eventStartMs).toISOString() : null,
          timezone: event.timezone,
        }}
        registrationCta={
          registrationState === "no_paths"
            ? null
            : { state: registrationState, registerHref }
        }
      />
    );
  }

  return (
    <PublicEventDetail
      event={serializeEvent(event)}
      form={form ? serializeForm(form) : null}
    />
  );
}
