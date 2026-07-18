import "server-only";

import { resolveEffectiveEmailDefinition } from "@/features/emails/server/resolve-definition";
import { countAdminAttendeesForEvent } from "@/lib/db/adminAttendee";
import { hasAdminCheckinConfigForEvent } from "@/lib/db/adminCheckinConfig";
import { countAdminEmailMessagesForEvent } from "@/lib/db/adminEmailMessage";
import { getAdminEventPageForEvent } from "@/lib/db/adminEventPage";
import { getAdminFeesForEvent } from "@/lib/db/adminFee";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { sumAdminOrderTotalsForEvent } from "@/lib/db/adminOrder";
import { countAdminAbandonedRegistrationDraftsForEvent } from "@/lib/db/adminRegistrationDraft";
import { getAdminRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import { getAdminTicketTypesForEvent } from "@/lib/db/adminTicketType";
import type {
  EventOverviewCountResult,
  EventOverviewData,
  EventOverviewReadinessEntry,
  EventOverviewRevenueResult,
} from "@/features/event/overview/event-overview-types";
import type {
  Currency,
  EventDoc,
  PaymentMethod,
  RegistrationPathDoc,
  WithId,
} from "@/types/collection";

const METHOD_ORDER: PaymentMethod[] = ["card", "invoice", "comp", "none"];

function countResult(result: PromiseSettledResult<number>): EventOverviewCountResult {
  return result.status === "fulfilled"
    ? { value: result.value }
    : { loadError: true };
}

function readiness(input: {
  id: EventOverviewReadinessEntry["id"];
  done: boolean;
  doneLabel: string;
  pendingLabel: string;
  detail: string;
  href: string;
}): EventOverviewReadinessEntry {
  return input.done
    ? {
        id: input.id,
        state: "done",
        label: input.doneLabel,
        detail: input.detail,
      }
    : {
        id: input.id,
        state: "pending",
        label: input.pendingLabel,
        detail: input.detail,
        href: input.href,
      };
}

function unknown(
  id: EventOverviewReadinessEntry["id"],
  concept: string,
  href: string,
): EventOverviewReadinessEntry {
  return {
    id,
    state: "unknown",
    label: `${concept} — Unknown`,
    detail: "Unable to verify. Retry or open settings.",
    href,
  };
}

async function loadRevenue(input: {
  eventId: string;
  organizationId: string;
  paths: WithId<RegistrationPathDoc>[];
}): Promise<EventOverviewRevenueResult> {
  const currencies = Array.from(
    new Set(input.paths.map((path) => path.currency)),
  ).sort();
  if (currencies.length === 0) return { kind: "unconfigured" };

  const amounts = await Promise.all(
    currencies.map(async (currency) => ({
      currency,
      paidMinor: await sumAdminOrderTotalsForEvent({
        eventId: input.eventId,
        organizationId: input.organizationId,
        paymentStatus: "paid",
        currency: currency as Currency,
        field: "totalMinor",
      }),
    })),
  );
  return { kind: "currencies", amounts };
}

async function loadConfirmationReadiness(input: {
  eventId: string;
  organizationId: string;
  paths: WithId<RegistrationPathDoc>[];
}): Promise<boolean> {
  const activeMethods = new Set(
    input.paths.filter((path) => path.isActive).map((path) => path.paymentMethod),
  );
  const kinds = new Set<string>();
  if (
    activeMethods.has("card") ||
    activeMethods.has("comp") ||
    activeMethods.has("none")
  ) {
    kinds.add("confirmation-paid");
  }
  if (activeMethods.has("invoice")) kinds.add("confirmation-payment-due");
  if (kinds.size === 0) {
    kinds.add("confirmation-paid");
    kinds.add("confirmation-payment-due");
  }

  const definitions = await Promise.all(
    Array.from(kinds).map((kind) =>
      resolveEffectiveEmailDefinition({
        kind,
        eventId: input.eventId,
        organizationId: input.organizationId,
      }),
    ),
  );
  return definitions.every((definition) => definition?.enabled === true);
}

export async function loadEventOverview(input: {
  event: WithId<EventDoc>;
  eventId: string;
  organizationId: string;
}): Promise<EventOverviewData> {
  const { event, eventId, organizationId } = input;
  const scope = { eventId, organizationId };
  const base = `/dashboard/events/${encodeURIComponent(eventId)}`;

  const pathsPromise = getAdminRegistrationPathsForEvent(scope);
  const revenuePromise = pathsPromise.then((paths) =>
    loadRevenue({ ...scope, paths }),
  );
  const confirmationPromise = pathsPromise.then((paths) =>
    loadConfirmationReadiness({ ...scope, paths }),
  );

  const results = await Promise.allSettled([
    countAdminAttendeesForEvent({ ...scope, status: "accepted" }),
    countAdminEmailMessagesForEvent({
      ...scope,
      kind: "invitation",
      status: "sent",
    }),
    countAdminAbandonedRegistrationDraftsForEvent(scope),
    pathsPromise,
    revenuePromise,
    getAdminEventPageForEvent({
      ...scope,
      eventPagePath: event.eventPagePath,
    }),
    getAdminFormForEvent({
      ...scope,
      eventName: event.name,
      formPath: event.formPath,
    }),
    getAdminTicketTypesForEvent(scope),
    getAdminFeesForEvent(scope),
    confirmationPromise,
    hasAdminCheckinConfigForEvent(scope),
  ] as const);

  const [
    registered,
    invited,
    abandoned,
    paths,
    revenue,
    page,
    form,
    tickets,
    fees,
    confirmation,
    checkin,
  ] = results;

  const pathIdentity =
    paths.status === "fulfilled"
      ? {
          active: paths.value.filter((path) => path.isActive).length,
          total: paths.value.length,
          methods: METHOD_ORDER.filter((method) =>
            paths.value.some(
              (path) => path.isActive && path.paymentMethod === method,
            ),
          ),
        }
      : ({ loadError: true } as const);

  const eventPublished = event.status === "Published";
  const pageDone =
    event.pageMode !== "custom" ||
    (page.status === "fulfilled" && page.value?.status === "published");
  const pageDetail =
    event.pageMode === "custom"
      ? "Requires a published custom event page."
      : `Not required for ${event.pageMode} page mode`;

  let ticketEntry: EventOverviewReadinessEntry;
  if (tickets.status === "rejected" || fees.status === "rejected") {
    ticketEntry = unknown(
      "ticket-types-pricing-set",
      "Ticket types & pricing",
      `${base}/tickets`,
    );
  } else {
    const ticketIds = new Set(tickets.value.map((ticket) => ticket.id));
    const done =
      ticketIds.size > 0 &&
      fees.value.some(
        (fee) => fee.status === "active" && ticketIds.has(fee.ticketTypeId),
      );
    ticketEntry = readiness({
      id: "ticket-types-pricing-set",
      done,
      doneLabel: "Ticket types & pricing set",
      pendingLabel: "Ticket types & pricing not set",
      detail: "Requires a ticket type with active pricing.",
      href: `${base}/tickets`,
    });
  }

  const readinessEntries: EventOverviewReadinessEntry[] = [
    readiness({
      id: "event-published",
      done: eventPublished,
      doneLabel: "Event published",
      pendingLabel: "Event not published",
      detail: "Published iff event status is Published.",
      href: `${base}/edit`,
    }),
    page.status === "rejected" && event.pageMode === "custom"
      ? unknown(
          "custom-page-published",
          "Custom page published",
          `${base}/page-builder`,
        )
      : readiness({
          id: "custom-page-published",
          done: pageDone,
          doneLabel: "Custom page published",
          pendingLabel: "Custom page not published",
          detail: pageDetail,
          href: `${base}/page-builder`,
        }),
    form.status === "rejected"
      ? unknown(
          "registration-form-published",
          "Registration form published",
          `${base}/form`,
        )
      : readiness({
          id: "registration-form-published",
          done: form.value?.status === "published",
          doneLabel: "Registration form published",
          pendingLabel: "Registration form not published",
          detail: "Requires an existing published registration form.",
          href: `${base}/form`,
        }),
    ticketEntry,
    confirmation.status === "rejected"
      ? unknown(
          "confirmation-email-active",
          "Confirmation email active",
          `${base}/emails`,
        )
      : readiness({
          id: "confirmation-email-active",
          done: confirmation.value,
          doneLabel: "Confirmation email active",
          pendingLabel: "Confirmation email not active",
          detail: "Required confirmation definitions must be active.",
          href: `${base}/emails`,
        }),
    checkin.status === "rejected"
      ? unknown("checkin-configured", "Check-in configured", `${base}/checkin`)
      : readiness({
          id: "checkin-configured",
          done: checkin.value,
          doneLabel: "Check-in configured",
          pendingLabel: "Check-in not configured",
          detail: "Requires a saved check-in configuration.",
          href: `${base}/checkin`,
        }),
  ];

  return {
    event,
    registered: countResult(registered),
    invited: countResult(invited),
    revenue:
      revenue.status === "fulfilled" ? revenue.value : { loadError: true },
    abandoned: countResult(abandoned),
    identity: {
      category: "Not set",
      timezone: event.timezone,
      visibility: eventPublished ? "Public" : "Private (draft)",
      paths: pathIdentity,
    },
    readiness: readinessEntries,
  };
}
