import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import decodeUser from "@/lib/auth-utils";
import { getAdminEventForOrganization, updateAdminEvent } from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import {
  DEFAULT_EVENT_PAGE_KEY,
  publishAdminEventPage,
} from "@/lib/db/adminEventPage";
import { getAdminRegistrationPathForEvent } from "@/lib/db/adminRegistrationPath";
import { saveEventPageDraftSchema } from "@/features/event-pages/schema";

const COOKIE_NAME = "session";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
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

    const event = await getAdminEventForOrganization(eventId, userDoc.organizationId);

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = saveEventPageDraftSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    // M4-T2 AC-25: a non-default pageKey must be a registration path id of
    // THIS event (org-scoped) — foreign/unknown ids are rejected.
    const pageKey = parsed.data.pageKey ?? DEFAULT_EVENT_PAGE_KEY;
    if (pageKey !== DEFAULT_EVENT_PAGE_KEY) {
      const path = await getAdminRegistrationPathForEvent({
        pathId: pageKey,
        eventId,
        organizationId: userDoc.organizationId,
      });
      if (!path) {
        return NextResponse.json(
          { error: "Unknown registration path for this event" },
          { status: 400 },
        );
      }
    }

    const published = await publishAdminEventPage({
      eventId,
      organizationId: userDoc.organizationId,
      eventPagePath: event.eventPagePath,
      pageKey,
      title: parsed.data.title,
      draftContent: parsed.data.draftContent,
    });

    // AC-24: publishing a PATH page never flips event.pageMode or moves
    // event.eventPagePath — those track the default page only.
    if (pageKey === DEFAULT_EVENT_PAGE_KEY) {
      await updateAdminEvent(eventId, {
        eventPagePath: published.path,
        pageMode: "custom",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({
      eventPageId: published.id,
      eventPagePath: published.path,
      pageKey,
      status: "published",
      pageMode: pageKey === DEFAULT_EVENT_PAGE_KEY ? "custom" : event.pageMode,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to publish event page",
      },
      { status: 500 },
    );
  }
}
