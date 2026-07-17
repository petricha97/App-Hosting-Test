// Zod schema + size limits for the M7-T3 `ReportSchedule` entity. Spec:
// agents/docs/specs/m7-scheduled-reports.md §2/§3/§4/§7.
//
// Mirrors adminEmailDefinition.ts's precedent of validating shape here (this
// module) while the DAL (adminReportSchedule.ts) owns the business-rule
// checks Zod can't express standalone (recipient org-membership, the
// deterministic-id upsert). Full-Stack's schedule CRUD route (their slice,
// NOT this file) is expected to run request bodies through
// `reportScheduleUpsertPatchSchema` before calling into the DAL — same
// division of labor as every other M1-M7 mutating route.
import "server-only";

import { z } from "zod";

import { REPORT_TEMPLATE_IDS } from "@/features/reports/templates";
import { emailAddressSchema } from "@/lib/email/schemas";
import { REPORT_SCHEDULE_FREQUENCIES } from "@/types/collection";

// Spec §2: "a handful of stakeholders per report, not a mailing list."
export const MAX_RECIPIENTS_PER_SCHEDULE = 20;

// Spec D4: catch-up never backfills more than this many most-recent periods
// per tick, and never earlier than the schedule's own createdAt.
export const MAX_CATCHUP_PERIODS = 4;

export const reportScheduleFrequencySchema = z.enum(
  REPORT_SCHEDULE_FREQUENCIES,
);

export const reportScheduleTemplateSlugSchema = z.enum(REPORT_TEMPLATE_IDS);

// Candidate recipient emails only — NOT `{email, name}` pairs. The DAL
// resolves each candidate to its matched org member's real name via
// verifyReportScheduleRecipient (spec §2 AC-1: never a client-supplied
// label) and rejects the whole write if any candidate is not a current org
// member (spec §2 AC-2: "zero write to the schedule doc").
export const reportScheduleRecipientEmailsSchema = z
  .array(emailAddressSchema)
  .min(1, "At least one recipient is required.")
  .max(
    MAX_RECIPIENTS_PER_SCHEDULE,
    `A schedule may have at most ${MAX_RECIPIENTS_PER_SCHEDULE} recipients.`,
  )
  .refine((emails) => new Set(emails).size === emails.length, {
    message: "Duplicate recipient email.",
  });

// The editable shape for BOTH create and edit (D5: "editing a schedule is
// an upsert onto this same [deterministic] id" — one schema, one entrypoint,
// matching EmailDefinition's own upsert precedent).
export const reportScheduleUpsertPatchSchema = z
  .object({
    frequency: reportScheduleFrequencySchema,
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    recipientEmails: reportScheduleRecipientEmailsSchema,
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    // Spec §3: dayOfWeek only meaningful (and required) for weekly;
    // dayOfMonth only meaningful (and required) for monthly — the OTHER
    // field must be null, never a stale leftover from a prior frequency
    // edit (never ambiguous which one the stored doc means).
    if (value.frequency === "weekly" && value.dayOfWeek === null) {
      ctx.addIssue({
        code: "custom",
        path: ["dayOfWeek"],
        message: "dayOfWeek is required for a weekly schedule.",
      });
    }
    if (value.frequency !== "weekly" && value.dayOfWeek !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["dayOfWeek"],
        message: "dayOfWeek must be null unless frequency is weekly.",
      });
    }
    if (value.frequency === "monthly" && value.dayOfMonth === null) {
      ctx.addIssue({
        code: "custom",
        path: ["dayOfMonth"],
        message: "dayOfMonth is required for a monthly schedule.",
      });
    }
    if (value.frequency !== "monthly" && value.dayOfMonth !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["dayOfMonth"],
        message: "dayOfMonth must be null unless frequency is monthly.",
      });
    }
  });

export type ReportScheduleUpsertPatchInput = z.infer<
  typeof reportScheduleUpsertPatchSchema
>;
