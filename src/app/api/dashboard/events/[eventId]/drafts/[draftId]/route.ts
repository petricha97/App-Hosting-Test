// Manual draft purge route (M3-T5 AC-7, defect QA-M3-D1):
//   DELETE — removes a single RegistrationDraft so organizers can purge its
//            PII on request. No auto-delete/TTL job exists in M3 (spec
//            retention decision); this route is the only purge path besides
//            the finalize-time delete (T3 AC-11).
//
// Route-owned validations (spec: agents/docs/specs/m3-registration-paths.md):
// - Session + write:events via resolveRegistrationRouteScope (401/403).
// - 404 for cross-org/unknown events AND cross-org/unknown draft ids via the
//   org-scoped lookup, indistinguishable from missing (IDOR-safe).
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  deleteAdminRegistrationDraft,
  getAdminRegistrationDraftForEvent,
} from "@/lib/db/adminRegistrationDraft";

interface RouteContext {
  params: Promise<{ eventId: string; draftId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, draftId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminRegistrationDraftForEvent({
    draftId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  await deleteAdminRegistrationDraft(draftId);
  return NextResponse.json({ success: true });
}
