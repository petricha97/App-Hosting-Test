// GET /api/dashboard/promotions/templates/[templateId]/eligible-events
// Returns org events that have not ended, annotated with whether each event
// already has a promotion attached for this template and its inheritFromParent status.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import {
  getAdminPromotionTemplateForOrganization,
} from "@/lib/db/adminPromotionTemplate";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import { isEventOngoingOrFuture } from "@/features/event/utils";
import { adminDb } from "@/app/lib/firestore";
import type { EventPromotionDoc } from "@/types/collection";

const COOKIE_NAME = "session";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export interface EligibleEvent {
  id: string;
  name: string;
  hasPromotion: boolean;
  inheritFromParent: boolean | null;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
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

    // Fetch all org events and filter to ongoing/future only.
    const allEvents = await getAdminEventsForOrganization(userDoc.organizationId);
    const eligibleEvents = allEvents.filter((e) => isEventOngoingOrFuture(e));

    // Fetch all EventPromotion docs for this template across the org in one query.
    const snap = await adminDb
      .collectionGroup("EventPromotion")
      .where("templateId", "==", templateId)
      .where("organizationId", "==", userDoc.organizationId)
      .get();

    // Build a map: eventId → inheritFromParent
    const promotionByEventId = new Map<string, boolean>();
    for (const doc of snap.docs) {
      const parentEventId = doc.ref.parent.parent?.id;
      if (parentEventId) {
        const data = doc.data() as Pick<EventPromotionDoc, "inheritFromParent">;
        promotionByEventId.set(parentEventId, data.inheritFromParent);
      }
    }

    const events: EligibleEvent[] = eligibleEvents.map((event) => {
      const inheritFromParent = promotionByEventId.get(event.id);
      return {
        id: event.id,
        name: event.name,
        hasPromotion: promotionByEventId.has(event.id),
        inheritFromParent: inheritFromParent ?? null,
      };
    });

    return NextResponse.json({ events });
  } catch (err) {
    console.error("[eligible-events] 500 error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
