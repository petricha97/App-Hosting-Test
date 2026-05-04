import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { templateBuilderSchema } from "@/features/form/schema";
import { sanitizeFormFieldsForFirestore } from "@/features/form/utils";
import { createAdminFormTemplate } from "@/lib/db/adminFormTemplate";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

const COOKIE_NAME = "session";

const SaveTemplateRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  status: z.enum(["active", "archived"]),
  fields: z.array(z.unknown()),
});

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
    return NextResponse.json({ error: "Missing organization scope" }, { status: 403 });
  }

  if (!userDoc.permissions.includes("write:form")) {
    return NextResponse.json({ error: "Missing write:form permission" }, { status: 403 });
  }

  const body = await request.json();
  const parsedRequest = SaveTemplateRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: parsedRequest.error.flatten() },
      { status: 400 },
    );
  }

  const parsedBuilder = templateBuilderSchema.safeParse(parsedRequest.data);

  if (!parsedBuilder.success) {
    return NextResponse.json(
      { error: parsedBuilder.error.flatten() },
      { status: 400 },
    );
  }

  const templateId = await createAdminFormTemplate({
    organizationId: userDoc.organizationId,
    title: parsedBuilder.data.title.trim(),
    description: parsedBuilder.data.description.trim(),
    status: parsedBuilder.data.status,
    version: 1,
    fields: sanitizeFormFieldsForFirestore(parsedBuilder.data.fields),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ templateId });
}
