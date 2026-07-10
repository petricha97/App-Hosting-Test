// API route: POST /api/dashboard/events/[eventId]/pricing/taxes
// Creates a tax for an org-owned event (M2-T3).
//
// Route-owned validations (spec: agents/docs/specs/m2-pricing-commerce.md):
// - session -> write:events -> org-owned event via the shared route scope
//   (403 for view-only members, 404 cross-org — IDOR-safe).
// - Zod discriminated-union payload (percentage: integer milli-percent rate;
//   fixed: integer minor amount + currency); the DAL nulls the unused group.
// - Per-event, case-insensitive code uniqueness WITHIN Tax -> 409 field error.
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { taxPayloadSchema } from "@/features/pricing/schemas";
import { createAdminTax, isAdminTaxCodeTaken } from "@/lib/db/adminTax";

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
  const parsed = taxPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (await isAdminTaxCodeTaken({ eventId, code: parsed.data.code })) {
    return NextResponse.json(
      { error: "Code already in use", field: "code" },
      { status: 409 },
    );
  }

  const taxId = await createAdminTax({
    organizationId: scope.organizationId,
    eventId,
    name: parsed.data.name,
    code: parsed.data.code,
    type: parsed.data.type,
    rateMilliPercent:
      parsed.data.type === "percentage" ? parsed.data.rateMilliPercent : null,
    fixedAmountMinor:
      parsed.data.type === "fixed" ? parsed.data.fixedAmountMinor : null,
    fixedCurrency:
      parsed.data.type === "fixed" ? parsed.data.fixedCurrency : null,
    isActive: parsed.data.isActive,
  });

  return NextResponse.json({ taxId });
}
