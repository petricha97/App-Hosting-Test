// Public API route: POST /api/events/[eventId]/checkin/resolve
// Scanner QR resolution under a team scanner session (M5-T5 AC-3/AC-4/AC-7).
// Resolve NEVER writes the attendee (resolve ≠ confirm); camera scans and
// manual token entry both land here with the same body shape.
//
// Body: { sessionToken, qrToken } — tokens travel in bodies, never URLs.
// Gates: session HMAC -> per-session rate limit (60/min) -> isActive
// re-check (revocation, T5 AC-9). Result states: OK | WRONG_EVENT | INVALID
// | NOT_ACCEPTED | CANCELLED (all five per spec T5 AC-7).
import { NextResponse } from "next/server";
import { z } from "zod";

import type { ScanResolveResponse } from "@/features/checkin/scan-types";
import {
  resolveScanToken,
  serializeScanAttendeeCard,
} from "@/features/checkin/server/resolve-scan";
import { resolveScannerSessionScope } from "@/features/checkin/server/scanner-session-scope";
import { readPublicJsonBody } from "@/features/public-registration/server/context";
import { touchAdminCheckinTeamMemberLastSeen } from "@/lib/db/adminCheckinTeamMember";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const ResolveRequestSchema = z.object({
  sessionToken: z.string().trim().min(1).max(512),
  qrToken: z.string().trim().min(1).max(512),
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  const rawBody = await readPublicJsonBody(request);
  if (!rawBody.ok) {
    return rawBody.reason === "too_large"
      ? NextResponse.json({ error: "Request body too large." }, { status: 413 })
      : NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = ResolveRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const scope = await resolveScannerSessionScope({
    eventId,
    sessionToken: parsed.data.sessionToken,
    routeName: "checkin-resolve",
  });
  if (!scope.ok) {
    return NextResponse.json(
      { error: scope.error, ...(scope.code ? { code: scope.code } : {}) },
      {
        status: scope.status,
        headers:
          scope.retryAfterSeconds !== undefined
            ? { "Retry-After": String(scope.retryAfterSeconds) }
            : undefined,
      },
    );
  }

  const resolution = await resolveScanToken({
    eventId,
    organizationId: scope.organizationId,
    qrToken: parsed.data.qrToken,
  });

  await touchAdminCheckinTeamMemberLastSeen(scope.member.id);

  // L-5: TEAM-SESSION caller — mask an admin's email/userId (an attendee who
  // is already checked in by an admin resolves straight to the "already"
  // card, same disclosure risk as the confirm route).
  const body: ScanResolveResponse =
    resolution.status === "OK"
      ? {
          status: "OK",
          attendee: serializeScanAttendeeCard(resolution.attendee, true),
        }
      : { status: resolution.status };

  return NextResponse.json(body);
}
