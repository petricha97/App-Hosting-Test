// Server-side loader for the "Abandoned registration details" report
// template. Spec §3 (agents/docs/specs/m7-report-templates.md): the exact
// same DAL method and the exact same in-memory isAbandoned filter the
// Abandoned tab (M5-T3, src/features/attendees/abandoned.ts) already uses —
// reused verbatim, not reimplemented. PII rule (D4): masked email ONLY, in
// Run AND export alike — maskEmailDomain() verbatim, never the raw
// RegistrationDraftDoc.email field.
import "server-only";

import {
  REGISTRATION_DRAFT_LIST_LIMIT,
  getAdminRegistrationDraftsForEvent,
  type AdminRegistrationDraftListItem,
} from "@/lib/db/adminRegistrationDraft";
import {
  ABANDONED_EMPTY_FALLBACK,
  DRAFT_STEP_LABELS,
  maskEmailDomain,
} from "@/features/attendees/abandoned";
import { timestampToIso, timestampToMs } from "@/features/attendees/roster";
import { REPORT_EXPORT_ROW_LIMIT } from "@/features/reports/csv";
import { REPORT_EXPORT_BATCH_SIZE } from "@/features/reports/server/report-export-loop";
import {
  TYPE_NAME_FALLBACK,
  loadTypeNameMaps,
  type TypeNameMaps,
} from "@/features/reports/server/resolve-type-names";
import type { ReportPage, ReportRow } from "@/features/reports/types";

const RUN_PAGE_SIZE = REGISTRATION_DRAFT_LIST_LIMIT;

// Spec §3's documented wrinkle: getAdminRegistrationDraftsForEvent returns
// ALL drafts (fresh + abandoned); isAbandoned is filtered IN MEMORY per page
// — so the export loop needs a SECOND, independent ceiling (raw-page-fetch
// count) alongside the 1000-abandoned-row cap, bounding the worst case to
// ABANDONED_EXPORT_MAX_RAW_PAGES * REPORT_EXPORT_BATCH_SIZE (4,000) raw
// RegistrationDraft reads even on an event with thousands of fresh,
// non-abandoned, still-in-progress drafts.
export const ABANDONED_EXPORT_MAX_RAW_PAGES = 20;

function serializeRow(
  item: AdminRegistrationDraftListItem,
  names: TypeNameMaps,
): ReportRow {
  const name = [item.firstName?.trim(), item.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    name: name || ABANDONED_EMPTY_FALLBACK,
    // Never the raw address (D4) — domain-only or "—".
    maskedEmail: maskEmailDomain(item.email ?? ""),
    lastStepReached: DRAFT_STEP_LABELS[item.lastStepReached],
    ticketType: item.ticketTypeId
      ? (names.ticketTypeNames.get(item.ticketTypeId) ?? TYPE_NAME_FALLBACK)
      : "",
    registrationType: item.registrationTypeId
      ? (names.registrationTypeNames.get(item.registrationTypeId) ??
        TYPE_NAME_FALLBACK)
      : "",
    lastActivity: timestampToIso(item.updatedAt) ?? "",
  };
}

export async function loadAbandonedRegistrationsPage(input: {
  eventId: string;
  organizationId: string;
  cursorMs?: number;
  nowMs?: number;
}): Promise<ReportPage> {
  const [page, names] = await Promise.all([
    getAdminRegistrationDraftsForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      limit: RUN_PAGE_SIZE,
      startAfterUpdatedAtMs: input.cursorMs,
      nowMs: input.nowMs,
    }),
    loadTypeNameMaps({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }),
  ]);

  const abandoned = page.filter((item) => item.isAbandoned);
  const last = page[page.length - 1];

  return {
    rows: abandoned.map((item) => serializeRow(item, names)),
    nextCursorMs: last ? timestampToMs(last.updatedAt) : null,
    hasMore: page.length === RUN_PAGE_SIZE,
  };
}

export async function loadAbandonedRegistrationsExport(input: {
  eventId: string;
  organizationId: string;
  nowMs?: number;
}): Promise<ReportRow[]> {
  const names = await loadTypeNameMaps({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });

  const collected: AdminRegistrationDraftListItem[] = [];
  let cursorMs: number | undefined;
  let rawPages = 0;

  while (
    collected.length < REPORT_EXPORT_ROW_LIMIT &&
    rawPages < ABANDONED_EXPORT_MAX_RAW_PAGES
  ) {
    const page = await getAdminRegistrationDraftsForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      limit: REPORT_EXPORT_BATCH_SIZE,
      startAfterUpdatedAtMs: cursorMs,
      nowMs: input.nowMs,
    });
    rawPages += 1;
    if (page.length === 0) break;

    const abandoned = page.filter((item) => item.isAbandoned);
    const remaining = REPORT_EXPORT_ROW_LIMIT - collected.length;
    collected.push(...abandoned.slice(0, remaining));

    if (page.length < REPORT_EXPORT_BATCH_SIZE) break; // query exhausted

    const lastItem = page[page.length - 1];
    const nextCursorMs = timestampToMs(lastItem.updatedAt);
    if (nextCursorMs === null) break;
    cursorMs = nextCursorMs;
  }

  return collected.map((item) => serializeRow(item, names));
}
