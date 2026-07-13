// API routes for a specific EventPromotion subcollection doc:
//   POST   — update event-level fields (does NOT touch the parent template)
//   DELETE — detach the promotion from the event
// Both verify session, write:events permission, and event org ownership.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { resolveActiveOrganizationId } from "@/lib/org-membership";
import {
  getAdminEventPromotionById,
  updateAdminEventPromotion,
  deleteAdminEventPromotion,
} from "@/lib/db/adminEventPromotion";

const COOKIE_NAME = "session";

// Validates the body for updating an event-level promotion.
// Includes enablePromoCode and promoCode so attendees can see the correct
// redemption mode on the event page without hitting the parent template.
// Server-side refinement mirrors the client-side check: promoCode is required
// when enablePromoCode is true so the invariant holds even on direct API calls.
const updateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    discountType: z.string().optional().nullable(),
    discountValue: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().optional().nullable(),
    ),
    conditions: z
      .array(
        z.object({
          field: z.string(),
          operator: z.string(),
          value: z.union([z.string(), z.number()]),
        }),
      )
      .default([]),
    inheritFromParent: z.boolean(),
    enablePromoCode: z.boolean().default(false),
    promoCode: z.string().optional().nullable(),
  })
  .refine(
    (data) => {
      // When promo code mode is on, a non-empty code must be provided.
      if (data.enablePromoCode) {
        return (
          typeof data.promoCode === "string" && data.promoCode.trim().length > 0
        );
      }
      return true;
    },
    {
      message: "Promo code is required when 'Enable promo code' is turned on.",
      path: ["promoCode"],
    },
  );

interface RouteContext {
  params: Promise<{ eventId: string; promotionId: string }>;
}

// Shared auth helper — verifies session and event org ownership.
// Does not need the Request object because Next.js `cookies()` reads from
// the current request context automatically.
async function resolveScope(eventId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return { error: "Missing session", status: 401 } as const;

  const decodedUser = await decodeUser(token);
  if ("error" in decodedUser)
    return { error: decodedUser.error, status: 401 } as const;

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());
  // SEC M2 Finding 1: the active organizationId is client-writable — only a
  // valid tenant key when the server-locked organizations[] roster confirms
  // membership (shared check with route-scope.ts / get-dashboard-scope.ts).
  const organizationId = resolveActiveOrganizationId(userDoc);
  if (!organizationId)
    return { error: "Missing organization scope", status: 403 } as const;
  if (!userDoc?.permissions.includes("write:events"))
    return { error: "Missing write:events permission", status: 403 } as const;

  const event = await getAdminEventForOrganization(eventId, organizationId);
  if (!event) return { error: "Event not found", status: 404 } as const;

  return { organizationId };
}

// Updates event-level promotion fields. Changes are isolated to this event's
// subcollection doc — the parent PromotionTemplate is never touched.
export async function POST(request: Request, context: RouteContext) {
  const { eventId, promotionId } = await context.params;
  const scope = await resolveScope(eventId);
  if ("error" in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const promotion = await getAdminEventPromotionById(eventId, promotionId);
  if (!promotion || promotion.organizationId !== scope.organizationId) {
    return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Write each field explicitly with ?? null so that a cleared discountValue
  // is stored as null in Firestore rather than undefined (which the Admin SDK rejects).
  // promoCode is cleared to null when enablePromoCode is turned off.
  await updateAdminEventPromotion(eventId, promotionId, {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    discountType: parsed.data.discountType ?? null,
    discountValue: parsed.data.discountValue ?? null,
    conditions: parsed.data.conditions,
    inheritFromParent: parsed.data.inheritFromParent,
    enablePromoCode: parsed.data.enablePromoCode,
    promoCode: parsed.data.enablePromoCode
      ? (parsed.data.promoCode ?? null)
      : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ promotionId });
}

// Detaches a promotion from an event by deleting the subcollection doc.
export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, promotionId } = await context.params;
  const scope = await resolveScope(eventId);
  if ("error" in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const promotion = await getAdminEventPromotionById(eventId, promotionId);
  if (!promotion || promotion.organizationId !== scope.organizationId) {
    return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
  }

  await deleteAdminEventPromotion(eventId, promotionId);
  return NextResponse.json({ success: true });
}
