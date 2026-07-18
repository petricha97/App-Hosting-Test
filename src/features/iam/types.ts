// Shared client-safe types for the M8-T1 real-IAM screen and its API routes.
// Deliberately DECOUPLED from src/types/collection.ts's OrganizationMembership
// role union (Backend's extension point, agents/docs/specs/m8-real-iam.md D2)
// so the UI/route layer this file backs can be built and typechecked in
// parallel with Backend's DAL work — once Backend widens
// OrganizationMembership["role"]/UserDoc.organizationRole to
// "owner" | "admin" | "editor" | "viewer" (D2), those values are
// structurally identical to OrgRole below and need no adapter.
//
// D2's legacy alias ("member" reads as "viewer") is normalized by
// normalizeOrgRole() (permissions.ts) at the API boundary — OrgRole itself
// never includes "member", so every UI/route consumer only ever sees the
// real 4-tier model.
export type OrgRole = "owner" | "admin" | "editor" | "viewer";

// Never "owner" (D10 — an invite/role-change target role is capped below
// Owner; Owner transfer, if ever added, would be a distinct, explicit flow).
export type InvitableRole = Exclude<OrgRole, "owner">;

export interface MemberRow {
  email: string;
  name: string;
  role: OrgRole;
  status: "active";
  // True for the row matching the caller's own session email (role-change/
  // removal UI uses this for the D11 "this won't affect your session until
  // your next action" self-targeting copy, design §3).
  isSelf: boolean;
}

export interface InvitationRow {
  email: string;
  role: InvitableRole;
  status: "invited";
  invitedAt: number | null;
  expiresAt: number | null;
  invitedBy: string;
}

export type IamRosterRow =
  ({ kind: "member" } & MemberRow) | ({ kind: "invitation" } & InvitationRow);

export interface IamDashboardData {
  members: MemberRow[];
  invitations: InvitationRow[];
  // Server-computed capability boolean (write:user), mirrors
  // reports/page.tsx's canManageSchedules pattern (design §0) — the client
  // never re-derives this from a raw permission string.
  canManageMembers: boolean;
  currentUserEmail: string;
  currentUserRole: OrgRole;
}
