// API route: POST /api/dashboard/events/[eventId]/checkin/confirm
// Dashboard scanner check-in flip (M5-T5 AC-8): admin session (write:events,
// 404 cross-org). Records checkedInBy = { kind: "admin", userId } — the User
// doc id (lowercased email). Confirm re-resolves the QR token server-side
// (never a bare attendeeId, T5 AC-12) and runs the same idempotent,
// never-overwriting flip as the public route.
import { NextResponse } from "next/server";
import { z } from "zod";

import { timestampToIso } from "@/features/attendees/roster";
import type { ScanConfirmResponse } from "@/features/checkin/scan-types";
import {
  checkedInByName,
  resolveScanToken,
  serializeScanAttendeeCard,
} from "@/features/checkin/server/resolve-scan";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { checkInAdminAttendee } from "@/lib/db/adminAttendee";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const ConfirmRequestSchema = z.object({
  qrToken: z.string().trim().min(1).max(512),
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(`checkin-admin-confirm:${scope.userId}`, {
    limit: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many scans — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = ConfirmRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
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
    checkedInBy: { kind: "admin", userId: scope.userId },
  });

  if (!result.ok) {
    const body: ScanConfirmResponse = {
      status: result.code === "CANCELLED" ? "CANCELLED" : "INVALID",
    };
    return NextResponse.json(body);
  }

  if (result.alreadyCheckedIn) {
    const body: ScanConfirmResponse = {
      status: "ALREADY_CHECKED_IN",
      attendee: serializeScanAttendeeCard(result.attendee),
      checkedInAtIso: timestampToIso(result.checkedInAt),
      checkedInByName: checkedInByName(result.checkedInBy),
    };
    return NextResponse.json(body);
  }

  const body: ScanConfirmResponse = {
    status: "CHECKED_IN",
    attendee: serializeScanAttendeeCard(result.attendee),
    checkedInAtIso: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
