// API route: POST /api/organizations/join
// Server-side org join (SEC M2 Findings 1-3): replaces the client-SDK join
// flows (signupJoinOrg / addExistingUserToOrg / createNewUserAndJoinOrg),
// which firestore.rules now denies (roster, permissions and memberCount are
// server-only fields).
//
// Entitlement is validated HERE, then the atomic membership write is
// delegated to addAdminUserToOrganization (roster + permissions mirror +
// memberCount in one transaction; idempotent on re-join):
//  - invite_code: the submitted code must match an Organization with invite
//    codes enabled (Admin SDK lookup — codes never reach the client).
//  - domain_auto_join: the CALLER'S TOKEN email domain (never client input)
//    must match an Organization with allowDomainAutoJoin; personal email
//    domains are refused.
//
// Auth: session cookie (logged-in surfaces, e.g. the join dialog) OR an
// Authorization: Bearer <idToken> header (signup flow — the Firebase user
// exists but the session cookie has not been minted yet). Both paths verify
// the token with the Admin SDK via decodeUser.
import { NextResponse } from "next/server";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import {
  getAdminOrganizationByDomain,
  getAdminOrganizationByInviteCode,
} from "@/lib/db/adminOrganization";
import { addAdminUserToOrganization } from "@/lib/db/adminUserOrganization";
import { extractDomain, isPersonalEmail } from "@/lib/domain-utils";
import { normalizeInviteCode } from "@/lib/invite-utils";
import { toOrganizationPreview } from "@/lib/org-preview";
import { resolveCallerToken } from "@/lib/server/caller-token";
import type { OrganizationDoc, WithId } from "@/types/collection";

const INVALID_CODE_ERROR = "Invalid invite code";

const joinPayloadSchema = z.discriminatedUnion("joinMethod", [
  z.object({
    joinMethod: z.literal("invite_code"),
    code: z.string().min(1).max(64),
    // Optional profile name for first-time User doc creation (the signup
    // flow's display name may not be in the token yet). Own-profile field
    // only — never an authorization input.
    displayName: z.string().trim().max(120).optional(),
  }),
  z.object({
    joinMethod: z.literal("domain_auto_join"),
    // Optional UX cross-check: when provided it must match the org the
    // caller's email domain actually resolves to.
    organizationId: z.string().min(1).max(128).optional(),
    displayName: z.string().trim().max(120).optional(),
  }),
]);

export async function POST(request: Request) {
  const token = await resolveCallerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Missing session" }, { status: 401 });
  }

  const decoded = await decodeUser(token);
  if ("error" in decoded) {
    return NextResponse.json({ error: decoded.error }, { status: 401 });
  }
  // decodeUser substitutes "No email" when the token carries none — a join
  // is impossible without a real email identity.
  if (!decoded.email || !decoded.email.includes("@")) {
    return NextResponse.json(
      { error: "Your account has no email address" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = joinPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // --- Entitlement validation (the DAL deliberately does not own this) ---
  let organization: WithId<OrganizationDoc> | null = null;
  if (parsed.data.joinMethod === "invite_code") {
    const normalized = normalizeInviteCode(parsed.data.code);
    if (normalized.length >= 6) {
      organization = await getAdminOrganizationByInviteCode(normalized);
    }
    if (!organization) {
      return NextResponse.json({ error: INVALID_CODE_ERROR }, { status: 404 });
    }
  } else {
    const domain = extractDomain(decoded.email);
    if (!domain || isPersonalEmail(decoded.email)) {
      return NextResponse.json(
        { error: "Domain auto-join is not available for this email" },
        { status: 403 },
      );
    }
    organization = await getAdminOrganizationByDomain(domain);
    if (
      !organization ||
      (parsed.data.organizationId !== undefined &&
        parsed.data.organizationId !== organization.id)
    ) {
      // Uniform 404: neither org existence nor domain mappings leak.
      return NextResponse.json(
        { error: "No organization allows auto-join for your email domain" },
        { status: 404 },
      );
    }
  }

  // decodeUser fills placeholders for missing claims; keep them out of docs.
  const tokenName = decoded.name === "No name" ? "" : decoded.name;
  const tokenPicture = decoded.picture === "No picture" ? "" : decoded.picture;

  const result = await addAdminUserToOrganization({
    userEmail: decoded.email.toLowerCase(),
    organizationId: organization.id,
    joinMethod: parsed.data.joinMethod,
    profile: {
      uid: decoded.uid,
      name: parsed.data.displayName || tokenName,
      avatarUrl: tokenPicture || null,
    },
  });

  if (!result.ok) {
    if (result.reason === "organization-not-found") {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }
    // user-doc-missing-profile is unreachable (profile always supplied), but
    // fail loudly rather than pretend the join happened.
    return NextResponse.json({ error: "Unable to join" }, { status: 500 });
  }

  return NextResponse.json({
    status: result.status,
    organization: toOrganizationPreview(organization),
  });
}
