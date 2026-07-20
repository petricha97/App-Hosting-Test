// API routes for a specific Tax (M2-T3):
//   PATCH  — full edit (discriminated-union payload) OR the lightweight
//            inline Active toggle ({ isActive } only, spec AC-3)
//   DELETE — hard delete, BLOCKED (409 -> deactivate) when Orders applied it
//
// Route-owned validations (spec: agents/docs/specs/m2-pricing-commerce.md):
// - 404 for cross-org events AND tax ids of another event/org (IDOR-safe).
// - Code uniqueness re-checked excluding self -> 409 field pointer.
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  taxActiveToggleSchema,
  taxPayloadSchema,
} from "@/features/pricing/schemas";
import { getAdminOrdersReferencingTax } from "@/lib/db/adminOrder";
import {
  deleteAdminTax,
  getAdminTaxForEvent,
  isAdminTaxCodeTaken,
  updateAdminTax,
} from "@/lib/db/adminTax";

interface RouteContext {
  params: Promise<{ eventId: string; taxId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, taxId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminTaxForEvent({
    taxId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json({ error: "Tax not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  // Inline Active toggle from the table (spec AC-3): strict { isActive } shape
  // so a malformed full payload can never be misread as a toggle.
  const toggle = taxActiveToggleSchema.safeParse(body);
  if (toggle.success) {
    const result = await updateAdminTax(
      { taxId, eventId, organizationId: scope.organizationId },
      { isActive: toggle.data.isActive },
    );
    if (!result.ok) {
      return NextResponse.json({ error: "Tax not found" }, { status: 404 });
    }
    return NextResponse.json({ taxId });
  }

  const parsed = taxPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (
    await isAdminTaxCodeTaken({
      eventId,
      code: parsed.data.code,
      excludeId: taxId,
    })
  ) {
    return NextResponse.json(
      { error: "Code already in use", field: "code" },
      { status: 409 },
    );
  }

  const result = await updateAdminTax(
    { taxId, eventId, organizationId: scope.organizationId },
    {
    name: parsed.data.name,
    code: parsed.data.code,
    // Passing type makes the DAL null the unused field group, so a
    // percentage <-> fixed switch never leaves stale values behind.
    type: parsed.data.type,
    rateMilliPercent:
      parsed.data.type === "percentage" ? parsed.data.rateMilliPercent : null,
    fixedAmountMinor:
      parsed.data.type === "fixed" ? parsed.data.fixedAmountMinor : null,
    fixedCurrency:
      parsed.data.type === "fixed" ? parsed.data.fixedCurrency : null,
    isActive: parsed.data.isActive,
    },
  );
  if (!result.ok) {
    return NextResponse.json({ error: "Tax not found" }, { status: 404 });
  }

  return NextResponse.json({ taxId });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, taxId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const existing = await getAdminTaxForEvent({
    taxId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json({ error: "Tax not found" }, { status: 404 });
  }

  // BLOCK, never cascade: orders snapshot their tax lines, but the tax row
  // remains their audit anchor — direct organizers to deactivate instead.
  const referencingOrders = await getAdminOrdersReferencingTax({
    eventId,
    organizationId: scope.organizationId,
    taxId,
  });
  if (referencingOrders.length > 0) {
    return NextResponse.json(
      {
        error: `${referencingOrders.length}${referencingOrders.length >= 5 ? "+" : ""} order${
          referencingOrders.length === 1 ? "" : "s"
        } applied this tax. Deactivate it instead.`,
      },
      { status: 409 },
    );
  }

  const result = await deleteAdminTax({
    taxId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Tax not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
