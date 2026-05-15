// API route: POST /api/dashboard/promotions/templates
// Creates a new promotion template scoped to the authenticated user's organization.
// Verifies the session cookie, checks write:promotion permission, then writes
// the doc via the Admin SDK with organizationId set from the session (not the request).
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { createAdminPromotionTemplate } from "@/lib/db/adminPromotionTemplate";
import { promotionTemplateSchema } from "@/features/promotion-templates/schema";

const COOKIE_NAME = "session";

export async function POST(request: Request) {
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

  const body = await request.json();
  const parsed = promotionTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Write the new template doc. promoCode is only stored when enablePromoCode is on.
  const templateId = await createAdminPromotionTemplate({
    organizationId: userDoc.organizationId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    discountType: parsed.data.discountType ?? null,
    discountValue: parsed.data.discountValue ?? null,
    conditions: parsed.data.conditions,
    enablePromoCode: parsed.data.enablePromoCode,
    promoCode: parsed.data.enablePromoCode
      ? (parsed.data.promoCode ?? null)
      : null,
    isArchived: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ templateId });
}
