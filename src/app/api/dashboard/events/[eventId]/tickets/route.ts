// API route: POST /api/dashboard/events/[eventId]/tickets
// Creates a ticket type (admission item) for an org-owned event (M1-T2).
//
// Route-owned validations (spec: agents/docs/specs/m1-registration-spine.md):
// - Zod payload validation incl. salesEnd >= salesStart (calendar dates);
//   server-owned fields such as registeredCount are stripped by the schema.
// - registrationTypeIds must belong to this event's registration types.
// - Per-event, case-insensitive code uniqueness within TicketType -> 409.
// - Sales dates are event-local calendar dates converted here to UTC instants
//   (start 00:00:00.000 / end 23:59:59.999 in the event's timezone).
import { NextResponse } from "next/server";

import { findUnknownRegistrationTypeIds } from "@/features/registration/server/registration-type-membership";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { ticketTypePayloadSchema } from "@/features/registration/schemas";
import {
  eventLocalDateToUtcMs,
  resolveEventTimeZone,
} from "@/features/registration/utils";
import {
  createAdminTicketType,
  isAdminTicketTypeCodeTaken,
} from "@/lib/db/adminTicketType";

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

  if (await isAdminTicketTypeCodeTaken({ eventId, code: parsed.data.code })) {
    return NextResponse.json(
      { error: "Code already in use", field: "code" },
      { status: 409 },
    );
  }

  const timeZone = resolveEventTimeZone(scope.event.timezone);
  const salesStart = parsed.data.salesStart
    ? new Date(eventLocalDateToUtcMs(parsed.data.salesStart, timeZone, "start"))
    : null;
  const salesEnd = parsed.data.salesEnd
    ? new Date(eventLocalDateToUtcMs(parsed.data.salesEnd, timeZone, "end"))
    : null;

  const ticketTypeId = await createAdminTicketType({
    organizationId: scope.organizationId,
    eventId,
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
