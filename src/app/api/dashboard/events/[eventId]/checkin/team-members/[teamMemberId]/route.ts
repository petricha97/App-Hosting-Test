// API route: DELETE /api/dashboard/events/[eventId]/checkin/team-members/[teamMemberId]
// Revokes a door-scanner team member (M5-T4 AC-6): isActive := false — the
// doc is KEPT for the checkedInBy audit trail, and every outstanding scanner
// session 401s on its next resolve/confirm (the isActive re-check, T5 AC-9).
// write:events-gated, 404 cross-org/unknown (IDOR-safe). Idempotent.
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { revokeAdminCheckinTeamMember } from "@/lib/db/adminCheckinTeamMember";

interface RouteContext {
  params: Promise<{ eventId: string; teamMemberId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, teamMemberId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const revoked = await revokeAdminCheckinTeamMember({
    teamMemberId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!revoked) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
