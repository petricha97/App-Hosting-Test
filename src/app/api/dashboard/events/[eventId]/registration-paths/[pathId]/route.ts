// API routes for a specific RegistrationPath (M3-T1):
//   PATCH  — full edit (payload schema) OR the lightweight inline controls:
//            { isActive } Active toggle (T1 AC-4) / { sortOrder } reorder
//            (T1 AC-10) — both strict shapes so a malformed full payload can
//            never be misread as a partial update.
//   DELETE — hard delete, BLOCKED (409 -> "Deactivate instead") when any
//            RegistrationDraft or FormData references the path (T1 AC-5;
//            bounded reference queries, limit 5).
//
// Route-owned validations (spec: agents/docs/specs/m3-registration-paths.md):
// - 404 for cross-org events AND path ids of another event/org (IDOR-safe).
// - Code uniqueness re-checked excluding self -> 409 field pointer.
// - Audience membership re-checked on edit (foreign ids rejected 400).
import { NextResponse } from "next/server";

import {
  PATH_AUDIENCE_MESSAGE,
  PATH_CODE_DUPLICATE_MESSAGE,
  pathActiveToggleSchema,
  pathSortOrderSchema,
  registrationPathPayloadSchema,
} from "@/features/registration-paths/schemas";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { getAdminFormDataReferencingPath } from "@/lib/db/adminFormData";
import { getAdminRegistrationDraftsReferencingPath } from "@/lib/db/adminRegistrationDraft";
import {
  deleteAdminRegistrationPath,
  getAdminRegistrationPathForEvent,
  isAdminRegistrationPathCodeTaken,
  updateAdminRegistrationPath,
} from "@/lib/db/adminRegistrationPath";
import { getAdminRegistrationTypeForEvent } from "@/lib/db/adminRegistrationType";

interface RouteContext {
  params: Promise<{ eventId: string; pathId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, pathId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminRegistrationPathForEvent({
    pathId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Registration path not found" },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);

  // Inline Active toggle from the table (T1 AC-4).
  const toggle = pathActiveToggleSchema.safeParse(body);
  if (toggle.success) {
    await updateAdminRegistrationPath(pathId, {
      isActive: toggle.data.isActive,
    });
    return NextResponse.json({ pathId });
  }

  // Inline reorder from the table's up/down buttons (T1 AC-10).
  const reorder = pathSortOrderSchema.safeParse(body);
  if (reorder.success) {
    await updateAdminRegistrationPath(pathId, {
      sortOrder: reorder.data.sortOrder,
    });
    return NextResponse.json({ pathId });
  }

  const parsed = registrationPathPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

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

  if (
    await isAdminRegistrationPathCodeTaken({
      eventId,
      code: parsed.data.code,
      excludeId: pathId,
    })
  ) {
    return NextResponse.json(
      { error: PATH_CODE_DUPLICATE_MESSAGE, field: "code" },
      { status: 409 },
    );
  }

  await updateAdminRegistrationPath(pathId, {
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

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, pathId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminRegistrationPathForEvent({
    pathId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Registration path not found" },
      { status: 404 },
    );
  }

  // BLOCK, never cascade (T1 AC-5): drafts and submissions keep the path as
  // their audit anchor — direct organizers to deactivate instead. Both
  // reference queries are bounded (limit 5), so counts render as "5+".
  const [referencingDrafts, referencingSubmissions] = await Promise.all([
    getAdminRegistrationDraftsReferencingPath({
      eventId,
      organizationId: scope.organizationId,
      pathId,
    }),
    getAdminFormDataReferencingPath({
      eventId,
      organizationId: scope.organizationId,
      pathId,
    }),
  ]);

  if (referencingDrafts.length > 0 || referencingSubmissions.length > 0) {
    const parts: string[] = [];
    if (referencingSubmissions.length > 0) {
      parts.push(
        `${referencingSubmissions.length}${referencingSubmissions.length >= 5 ? "+" : ""} submission${
          referencingSubmissions.length === 1 ? "" : "s"
        }`,
      );
    }
    if (referencingDrafts.length > 0) {
      parts.push(
        `${referencingDrafts.length}${referencingDrafts.length >= 5 ? "+" : ""} in-progress registration${
          referencingDrafts.length === 1 ? "" : "s"
        }`,
      );
    }

    return NextResponse.json(
      {
        error: `${parts.join(" and ")} came through this path. Deactivate it instead.`,
      },
      { status: 409 },
    );
  }

  await deleteAdminRegistrationPath(pathId);
  return NextResponse.json({ success: true });
}
