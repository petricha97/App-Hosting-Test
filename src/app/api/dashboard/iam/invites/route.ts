// API route: POST /api/dashboard/iam/invites
// Creates (or upserts, spec §3 AC-1) a per-email invitation. write:user-gated
// + D10: only an Owner may invite someone as role "admin" — an Admin caller
// invoking this with role "admin" gets 403; role "editor"/"viewer" succeeds
// for either. D8: no real email delivery — the response carries the accept
// URL (`/invite/{token}`) the inviter copies/shares manually, plus a
// `wasExisting` boolean (design §2) so the UI can show "Invite sent" vs
// "Invite updated" from the same "sent" view.
//
// Authorization is layered: this route's own write:user + D10 pre-check is
// a fast, cheap UX fail-fast, but createOrUpdateAdminInvitation
// (src/lib/db/adminInvitation.ts) independently re-derives the caller's role
// from the D12 reverse-index and re-checks the SAME hierarchy rule — that
// DAL result (CALLER_NOT_AUTHORIZED / HIERARCHY_VIOLATION) is the actual
// security boundary, not this route's pre-check. Also relies on the upsert
// semantics baked into createOrUpdateAdminInvitation (result.created toggles
// wasExisting) and its ALREADY_MEMBER rejection (spec §3 AC-2).
import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import decodeUser from "@/lib/auth-utils";
import { createOrUpdateAdminInvitation } from "@/lib/db/adminInvitation";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { canInviteRole, normalizeOrgRole } from "@/features/iam/permissions";
import { timestampToMillis } from "@/features/registration/types";
import { resolveActiveOrganizationId } from "@/lib/org-membership";
import { createInvitationSchema } from "@/lib/validation";
import type { InvitableRole, InvitationRow } from "@/features/iam/types";

const COOKIE_NAME = "session";

function buildAcceptUrl(request: Request, token: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/invite/${token}`;
}

export async function POST(request: Request) {
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
  if (!userDoc.permissions.includes("write:user")) {
    return NextResponse.json(
      { error: "Missing write:user permission" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const callerRole = normalizeOrgRole(userDoc.organizationRole);
  // Zod validates the role is one of the schema's allowed literals; narrow
  // here since InvitableRole never includes "owner" (D10) by construction.
  const inviteRole = parsed.data.role as InvitableRole;
  if (!canInviteRole(callerRole, inviteRole)) {
    return NextResponse.json(
      { error: "Only an Owner can invite someone as Admin." },
      { status: 403 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const result = await createOrUpdateAdminInvitation({
    organizationId,
    callerEmail,
    email,
    role: inviteRole,
  });

  if (!result.ok) {
    switch (result.code) {
      case "ALREADY_MEMBER":
        // Spec §3 AC-2: already-active-member is rejected with ZERO writes,
        // surfaced inline under the Email field (design §2), not a toast.
        return NextResponse.json(
          {
            error: "This person is already a member of this workspace.",
            field: "email",
          },
          { status: 409 },
        );
      case "HIERARCHY_VIOLATION":
        return NextResponse.json(
          { error: "Only an Owner can invite someone as Admin." },
          { status: 403 },
        );
      case "CALLER_NOT_AUTHORIZED":
      default:
        return NextResponse.json(
          { error: "You don't have permission to do that." },
          { status: 403 },
        );
    }
  }

  const invitation: InvitationRow = {
    email: result.invitation.email,
    role: inviteRole,
    status: "invited",
    invitedAt: timestampToMillis(result.invitation.createdAt),
    expiresAt: timestampToMillis(result.invitation.expiresAt),
    invitedBy: result.invitation.invitedBy,
  };

  return NextResponse.json(
    {
      invitation,
      acceptUrl: buildAcceptUrl(request, result.invitation.token),
      wasExisting: !result.created,
    },
    { status: result.created ? 201 : 200 },
  );
}
