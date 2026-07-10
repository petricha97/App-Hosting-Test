// FormData response-status machine (M3-T4) — PURE module (no Firebase
// imports) so it is safe from client components (badge rendering, filter
// selects) and the admin DAL alike.
// Spec: agents/docs/specs/m3-registration-paths.md (M3-T4).
//
// Machine: forward-only along  new < pending < reviewed < accepted.
// - Skipping forward is allowed (e.g. new -> accepted).
// - Backward moves are rejected (routes respond 409).
// - Same-status "transitions" are rejected (this is what makes the accept
//   side-effect hook fire AT MOST ONCE: re-accepting an accepted doc fails).
// - "accepted" is terminal in M3 (un-accept implies attendee teardown — M5).
// - No "rejected" status in M3 (decline semantics deferred to M5 alongside
//   the attendee lifecycle — documented gap).

import type { FormDataDoc, FormDataStatus } from "@/types/collection";

export const FORM_DATA_STATUSES: readonly FormDataStatus[] = [
  "new",
  "pending",
  "reviewed",
  "accepted",
] as const;

const STATUS_RANK: Record<FormDataStatus, number> = {
  new: 0,
  pending: 1,
  reviewed: 2,
  accepted: 3,
};

export function formDataStatusRank(status: FormDataStatus): number {
  return STATUS_RANK[status];
}

// True only for strictly-forward moves. Terminal "accepted" and the
// reject-same-status rule both fall out of the strict inequality.
export function canTransitionFormDataStatus(
  from: FormDataStatus,
  to: FormDataStatus,
): boolean {
  return STATUS_RANK[to] > STATUS_RANK[from];
}

// Read-time default (NO backfill, docs never rewritten on load): legacy
// pre-M3 submissions have no status field and read as "new"; malformed
// values degrade to "new" as well (same convention as
// eventPromotionDefaults.ts).
export function readFormDataStatus(
  doc: Pick<FormDataDoc, "status">,
): FormDataStatus {
  const status = doc.status;
  return status !== undefined && STATUS_RANK[status] !== undefined
    ? status
    : "new";
}

// Read-time defaults for the full M3-T4 additive field set. Returns a NEW
// object; never mutates or persists.
export function applyFormDataReadDefaults<T extends FormDataDoc>(
  doc: T,
): T & {
  status: FormDataStatus;
  orderId: string | null;
  pathId: string | null;
  ticketLabel: string | null;
  attendeeCreated: boolean;
} {
  return {
    ...doc,
    status: readFormDataStatus(doc),
    orderId: doc.orderId ?? null,
    pathId: doc.pathId ?? null,
    ticketLabel: doc.ticketLabel ?? null,
    attendeeCreated: doc.attendeeCreated ?? false,
  };
}
