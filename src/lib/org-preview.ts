// Sanitized Organization projection for join/lookup surfaces — PURE module
// (no Firebase imports), shared by the server routes that emit it and the
// client callers that consume it.
//
// SEC M2 Finding 3: invite secrets must never leave the server. This
// projection is an explicit ALLOW-LIST — inviteCode, inviteLinkToken, domain,
// ownerId and every other Organization field are excluded by construction
// (never spread the doc; copy field by field).

import type { OrganizationDoc, WithId } from "@/types/collection";

export interface OrganizationPreview {
  id: string;
  name: string;
  type: OrganizationDoc["type"];
  memberCount: number;
  logoUrl: string | null;
}

export function toOrganizationPreview(
  org: WithId<OrganizationDoc>,
): OrganizationPreview {
  return {
    id: org.id,
    name: org.name,
    type: org.type,
    memberCount: org.memberCount,
    logoUrl: org.logoUrl ?? null,
  };
}
