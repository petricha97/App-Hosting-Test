// API routes for a specific TicketType (M1-T2):
//   PATCH  — update the allow-listed fields (server-owned fields unreachable)
//   DELETE — hard delete, BLOCKED (409) when registeredCount > 0
//            (M2 must extend the block to tickets referenced by fees)
//
// Route-owned validations (spec: agents/docs/specs/m1-registration-spine.md):
// - 404 for cross-org events AND ticket ids of another event/org (IDOR-safe).
// - Code uniqueness within TicketType, excluding self -> 409 field pointer.
// - capacity >= current registeredCount on edit.
// - salesEnd >= salesStart (schema) and registrationTypeIds membership.
import { NextResponse } from "next/server";

import { findUnknownRegistrationTypeIds } from "@/features/registration/server/registration-type-membership";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { ticketTypePayloadSchema } from "@/features/registration/schemas";
import {
  eventLocalDateToUtcMs,
  resolveEventTimeZone,
} from "@/features/registration/utils";
import {
  deleteAdminTicketType,
  getAdminTicketTypeForEvent,
  isAdminTicketTypeCodeTaken,
  updateAdminTicketType,
} from "@/lib/db/adminTicketType";

interface RouteContext {
  params: Promise<{ eventId: string; ticketTypeId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, ticketTypeId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminTicketTypeForEvent({
    ticketTypeId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Ticket type not found" },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = ticketTypePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const unknownIds = await findUnknownRegistrationTypeIds({
    eventId,
    organizationId: scope.organizationId,
    registrationTypeIds: parsed.data.registrationTypeIds,
  });
  if (unknownIds.length > 0) {
    return NextResponse.json(
      {
        error:
          "One or more selected registration types do not belong to this event",
        field: "registrationTypeIds",
      },
      { status: 400 },
    );
  }

  if (
    await isAdminTicketTypeCodeTaken({
      eventId,
      code: parsed.data.code,
      excludeId: ticketTypeId,
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

  const timeZone = resolveEventTimeZone(scope.event.timezone);
  const salesStart = parsed.data.salesStart
    ? new Date(eventLocalDateToUtcMs(parsed.data.salesStart, timeZone, "start"))
    : null;
  const salesEnd = parsed.data.salesEnd
    ? new Date(eventLocalDateToUtcMs(parsed.data.salesEnd, timeZone, "end"))
    : null;

  await updateAdminTicketType(ticketTypeId, {
    name: parsed.data.name,
    code: parsed.data.code,
    capacity: parsed.data.capacity,
    salesStart,
    salesEnd,
    isOpen: parsed.data.isOpen,
    registrationTypeIds: parsed.data.registrationTypeIds,
  });

  return NextResponse.json({ ticketTypeId });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, ticketTypeId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminTicketTypeForEvent({
    ticketTypeId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Ticket type not found" },
      { status: 404 },
    );
  }

  if (existing.registeredCount > 0) {
    return NextResponse.json(
      {
        error: `${existing.registeredCount} ${
          existing.registeredCount === 1 ? "person is" : "people are"
        } registered with this ticket. Ticket types with registrations cannot be deleted.`,
      },
      { status: 409 },
    );
  }

  await deleteAdminTicketType(ticketTypeId);
  return NextResponse.json({ success: true });
}
