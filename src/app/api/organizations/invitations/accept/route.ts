// API route: POST /api/organizations/invitations/accept
// Lives under /api/organizations/ (not /api/dashboard/) since the invitee is
// not yet a member of the target org — dashboard routes assume that. Dual
// auth (session cookie OR Authorization: Bearer <idToken>), identical shape
// to POST /api/organizations/join (src/app/api/organizations/join/route.ts)
// via the same resolveCallerToken helper — covers the mid-signup case where
// the Firebase user exists but no session cookie has been minted yet.
//
// THE security-critical check (spec §4 AC-2, explicitly named the one in
// this whole ticket): the authenticated caller's own token email must
// case-insensitively equal the invitation's stored email — a token alone
// proves "an invite to this address exists," never "you ARE that address."
// A mismatch is a 403 with ZERO writes (no membership grant, no invitation
// status change) and a deliberately generic message that never echoes back
// which email the invitation actually belongs to.
//
// Uses Backend's acceptAdminInvitation (src/lib/db/adminUserOrganization.ts)
// — email-match is re-checked there against the freshly re-read Invitation
// doc inside its own transaction (defense in depth beyond this route).
import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { acceptAdminInvitation } from "@/lib/db/adminUserOrganization";
import { resolveCallerToken } from "@/lib/server/caller-token";

const acceptSchema = z.object({
  token: z.string().min(1).max(256),
  // Optional profile name for first-time User doc creation (mirrors
  // join/route.ts's displayName — own-profile field only, never an
  // authorization input).
  displayName: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const token = await resolveCallerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Missing session" }, { status: 401 });
  }

  const decoded = await decodeUser(token);
  if ("error" in decoded) {
    return NextResponse.json({ error: decoded.error }, { status: 401 });
  }
  if (!decoded.email || !decoded.email.includes("@")) {
    return NextResponse.json(
      { error: "Your account has no email address" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const tokenName = decoded.name === "No name" ? "" : decoded.name;
  const tokenPicture = decoded.picture === "No picture" ? "" : decoded.picture;

  const result = await acceptAdminInvitation({
    token: parsed.data.token,
    callerEmail: decoded.email.toLowerCase(),
    profile: {
      uid: decoded.uid,
      name: parsed.data.displayName || tokenName,
      avatarUrl: tokenPicture || null,
    },
  });

  if (!result.ok) {
    switch (result.code) {
      case "INVALID":
        return NextResponse.json(
          { error: "This invitation is no longer valid." },
          { status: 410 },
        );
      case "EMAIL_MISMATCH":
        return NextResponse.json(
          { error: "This invitation is not addressed to your account." },
          { status: 403 },
        );
      case "ORGANIZATION_NOT_FOUND":
        return NextResponse.json(
          { error: "This workspace no longer exists." },
          { status: 404 },
        );
      case "USER_PROFILE_REQUIRED":
        return NextResponse.json(
          { error: "Unable to complete signup" },
          { status: 500 },
        );
      default:
        return NextResponse.json(
          { error: "Unable to accept the invitation" },
          { status: 500 },
        );
    }
  }

  return NextResponse.json({
    organizationId: result.organizationId,
    role: result.role,
  });
}
