// Client-safe RHF/Zod schema for the M7-T3 schedule dialog. Deliberately
// SEPARATE from src/lib/db/reportScheduleSchemas.ts (marked "server-only" —
// importing it into a "use client" component would break the client
// bundle). The server route + DAL (Backend's adminReportSchedule.ts) remain
// the source of truth for validation (defense in depth, same posture as
// every other RHF dialog in this app — see src/features/emails/schemas.ts);
// this file mirrors the bounds only for fast client-side feedback.
// Spec: agents/docs/specs/m7-scheduled-reports.md §2/§3/§4.
import { z } from "zod";

import { REPORT_TEMPLATE_IDS } from "@/features/reports/templates";
import { REPORT_SCHEDULE_FREQUENCIES } from "@/types/collection";

// Mirrors src/lib/db/reportScheduleSchemas.ts's MAX_RECIPIENTS_PER_SCHEDULE
// (server-only, cannot be imported here) — server is the authority; this is
// UX-only fast feedback (spec §2: "a handful of stakeholders, not a mailing
// list").
export const MAX_RECIPIENTS_PER_SCHEDULE_CLIENT = 20;

export const reportScheduleFrequencySchema = z.enum(
  REPORT_SCHEDULE_FREQUENCIES,
);

export const reportScheduleTemplateSlugSchema = z.enum(REPORT_TEMPLATE_IDS);

// Client-side "does this look like an email" check only — the server
// independently re-verifies org membership per candidate (D2); this schema
// never claims to know whether an address is a real member.
export const reportScheduleRecipientEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter an email address.")
  .max(254, "Email address must be 254 characters or fewer.")
  .email("Enter a valid email address.");

// The scalar (non-recipient) fields RHF manages directly — recipients are
// managed as separate component state (src/features/reports/components/
// report-schedule-recipients-field.tsx) so a per-recipient server rejection
// (D2) can be displayed against the specific chip that failed, which an RHF
// array field would make awkward to key stably.
export const reportScheduleFormSchema = z
  .object({
    frequency: reportScheduleFrequencySchema,
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === "weekly" && value.dayOfWeek === null) {
      ctx.addIssue({
        code: "custom",
        path: ["dayOfWeek"],
        message: "Pick a day of the week.",
      });
    }
    if (value.frequency === "monthly" && value.dayOfMonth === null) {
      ctx.addIssue({
        code: "custom",
        path: ["dayOfMonth"],
        message: "Pick a day of the month.",
      });
    }
  });

export type ReportScheduleFormValues = z.infer<typeof reportScheduleFormSchema>;
