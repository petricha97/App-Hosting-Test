// API route: POST /api/dashboard/events/[eventId]/checkin/resolve
// Dashboard scanner QR resolution (M5-T5 AC-8): authenticated by the ADMIN
// session (write:events, 404 cross-org) — no scanner session token involved.
// Same resolution pipeline and result states as the public route; resolve
// never writes. Rate-limited per admin user (60/min, T5 AC-10).
import { NextResponse } from "next/server";
import { z } from "zod";

import type { ScanResolveResponse } from "@/features/checkin/scan-types";
import {
  resolveScanToken,
  serializeScanAttendeeCard,
} from "@/features/checkin/server/resolve-scan";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const ResolveRequestSchema = z.object({
  qrToken: z.string().trim().min(1).max(512),
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(`checkin-admin-resolve:${scope.userId}`, {
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

  const parsed = ResolveRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const resolution = await resolveScanToken({
    eventId,
    organizationId: scope.organizationId,
    qrToken: parsed.data.qrToken,
  });

  const body: ScanResolveResponse =
    resolution.status === "OK"
      ? { status: "OK", attendee: serializeScanAttendeeCard(resolution.attendee) }
      : { status: resolution.status };

  return NextResponse.json(body);
}
