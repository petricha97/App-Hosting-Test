// API route: PATCH /api/dashboard/events/[eventId]/promotions/[promotionId]/settings
// Edits ONLY the M2-T2 discount-settings fields of an EventPromotion:
// level, validityStart/End, usageCap, isActive. The base promotion fields
// (name, code, discount, conditions) keep their single write path on the
// existing promotions route; usedCount is server-owned — absent from the
// schema here AND stripped defensively by the DAL blocklist, so no payload
// can ever touch it (spec M2-T2 AC-7).
//
// Validity dates arrive as event-local calendar dates and are stored as UTC
// instants bounding the event-local day (same storage rule as M1 sales
// windows: start 00:00:00.000, end 23:59:59.999 in the event's timezone).
import { NextResponse } from "next/server";

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { discountSettingsPayloadSchema } from "@/features/pricing/schemas";
import {
  eventLocalDateToUtcMs,
  resolveEventTimeZone,
} from "@/features/registration/utils";
import {
  getAdminEventPromotionById,
  updateAdminEventPromotion,
} from "@/lib/db/adminEventPromotion";

interface RouteContext {
  params: Promise<{ eventId: string; promotionId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, promotionId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const promotion = await getAdminEventPromotionById(eventId, promotionId);
  if (!promotion || promotion.organizationId !== scope.organizationId) {
    return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = discountSettingsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // The cap can never drop below the server-owned usage counter (spec AC-6).
  if (
    parsed.data.usageCap !== null &&
    parsed.data.usageCap < promotion.usedCount
  ) {
    return NextResponse.json(
      { error: "Cap cannot be below times used", field: "usageCap" },
      { status: 400 },
    );
  }

  // Plain epoch-millis bounds: the DAL mints the stored Timestamps and stamps
  // updatedAt itself (review S-2 — no firebase-admin import in routes).
  const timeZone = resolveEventTimeZone(scope.event.timezone);
  const validityStartMs = parsed.data.validityStart
    ? eventLocalDateToUtcMs(parsed.data.validityStart, timeZone, "start")
    : null;
  const validityEndMs = parsed.data.validityEnd
    ? eventLocalDateToUtcMs(parsed.data.validityEnd, timeZone, "end")
    : null;

  await updateAdminEventPromotion(eventId, promotionId, {
    level: parsed.data.level,
    validityStartMs,
    validityEndMs,
    usageCap: parsed.data.usageCap,
    isActive: parsed.data.isActive,
  });

  return NextResponse.json({ promotionId });
}
