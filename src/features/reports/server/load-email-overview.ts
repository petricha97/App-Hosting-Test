// Server-side loader for the "Email overview" report template. Spec §5
// (agents/docs/specs/m7-report-templates.md): a send-log-style overview,
// unfiltered by status/kind. "Email name" resolves EmailMessageDoc.kind (a
// free-text join key, not a display name) via mergeEmailDefinitions() — the
// SAME virtual-catalog-merge function the M6-T2 Emails screen already uses —
// falling back to the raw kind string when no catalog entry matches (ad-hoc
// sends). Scope boundary: bodyHtml/bodyText are never columns here (an
// "overview" is a send-log audit, not a message-content export).
import "server-only";

import {
  EMAIL_MESSAGE_LIST_LIMIT,
  listAdminEmailMessagesForEvent,
} from "@/lib/db/adminEmailMessage";
import { listAdminEmailDefinitionsForEvent } from "@/lib/db/adminEmailDefinition";
import { mergeEmailDefinitions } from "@/features/emails/default-definitions";
import { timestampToIso, timestampToMs } from "@/features/attendees/roster";
import { REPORT_EXPORT_ROW_LIMIT } from "@/features/reports/csv";
import { collectExportDocs } from "@/features/reports/server/report-export-loop";
import type { ReportPage, ReportRow } from "@/features/reports/types";
import type { EmailMessageDoc, WithId } from "@/types/collection";

const RUN_PAGE_SIZE = EMAIL_MESSAGE_LIST_LIMIT;

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

// Built once per Run/export invocation (spec §2 AC-3's "at most one call"
// convention, applied here too) — `event: null` is safe: the merge only
// needs each definition's `name` for this report, never its resolved
// trigger date, and resolveScheduledDefaultAt already handles a null event
// input by returning atMs: null (see default-definitions.ts).
async function loadEmailNameByKind(input: {
  eventId: string;
  organizationId: string;
}): Promise<Map<string, string>> {
  const stored = await listAdminEmailDefinitionsForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
  const merged = mergeEmailDefinitions({
    stored,
    event: null,
    organizationId: input.organizationId,
    eventId: input.eventId,
  });
  return new Map(
    merged.map((definition) => [definition.kind, definition.name]),
  );
}

function serializeRow(
  doc: WithId<EmailMessageDoc>,
  namesByKind: Map<string, string>,
): ReportRow {
  return {
    recipientName: doc.recipient.name,
    recipientEmail: doc.recipient.email,
    // Falls back to the raw kind string verbatim (ad-hoc/manual sends whose
    // kind doesn't correspond to any definition, e.g. "manual").
    emailName: namesByKind.get(doc.kind) ?? doc.kind,
    subject: doc.subject,
    status: capitalize(doc.status),
    attemptCount: String(doc.attemptCount),
    lastError: doc.lastError?.message ?? "",
    queuedAt: timestampToIso(doc.queuedAt) ?? "",
    sentAt: timestampToIso(doc.sentAt) ?? "",
    failedAt: timestampToIso(doc.failedAt) ?? "",
  };
}

export async function loadEmailOverviewPage(input: {
  eventId: string;
  organizationId: string;
  cursorMs?: number;
}): Promise<ReportPage> {
  const [docs, namesByKind] = await Promise.all([
    listAdminEmailMessagesForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      limit: RUN_PAGE_SIZE,
      startAfterCreatedAtMs: input.cursorMs,
    }),
    loadEmailNameByKind(input),
  ]);

  const last = docs[docs.length - 1];
  return {
    rows: docs.map((doc) => serializeRow(doc, namesByKind)),
    nextCursorMs: last ? timestampToMs(last.createdAt) : null,
    hasMore: docs.length === RUN_PAGE_SIZE,
  };
}

export async function loadEmailOverviewExport(input: {
  eventId: string;
  organizationId: string;
}): Promise<ReportRow[]> {
  const namesByKind = await loadEmailNameByKind(input);

  const docs = await collectExportDocs<WithId<EmailMessageDoc>>({
    rowLimit: REPORT_EXPORT_ROW_LIMIT,
    fetchPage: (cursorMs) =>
      listAdminEmailMessagesForEvent({
        eventId: input.eventId,
        organizationId: input.organizationId,
        limit: 200,
        startAfterCreatedAtMs: cursorMs,
      }),
    cursorMsOf: (doc) => timestampToMs(doc.createdAt),
  });

  return docs.map((doc) => serializeRow(doc, namesByKind));
}
