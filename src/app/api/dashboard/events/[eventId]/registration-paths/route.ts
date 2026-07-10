// API route: POST /api/dashboard/events/[eventId]/registration-paths
// Creates a registration path for an org-owned event (M3-T1).
//
// Route-owned validations (spec: agents/docs/specs/m3-registration-paths.md):
// - session -> write:events -> org-owned event via the shared route scope
//   (401 unauthenticated, 403 view-only, 404 cross-org — IDOR-safe).
// - Zod payload validation; server-owned fields (organizationId, eventId,
//   timestamps) are stripped by the schema.
// - Per-event, case-insensitive code uniqueness WITHIN RegistrationPath
//   -> 409 with a field pointer (T1 AC-2).
// - audienceRegistrationTypeId (when set) must belong to this event —
//   foreign ids rejected 400 (T1 AC-2).
import { NextResponse } from "next/server";

import {
  PATH_AUDIENCE_MESSAGE,
  PATH_CODE_DUPLICATE_MESSAGE,
  registrationPathPayloadSchema,
} from "@/features/registration-paths/schemas";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  createAdminRegistrationPath,
  isAdminRegistrationPathCodeTaken,
} from "@/lib/db/adminRegistrationPath";
import { getAdminRegistrationTypeForEvent } from "@/lib/db/adminRegistrationType";

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
  const parsed = registrationPathPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Audience must be a registration type of THIS event ("Any" = null skips
  // the check). The scoped getter nulls cross-org/cross-event ids, so a
  // foreign id can never be pinned as an audience.
  if (parsed.data.audienceRegistrationTypeId !== null) {
    const audience = await getAdminRegistrationTypeForEvent({
      registrationTypeId: parsed.data.audienceRegistrationTypeId,
      eventId,
      organizationId: scope.organizationId,
    });
    if (!audience) {
      return NextResponse.json(
        { error: PATH_AUDIENCE_MESSAGE, field: "audienceRegistrationTypeId" },
        { status: 400 },
      );
    }
  }

  // Per-event uniqueness within RegistrationPath, case-insensitive (the
  // schema already normalized the code to uppercase).
  if (
    await isAdminRegistrationPathCodeTaken({ eventId, code: parsed.data.code })
  ) {
    return NextResponse.json(
      { error: PATH_CODE_DUPLICATE_MESSAGE, field: "code" },
      { status: 409 },
    );
  }

  const pathId = await createAdminRegistrationPath({
    organizationId: scope.organizationId,
    eventId,
    name: parsed.data.name,
    code: parsed.data.code,
    audienceRegistrationTypeId: parsed.data.audienceRegistrationTypeId,
    paymentMethod: parsed.data.paymentMethod,
    currency: parsed.data.currency,
    isActive: parsed.data.isActive,
    sortOrder: parsed.data.sortOrder,
  });

  return NextResponse.json({ pathId });
}
