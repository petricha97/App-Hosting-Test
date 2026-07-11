// Pure CSV builder for the attendees export (M5-T2 AC-8). Reuses the M3-T4
// escaping rules (formula-injection guard + RFC-4180 quoting) from
// src/features/responses/csv.ts — never a second escaping implementation.
// No Firebase imports.

import { escapeCsvField } from "@/features/responses/csv";
import type { SerializedAttendeeRow } from "@/features/attendees/roster";

// Bounded export, same cap rationale as the responses export (M3-T4 AC-6).
export const ATTENDEES_EXPORT_LIMIT = 1000;

// Columns per spec T2: name, email, company, ticket, registration type,
// status, check-in state, checked-in at.
const HEADERS = [
  "Name",
  "Email",
  "Company",
  "Ticket",
  "Registration type",
  "Status",
  "Check-in",
  "Checked-in at",
] as const;

export function buildAttendeesCsv(rows: SerializedAttendeeRow[]): string {
  const header = HEADERS.map(escapeCsvField);

  const lines = rows.map((row) => {
    const cells = [
      row.name,
      row.email,
      row.company,
      row.ticketLabel ?? "",
      row.registrationTypeLabel ?? "",
      row.status,
      row.checkInState ?? "",
      row.checkedInAtIso ?? "",
    ];
    return cells.map(escapeCsvField).join(",");
  });

  // CRLF line endings per RFC 4180 (and Excel).
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
