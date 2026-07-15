// Per-event orchestrator — the entrypoint agents/docs/specs/m6-lifecycle-triggers.md
// itself never names explicitly, but §3/§4/§5 collectively require: for ONE
// event, evaluate the fixed-kind abandoned-24h and unpaid-offsets triggers
// plus every currently-scheduled definition (system defaults AND custom),
// reusing the SAME merged virtual+stored definition list T2's screen reads
// (mergeEmailDefinitions, default-definitions.ts) so this evaluator can
// never disagree with what the Emails screen shows as "enabled"/"scheduled
// for".
import "server-only";

import { listAdminEmailDefinitionsForEvent } from "@/lib/db/adminEmailDefinition";
import { mergeEmailDefinitions } from "@/features/emails/default-definitions";
import type { EmailTransport } from "@/lib/email/transport";
import {
  ABANDONED_REMINDER_KIND,
  evaluateAbandonedReminderTrigger,
} from "./evaluate-abandoned";
import {
  PAYMENT_REMINDER_KIND,
  evaluateUnpaidOffsetsTrigger,
} from "./evaluate-unpaid-offsets";
import {
  evaluateScheduledDefinitionTrigger,
  type ScheduledDefinitionInput,
} from "./evaluate-scheduled";
import type { LifecycleEventInput } from "./paged-trigger-runner";
import type { TriggerEvalOutcome } from "./types";

// Default budget per trigger per event per invocation — the §8 "bounded,
// resumable" contract. 100 candidates/page keeps a single page's
// sendEventEmailBatch call well clear of the sequential-processing cost
// called out in §8; 20 pages caps a single trigger at ~2,000 candidates per
// tick (comfortably covers the spec's own 5,000-attendee worked example
// across 2-3 ticks, never in one unbounded shot).
export const DEFAULT_LIFECYCLE_PAGE_SIZE = 100;
export const DEFAULT_LIFECYCLE_MAX_PAGES_PER_TRIGGER = 20;

export interface EvaluateEventLifecycleTriggersInput {
  organizationId: string;
  eventId: string;
  event: LifecycleEventInput;
  nowMs?: number;
  pageSize?: number;
  maxPagesPerTrigger?: number;
  transport?: EmailTransport;
}

export interface EventLifecycleTriggerResult {
  kind: string;
  definitionId: string | null;
  outcome: TriggerEvalOutcome;
}

export interface EvaluateEventLifecycleTriggersResult {
  eventId: string;
  organizationId: string;
  results: EventLifecycleTriggerResult[];
}

export async function evaluateEventLifecycleTriggers(
  input: EvaluateEventLifecycleTriggersInput,
): Promise<EvaluateEventLifecycleTriggersResult> {
  const nowMs = input.nowMs ?? Date.now();
  const pageSize = input.pageSize ?? DEFAULT_LIFECYCLE_PAGE_SIZE;
  const maxPages =
    input.maxPagesPerTrigger ?? DEFAULT_LIFECYCLE_MAX_PAGES_PER_TRIGGER;

  const stored = await listAdminEmailDefinitionsForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
  const merged = mergeEmailDefinitions({
    stored,
    event: input.event,
    organizationId: input.organizationId,
    eventId: input.eventId,
  });

  const results: EventLifecycleTriggerResult[] = [];

  const abandonedDefinition = merged.find(
    (d) => d.kind === ABANDONED_REMINDER_KIND,
  );
  if (abandonedDefinition) {
    const outcome = await evaluateAbandonedReminderTrigger({
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: input.event.name,
      event: input.event,
      definitionId: abandonedDefinition.id,
      template: {
        subject: abandonedDefinition.subject,
        body: abandonedDefinition.body,
      },
      nowMs,
      pageSize,
      maxPages,
      transport: input.transport,
    });
    results.push({
      kind: ABANDONED_REMINDER_KIND,
      definitionId: abandonedDefinition.id,
      outcome,
    });
  }

  const paymentReminderDefinition = merged.find(
    (d) => d.kind === PAYMENT_REMINDER_KIND,
  );
  if (paymentReminderDefinition) {
    const trigger = paymentReminderDefinition.trigger;
    const offsetsDays =
      trigger.type === "unpaid-offsets" ? trigger.offsetsDays : [];
    const outcome = await evaluateUnpaidOffsetsTrigger({
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: input.event.name,
      event: input.event,
      definitionId: paymentReminderDefinition.id,
      template: {
        subject: paymentReminderDefinition.subject,
        body: paymentReminderDefinition.body,
      },
      offsetsDays,
      nowMs,
      pageSize,
      maxPages,
      transport: input.transport,
    });
    results.push({
      kind: PAYMENT_REMINDER_KIND,
      definitionId: paymentReminderDefinition.id,
      outcome,
    });
  }

  const scheduledDefinitions = merged.filter(
    (d) => d.trigger.type === "scheduled",
  );
  for (const definition of scheduledDefinitions) {
    const trigger = definition.trigger;
    const scheduledInput: ScheduledDefinitionInput = {
      id: definition.id,
      kind: definition.kind,
      audience: definition.audience,
      atMs: trigger.type === "scheduled" ? trigger.atMs : null,
      subject: definition.subject,
      body: definition.body,
    };

    const outcome = await evaluateScheduledDefinitionTrigger({
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: input.event.name,
      event: input.event,
      definition: scheduledInput,
      nowMs,
      pageSize,
      maxPages,
      transport: input.transport,
    });
    results.push({
      kind: definition.kind,
      definitionId: definition.id,
      outcome,
    });
  }

  return {
    eventId: input.eventId,
    organizationId: input.organizationId,
    results,
  };
}
