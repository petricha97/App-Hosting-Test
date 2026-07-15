// Shared types for the M6-T3 periodic lifecycle-trigger evaluator (spec
// agents/docs/specs/m6-lifecycle-triggers.md). PURE type declarations only.
import "server-only";

import type { BuildEmailMergeContextInput } from "@/lib/email/merge-context";

// One page-worth candidate for a §6 audience segment, normalized to exactly
// what the evaluator needs: enough to compute a stable dedupeKey, enough to
// build the merge context (event is supplied separately, once per call —
// never re-read per candidate), and the attendeeId/submissionId/orderId the
// resulting EmailMessage row should carry.
export interface AudienceCandidate {
  // §5's "recipientKey" (attendeeId | submissionId | draftId depending on
  // audience, §6 table) — the §3/§4 triggers derive their own dedupeKey
  // components directly (draftId, orderId) rather than through this field.
  recipientKey: string;
  recipient: { name: string; email: string };
  attendeeId: string | null;
  submissionId: string | null;
  orderId: string | null;
  // Order.createdAt in ms — only populated for the two Order-joined
  // audiences (accepted-paid / accepted-invoice); §4's offset-days math
  // reads this directly instead of a second Order fetch.
  orderCreatedAtMs: number | null;
  mergeInput: Omit<BuildEmailMergeContextInput, "event" | "qrCodeSvg">;
}

export interface AudiencePageResult {
  candidates: AudienceCandidate[];
  // Cursor for the NEXT page within this invocation (§8: bounded pages,
  // multiple pages processed per tick up to a budget). Not persisted across
  // HTTP invocations in T3 — see the data-model doc's "resumability" note.
  nextCursorMs: number | null;
  // true when a full page was read (more MAY remain) — the same "load more"
  // heuristic used by every cursor-paginated list in this codebase.
  hasMore: boolean;
}

// Aggregate outcome of evaluating one trigger (abandoned-24h /
// unpaid-offsets / one scheduled definition) across however many pages this
// invocation processed.
export interface TriggerEvalOutcome {
  pagesProcessed: number;
  // NEW EmailMessage rows written (duplicates/rejections/no-ops excluded) —
  // sendEventEmailBatch's own `enqueued` counter, summed across pages.
  enqueued: number;
  duplicates: number;
  rejected: number;
  failed: number;
  stoppedReason:
    | "exhausted" // no more candidates
    | "disabled" // enabled:false observed at a page boundary
    | "budget" // maxPages reached with candidates possibly remaining
    | "not-due" // trigger.at is null, or now < trigger.at
    | "past-cutoff"; // §5 catch-up window has closed
}
