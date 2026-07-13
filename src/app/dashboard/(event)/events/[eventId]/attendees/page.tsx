// Attendees screen (M5-T2/T3). Server Component: verifies org ownership
// (404 on cross-org), reads the first merged roster page (limit 50 per
// source), the accepted-attendee count (aggregate — never page length), the
// abandoned drafts (emails masked server-side, the local part never crosses
// this boundary) and the register-dialog data (paths / tickets / types /
// form question fields), then renders the client workspace. ?tab= deep links
// resolve server-side so the right tab renders without a flash.
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  serializeAbandonedDrafts,
  type SerializedAbandonedDraft,
} from "@/features/attendees/abandoned";
import { AttendeesWorkspace } from "@/features/attendees/components/attendees-workspace";
import { loadRosterPage, type RosterPage } from "@/features/attendees/server/load-roster";
import { resolveAttendeesTab } from "@/features/attendees/utils";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import {
  getNonCommerceFields,
  type FormFieldValues,
} from "@/features/form/schema";
import { serializeForm } from "@/features/form/utils";
import {
  serializeRegistrationPath,
  type SerializedRegistrationPath,
} from "@/features/registration-paths/types";
import {
  serializeRegistrationType,
  serializeTicketType,
  type SerializedRegistrationType,
  type SerializedTicketType,
} from "@/features/registration/types";
import { countAdminAttendeesForEvent } from "@/lib/db/adminAttendee";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { getAdminRegistrationDraftsForEvent } from "@/lib/db/adminRegistrationDraft";
import { getAdminRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import { getAdminRegistrationTypesForEvent } from "@/lib/db/adminRegistrationType";
import { getAdminTicketTypesForEvent } from "@/lib/db/adminTicketType";

export const metadata: Metadata = {
  title: "Attendees | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

const EMPTY_ROSTER: RosterPage = {
  rows: [],
  attendeeCursorMs: null,
  pendingCursorMs: null,
  hasMoreAttendees: false,
  hasMorePending: false,
};

export default async function EventAttendeesPage({
  params,
  searchParams,
}: PageProps) {
  const [{ eventId }, { tab }] = await Promise.all([params, searchParams]);
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  let roster = EMPTY_ROSTER;
  let acceptedCount = 0;
  let abandonedDrafts: SerializedAbandonedDraft[] = [];
  let paths: SerializedRegistrationPath[] = [];
  let tickets: SerializedTicketType[] = [];
  let registrationTypes: SerializedRegistrationType[] = [];
  let questionFields: FormFieldValues[] = [];
  let hasForm = false;
  let loadError = false;
  try {
    const [rosterPage, count, drafts, pathDocs, ticketDocs, typeDocs, form] =
      await Promise.all([
        loadRosterPage({ eventId, organizationId: scope.organizationId }),
        countAdminAttendeesForEvent({
          eventId,
          organizationId: scope.organizationId,
          status: "accepted",
        }),
        getAdminRegistrationDraftsForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        getAdminRegistrationPathsForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        getAdminTicketTypesForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        getAdminRegistrationTypesForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        getAdminFormForEvent({
          eventId,
          eventName: event.name,
          organizationId: scope.organizationId,
          formPath: event.formPath,
        }),
      ]);

    roster = rosterPage;
    acceptedCount = count;
    abandonedDrafts = serializeAbandonedDrafts(drafts);
    paths = pathDocs.map(serializeRegistrationPath);
    tickets = ticketDocs.map(serializeTicketType);
    registrationTypes = typeDocs.map(serializeRegistrationType);
    if (form) {
      hasForm = true;
      questionFields = getNonCommerceFields(
        serializeForm(form).fields as FormFieldValues[],
      );
    }
  } catch {
    // Shell + tabs stay interactive; the tabs show retryable error panels.
    loadError = true;
  }

  return (
    <AttendeesWorkspace
      eventId={eventId}
      initialTab={resolveAttendeesTab(tab)}
      acceptedCount={acceptedCount}
      initialRows={roster.rows}
      initialAttendeeCursorMs={roster.attendeeCursorMs}
      initialPendingCursorMs={roster.pendingCursorMs}
      initialHasMoreAttendees={roster.hasMoreAttendees}
      initialHasMorePending={roster.hasMorePending}
      abandonedDrafts={abandonedDrafts}
      paths={paths}
      tickets={tickets}
      registrationTypes={registrationTypes}
      questionFields={questionFields}
      hasForm={hasForm}
      loadError={loadError}
    />
  );
}
