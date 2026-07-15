// Fresh, per-page `enabled` re-check (spec §8: "re-read the definition's
// enabled flag at the start of each processed page/chunk, immediately
// before that chunk's sendEventEmailBatch call — not once per recipient,
// and not only once at the very start of a multi-page tick").
//
// A kind with no materialized EmailDefinition doc is a still-virtual
// default, which is always enabled (T2 catalog default `enabled: true`) —
// this mirrors the merge rule in default-definitions.ts without importing
// its heavier merge machinery for a single boolean.
import "server-only";

import { getAdminEmailDefinitionByKind } from "@/lib/db/adminEmailDefinition";

export async function isDefinitionCurrentlyEnabled(input: {
  kind: string;
  eventId: string;
  organizationId: string;
}): Promise<boolean> {
  const stored = await getAdminEmailDefinitionByKind(input);
  return stored ? stored.enabled : true;
}
