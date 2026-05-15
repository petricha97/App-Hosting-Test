// API routes for a specific promotion template:
//   POST   /api/dashboard/promotions/templates/[templateId] — update
//   DELETE /api/dashboard/promotions/templates/[templateId] — delete
// Both handlers verify the session, check write:promotion permission, and confirm
// the template belongs to the user's organization before mutating Firestore.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import {
  getAdminPromotionTemplateForOrganization,
  updateAdminPromotionTemplate,
  deleteAdminPromotionTemplate,
} from "@/lib/db/adminPromotionTemplate";
import { promotionTemplateSchema } from "@/features/promotion-templates/schema";

const COOKIE_NAME = "session";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

// Shared auth helper — decodes the session cookie and returns the user's
// organizationId and permission list, or an error object with an HTTP status.
async function resolveScope(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return { error: "Missing session", status: 401 } as const;

  const decodedUser = await decodeUser(token);
  if ("error" in decodedUser)
    return { error: decodedUser.error, status: 401 } as const;

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());
  if (!userDoc?.organizationId)
    return { error: "Missing organization scope", status: 403 } as const;
  if (!userDoc.permissions.includes("write:promotion"))
    return {
      error: "Missing write:promotion permission",
      status: 403,
    } as const;

  return { organizationId: userDoc.organizationId };
}

// Updates an existing template. Validates the request body with Zod and
// confirms the template belongs to the caller's org before writing.
export async function POST(request: Request, context: RouteContext) {
  const { templateId } = await context.params;
  const scope = await resolveScope(request);

  if ("error" in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const template = await getAdminPromotionTemplateForOrganization(
    templateId,
    scope.organizationId,
  );

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = promotionTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Update the template fields. promoCode is cleared when enablePromoCode is turned off.
  await updateAdminPromotionTemplate(templateId, {
    description: parsed.data.description ?? null,
    discountType: parsed.data.discountType ?? null,
    discountValue: parsed.data.discountValue ?? null,
    conditions: parsed.data.conditions,
    enablePromoCode: parsed.data.enablePromoCode,
    promoCode: parsed.data.enablePromoCode
      ? (parsed.data.promoCode ?? null)
      : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ templateId });
}

// Deletes a template after confirming org ownership.
export async function DELETE(_request: Request, context: RouteContext) {
  const { templateId } = await context.params;
  const scope = await resolveScope(_request);

  if ("error" in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const template = await getAdminPromotionTemplateForOrganization(
    templateId,
    scope.organizationId,
  );

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await deleteAdminPromotionTemplate(templateId);

  return NextResponse.json({ success: true });
}
