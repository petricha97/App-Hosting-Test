// Public tickets endpoint for the multi-step flow's step 2 (M3-T2 AC-4/5).
// GET /api/events/[eventId]/registration/tickets?path=<pathId>
//
// Returns the PUBLIC-SAFE projection only: id / name / code / priceMinor /
// currency / availability bucket (+ the "Register as" choices for ambiguous
// Any-audience tickets). Exact capacities, registered counts, sales windows,
// fee ids and the raw registrationTypeIds array never leave the server.
// The pathId is flow config (not a capability) so it may ride the URL —
// unlike draft tokens.
import { NextResponse } from "next/server";

import { loadPublicRegistrationContext } from "@/features/public-registration/server/context";
import { listPublicTicketsForPath } from "@/features/public-registration/server/tickets";
import { checkRequestRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  // Best-effort per-IP limit (spec Shared decisions; see src/lib/rate-limit.ts
  // for the documented in-memory/serverless caveats).
  const rate = checkRequestRateLimit(request, "registration-tickets", 60);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts — please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const pathId = new URL(request.url).searchParams.get("path")?.trim() ?? "";
  if (!pathId || pathId.length > 128) {
    return NextResponse.json(
      { error: "Registration is not available." },
      { status: 404 },
    );
  }

  const loaded = await loadPublicRegistrationContext({ eventId, pathId });
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const tickets = await listPublicTicketsForPath({
    eventId,
    organizationId: loaded.context.organizationId,
    path: loaded.context.path,
  });

  return NextResponse.json({ tickets });
}
