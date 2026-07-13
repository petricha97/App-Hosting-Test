// API route: POST /api/dashboard/events/[eventId]/pricing/fees
// Creates a fee (price for a ticket × registration type × currency) for an
// org-owned event (M2-T1).
//
// Route-owned validations (spec: agents/docs/specs/m2-pricing-commerce.md):
// - session -> write:events -> org-owned event via the shared route scope
//   (403 for view-only members, 404 cross-org — IDOR-safe).
// - Zod payload validation; server-owned fields are stripped by the schema.
// - ticketTypeId (and registrationTypeId when set) must belong to this event.
// - At most one ACTIVE fee per (ticket, regType-or-null, currency) -> 409
//   with a field pointer; archived fees never block.
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  FEE_DUPLICATE_MESSAGE,
  feePayloadSchema,
} from "@/features/pricing/schemas";
import {
  createAdminFee,
  isAdminActiveFeeCombinationTaken,
} from "@/lib/db/adminFee";
import { getAdminRegistrationTypeForEvent } from "@/lib/db/adminRegistrationType";
import { getAdminTicketTypeForEvent } from "@/lib/db/adminTicketType";

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
  const parsed = feePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const ticket = await getAdminTicketTypeForEvent({
    ticketTypeId: parsed.data.ticketTypeId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!ticket) {
    return NextResponse.json(
      {
        error: "The selected ticket does not belong to this event",
        field: "ticketTypeId",
      },
      { status: 400 },
    );
  }

  if (parsed.data.registrationTypeId !== null) {
    const registrationType = await getAdminRegistrationTypeForEvent({
      registrationTypeId: parsed.data.registrationTypeId,
      eventId,
      organizationId: scope.organizationId,
    });
    if (!registrationType) {
      return NextResponse.json(
        {
          error: "The selected registration type does not belong to this event",
          field: "registrationTypeId",
        },
        { status: 400 },
      );
    }
  }

  // Only ACTIVE fees participate in uniqueness — creating an archived fee can
  // never conflict, and archived rows never block (spec T1 AC-3/AC-4).
  if (
    parsed.data.status === "active" &&
    (await isAdminActiveFeeCombinationTaken({
      eventId,
      ticketTypeId: parsed.data.ticketTypeId,
      registrationTypeId: parsed.data.registrationTypeId,
      currency: parsed.data.currency,
    }))
  ) {
    return NextResponse.json(
      { error: FEE_DUPLICATE_MESSAGE, field: "ticketTypeId" },
      { status: 409 },
    );
  }

  const feeId = await createAdminFee({
    organizationId: scope.organizationId,
    eventId,
    name: parsed.data.name,
    ticketTypeId: parsed.data.ticketTypeId,
    registrationTypeId: parsed.data.registrationTypeId,
    currency: parsed.data.currency,
    basePriceMinor: parsed.data.basePriceMinor,
    status: parsed.data.status,
  });

  return NextResponse.json({ feeId });
}
