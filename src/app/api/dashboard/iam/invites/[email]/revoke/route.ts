// API route: POST /api/dashboard/iam/invites/[email]/revoke
// write:user-gated + D10 (revoking an Admin-role invite is Owner-only).
// Idempotent (spec §3 AC-6): revokeAdminInvitation (src/lib/db/
// adminInvitation.ts) itself owns the caller-authorization + hierarchy +
// idempotency logic — NOT_FOUND doubles as the cross-org answer (spec §7
// AC-2, IDOR-safe: the deterministic (org, email) doc id means a foreign
// org's invitation for this email is structurally indistinguishable from
// "never invited").
import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import decodeUser from "@/lib/auth-utils";
import { revokeAdminInvitation } from "@/lib/db/adminInvitation";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { resolveActiveOrganizationId } from "@/lib/org-membership";

const COOKIE_NAME = "session";

interface RouteContext {
  params: Promise<{ email: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { email: rawEmail } = await context.params;
  const targetEmail = decodeURIComponent(rawEmail).toLowerCase();

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

  const result = await revokeAdminInvitation({
    organizationId,
    callerEmail,
    email: targetEmail,
  });

  if (!result.ok) {
    switch (result.code) {
      case "NOT_FOUND":
        return NextResponse.json(
          { error: "Invitation not found" },
          { status: 404 },
        );
      case "HIERARCHY_VIOLATION":
        return NextResponse.json(
          { error: "You don't have permission to do that." },
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

  return NextResponse.json({ ok: true });
}
