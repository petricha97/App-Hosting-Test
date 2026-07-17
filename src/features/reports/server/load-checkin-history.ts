// Server-side loader for the "Badges printed (check-in history)" report
// template. Spec §4/D5 (agents/docs/specs/m7-report-templates.md): a real
// check-in-history report, NOT a literal badge-print-event report (that
// data does not exist). Narrower scope than Registration overview —
// status: "accepted" only (a cancelled registrant was never going to be
// checked in). "Checked-in by" reuses checkedInByName() verbatim with
// viewerIsTeamSession = false (dashboard-only surface, M5-T5/M6-T2 L-5).
import "server-only";

import {
  ATTENDEE_LIST_LIMIT,
  listAdminAttendeesForEvent,
} from "@/lib/db/adminAttendee";
import { checkedInByName } from "@/features/checkin/server/resolve-scan";
import {
  ROSTER_LABEL_FALLBACK,
  buildName,
  timestampToIso,
  timestampToMs,
} from "@/features/attendees/roster";
import { REPORT_EXPORT_ROW_LIMIT } from "@/features/reports/csv";
import { collectExportDocs } from "@/features/reports/server/report-export-loop";
import type { ReportPage, ReportRow } from "@/features/reports/types";
import type { AttendeeDoc, WithId } from "@/types/collection";

const RUN_PAGE_SIZE = ATTENDEE_LIST_LIMIT;

function serializeRow(doc: WithId<AttendeeDoc>): ReportRow {
  return {
    name: buildName(doc.firstName ?? "", doc.lastName ?? "", doc.email ?? ""),
    email: doc.email ?? "",
    registrationType: doc.registrationTypeLabel || ROSTER_LABEL_FALLBACK,
    ticketType: doc.ticketLabel || ROSTER_LABEL_FALLBACK,
    checkInState:
      doc.checkInState === "checked-in" ? "Checked in" : "Not arrived",
    checkedInAt: timestampToIso(doc.checkedInAt) ?? "",
    checkedInBy: checkedInByName(doc.checkedInBy, false) ?? "",
  };
}

export async function loadCheckinHistoryPage(input: {
  eventId: string;
  organizationId: string;
  cursorMs?: number;
}): Promise<ReportPage> {
  const docs = await listAdminAttendeesForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
    status: "accepted",
    limit: RUN_PAGE_SIZE,
    startAfterCreatedAtMs: input.cursorMs,
  });

  const last = docs[docs.length - 1];
  return {
    rows: docs.map(serializeRow),
    nextCursorMs: last ? timestampToMs(last.createdAt) : null,
    hasMore: docs.length === RUN_PAGE_SIZE,
  };
}

export async function loadCheckinHistoryExport(input: {
  eventId: string;
  organizationId: string;
}): Promise<ReportRow[]> {
  const docs = await collectExportDocs<WithId<AttendeeDoc>>({
    rowLimit: REPORT_EXPORT_ROW_LIMIT,
    fetchPage: (cursorMs) =>
      listAdminAttendeesForEvent({
        eventId: input.eventId,
        organizationId: input.organizationId,
        status: "accepted",
        limit: 200,
        startAfterCreatedAtMs: cursorMs,
      }),
    cursorMsOf: (doc) => timestampToMs(doc.createdAt),
  });

  return docs.map(serializeRow);
}
