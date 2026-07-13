// API routes for a specific RegistrationType (M1-T1):
//   PATCH  — update name/code/capacity (server-owned fields unreachable)
//   DELETE — hard delete, BLOCKED (409) when tickets reference the type,
//            when fees pin this type (M2-T1 AC-6), when registration paths
//            pin it as their audience (M3-T1 AC-6), or registeredCount > 0
//            (block, never cascade)
//
// Route-owned validations (spec: agents/docs/specs/m1-registration-spine.md):
// - 404 for cross-org events AND for type ids belonging to another
//   event/org (IDOR-safe null from the scoped getter).
// - Code uniqueness re-checked excluding self -> 409 with field pointer.
// - capacity >= current registeredCount on edit.
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { registrationTypePayloadSchema } from "@/features/registration/schemas";
import {
  deleteAdminRegistrationType,
  getAdminRegistrationTypeForEvent,
  isAdminRegistrationTypeCodeTaken,
  updateAdminRegistrationType,
} from "@/lib/db/adminRegistrationType";
import { getAdminFeesReferencingRegistrationType } from "@/lib/db/adminFee";
import { getAdminRegistrationPathsReferencingRegistrationType } from "@/lib/db/adminRegistrationPath";
import { getAdminTicketTypesReferencingRegistrationType } from "@/lib/db/adminTicketType";

interface RouteContext {
  params: Promise<{ eventId: string; registrationTypeId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, registrationTypeId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminRegistrationTypeForEvent({
    registrationTypeId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Registration type not found" },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = registrationTypePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (
    await isAdminRegistrationTypeCodeTaken({
      eventId,
      code: parsed.data.code,
      excludeId: registrationTypeId,
    })
  ) {
    return NextResponse.json(
      { error: "Code already in use", field: "code" },
      { status: 409 },
    );
  }

  // Trivially true in M1 (counter is always 0) but enforced now so later
  // milestones cannot shrink capacity below the real registration count.
  if (
    parsed.data.capacity !== null &&
    parsed.data.capacity < existing.registeredCount
  ) {
    return NextResponse.json(
      { error: "Capacity cannot be below registered count", field: "capacity" },
      { status: 400 },
    );
  }

  await updateAdminRegistrationType(registrationTypeId, {
    name: parsed.data.name,
    code: parsed.data.code,
    capacity: parsed.data.capacity,
  });

  return NextResponse.json({ registrationTypeId });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, registrationTypeId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminRegistrationTypeForEvent({
    registrationTypeId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Registration type not found" },
      { status: 404 },
    );
  }

  // BLOCK, never cascade: cascading would silently widen ticket eligibility
  // (removing the last restriction makes a ticket unrestricted).
  const blockingTickets = await getAdminTicketTypesReferencingRegistrationType({
    eventId,
    organizationId: scope.organizationId,
    registrationTypeId,
  });
  if (blockingTickets.length > 0) {
    const names = blockingTickets.map((ticket) => ticket.name);
    return NextResponse.json(
      {
        error: `"${existing.name}" is used by ${names.length} ticket type${
          names.length === 1 ? "" : "s"
        }: ${names.join(", ")}. Reassign or delete those tickets first.`,
        blockingTicketNames: names,
      },
      { status: 409 },
    );
  }

  // M2-T1 AC-6: BLOCK when fees pin this registration type ("All types" fees
  // never block — deleting a type does not affect them).
  const blockingFees = await getAdminFeesReferencingRegistrationType({
    eventId,
    organizationId: scope.organizationId,
    registrationTypeId,
  });
  if (blockingFees.length > 0) {
    const names = blockingFees.map((fee) => fee.name);
    return NextResponse.json(
      {
        error: `"${existing.name}" is priced by ${names.length} fee${
          names.length === 1 ? "" : "s"
        }: ${names.join(", ")}. Delete or archive those fees first.`,
        blockingFeeNames: names,
      },
      { status: 409 },
    );
  }

  // M3-T1 AC-6: BLOCK when registration paths pin this type as their
  // audience ("Any"-audience paths never block — deleting a type does not
  // affect them).
  const blockingPaths = await getAdminRegistrationPathsReferencingRegistrationType({
    eventId,
    organizationId: scope.organizationId,
    registrationTypeId,
  });
  if (blockingPaths.length > 0) {
    const names = blockingPaths.map((path) => path.name);
    return NextResponse.json(
      {
        error: `"${existing.name}" is the audience of ${names.length} registration path${
          names.length === 1 ? "" : "s"
        }: ${names.join(", ")}. Re-point or delete those paths first.`,
        blockingPathNames: names,
      },
      { status: 409 },
    );
  }

  if (existing.registeredCount > 0) {
    return NextResponse.json(
      {
        error: `${existing.registeredCount} ${
          existing.registeredCount === 1 ? "person is" : "people are"
        } registered under this type. Registration types with registrations cannot be deleted.`,
      },
      { status: 409 },
    );
  }

  await deleteAdminRegistrationType(registrationTypeId);
  return NextResponse.json({ success: true });
}
