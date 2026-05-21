// POST /api/dashboard/promotions/templates/[templateId]/apply-to-events
// Cascades template fields to a specific list of events.
// Events with inheritFromParent = false are skipped unless overwriteCustom = true.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import {
  getAdminPromotionTemplateForOrganization,
  applyTemplateToSpecificEvents,
} from "@/lib/db/adminPromotionTemplate";

const COOKIE_NAME = "session";

const bodySchema = z.object({
  eventIds: z.array(z.string().min(1)).min(1, "At least one event is required"),
  overwriteCustom: z.boolean(),
});

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { templateId } = await context.params;
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
  if (!userDoc.permissions.includes("write:promotion")) {
    return NextResponse.json(
      { error: "Missing write:promotion permission" },
      { status: 403 },
    );
  }

  const template = await getAdminPromotionTemplateForOrganization(
    templateId,
    userDoc.organizationId,
  );
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await applyTemplateToSpecificEvents(
    templateId,
    userDoc.organizationId,
    parsed.data.eventIds,
    {
      name: template.name,
      description: template.description ?? null,
      discountType: template.discountType ?? null,
      discountValue: template.discountValue ?? null,
      conditions: template.conditions ?? [],
      enablePromoCode: template.enablePromoCode ?? false,
      promoCode: template.promoCode ?? null,
    },
    { overwriteCustom: parsed.data.overwriteCustom },
  );

  return NextResponse.json(result);
}
