// Deterministic EmailMessage document IDs — PURE module (node:crypto only,
// no Firebase). Spec: agents/docs/specs/m6-email-infrastructure.md (Shared
// decisions: "never double-send by construction").
//
// The outbox doc id is DERIVED FROM THE LOGICAL SEND TUPLE
// (org, event, kind, recipient, dedupeKey) so enqueue is idempotent by
// construction: replayed hooks, double-clicked "send" buttons and concurrent
// calls all land on the same doc and collapse via create-if-absent — the
// same idempotency shape as the M5-T1 attendee create.
//
// `dedupeKey` is caller-supplied per logical send (e.g. submissionId for a
// confirmation, an ISO date for a scheduled blast, a fresh uuid for ad-hoc
// manual sends). A deliberate RE-send therefore uses a NEW dedupeKey and
// produces a second, separately-audited row.
//
// Same tuple-hash construction as src/lib/db/formDataId.ts /
// src/lib/db/attendeeId.ts / src/lib/orders/order-id.ts: an "EmailMessage"
// domain prefix keeps this derivation disjoint from every other one, and
// JSON encoding removes separator ambiguity. The recipient email is
// LOWERCASED before hashing so case variants of the same mailbox dedupe
// onto one doc (the DAL stores the lowercased form too).

import { createHash } from "node:crypto";

export function emailMessageId(input: {
  organizationId: string;
  eventId: string;
  kind: string;
  recipientEmail: string;
  dedupeKey: string;
}): string {
  const material = JSON.stringify([
    "EmailMessage",
    input.organizationId,
    input.eventId,
    input.kind,
    input.recipientEmail.toLowerCase(),
    input.dedupeKey,
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}
