// Deterministic Order document IDs — PURE module (node:crypto only, no
// Firebase). Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T4).
//
// The Order doc ID is a deterministic hash so the finalize transaction's
// create-if-absent is atomic: two concurrent/repeat finalize calls with the
// same idempotency key target the SAME document, and exactly one create wins.
//
// The hash input is scoped to (organizationId, eventId, idempotencyKey) — not
// the raw key alone — so idempotency keys are namespaced per tenant + event.
// A caller in org A can never occupy or probe the order slot a caller in
// org B would derive from the same key (cross-tenant collision/DoS guard).

import { createHash } from "node:crypto";

export function orderIdFromIdempotencyKey(input: {
  organizationId: string;
  eventId: string;
  idempotencyKey: string;
}): string {
  // JSON-encode the tuple so no separator ambiguity exists regardless of the
  // characters a caller-supplied idempotency key contains.
  const material = JSON.stringify([
    input.organizationId,
    input.eventId,
    input.idempotencyKey,
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}
