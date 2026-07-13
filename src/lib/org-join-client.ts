// Client callers for the server-side org join surface (SEC M2 Findings 1-3).
// The old client-SDK flows (invite-code Organization query, roster/permission
// writes, memberCount increments) are denied by firestore.rules; every join
// now goes through these API routes, which validate the entitlement and
// perform the atomic membership write with the Admin SDK.
//
// PURE fetch module — no Firebase imports (callers pass the ID token).

import type { OrganizationPreview } from "@/lib/org-preview";

export type JoinOrganizationStatus = "joined" | "already-member";

export interface JoinOrganizationResult {
  status: JoinOrganizationStatus;
  organization: OrganizationPreview;
}

// Sanitized invite-code lookup: resolves a code to its organization preview
// (name/type/memberCount/logo — never invite secrets), or null when the code
// does not match any organization with invite codes enabled.
export async function lookupOrganizationByInviteCode(
  code: string,
): Promise<OrganizationPreview | null> {
  const response = await fetch("/api/organizations/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error("Invite code lookup failed");
  }

  const data = (await response.json()) as { organization: OrganizationPreview };
  return data.organization;
}

export type JoinOrganizationInput =
  | { joinMethod: "invite_code"; code: string; displayName?: string }
  | {
      joinMethod: "domain_auto_join";
      organizationId?: string;
      displayName?: string;
    };

// Joins the caller (identified by the Firebase ID token) to an organization.
// The token travels in the Authorization header so the signup flow — where
// the session cookie has not been minted yet — can join too. Idempotent:
// re-joining resolves with status "already-member".
export async function joinOrganization(
  idToken: string,
  input: JoinOrganizationInput,
): Promise<JoinOrganizationResult> {
  const response = await fetch("/api/organizations/join", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(input),
  });

  const data = (await response.json().catch(() => null)) as
    | (JoinOrganizationResult & { error?: unknown })
    | null;

  if (!response.ok || !data) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : "Failed to join organization";
    throw new Error(message);
  }

  return { status: data.status, organization: data.organization };
}
