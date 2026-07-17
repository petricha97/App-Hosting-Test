// Serializes a stored ReportScheduleDoc (src/lib/db/adminReportSchedule.ts,
// Backend's DAL) into the client-safe shape the schedule CRUD API routes
// return (Timestamp -> ms, same convention as
// src/features/emails/default-definitions.ts's serializeStoredDefinition).
import "server-only";

import { timestampToMillis } from "@/features/registration/types";
import type { SerializedReportSchedule } from "@/features/reports/types";
import type { ReportScheduleDoc, WithId } from "@/types/collection";

export function serializeReportSchedule(
  doc: WithId<ReportScheduleDoc>,
): SerializedReportSchedule {
  return {
    templateSlug: doc.templateSlug,
    frequency: doc.frequency,
    dayOfWeek: doc.dayOfWeek,
    dayOfMonth: doc.dayOfMonth,
    hour: doc.hour,
    minute: doc.minute,
    recipients: doc.recipients,
    enabled: doc.enabled,
    createdBy: doc.createdBy,
    createdAtMs: timestampToMillis(doc.createdAt),
    updatedAtMs: timestampToMillis(doc.updatedAt),
  };
}
