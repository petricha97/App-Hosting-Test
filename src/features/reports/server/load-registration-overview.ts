// Server-side loader for the "Registration overview" report template.
// Spec §1 (agents/docs/specs/m7-report-templates.md): unfiltered by status
// (accepted AND cancelled render, unlike M7-T1's accepted-only chart) — an
// audit list's whole purpose is completeness. Data source:
// listAdminAttendeesForEvent (already exists, already cursor-paginated by
// createdAt desc) — zero DAL change needed for this template.
import "server-only";

import {
  ATTENDEE_LIST_LIMIT,
  listAdminAttendeesForEvent,
} from "@/lib/db/adminAttendee";
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
    company: doc.company ?? "",
    jobTitle: doc.jobTitle ?? "",
    registrationType: doc.registrationTypeLabel || ROSTER_LABEL_FALLBACK,
    ticketType: doc.ticketLabel || ROSTER_LABEL_FALLBACK,
    status: doc.status === "cancelled" ? "Cancelled" : "Accepted",
    checkInState:
      doc.checkInState === "checked-in" ? "Checked in" : "Not arrived",
    checkedInAt: timestampToIso(doc.checkedInAt) ?? "",
    registeredAt: timestampToIso(doc.createdAt) ?? "",
  };
}

export async function loadRegistrationOverviewPage(input: {
  eventId: string;
  organizationId: string;
  cursorMs?: number;
}): Promise<ReportPage> {
  const docs = await listAdminAttendeesForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
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

export async function loadRegistrationOverviewExport(input: {
  eventId: string;
  organizationId: string;
}): Promise<ReportRow[]> {
  const docs = await collectExportDocs<WithId<AttendeeDoc>>({
    rowLimit: REPORT_EXPORT_ROW_LIMIT,
    fetchPage: (cursorMs) =>
      listAdminAttendeesForEvent({
        eventId: input.eventId,
        organizationId: input.organizationId,
        limit: 200,
        startAfterCreatedAtMs: cursorMs,
      }),
    cursorMsOf: (doc) => timestampToMs(doc.createdAt),
  });

  return docs.map(serializeRow);
}
