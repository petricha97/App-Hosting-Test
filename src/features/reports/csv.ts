// Shared CSV mechanics for the M7-T2 report templates library (spec §7).
// Reuses the M3-T4 escaping rules (formula-injection guard + RFC-4180
// quoting) from src/features/responses/csv.ts VERBATIM — no new escaping
// implementation, for any of the 5 templates.
import { escapeCsvField } from "@/features/responses/csv";
import type { ReportColumnConfig } from "@/features/reports/templates";
import type { ReportRow } from "@/features/reports/types";

// Bounded export, same cap rationale/value as ATTENDEES_EXPORT_LIMIT /
// RESPONSES_EXPORT_LIMIT (spec D2) — one shared constant so the ceiling is
// changeable in one place for all 5 templates.
export const REPORT_EXPORT_ROW_LIMIT = 1000;

// One builder for all 5 templates: the column list (order + header text)
// varies per template (templates.ts), the escaping/quoting/line-ending
// mechanics do not. Column headers are the exact ordered list from each
// template's spec column table (§1–§5) — e.g. "Checked-in at", never
// "checkedInAt" (spec §7).
export function buildReportCsv(
  columns: ReportColumnConfig[],
  rows: ReportRow[],
): string {
  const header = columns.map((column) => escapeCsvField(column.header));

  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvField(row[column.key] ?? "")).join(","),
  );

  // CRLF line endings per RFC 4180 (and Excel) — same convention as
  // buildAttendeesCsv / buildResponsesCsv.
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
