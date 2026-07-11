// Deterministic Attendee document IDs — PURE module (node:crypto only, no
// Firebase). Spec: agents/docs/specs/m5-attendees-checkin.md (M5-T1).
//
// The Attendee doc id is DERIVED FROM THE SUBMISSION ID (the FormData doc id)
// so the accept hook is idempotent by construction: duplicate accepts
// (double-click, replayed hook, concurrent transitions) all land on the same
// doc and collapse via create-if-absent. It also makes the scanner's resolve
// flow a direct doc get: verify the QR token -> embedded formDataId ->
// attendeeIdFromSubmissionId -> doc get (no query, no index).
//
// Same tuple-hash construction as src/lib/db/formDataId.ts /
// src/lib/orders/order-id.ts: scoped to (organizationId, eventId) so ids are
// namespaced per tenant + event, with an "Attendee" domain prefix so this
// derivation can never collide with the FormData or Order derivations, and
// JSON encoding so no separator ambiguity exists.

import { createHash } from "node:crypto";

export function attendeeIdFromSubmissionId(input: {
  organizationId: string;
  eventId: string;
  submissionId: string;
}): string {
  const material = JSON.stringify([
    "Attendee",
    input.organizationId,
    input.eventId,
    input.submissionId,
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}
