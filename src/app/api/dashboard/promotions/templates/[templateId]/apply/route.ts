// API route: POST /api/dashboard/promotions/templates/[templateId]/apply
// Cascades the parent template's current field values to all EventPromotion docs
// across all events where inheritFromParent = true for this template.
// Only affects events in the caller's organization.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import {
  getAdminPromotionTemplateForOrganization,
  applyTemplateToInheritingEvents,
} from "@/lib/db/adminPromotionTemplate";

const COOKIE_NAME = "session";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
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

  // Push all template fields — including enablePromoCode and promoCode — to every
  // event that still inherits from this template.
  const updatedCount = await applyTemplateToInheritingEvents(
    templateId,
    userDoc.organizationId,
    {
      name: template.name,
      description: template.description ?? null,
      discountType: template.discountType ?? null,
      discountValue: template.discountValue ?? null,
      conditions: template.conditions ?? [],
      enablePromoCode: template.enablePromoCode ?? false,
      promoCode: template.promoCode ?? null,
    },
  );

  return NextResponse.json({ updatedCount });
}
