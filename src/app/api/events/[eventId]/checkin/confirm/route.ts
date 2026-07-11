// Public API route: POST /api/events/[eventId]/checkin/confirm
// Idempotent check-in flip under a team scanner session (M5-T5 AC-5/AC-6).
//
// The confirm re-resolves the QR TOKEN server-side — never a bare attendeeId
// from the client (T5 AC-12) — then runs the transactional, never-
// overwriting checkInAdminAttendee: the first confirm records
// checkedInAt/checkedInBy { kind: "team-member", teamMemberId, name };
// duplicates return ALREADY_CHECKED_IN with the ORIGINAL record, zero writes.
import { NextResponse } from "next/server";
import { z } from "zod";

import type { ScanConfirmResponse } from "@/features/checkin/scan-types";
import {
  checkedInByName,
  resolveScanToken,
  serializeScanAttendeeCard,
} from "@/features/checkin/server/resolve-scan";
import { resolveScannerSessionScope } from "@/features/checkin/server/scanner-session-scope";
import { timestampToIso } from "@/features/attendees/roster";
import { checkInAdminAttendee } from "@/lib/db/adminAttendee";
import { touchAdminCheckinTeamMemberLastSeen } from "@/lib/db/adminCheckinTeamMember";
import { readPublicJsonBody } from "@/features/public-registration/server/context";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const ConfirmRequestSchema = z.object({
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

  const parsed = ConfirmRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const scope = await resolveScannerSessionScope({
    eventId,
    sessionToken: parsed.data.sessionToken,
    routeName: "checkin-confirm",
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
  if (resolution.status !== "OK") {
    return NextResponse.json({ status: resolution.status } satisfies ScanConfirmResponse);
  }

  const result = await checkInAdminAttendee({
    attendeeId: resolution.attendee.id,
    eventId,
    organizationId: scope.organizationId,
    checkedInBy: {
      kind: "team-member",
      teamMemberId: scope.member.id,
      name: scope.member.name,
    },
  });

  await touchAdminCheckinTeamMemberLastSeen(scope.member.id);

  if (!result.ok) {
    // NOT_FOUND after a successful resolve = a raced delete; surface as the
    // invalid variant. CANCELLED keeps its own copy.
    const body: ScanConfirmResponse = {
      status: result.code === "CANCELLED" ? "CANCELLED" : "INVALID",
    };
    return NextResponse.json(body);
  }

  if (result.alreadyCheckedIn) {
    const body: ScanConfirmResponse = {
      status: "ALREADY_CHECKED_IN",
      attendee: serializeScanAttendeeCard(result.attendee),
      // The ORIGINAL record — the first scanner's flip is never overwritten.
      checkedInAtIso: timestampToIso(result.checkedInAt),
      checkedInByName: checkedInByName(result.checkedInBy),
    };
    return NextResponse.json(body);
  }

  const body: ScanConfirmResponse = {
    status: "CHECKED_IN",
    attendee: serializeScanAttendeeCard(result.attendee),
    // checkedInAt was written with serverTimestamp() inside the transaction;
    // the response approximates it with route time (display-only "at HH:mm").
    checkedInAtIso: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
