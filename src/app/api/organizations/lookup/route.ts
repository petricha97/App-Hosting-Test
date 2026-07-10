// API route: POST /api/organizations/lookup
// Sanitized invite-code lookup (SEC M2 Finding 3 replacement for the client
// getOrganizationByInviteCode, which firestore.rules now denies).
//
// The invite code itself is the entitlement, so this route is reachable
// pre-auth (the signup flow validates codes before an account exists). It
// returns ONLY the OrganizationPreview allow-list (name/id/type/memberCount/
// logo) — never inviteCode, inviteLinkToken, domain or ownerId — and answers
// a uniform 404 for unknown/disabled/too-short codes so nothing about code
// space is enumerable beyond "this exact code works".
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminOrganizationByInviteCode } from "@/lib/db/adminOrganization";
import { normalizeInviteCode } from "@/lib/invite-utils";
import { toOrganizationPreview } from "@/lib/org-preview";

const lookupPayloadSchema = z.object({
  code: z.string().min(1).max(64),
});

const INVALID_CODE_ERROR = "Invalid invite code";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = lookupPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Codes are 6-8 chars after normalization (invite-utils); shorter inputs
  // can never match, so refuse them without a Firestore read.
  const normalized = normalizeInviteCode(parsed.data.code);
  if (normalized.length < 6) {
    return NextResponse.json({ error: INVALID_CODE_ERROR }, { status: 404 });
  }

  const organization = await getAdminOrganizationByInviteCode(normalized);
  if (!organization) {
    return NextResponse.json({ error: INVALID_CODE_ERROR }, { status: 404 });
  }

  return NextResponse.json({ organization: toOrganizationPreview(organization) });
}
