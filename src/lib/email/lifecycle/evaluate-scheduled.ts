// §5 — periodic trigger `scheduled` (system `one-week-to-go` / `qr-ready`,
// plus any custom scheduled definition). Spec
// agents/docs/specs/m6-lifecycle-triggers.md §5: fires at `now >=
// trigger.at`, keeps catching up newly-eligible audience members on later
// ticks, stops catching up once the event's first period has started —
// dedupeKey = `definitionId:recipientKey`.
import "server-only";

import { queryAudiencePage } from "./audience-queries";
import { scheduledDedupeKey } from "./dedupe-keys";
import { resolveEventFirstPeriodStartMs } from "./event-schedule";
import {
  runPagedLifecycleTrigger,
  type LifecycleEventInput,
} from "./paged-trigger-runner";
import type { TriggerEvalOutcome } from "./types";
import type { EmailDefinitionAudience } from "@/types/collection";
import type { EmailTransport } from "@/lib/email/transport";

export interface ScheduledDefinitionInput {
  // The deterministic definitionId (SerializedEmailDefinition.id) — carried
  // on every resulting EmailMessage row and used as the dedupeKey prefix.
  id: string;
  kind: string;
  audience: EmailDefinitionAudience;
  // Resolved absolute instant (T2 already materializes this from
  // event-local time at edit time — never re-derived here); null = "Not
  // scheduled", never fires.
  atMs: number | null;
  subject: string;
  body: string;
}

export interface EvaluateScheduledDefinitionInput {
  organizationId: string;
  eventId: string;
  eventName: string;
  event: LifecycleEventInput;
  definition: ScheduledDefinitionInput;
  nowMs: number;
  pageSize: number;
  maxPages: number;
  transport?: EmailTransport;
}

export async function evaluateScheduledDefinitionTrigger(
  input: EvaluateScheduledDefinitionInput,
): Promise<TriggerEvalOutcome> {
  const { definition } = input;

  if (definition.atMs === null || input.nowMs < definition.atMs) {
    return {
      pagesProcessed: 0,
      enqueued: 0,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      stoppedReason: "not-due",
    };
  }

  // Catch-up window cutoff (spec §5): once `now` has passed the event's
  // first period start, this scheduled definition never fires again for
  // anyone, even though `now >= trigger.at` and `enabled` both remain true.
  // Skipping the query entirely (rather than filtering candidates) is what
  // makes "an attendee accepted after the event started never receives it"
  // true regardless of when THEY became eligible.
  const cutoffMs = resolveEventFirstPeriodStartMs(input.event);
  if (cutoffMs !== null && input.nowMs >= cutoffMs) {
    return {
      pagesProcessed: 0,
      enqueued: 0,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      stoppedReason: "past-cutoff",
    };
  }

  return runPagedLifecycleTrigger({
    kind: definition.kind,
    organizationId: input.organizationId,
    eventId: input.eventId,
    eventName: input.eventName,
    event: input.event,
    definitionId: definition.id,
    template: { subject: definition.subject, body: definition.body },
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    transport: input.transport,
    fetchPage: (startAfterMs) =>
      queryAudiencePage({
        audience: definition.audience,
        eventId: input.eventId,
        organizationId: input.organizationId,
        limit: input.pageSize,
        startAfterMs,
        nowMs: input.nowMs,
      }),
    buildDedupeKeys: (candidate) => [
      scheduledDedupeKey(definition.id, candidate.recipientKey),
    ],
  });
}
