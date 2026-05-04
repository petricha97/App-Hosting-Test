import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { getAdminEventForOrganization, updateAdminEvent } from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

const COOKIE_NAME = "session";

const UpdateEventStatusSchema = z.object({
  status: z.enum(["Draft", "Published"]),
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
    return NextResponse.json({ error: "Missing organization scope" }, { status: 403 });
  }

  if (!userDoc.permissions.includes("write:events")) {
    return NextResponse.json({ error: "Missing write:events permission" }, { status: 403 });
  }

  const event = await getAdminEventForOrganization(eventId, userDoc.organizationId);

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = UpdateEventStatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await updateAdminEvent(eventId, {
    status: parsed.data.status,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ status: parsed.data.status });
}
