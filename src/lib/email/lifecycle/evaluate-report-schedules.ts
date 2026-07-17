// M7-T3 — scheduled report delivery, folded into M6-T3's existing periodic
// sweep (spec agents/docs/specs/m7-scheduled-reports.md D5: "extend the SAME
// evaluator, not a parallel one"). Evaluates ONE already-loaded
// `ReportSchedule` across every period currently due for it (D3's
// deterministic periodKey math, D4's bounded catch-up window) — mirrors
// evaluate-scheduled.ts's per-definition shape (evaluate-event.ts's
// per-event fan-out loops schedules the same way it already loops scheduled
// EmailDefinitions, see that file for the wiring).
//
// The ONE real difference from M6-T3's three trigger types (D5, stated
// explicitly): a ReportSchedule has NO audience query at all — its
// "recipients" are a small, static, organizer-configured list stored
// directly on the doc, re-verified per-recipient at fire time (D2) rather
// than re-queried as a segment. `queryAudiencePage`/`runPagedLifecycleTrigger`
// are therefore NOT reused here (D4: no paging infrastructure is needed at
// this volume — worst case per schedule per tick is
// `MAX_CATCHUP_PERIODS x MAX_RECIPIENTS_PER_SCHEDULE` = 4 x 20 = 80 send
// attempts).
import "server-only";

import { deriveBodyForDefinition } from "@/features/emails/server/render";
import { getReportTemplate } from "@/features/reports/templates";
import { resolveEventTimeZone } from "@/features/registration/utils";
import { getAdminReportScheduleForEvent } from "@/lib/db/adminReportSchedule";
import { getAdminUserMembership } from "@/lib/db/adminUserOrganization";
import { MAX_CATCHUP_PERIODS } from "@/lib/db/reportScheduleSchemas";
import { resolveEmailBaseUrl } from "@/lib/email/base-url";
import { reportScheduleDedupeKey } from "./dedupe-keys";
import {
  resolveDueReportSchedulePeriods,
  type ReportSchedulePeriod,
} from "./report-schedule-periods";
import type { LifecycleEventInput } from "./paged-trigger-runner";
import type { TriggerEvalOutcome } from "./types";
import { sendEventEmailBatch } from "@/lib/email/send-service";
import type { EmailTransport } from "@/lib/email/transport";
import type { ReportScheduleDoc, WithId } from "@/types/collection";

export const REPORT_SCHEDULE_KIND_PREFIX = "scheduled-report:";

// Spec §5: "kind = 'scheduled-report:' + templateSlug" — a new, free-text
// `kind` value, NOT routed through EmailDefinition (definitionId stays
// null). The Email overview report's existing kind -> name resolution
// already falls back to the raw kind string for any unmatched value
// (M7-T2, unmodified) — this shows up there for free.
export function reportScheduleKind(templateSlug: string): string {
  return `${REPORT_SCHEDULE_KIND_PREFIX}${templateSlug}`;
}

function timestampToMs(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === "function") return candidate.toMillis();
  if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  return null;
}

// Spec §1 AC-3 / D1: the deep link is the ENTIRE payload — no row data, no
// attendee names/emails, no dollar amounts (spec §5 AC-3). Falls back to a
// site-relative path when NEXT_PUBLIC_APP_URL is unset/invalid
// (resolveEmailBaseUrl's documented null case) rather than blocking the
// send entirely — a relative link is still useful to an organizer who
// already has the dashboard open, and this is a notification, not the sole
// access path to the report.
export function buildReportScheduleDeepLink(input: {
  eventId: string;
  templateSlug: string;
  baseUrl: string | null;
}): string {
  const path = `/dashboard/events/${input.eventId}/reports?template=${input.templateSlug}`;
  return input.baseUrl ? `${input.baseUrl}${path}` : path;
}

// Fixed, code-defined copy (spec §5 — explicitly NOT organizer-editable in
// this ticket's scope). Content is intentionally minimal and non-PII: it
// names the report and links to it, nothing else.
export function buildReportScheduleEmailCopy(input: {
  templateName: string;
  eventName: string;
  link: string;
}): { subject: string; body: string } {
  const subject = `Your ${input.templateName} report is ready — ${input.eventName}`;
  const body =
    `The "${input.templateName}" report for ${input.eventName} is ready to view.\n\n` +
    `Open it here: ${input.link}\n\n` +
    `This is an automated notification — no report data is included in this email.`;
  return { subject, body };
}

export interface EvaluateReportScheduleTriggerInput {
  organizationId: string;
  eventId: string;
  eventName: string;
  event: LifecycleEventInput;
  schedule: WithId<ReportScheduleDoc>;
  nowMs: number;
  transport?: EmailTransport;
}

function outcomeFrom(): TriggerEvalOutcome {
  return {
    pagesProcessed: 0,
    enqueued: 0,
    duplicates: 0,
    rejected: 0,
    failed: 0,
    stoppedReason: "exhausted",
  };
}

// Re-checks `enabled` fresh (spec §3 AC-6: disabling a schedule mid-tick
// stops later periods from firing on that tick while already-enqueued sends
// stand) AND returns the CURRENT stored recipient list — never a value
// captured once at the top of the tick (T2/T3's established "re-read
// immediately before use" discipline, applied to a whole doc here since a
// ReportSchedule's `enabled` and `recipients` are both mutable at any time).
async function reloadSchedule(
  input: EvaluateReportScheduleTriggerInput,
): Promise<WithId<ReportScheduleDoc> | null> {
  return getAdminReportScheduleForEvent({
    scheduleId: input.schedule.id,
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
}

export async function evaluateReportScheduleTrigger(
  input: EvaluateReportScheduleTriggerInput,
): Promise<TriggerEvalOutcome> {
  const outcome = outcomeFrom();
  const { schedule } = input;

  const template = getReportTemplate(schedule.templateSlug);
  if (!template) {
    // Defensive only — the 5 templates are a fixed, code-defined set (spec
    // §7: "there is no 'template deleted out from under a schedule' case to
    // handle"). Never reachable through normal operation.
    return { ...outcome, stoppedReason: "not-due" };
  }

  const timeZone = resolveEventTimeZone(input.event.timezone);
  const notBeforeMs = timestampToMs(schedule.createdAt) ?? input.nowMs;

  // Oldest-first (D4's "period N before period N+1" ordering, spec §3
  // AC-6) — resolveDueReportSchedulePeriods itself returns newest-first.
  const periods: ReportSchedulePeriod[] = resolveDueReportSchedulePeriods({
    frequency: schedule.frequency,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    hour: schedule.hour,
    minute: schedule.minute,
    timeZone,
    nowMs: input.nowMs,
    notBeforeMs,
    maxPeriods: MAX_CATCHUP_PERIODS,
  })
    .slice()
    .reverse();

  if (periods.length === 0) {
    return { ...outcome, stoppedReason: "not-due" };
  }

  const baseUrl = await resolveEmailBaseUrl();
  const link = buildReportScheduleDeepLink({
    eventId: input.eventId,
    templateSlug: schedule.templateSlug,
    baseUrl,
  });
  const { subject, body } = buildReportScheduleEmailCopy({
    templateName: template.name,
    eventName: input.eventName,
    link,
  });
  // Derived ONCE per tick (identical for every period/recipient of this
  // schedule — no per-recipient personalization exists for this kind, spec
  // §5's own content rule) — same "derive once, reuse across the loop"
  // discipline as runPagedLifecycleTrigger.
  const { bodyHtml, bodyText } = deriveBodyForDefinition({ body });

  const kind = reportScheduleKind(schedule.templateSlug);

  for (const period of periods) {
    // Fresh re-read at the START of every period (spec §3 AC-6) — a
    // schedule disabled between periods must stop firing for every LATER
    // period on this same tick while earlier periods' already-enqueued
    // sends stand.
    const fresh = await reloadSchedule(input);
    if (!fresh || !fresh.enabled) {
      outcome.stoppedReason = "disabled";
      break;
    }

    outcome.pagesProcessed += 1;

    // D2's durability guarantee: re-verify EVERY stored recipient fresh,
    // immediately before this period's send. A departed member is
    // SILENTLY DROPPED from this send only — no error, no mutation of the
    // schedule's own stored recipient list (they resume automatically if
    // they rejoin the org before a later period fires).
    const verified: Array<{ email: string; name: string }> = [];
    for (const recipient of fresh.recipients) {
      const membership = await getAdminUserMembership(
        recipient.email,
        input.organizationId,
      );
      if (membership) verified.push(recipient);
    }

    if (verified.length === 0) {
      // Spec §7: "the sweep still fires in the sense of attempting the
      // batch... zero error, zero crash, the schedule silently produces no
      // mail for that period and tries again next period" — pagesProcessed
      // already counted this attempt above.
      continue;
    }

    const dedupeKey = reportScheduleDedupeKey(schedule.id, period.periodKey);
    const result = await sendEventEmailBatch({
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: input.eventName,
      kind,
      definitionId: null,
      template: { subject, bodyHtml, bodyText },
      recipients: verified.map((recipient) => ({
        recipient,
        dedupeKey,
        context: {},
      })),
      transport: input.transport,
    });

    if (result.ok) {
      outcome.enqueued += result.enqueued;
      for (const entry of result.results) {
        if (entry.outcome === "duplicate") outcome.duplicates += 1;
        if (entry.outcome === "failed") outcome.failed += 1;
        if (entry.outcome === "rejected") outcome.rejected += 1;
      }
    } else {
      // Should not happen — every recipient here was already independently
      // verified via getAdminUserMembership, whose stored email passed
      // emailAddressSchema at add-time (reportScheduleSchemas.ts). Surfaced
      // defensively rather than swallowed, same posture as
      // runPagedLifecycleTrigger's equivalent branch.
      outcome.rejected += result.invalid.length;
    }
  }

  return outcome;
}
