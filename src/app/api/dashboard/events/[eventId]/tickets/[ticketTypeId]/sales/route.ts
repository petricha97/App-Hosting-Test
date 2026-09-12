// Dedicated pause/resume endpoint: changes only the ticket's manual sales switch.
// Scheduled sales boundaries, capacity and all other ticket fields stay intact.
import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { updateAdminTicketType } from "@/lib/db/adminTicketType";

const ticketSalesPayloadSchema = z.object({ isOpen: z.boolean() });

// Validates the session, event and boolean input, then transactionally updates
// the scoped ticket's isOpen flag. Returns 404 for missing or foreign tickets.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string; ticketTypeId: string }> },
) {
  const { eventId, ticketTypeId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = ticketSalesPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await updateAdminTicketType(
    { eventId, ticketTypeId, organizationId: scope.organizationId },
    { isOpen: parsed.data.isOpen },
  );
  if (!result.ok) {
    return NextResponse.json({ error: "Ticket type not found" }, { status: 404 });
  }

  return NextResponse.json({ ticketTypeId, isOpen: parsed.data.isOpen });
}
