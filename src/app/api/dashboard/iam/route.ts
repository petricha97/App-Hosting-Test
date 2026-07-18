// API route: GET /api/dashboard/iam
// Roster + pending invitations for the caller's active org (spec §2 AC-1):
// org-membership-only gate (view-tier, NOT write:user — a Viewer can see the
// full roster, matching D6's convention and users.html's own zero-role-
// conditional table). `canManageMembers` is the server-computed capability
// boolean the UI conditionally renders on (write:user), mirroring
// reports/page.tsx's canManageSchedules pattern — the client never
// re-derives it from a raw permission string.
//
// Org scope is derived STRICTLY from the roster-verified session
// (resolveActiveOrganizationId), never from client input — spec §2 AC-4/§7
// AC-1: a crafted organizationId query param can never leak another org's
// roster.
//
// Uses Backend's listAdminOrganizationMembers (src/lib/db/
// adminOrganizationMember.ts, the D12 reverse-index) and
// listAdminInvitationsForOrganization (src/lib/db/adminInvitation.ts).
import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { listAdminInvitationsForOrganization } from "@/lib/db/adminInvitation";
import { listAdminOrganizationMembers } from "@/lib/db/adminOrganizationMember";
import { normalizeOrgRole } from "@/features/iam/permissions";
import { timestampToMillis } from "@/features/registration/types";
import { resolveActiveOrganizationId } from "@/lib/org-membership";
import type {
  IamDashboardData,
  InvitableRole,
  InvitationRow,
  MemberRow,
} from "@/features/iam/types";

const COOKIE_NAME = "session";

function toInvitableRole(role: string): InvitableRole {
  const normalized = normalizeOrgRole(role);
  // D10: invitations are never stored at "owner" — fail closed to "admin"
  // rather than surfacing an impossible role in the UI.
  return normalized === "owner" ? "admin" : normalized;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Missing session" }, { status: 401 });
  }

  const decoded = await decodeUser(token);
  if ("error" in decoded) {
    return NextResponse.json({ error: decoded.error }, { status: 401 });
  }

  const callerEmail = decoded.email.toLowerCase();
  const userDoc = await getAdminUserByEmail(callerEmail);
  const organizationId = resolveActiveOrganizationId(userDoc);
  if (!userDoc || !organizationId) {
    return NextResponse.json(
      { error: "Missing organization scope" },
      { status: 403 },
    );
  }

  const [memberRecords, invitationRecords] = await Promise.all([
    listAdminOrganizationMembers(organizationId),
    listAdminInvitationsForOrganization(organizationId),
  ]);

  const members: MemberRow[] = memberRecords.map((record) => ({
    email: record.email,
    name: record.name ?? "",
    role: normalizeOrgRole(record.role),
    status: "active",
    isSelf: record.email.toLowerCase() === callerEmail,
  }));

  // "expired" is derived at read time (spec §3 — never a stored status);
  // only pending, unexpired invitations render as roster rows.
  const now = Date.now();
  const invitations: InvitationRow[] = invitationRecords
    .filter((invitation) => {
      if (invitation.status !== "pending") return false;
      const expiresAtMs = timestampToMillis(invitation.expiresAt);
      return expiresAtMs === null || expiresAtMs > now;
    })
    .map((invitation) => ({
      email: invitation.email,
      role: toInvitableRole(invitation.role),
      status: "invited",
      invitedAt: timestampToMillis(invitation.createdAt),
      expiresAt: timestampToMillis(invitation.expiresAt),
      invitedBy: invitation.invitedBy,
    }));

  const payload: IamDashboardData = {
    members,
    invitations,
    canManageMembers: userDoc.permissions.includes("write:user"),
    currentUserEmail: callerEmail,
    currentUserRole: normalizeOrgRole(userDoc.organizationRole),
  };

  return NextResponse.json(payload);
}
