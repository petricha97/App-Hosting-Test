// Pure, framework-free role-hierarchy helpers implementing spec D10
// (agents/docs/specs/m8-real-iam.md) — no Firebase imports, safe to import
// from both API routes (server) and dialogs (client) and to unit test in
// isolation. This is the client-side UX mirror AND the shape every
// server-side route re-checks; the DAL's own typed rejections
// (forbidden-hierarchy / last-owner) remain the actual security boundary —
// these helpers never replace that server-side re-check (D11).
import type { InvitableRole, OrgRole } from "@/features/iam/types";

// D2: legacy "member" is a permanent read-time alias for "viewer" — the only
// place that alias is ever materialized. Unknown/malformed input fails
// closed to the lowest-privilege role rather than throwing.
export function normalizeOrgRole(role: string | null | undefined): OrgRole {
  if (role === "member") return "viewer";
  if (
    role === "owner" ||
    role === "admin" ||
    role === "editor" ||
    role === "viewer"
  ) {
    return role;
  }
  return "viewer";
}

const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

export function roleRank(role: OrgRole): number {
  return ROLE_RANK[role];
}

export function roleLabel(role: OrgRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// D10: whether `callerRole` may act (change role / remove) on a member whose
// CURRENT role is `targetRole` AT ALL. An Admin cannot touch an Owner or
// Admin row in either direction, even to no-op.
export function canManageTargetRole(
  callerRole: OrgRole,
  targetRole: OrgRole,
): boolean {
  if (callerRole === "owner") return true;
  if (callerRole === "admin") {
    return targetRole === "editor" || targetRole === "viewer";
  }
  return false;
}

// D10: whether `callerRole` may set a target's role TO `newRole`. An Admin
// may only ever assign editor/viewer — never promote anyone to admin/owner.
export function canAssignRole(callerRole: OrgRole, newRole: OrgRole): boolean {
  if (callerRole === "owner") return true;
  if (callerRole === "admin") {
    return newRole === "editor" || newRole === "viewer";
  }
  return false;
}

// Combined gate for the role-change route: both the target's CURRENT role
// and the REQUESTED role must be within the caller's D10 ceiling.
export function canChangeRole(
  callerRole: OrgRole,
  targetRole: OrgRole,
  newRole: OrgRole,
): boolean {
  return (
    canManageTargetRole(callerRole, targetRole) &&
    canAssignRole(callerRole, newRole)
  );
}

// D10: whether `callerRole` may invite someone at `inviteRole`. Only an
// Owner may invite as Admin.
export function canInviteRole(
  callerRole: OrgRole,
  inviteRole: InvitableRole,
): boolean {
  if (callerRole === "owner") return true;
  if (callerRole === "admin") {
    return inviteRole === "editor" || inviteRole === "viewer";
  }
  return false;
}

// design §3: an "Owner-tier change" escalates the role-change dialog from a
// lightweight Dialog to an AlertDialog confirm — true when EITHER the
// target's current role or the requested new role touches Owner/Admin.
export function isOwnerTierRoleChange(
  currentRole: OrgRole,
  newRole: OrgRole,
): boolean {
  const touchesOwnerTier = (role: OrgRole) =>
    role === "owner" || role === "admin";
  return touchesOwnerTier(currentRole) || touchesOwnerTier(newRole);
}

// The role Select options a caller may offer when changing someone's role —
// options OUTSIDE the caller's D10 ceiling are omitted entirely, never
// disabled (design §3's "options filtered by the caller's own D10 ceiling").
export function assignableRoles(callerRole: OrgRole): OrgRole[] {
  if (callerRole === "owner") return ["owner", "admin", "editor", "viewer"];
  if (callerRole === "admin") return ["editor", "viewer"];
  return [];
}

// The role Select options a caller may offer when inviting someone (design
// §2) — never includes "owner" (D10) and additionally omits "admin" for an
// Admin caller.
export function invitableRoles(callerRole: OrgRole): InvitableRole[] {
  if (callerRole === "owner") return ["admin", "editor", "viewer"];
  if (callerRole === "admin") return ["editor", "viewer"];
  return [];
}
