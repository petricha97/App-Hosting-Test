// §4 — periodic trigger `unpaid-offsets` (`payment-reminder`, debt chase).
// Spec agents/docs/specs/m6-lifecycle-triggers.md §4: audience =
// `accepted-invoice` (the two-condition eligibility — Attendee.status ===
// "accepted" AND Order.paymentStatus === "outstanding" — is what
// audience-queries.ts's Order-first traversal already enforces), offsets
// measured from Order.createdAt (documented anchor, no dueDate field
// exists), THREE independent dedupeKey instances per order
// (`orderId:offsetDays`), re-evaluated fresh every tick — an order that
// pays off between offsets simply drops out of the `accepted-invoice`
// audience query on the NEXT tick, so later offsets never fire (spec §4:
// "the eligibility re-query on that later tick simply no longer includes
// this order").
import "server-only";

import { queryAudiencePage } from "./audience-queries";
import { unpaidOffsetDedupeKey } from "./dedupe-keys";
import {
  runPagedLifecycleTrigger,
  type LifecycleEventInput,
} from "./paged-trigger-runner";
import type { AudienceCandidate, TriggerEvalOutcome } from "./types";
import type { EmailTransport } from "@/lib/email/transport";
import type { EmailPuckBlock } from "@/types/collection";

export const PAYMENT_REMINDER_KIND = "payment-reminder";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EvaluateUnpaidOffsetsInput {
  organizationId: string;
  eventId: string;
  eventName: string;
  event: LifecycleEventInput;
  definitionId: string | null;
  template: {
    subject: string;
    body: string;
    // M6-T4 — optional, additive (spec Shared decisions).
    bodyMode?: "text" | "blocks";
    bodyBlocks?: EmailPuckBlock[];
  };
  // Fixed system-catalog data (spec §4: "system definitions cannot edit
  // trigger.offsetsDays") — [7, 14, 21] today, passed in rather than
  // hardcoded so a future catalog change is a one-line default-definitions
  // edit, never a re-spec of this evaluator.
  offsetsDays: number[];
  nowMs: number;
  pageSize: number;
  maxPages: number;
  transport?: EmailTransport;
}

export function dueOffsetDedupeKeys(input: {
  candidate: AudienceCandidate;
  offsetsDays: number[];
  nowMs: number;
}): string[] {
  const { candidate, offsetsDays, nowMs } = input;
  if (candidate.orderId === null || candidate.orderCreatedAtMs === null) {
    return [];
  }
  const daysSinceOrder = Math.floor(
    (nowMs - candidate.orderCreatedAtMs) / MS_PER_DAY,
  );
  return offsetsDays
    .filter((offsetDays) => daysSinceOrder >= offsetDays)
    .map((offsetDays) =>
      unpaidOffsetDedupeKey(candidate.orderId as string, offsetDays),
    );
}

export async function evaluateUnpaidOffsetsTrigger(
  input: EvaluateUnpaidOffsetsInput,
): Promise<TriggerEvalOutcome> {
  return runPagedLifecycleTrigger({
    kind: PAYMENT_REMINDER_KIND,
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
        audience: "accepted-invoice",
        eventId: input.eventId,
        organizationId: input.organizationId,
        limit: input.pageSize,
        startAfterMs,
        nowMs: input.nowMs,
      }),
    buildDedupeKeys: (candidate) =>
      dueOffsetDedupeKeys({
        candidate,
        offsetsDays: input.offsetsDays,
        nowMs: input.nowMs,
      }),
  });
}
