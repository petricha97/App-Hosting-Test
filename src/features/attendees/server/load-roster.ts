// Server-side merged roster page loader (M5-T2) — shared by the attendees
// server page, the "load more" list route and the CSV export route so all
// three surfaces produce identical rows.
//
// Sources (data-model decision): Attendee docs via listAdminAttendeesForEvent
// (Firestore-side status filter, composite index) + pending submissions via
// the EXISTING listAdminFormDataForEvent — no new FormData query shape. The
// FormData page is filtered to non-accepted IN MEMORY (accepted submissions
// surface as Attendee rows instead), so its "load more" cursor must come from
// the RAW page tail, not the filtered rows. Documented limitation: a page of
// mostly-accepted submissions yields few pending rows per click — bounded
// lists per M3 convention; server search/joins are an M8 candidate.
import "server-only";

import {
  mergeRosterRows,
  serializeAttendeeRow,
  serializePendingRow,
  timestampToMs,
  type RosterRowStatus,
  type SerializedAttendeeRow,
} from "@/features/attendees/roster";
import {
  ATTENDEE_LIST_LIMIT,
  listAdminAttendeesForEvent,
} from "@/lib/db/adminAttendee";
import { listAdminFormDataForEvent } from "@/lib/db/adminFormData";

export interface RosterPage {
  rows: SerializedAttendeeRow[];
  // "Load more" cursors: last RAW page item per source (null = source not
  // queried this call or empty page).
  attendeeCursorMs: number | null;
  pendingCursorMs: number | null;
  hasMoreAttendees: boolean;
  hasMorePending: boolean;
}

export async function loadRosterPage(input: {
  eventId: string;
  organizationId: string;
  status?: RosterRowStatus;
  attendeeCursorMs?: number;
  pendingCursorMs?: number;
  limit?: number;
}): Promise<RosterPage> {
  const limit = input.limit ?? ATTENDEE_LIST_LIMIT;
  const wantAttendees = input.status !== "pending";
  const wantPending = input.status !== "accepted";

  const [attendees, responses] = await Promise.all([
    wantAttendees
      ? listAdminAttendeesForEvent({
          eventId: input.eventId,
          organizationId: input.organizationId,
          // The Accepted filter maps to the Firestore-side status equality
          // (composite index #2); the unfiltered view lists every attendee.
          status: input.status === "accepted" ? "accepted" : undefined,
          limit,
          startAfterCreatedAtMs: input.attendeeCursorMs,
        })
      : Promise.resolve([]),
    wantPending
      ? listAdminFormDataForEvent({
          eventId: input.eventId,
          organizationId: input.organizationId,
          limit,
          startAfterSubmittedAtMs: input.pendingCursorMs,
        })
      : Promise.resolve([]),
  ]);

  const attendeeRows = attendees.map(serializeAttendeeRow);
  const pendingRows = responses
    .map(serializePendingRow)
    .filter((row): row is SerializedAttendeeRow => row !== null);

  const lastAttendee = attendees[attendees.length - 1];
  const lastResponse = responses[responses.length - 1];

  return {
    rows: mergeRosterRows(attendeeRows, pendingRows),
    attendeeCursorMs: lastAttendee ? timestampToMs(lastAttendee.createdAt) : null,
    pendingCursorMs: lastResponse
      ? timestampToMs(lastResponse.submittedAt)
      : null,
    hasMoreAttendees: attendees.length === limit,
    hasMorePending: responses.length === limit,
  };
}
