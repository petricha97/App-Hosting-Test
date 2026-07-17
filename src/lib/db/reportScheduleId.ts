// Deterministic ReportSchedule document IDs — PURE module (node:crypto
// only, no Firebase). Spec: agents/docs/specs/m7-scheduled-reports.md §4.
//
// The doc id is DERIVED FROM THE LOGICAL SCHEDULE TUPLE
// (organizationId, eventId, templateSlug) — same tuple-hash family as
// src/lib/db/emailDefinitionId.ts / emailMessageId.ts / formDataId.ts /
// attendeeId.ts. Consequence (spec §4, deliberate scope decision): an event
// can have AT MOST ONE schedule per report template (5 templates -> 5 max
// schedules), and "editing a schedule" is a create-if-absent UPSERT onto
// this same id — no separate "does a schedule already exist for this
// template" lookup is ever needed before writing
// (src/lib/db/adminReportSchedule.ts).

import { createHash } from "node:crypto";

export function reportScheduleId(input: {
  organizationId: string;
  eventId: string;
  templateSlug: string;
}): string {
  const material = JSON.stringify([
    "ReportSchedule",
    input.organizationId,
    input.eventId,
    input.templateSlug,
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}
