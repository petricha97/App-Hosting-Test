import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { formBuilderSchema } from "@/features/form/schema";
import { sanitizeFormFieldsForFirestore } from "@/features/form/utils";
import {
  createAdminForm,
  getAdminFormForEvent,
  updateAdminForm,
} from "@/lib/db/adminForm";
import {
  getAdminEventForOrganization,
  updateAdminEvent,
} from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

const COOKIE_NAME = "session";

const SaveEventFormRequestSchema = z.object({
  title: z.string().trim().min(1),
  status: z.enum(["draft", "published"]),
  fields: z.array(z.unknown()),
});

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function POST(_: Request, context: RouteContext) {
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

  if (!userDoc.permissions.includes("write:form")) {
    return NextResponse.json({ error: "Missing write:form permission" }, { status: 403 });
  }

  const event = await getAdminEventForOrganization(eventId, userDoc.organizationId);

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const body = await _.json();
  const parsedRequest = SaveEventFormRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: parsedRequest.error.flatten() },
      { status: 400 },
    );
  }

  const parsedBuilder = formBuilderSchema.safeParse({
    title: parsedRequest.data.title,
    status: parsedRequest.data.status,
    fields: parsedRequest.data.fields,
  });

  if (!parsedBuilder.success) {
    return NextResponse.json(
      { error: parsedBuilder.error.flatten() },
      { status: 400 },
    );
  }

  const payloadFields = sanitizeFormFieldsForFirestore(parsedBuilder.data.fields);
  const existingForm = await getAdminFormForEvent({
    eventId,
    eventName: event.name,
    organizationId: userDoc.organizationId,
    formPath: event.formPath,
  });

  let formId = existingForm?.id ?? null;

  if (formId) {
    await updateAdminForm(formId, {
      eventId,
      organizationId: userDoc.organizationId,
      title: parsedBuilder.data.title.trim(),
      status: parsedBuilder.data.status,
      fields: payloadFields,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    formId = await createAdminForm({
      eventId,
      organizationId: userDoc.organizationId,
      title: parsedBuilder.data.title.trim(),
      status: parsedBuilder.data.status,
      fields: payloadFields,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await updateAdminEvent(eventId, {
      formPath: `Form/${formId}`,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return NextResponse.json({
    formId,
    status: parsedBuilder.data.status,
  });
}
