// API routes: GET/PATCH /api/dashboard/events/[eventId]/checkin/config
// Check-in configuration toggles (M5-T4). write:events-gated, 404 cross-org
// (T4 AC-8) via the shared registration route scope.
//
// GET returns the stored toggles or the read-time defaults (lazy lifecycle —
// no doc until the first save, T4 AC-3). PATCH validates through a Zod
// allow-list that STRIPS unknown keys (T4 AC-8); the DAL re-checks the
// boolean allow-list anyway (defense in depth).
import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  getAdminCheckinConfigForEvent,
  upsertAdminCheckinConfig,
} from "@/lib/db/adminCheckinConfig";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

// All five toggles optional — a PATCH flips one switch at a time. Unknown
// keys (organizationId, eventId, createdAt, ...) are stripped by default.
const ConfigPatchSchema = z.object({
  signatureCollection: z.boolean().optional(),
  photoCapture: z.boolean().optional(),
  photoIdVerification: z.boolean().optional(),
  selfPrintBadges: z.boolean().optional(),
  walletPasses: z.boolean().optional(),
});

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const settings = await getAdminCheckinConfigForEvent({
    eventId,
    organizationId: scope.organizationId,
  });
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = ConfigPatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const settings = await upsertAdminCheckinConfig({
    eventId,
    organizationId: scope.organizationId,
    patch: parsed.data,
  });
  if (!settings) {
    // Cross-org config doc (data corruption shape) — never merged into.
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({ settings });
}
