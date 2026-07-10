// API routes for a specific Fee (M2-T1):
//   PATCH  — update the allow-listed fields (server-owned fields unreachable)
//   DELETE — hard delete, BLOCKED (409 -> Archive) when Orders reference it
//
// Route-owned validations (spec: agents/docs/specs/m2-pricing-commerce.md):
// - 404 for cross-org events AND fee ids of another event/org (IDOR-safe).
// - ticket/registration-type membership re-checked on edit.
// - Active-combination uniqueness re-checked excluding self -> 409 field
//   pointer (archived fees never block; archiving is always allowed).
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  FEE_DUPLICATE_MESSAGE,
  feePayloadSchema,
} from "@/features/pricing/schemas";
import {
  deleteAdminFee,
  getAdminFeeForEvent,
  isAdminActiveFeeCombinationTaken,
  updateAdminFee,
} from "@/lib/db/adminFee";
import { getAdminOrdersReferencingFee } from "@/lib/db/adminOrder";
import { getAdminRegistrationTypeForEvent } from "@/lib/db/adminRegistrationType";
import { getAdminTicketTypeForEvent } from "@/lib/db/adminTicketType";

interface RouteContext {
  params: Promise<{ eventId: string; feeId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, feeId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminFeeForEvent({
    feeId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json({ error: "Fee not found" }, { status: 404 });
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

  if (
    parsed.data.status === "active" &&
    (await isAdminActiveFeeCombinationTaken({
      eventId,
      ticketTypeId: parsed.data.ticketTypeId,
      registrationTypeId: parsed.data.registrationTypeId,
      currency: parsed.data.currency,
      excludeId: feeId,
    }))
  ) {
    return NextResponse.json(
      { error: FEE_DUPLICATE_MESSAGE, field: "ticketTypeId" },
      { status: 409 },
    );
  }

  await updateAdminFee(feeId, {
    name: parsed.data.name,
    ticketTypeId: parsed.data.ticketTypeId,
    registrationTypeId: parsed.data.registrationTypeId,
    currency: parsed.data.currency,
    basePriceMinor: parsed.data.basePriceMinor,
    status: parsed.data.status,
  });

  return NextResponse.json({ feeId });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, feeId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminFeeForEvent({
    feeId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json({ error: "Fee not found" }, { status: 404 });
  }

  // BLOCK, never cascade: orders keep a frozen snapshot, but the fee row is
  // still their audit anchor — direct organizers to Archive instead.
  const referencingOrders = await getAdminOrdersReferencingFee({
    eventId,
    organizationId: scope.organizationId,
    feeId,
  });
  if (referencingOrders.length > 0) {
    return NextResponse.json(
      {
        error: `${referencingOrders.length}${referencingOrders.length >= 5 ? "+" : ""} order${
          referencingOrders.length === 1 ? "" : "s"
        } reference this fee. Archive it instead.`,
      },
      { status: 409 },
    );
  }

  await deleteAdminFee(feeId);
  return NextResponse.json({ success: true });
}
