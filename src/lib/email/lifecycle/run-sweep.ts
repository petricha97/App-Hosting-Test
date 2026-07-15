// The top-level sweep the internal scheduler entrypoint (§8/§9) invokes:
// iterate Published events (bounded, cursor-paginated — never an unbounded
// platform-wide read) and run the per-event trigger evaluator against each.
//
// Event-level fan-out is a documented, deliberately modest scope decision
// (see the data-model doc's "sweep fairness" note): each tick starts from
// the newest-updated Published event and processes up to `maxEvents` of
// them, budgeted independently of the per-trigger page budget
// (evaluate-event.ts). Because every send is idempotent via its dedupeKey,
// re-processing the same events on the next tick before reaching older ones
// is safe (never a duplicate), if perhaps momentarily unfair to an event
// that hasn't been touched in a while — a persisted round-robin cursor is
// the natural follow-up once real event volume warrants it (out of scope
// here, mechanism-agnostic per spec §8).
import "server-only";

import {
  getAdminEventForOrganization,
  listAdminPublishedEventsPage,
} from "@/lib/db/adminEvent";
import { extractOrganizationIdFromPath } from "@/features/event/utils";
import type { EmailTransport } from "@/lib/email/transport";
import {
  evaluateEventLifecycleTriggers,
  type EvaluateEventLifecycleTriggersResult,
} from "./evaluate-event";
import type { LifecycleEventInput } from "./paged-trigger-runner";

// Conservative default: each event's own evaluation can itself run up to
// (page budget) x (trigger count) Firestore round trips, so the event-level
// budget stays modest to keep one Cloud Run invocation well inside a
// request timeout even before a real per-provider rate limiter exists
// (spec §8 "forward-looking, not required now").
export const DEFAULT_LIFECYCLE_SWEEP_MAX_EVENTS = 25;

export interface RunLifecycleTriggerSweepInput {
  nowMs?: number;
  pageSize?: number;
  maxPagesPerTrigger?: number;
  maxEvents?: number;
  transport?: EmailTransport;
  // Test/DI + targeted-invocation seam: evaluate exactly one event instead
  // of sweeping Published events. Every DAL call this makes still carries
  // BOTH organizationId and eventId (spec §9 tenancy requirement) — this is
  // never a bare eventId lookup.
  onlyEvent?: { eventId: string; organizationId: string };
}

export interface LifecycleTriggerSweepResult {
  eventsEvaluated: number;
  events: EvaluateEventLifecycleTriggersResult[];
}

function toLifecycleEventInput(event: {
  id: string;
  name: string;
  periods: Array<Record<string, string>>;
  timezone: string;
}): LifecycleEventInput {
  return {
    id: event.id,
    name: event.name,
    periods: event.periods,
    timezone: event.timezone,
  };
}

export async function runLifecycleTriggerSweep(
  input: RunLifecycleTriggerSweepInput = {},
): Promise<LifecycleTriggerSweepResult> {
  const nowMs = input.nowMs ?? Date.now();

  if (input.onlyEvent) {
    const event = await getAdminEventForOrganization(
      input.onlyEvent.eventId,
      input.onlyEvent.organizationId,
    );
    if (!event) {
      return { eventsEvaluated: 0, events: [] };
    }
    const result = await evaluateEventLifecycleTriggers({
      organizationId: input.onlyEvent.organizationId,
      eventId: input.onlyEvent.eventId,
      event: toLifecycleEventInput(event),
      nowMs,
      pageSize: input.pageSize,
      maxPagesPerTrigger: input.maxPagesPerTrigger,
      transport: input.transport,
    });
    return { eventsEvaluated: 1, events: [result] };
  }

  const maxEvents = input.maxEvents ?? DEFAULT_LIFECYCLE_SWEEP_MAX_EVENTS;
  const events = await listAdminPublishedEventsPage({ limit: maxEvents });

  const results: EvaluateEventLifecycleTriggersResult[] = [];
  for (const event of events) {
    // Event docs carry organizationPath, not a bare organizationId (same
    // derivation getAdminEventForOrganization's callers already use) —
    // every DAL call below still receives a real organizationId, never a
    // blank string standing in for "unknown tenant" (spec §9 tenancy rule).
    const organizationId = extractOrganizationIdFromPath(
      event.organizationPath,
    );
    if (!organizationId) continue;

    const result = await evaluateEventLifecycleTriggers({
      organizationId,
      eventId: event.id,
      event: toLifecycleEventInput(event),
      nowMs,
      pageSize: input.pageSize,
      maxPagesPerTrigger: input.maxPagesPerTrigger,
      transport: input.transport,
    });
    results.push(result);
  }

  return { eventsEvaluated: results.length, events: results };
}
