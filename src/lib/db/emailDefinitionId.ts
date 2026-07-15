// Deterministic EmailDefinition document IDs — PURE module (node:crypto
// only, no Firebase). Spec: agents/docs/specs/m6-emails-admin.md (Shared
// decisions: "kind is the join key; the definition doc id is deterministic
// from it").
//
// The definition doc id is DERIVED FROM THE LOGICAL DEFINITION TUPLE
// (organizationId, eventId, kind) so:
//   - `kind` is unique per event BY CONSTRUCTION — two definitions with the
//     same kind in the same event collapse onto one doc.
//   - materializing a virtual default on first edit, and creating a brand
//     new custom definition, are both create-if-absent upserts at a
//     predictable id — no separate "does a doc exist for this kind" lookup
//     is ever needed before writing (src/lib/db/adminEmailDefinition.ts).
//   - EmailMessage rows join to a definition via the existing M6-T1 `kind`
//     composite index — no new `definitionId` index required (outbox rows
//     store `definitionId` as this same computed hash, whether or not the
//     definition doc actually exists).
//
// Same tuple-hash construction as src/lib/db/emailMessageId.ts /
// formDataId.ts / attendeeId.ts / order-id.ts: an "EmailDefinition" domain
// prefix keeps this derivation disjoint from every other one, and JSON
// encoding removes separator ambiguity between adjacent tuple fields.

import { createHash } from "node:crypto";

export function emailDefinitionId(input: {
  organizationId: string;
  eventId: string;
  kind: string;
}): string {
  const material = JSON.stringify([
    "EmailDefinition",
    input.organizationId,
    input.eventId,
    input.kind,
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}
