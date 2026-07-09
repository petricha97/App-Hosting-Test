// API route: POST /api/dashboard/events/[eventId]/registration-types
// Creates a registration type for an org-owned event (M1-T1).
//
// Route-owned validations (spec: agents/docs/specs/m1-registration-spine.md):
// - Zod payload validation (name/code/capacity); server-owned fields such as
//   registeredCount are stripped by the schema and never reach the DAL.
// - Per-event, case-insensitive code uniqueness -> 409 with a field pointer.
// Auth: session -> org scope -> event ownership (404 on cross-org, IDOR-safe).
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { registrationTypePayloadSchema } from "@/features/registration/schemas";
import {
  createAdminRegistrationType,
  isAdminRegistrationTypeCodeTaken,
} from "@/lib/db/adminRegistrationType";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = registrationTypePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Per-event uniqueness within RegistrationType, case-insensitive (the
  // schema already normalized the code to uppercase).
  if (
    await isAdminRegistrationTypeCodeTaken({ eventId, code: parsed.data.code })
  ) {
    return NextResponse.json(
      { error: "Code already in use", field: "code" },
      { status: 409 },
    );
  }

  const registrationTypeId = await createAdminRegistrationType({
    organizationId: scope.organizationId,
    eventId,
    name: parsed.data.name,
    code: parsed.data.code,
    capacity: parsed.data.capacity,
  });

  return NextResponse.json({ registrationTypeId });
}
