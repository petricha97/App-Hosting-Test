// Pure CSV builder for the responses export (M3-T4 AC-6). No Firebase
// imports — unit-testable and shared by the per-event and workspace export
// routes.
//
// Escaping rules (in this order, both are applied when both match):
// 1. Formula-injection guard: cells starting with = + - or @ — including
//    after any leading whitespace/tab/CR, which some spreadsheet apps trim
//    before evaluating (security review L-2) — are prefixed with a single
//    quote so they are treated as text, never as formulas (CSV injection,
//    OWASP).
// 2. RFC-4180 quoting: cells containing commas, double quotes, CR or LF are
//    wrapped in double quotes with inner quotes doubled.

import type { SerializedResponse } from "@/features/responses/utils";
import type { FormDataStatus } from "@/types/collection";

// Bounded export: 1000 rows per file. Larger events need filtered exports
// (status/event) until a streaming/batched exporter lands (M7 reports).
export const RESPONSES_EXPORT_LIMIT = 1000;

// Matches a formula lead byte even behind leading whitespace (space, tab,
// CR, LF, ...) — guards values like " =SUM(A1)" or "\t=cmd()".
const FORMULA_PREFIX = /^\s*[=+\-@]/;
const NEEDS_QUOTING = /[",\r\n]/;

export function escapeCsvField(value: string): string {
  let field = value;
  if (FORMULA_PREFIX.test(field)) {
    field = `'${field}`;
  }
  if (NEEDS_QUOTING.test(field)) {
    field = `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export interface ResponsesCsvRow {
  name: string;
  email: string;
  eventName: string;
  ticketLabel: string | null;
  status: FormDataStatus;
  submittedAtIso: string | null;
  // Full submission map; identity keys are excluded from the answer columns
  // below because they already travel in the fixed Name/Email columns.
  submission: Record<string, string>;
}

// Export rows come from the same serializer the tables render from, so the
// CSV always matches the on-screen rows (T4 AC-6).
export function toResponsesCsvRow(response: SerializedResponse): ResponsesCsvRow {
  return {
    name: response.attendeeName,
    email: response.attendeeEmail,
    eventName: response.eventName,
    ticketLabel: response.ticketLabel,
    status: response.status,
    submittedAtIso: response.submittedAt?.isoString ?? null,
    submission: response.submission,
  };
}

const IDENTITY_KEYS = new Set(["first_name", "last_name", "email"]);

const FIXED_HEADERS = [
  "Name",
  "Email",
  "Event",
  "Ticket",
  "Status",
  "Submitted",
] as const;

// Stable answer-column set: the sorted union of submission keys across all
// exported rows (forms differ per event on the workspace export).
export function collectAnswerKeys(rows: ResponsesCsvRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.submission)) {
      if (!IDENTITY_KEYS.has(key)) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

export function buildResponsesCsv(rows: ResponsesCsvRow[]): string {
  const answerKeys = collectAnswerKeys(rows);
  const header = [...FIXED_HEADERS, ...answerKeys].map(escapeCsvField);

  const lines = rows.map((row) => {
    const cells = [
      row.name,
      row.email,
      row.eventName,
      row.ticketLabel ?? "",
      row.status,
      row.submittedAtIso ?? "",
      ...answerKeys.map((key) => row.submission[key] ?? ""),
    ];
    return cells.map(escapeCsvField).join(",");
  });

  // CRLF line endings per RFC 4180 (and Excel).
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
