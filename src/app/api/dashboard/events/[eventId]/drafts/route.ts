// API route: GET /api/dashboard/events/[eventId]/drafts
// Abandoned-registrations list for the M5-T3 Abandoned tab (client-side
// retry/refresh path; the server page renders the first load).
//
// Route-owned behavior (spec M5 shared decisions: every admin surface gates
// write:events; 404 cross-org IDOR-safe):
// - session -> write:events -> org-owned event via the shared scope;
// - returns ONLY abandoned drafts (isAbandoned derived by the DAL from
//   ABANDONED_AFTER_MS — strict >24h, T3 AC-1); fresher drafts are in-flight
//   registrations and never leave the server;
// - emails are MASKED to domain-only in the serializer — the local part
//   never crosses this boundary (T3 AC-3).
import { NextResponse } from "next/server";

import { serializeAbandonedDrafts } from "@/features/attendees/abandoned";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { getAdminRegistrationDraftsForEvent } from "@/lib/db/adminRegistrationDraft";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const drafts = await getAdminRegistrationDraftsForEvent({
    eventId,
    organizationId: scope.organizationId,
  });

  return NextResponse.json({ drafts: serializeAbandonedDrafts(drafts) });
}
