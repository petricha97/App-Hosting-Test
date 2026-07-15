// §3 — periodic trigger `abandoned-24h` (`abandoned-reminder`). Spec
// agents/docs/specs/m6-lifecycle-triggers.md §3: dedupeKey = draftId, one
// draft is one lifecycle instance, no per-tick repeat risk.
import "server-only";

import { queryAudiencePage } from "./audience-queries";
import { abandonedReminderDedupeKey } from "./dedupe-keys";
import {
  runPagedLifecycleTrigger,
  type LifecycleEventInput,
} from "./paged-trigger-runner";
import type { AudienceCandidate, TriggerEvalOutcome } from "./types";
import type { EmailTransport } from "@/lib/email/transport";

export const ABANDONED_REMINDER_KIND = "abandoned-reminder";

export interface EvaluateAbandonedReminderInput {
  organizationId: string;
  eventId: string;
  eventName: string;
  event: LifecycleEventInput;
  definitionId: string | null;
  template: { subject: string; body: string };
  nowMs: number;
  pageSize: number;
  maxPages: number;
  transport?: EmailTransport;
}

export async function evaluateAbandonedReminderTrigger(
  input: EvaluateAbandonedReminderInput,
): Promise<TriggerEvalOutcome> {
  return runPagedLifecycleTrigger({
    kind: ABANDONED_REMINDER_KIND,
    organizationId: input.organizationId,
    eventId: input.eventId,
    eventName: input.eventName,
    event: input.event,
    definitionId: input.definitionId,
    template: input.template,
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    transport: input.transport,
    fetchPage: (startAfterMs) =>
      queryAudiencePage({
        audience: "abandoned",
        eventId: input.eventId,
        organizationId: input.organizationId,
        limit: input.pageSize,
        startAfterMs,
        nowMs: input.nowMs,
      }),
    buildDedupeKeys: (candidate: AudienceCandidate) => [
      abandonedReminderDedupeKey(candidate.recipientKey),
    ],
  });
}
