// API route: PATCH /api/dashboard/events/[eventId]/responses/[responseId]/status
// Transitions a response along the forward-only status machine (M3-T4):
// new < pending < reviewed < accepted (skipping forward allowed, backward
// rejected, accepted terminal — no "rejected" until M5).
//
// Route-owned behavior (spec: agents/docs/specs/m3-registration-paths.md):
// - session -> write:events -> org-owned event (401/403/404 — IDOR-safe).
// - Zod payload { to } from the status enum.
// - The transition itself runs transactionally in the DAL
//   (transitionAdminFormDataStatus): NOT_FOUND -> 404 (missing or cross-org,
//   indistinguishable), INVALID_TRANSITION -> 409 (backward / repeat /
//   anything out of accepted). Accepting fires the M5 attendee hook stub at
//   most once — a second accept 409s before the hook is reachable.
import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { transitionAdminFormDataStatus } from "@/lib/db/adminFormData";
import { FORM_DATA_STATUSES } from "@/lib/db/formDataStatus";

const statusTransitionPayloadSchema = z.object({
  to: z.enum(FORM_DATA_STATUSES),
});

interface RouteContext {
  params: Promise<{ eventId: string; responseId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, responseId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = statusTransitionPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await transitionAdminFormDataStatus({
    responseId,
    eventId,
    organizationId: scope.organizationId,
    to: parsed.data.to,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.code === "NOT_FOUND" ? 404 : 409 },
    );
  }

  return NextResponse.json({ responseId, status: parsed.data.to });
}
