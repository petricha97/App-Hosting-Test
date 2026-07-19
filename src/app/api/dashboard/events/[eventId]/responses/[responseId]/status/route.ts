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
//   indistinguishable), INVALID_TRANSITION -> 409 except an accepted replay,
//   which performs a scoped attendee-completion check. A failed initial hook
//   or accepted/pending replay invokes the shared repair helper; an already-
//   complete accepted replay is an idempotent 200 without another transition.
import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { repairAttendeeCreation } from "@/features/responses/server/repair-attendee-creation";
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

  const isAcceptedReplay =
    !result.ok &&
    result.code === "INVALID_TRANSITION" &&
    parsed.data.to === "accepted";
  const needsRepair =
    (result.ok && result.acceptHookFailed === true) || isAcceptedReplay;

  if (needsRepair) {
    const repair = await repairAttendeeCreation({
      responseId,
      eventId,
      organizationId: scope.organizationId,
    });

    if (repair.ok) {
      return NextResponse.json({ responseId, status: "accepted" });
    }
    if (repair.code === "RESPONSE_NOT_FOUND") {
      return NextResponse.json({ error: "Response not found." }, { status: 404 });
    }
    if (repair.code === "ATTENDEE_CREATION_FAILED") {
      console.error(
        `[responses/status] attendee repair failed for accepted response ${responseId}`,
        repair.error,
      );
      return NextResponse.json(
        {
          error:
            "The response is accepted but the attendee record could not be created. Please retry.",
          code: "ATTENDEE_CREATION_FAILED",
          responseId,
          attendeeCreated: false,
        },
        { status: 500 },
      );
    }
    // An accepted replay can only reach the helper for an accepted record;
    // retain the status machine's conflict response if concurrent state is
    // unexpectedly different by the time the scoped re-read occurs.
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.code === "NOT_FOUND" ? 404 : 409 },
    );
  }

  return NextResponse.json({ responseId, status: parsed.data.to });
}
