// Server-side trust boundary for tenancy (SEC M2 Finding 1 — Critical).
//
// UserDoc.organizationId is the user's ACTIVE org and is client-writable by
// design (the org switcher). The embedded organizations[] roster is the
// authoritative membership record and is locked server-only by
// firestore.rules (clients can never add/edit roster entries). Every server
// consumer that resolves tenancy from userDoc.organizationId MUST verify the
// active org against the roster through this module — a mismatch means the
// client rewrote organizationId to an org it does not belong to, and the
// request must be refused (403 / redirect), never trusted.
//
// PURE module: no Firebase imports, safe for client bundles and unit tests.

import type { OrganizationMembership, UserDoc } from "@/types/collection";

// The minimal shape the checks need — accepts full UserDoc, admin reads, and
// test fixtures alike.
export type MembershipUserLike = Pick<UserDoc, "organizationId"> & {
  organizations?: readonly OrganizationMembership[] | null;
};

// Finds the roster entry for an org. Returns null when the roster is missing,
// malformed, or has no entry — callers treat null as "not a member"
// (fail closed; legacy docs without a roster get no tenant access).
export function findOrganizationMembership(
  memberships: readonly OrganizationMembership[] | null | undefined,
  organizationId: string,
): OrganizationMembership | null {
  if (!organizationId || !Array.isArray(memberships)) return null;
  return (
    memberships.find(
      (m) => m && typeof m === "object" && m.organizationId === organizationId,
    ) ?? null
  );
}

// True when the user's ACTIVE organizationId is backed by a roster entry.
export function isActiveOrganizationMember(
  userDoc: MembershipUserLike | null | undefined,
): boolean {
  if (!userDoc?.organizationId) return false;
  return (
    findOrganizationMembership(userDoc.organizations, userDoc.organizationId) !==
    null
  );
}

// Resolves the tenant key server routes may act on: the active organizationId
// ONLY if the roster confirms membership, otherwise null (callers 403 or
// redirect). This is the single implementation route-scope.ts and
// get-dashboard-scope.ts share — do not re-derive tenancy elsewhere.
export function resolveActiveOrganizationId(
  userDoc: MembershipUserLike | null | undefined,
): string | null {
  return isActiveOrganizationMember(userDoc)
    ? (userDoc as MembershipUserLike).organizationId
    : null;
}
