// Creates/reuses the wizard's ordinary default audience after explicit submission.
// Session, write permission and event ownership are resolved before any DAL access.
import { NextResponse } from "next/server";
import { z } from "zod";

import { capacitySchema } from "@/features/registration/schemas";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { ensureAdminDefaultRegistrationType } from "@/lib/db/adminRegistrationType";

const defaultAudiencePayloadSchema = z.object({ capacity: capacitySchema });

// Accepts a capacity for first creation and returns the saved audience identity.
// Retries reuse existing values; unrelated GENERAL code collisions return 409.
export async function POST(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = defaultAudiencePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await ensureAdminDefaultRegistrationType({
    eventId,
    organizationId: scope.organizationId,
    capacity: parsed.data.capacity,
  });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Registration type not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "The GENERAL code is already in use. Reopen ticket creation to select an existing registration type, or add a type with a different code." },
      { status: 409 },
    );
  }

  const { registrationTypeId, name, code, capacity } = result;
  return NextResponse.json({ registrationTypeId, name, code, capacity });
}
