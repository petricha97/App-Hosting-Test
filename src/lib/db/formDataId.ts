// Deterministic FormData document IDs for draft finalization — PURE module
// (node:crypto only, no Firebase). Spec: agents/docs/specs/m3-registration-paths.md
// (M3-T3 finalize / crash-recovery contract).
//
// At finalize the FormData doc ID is DERIVED FROM THE DRAFT ID so the
// order -> FormData -> draft-delete sequence is crash-recoverable: a retry
// after a crash between the order write and the FormData write replays
// placeOrder idempotently AND lands the FormData create on the same doc —
// exactly one submission per draft, ever (create-if-absent upsert in
// createAdminFormDataForDraft).
//
// Same tuple-hash construction as src/lib/orders/order-id.ts: scoped to
// (organizationId, eventId) so ids are namespaced per tenant + event, with a
// "FormData" domain prefix so this derivation can never collide with the
// Order id derivation, and JSON encoding so no separator ambiguity exists.

import { createHash } from "node:crypto";

export function formDataIdFromDraftId(input: {
  organizationId: string;
  eventId: string;
  draftId: string;
}): string {
  const material = JSON.stringify([
    "FormData",
    input.organizationId,
    input.eventId,
    input.draftId,
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}
