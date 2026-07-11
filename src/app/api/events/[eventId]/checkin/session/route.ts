// Public API route: POST /api/events/[eventId]/checkin/session
// Access-code -> scanner-session exchange (M5-T5 AC-1/AC-2).
//
// UNAUTHENTICATED (the access code IS the credential): rate-limited
// 10/min/IP, body capped at 32KB, Zod-stripped. The code is normalized +
// hashed and looked up among ACTIVE members only — revoked and unknown codes
// return the identical generic 401 (no oracle). Success mints a signed
// 12h session token (held in sessionStorage, sent in bodies — never URLs)
// and bumps the member's lastSeenAt.
import { NextResponse } from "next/server";
import { z } from "zod";

import { extractOrganizationIdFromPath } from "@/features/event/utils";
import { readPublicJsonBody } from "@/features/public-registration/server/context";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";
import {
  getAdminActiveCheckinTeamMemberByAccessCodeHash,
  touchAdminCheckinTeamMemberLastSeen,
} from "@/lib/db/adminCheckinTeamMember";
import {
  hashScannerAccessCode,
  mintScannerSessionToken,
} from "@/lib/qr/scanner-session";
import { checkRequestRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const SessionRequestSchema = z.object({
  accessCode: z.string().trim().min(1).max(128),
});

// One generic failure shape for wrong/revoked/unknown codes AND unknown
// events — the exchange is never an oracle (T5 AC-1). Fresh response per
// request (bodies are one-shot streams).
function genericDenied() {
  return NextResponse.json(
    { error: "That code didn't work. Check with the event organizer." },
    { status: 401 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  const rate = checkRequestRateLimit(request, "checkin-session", 10);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts — wait a minute." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const rawBody = await readPublicJsonBody(request);
  if (!rawBody.ok) {
    return rawBody.reason === "too_large"
      ? NextResponse.json({ error: "Request body too large." }, { status: 413 })
      : NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = SessionRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Door scanning only exists for published events; a missing/unpublished
  // event denies with the same generic shape as a bad code.
  const event = await getAdminPublishedEventById(eventId);
  const organizationId = event
    ? extractOrganizationIdFromPath(event.organizationPath)
    : null;
  if (!event || !organizationId) return genericDenied();

  const member = await getAdminActiveCheckinTeamMemberByAccessCodeHash({
    eventId,
    accessCodeHash: hashScannerAccessCode(parsed.data.accessCode),
  });
  // Tenant re-check (defense in depth — eventIds are globally unique, but a
  // member doc must never authenticate across orgs).
  if (!member || member.organizationId !== organizationId) {
    return genericDenied();
  }

  const token = mintScannerSessionToken({
    teamMemberId: member.id,
    eventId,
  });
  await touchAdminCheckinTeamMemberLastSeen(member.id);

  return NextResponse.json({ token, memberName: member.name });
}
