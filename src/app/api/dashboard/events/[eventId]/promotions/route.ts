// API route: POST /api/dashboard/events/[eventId]/promotions
// Attaches a promotion template to an event by creating an EventPromotion doc
// in the Event/{eventId}/EventPromotion subcollection.
// Verifies session, write:events permission, event org ownership, and that the
// selected template belongs to the same org before writing.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminPromotionTemplateForOrganization } from "@/lib/db/adminPromotionTemplate";
import {
  createAdminEventPromotion,
  getAdminEventPromotionsForEvent,
} from "@/lib/db/adminEventPromotion";

const COOKIE_NAME = "session";

const attachSchema = z.object({
  templateId: z.string().min(1),
});

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ error: "Missing session" }, { status: 401 });
  }

  const decodedUser = await decodeUser(token);
  if ("error" in decodedUser) {
    return NextResponse.json({ error: decodedUser.error }, { status: 401 });
  }

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());
  if (!userDoc?.organizationId) {
    return NextResponse.json(
      { error: "Missing organization scope" },
      { status: 403 },
    );
  }
  if (!userDoc.permissions.includes("write:events")) {
    return NextResponse.json(
      { error: "Missing write:events permission" },
      { status: 403 },
    );
  }

  const event = await getAdminEventForOrganization(
    eventId,
    userDoc.organizationId,
  );
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Confirm the template belongs to the same org before copying its fields.
  const template = await getAdminPromotionTemplateForOrganization(
    parsed.data.templateId,
    userDoc.organizationId,
  );
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Guard against duplicate attaches that could slip through a double-submit,
  // stale tab, or direct API call even when the UI disables already-attached templates.
  const existingPromotions = await getAdminEventPromotionsForEvent(
    eventId,
    userDoc.organizationId,
  );
  const alreadyAttached = existingPromotions.some(
    (p) => p.templateId === template.id,
  );
  if (alreadyAttached) {
    return NextResponse.json(
      { error: "This template is already attached to the event" },
      { status: 409 },
    );
  }

  // Copy all template fields into the event-level doc so the event has its own
  // snapshot. enablePromoCode and promoCode are included so the event inherits
  // the correct redemption mode from the template.
  const promotionId = await createAdminEventPromotion(eventId, {
    organizationId: userDoc.organizationId,
    templateId: template.id,
    inheritFromParent: true,
    name: template.name,
    description: template.description ?? null,
    discountType: template.discountType ?? null,
    discountValue: template.discountValue ?? null,
    conditions: template.conditions ?? [],
    enablePromoCode: template.enablePromoCode ?? false,
    promoCode: template.promoCode ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ promotionId });
}
