import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { repairAttendeeCreation } from "@/features/responses/server/repair-attendee-creation";
import { checkRateLimit } from "@/lib/rate-limit";

const payloadSchema = z.object({}).strict();

interface RouteContext {
  params: Promise<{ eventId: string; responseId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId, responseId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const bodyText = await request.text();
  const body =
    bodyText.trim().length === 0
      ? {}
      : await Promise.resolve()
          .then(() => JSON.parse(bodyText))
          .catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rate = checkRateLimit(
    `responses-attendee-retry:${scope.organizationId}:${scope.userId}:${responseId}`,
    { limit: 30 },
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many retries — wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const repair = await repairAttendeeCreation({
    responseId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (repair.ok) {
    return NextResponse.json({
      responseId,
      status: "accepted",
      attendeeCreated: true,
      outcome: repair.outcome,
    });
  }
  if (repair.code === "RESPONSE_NOT_FOUND") {
    return NextResponse.json(
      { error: "Response not found.", code: "RESPONSE_NOT_FOUND" },
      { status: 404 },
    );
  }
  if (repair.code === "RESPONSE_NOT_ACCEPTED") {
    return NextResponse.json(
      {
        error: "Only accepted responses can create an attendee.",
        code: "RESPONSE_NOT_ACCEPTED",
      },
      { status: 409 },
    );
  }

  console.error(
    `[responses/retry-attendee-creation] repair failed for response ${responseId}`,
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
