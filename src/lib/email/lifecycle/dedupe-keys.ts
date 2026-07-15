// The three periodic-trigger dedupeKey formulas (M6-T3 spec
// agents/docs/specs/m6-lifecycle-triggers.md §3/§4/§5) — PURE, no I/O.
//
// This file is the single source of truth for these formulas: every
// evaluator module imports from here rather than inlining the string
// template, so the safety-critical "same logical send always produces the
// same dedupeKey" property is guaranteed by construction (a typo'd inline
// template in one call site can never silently diverge from another).
//
// Combined with `createAdminEmailMessageIfAbsent`'s create-if-absent
// transaction (M6-T1) at the deterministic id derived from
// (org, event, kind, recipientEmail, dedupeKey), a stable dedupeKey is the
// ENTIRE double-send prevention mechanism — no new "already sent" marker
// collection exists or is needed (spec Shared decisions).
import "server-only";

// §3 abandoned-24h (`abandoned-reminder`): one draft is one lifecycle
// instance, created once, deleted once — the draftId IS the dedupeKey.
// Also reused verbatim by §7's "Email all" bulk action (Full-Stack slice) so
// the manual button and the automatic sweep share exactly one dedupe scheme.
export function abandonedReminderDedupeKey(draftId: string): string {
  return draftId;
}

// §4 unpaid-offsets (`payment-reminder`): THREE independent dedupe
// instances per order, one per offset day, all sharing kind
// "payment-reminder". `offsetDays` must be one of the definition's stored
// trigger.offsetsDays values (7 | 14 | 21 today) — never re-derived here.
export function unpaidOffsetDedupeKey(
  orderId: string,
  offsetDays: number,
): string {
  return `${orderId}:${offsetDays}`;
}

// §5 scheduled (system `one-week-to-go`/`qr-ready` + any custom scheduled
// definition): keyed by the DEFINITION (not `kind` — see spec §5 rationale)
// plus the audience-specific recipient identity (§6 table: attendeeId for
// the three accepted-* audiences, submissionId for pending-approval, draftId
// for abandoned; all-invitees never reaches this, §6 no-op).
export function scheduledDedupeKey(
  definitionId: string,
  recipientKey: string,
): string {
  return `${definitionId}:${recipientKey}`;
}
