// Pure, client-safe helpers for the M3-T4 response status workflow: display
// labels, the ?status= URL-filter parser, and the legal forward transitions
// each row's action menu offers. The transition MACHINE itself lives in
// src/lib/db/formDataStatus.ts (pure too) — this module only derives UI
// affordances from it, so the menu can never offer a move the server rejects.

import {
  FORM_DATA_STATUSES,
  canTransitionFormDataStatus,
} from "@/lib/db/formDataStatus";
import type { FormDataStatus } from "@/types/collection";

export const FORM_DATA_STATUS_LABELS: Record<FormDataStatus, string> = {
  new: "New",
  pending: "Pending",
  reviewed: "Reviewed",
  accepted: "Accepted",
};

// Row-action copy per design §4. "new" is never a transition target (it is
// the floor of the forward-only machine), so it has no action label.
export const STATUS_ACTION_LABELS: Record<
  Exclude<FormDataStatus, "new">,
  string
> = {
  pending: "Mark as pending",
  reviewed: "Mark as reviewed",
  accepted: "Accept",
};

// Parses the ?status= URL param. Anything unknown (including "" and the
// explicit "any") means "no filter" — the tables then query without the
// status equality (legacy docs without the field only appear there).
export function parseStatusFilter(
  value: string | string[] | undefined | null,
): FormDataStatus | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return FORM_DATA_STATUSES.find((status) => status === candidate);
}

// Legal forward targets from a status, in machine order. Empty for
// "accepted" (terminal in M3) — those rows render no action menu at all.
export function forwardFormDataStatuses(
  from: FormDataStatus,
): FormDataStatus[] {
  return FORM_DATA_STATUSES.filter((to) =>
    canTransitionFormDataStatus(from, to),
  );
}
