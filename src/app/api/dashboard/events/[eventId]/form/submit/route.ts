import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { buildFormSubmissionSchema } from "@/features/form/schema";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import { createAdminFormData } from "@/lib/db/adminFormData";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

const COOKIE_NAME = "session";

const SubmitEventFormRequestSchema = z.object({
  submission: z.record(z.string(), z.string()),
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

  if (!userDoc.permissions.includes("write:form")) {
    return NextResponse.json({ error: "Missing write:form permission" }, { status: 403 });
  }

  const event = await getAdminEventForOrganization(eventId, userDoc.organizationId);

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const form = await getAdminFormForEvent({
    eventId,
    eventName: event.name,
    organizationId: userDoc.organizationId,
    formPath: event.formPath,
  });

  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsedRequest = SubmitEventFormRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: parsedRequest.error.flatten() },
      { status: 400 },
    );
  }

  const submissionSchema = buildFormSubmissionSchema(form.fields);
  const parsedSubmission = submissionSchema.safeParse(parsedRequest.data.submission);

  if (!parsedSubmission.success) {
    return NextResponse.json(
      { error: parsedSubmission.error.flatten() },
      { status: 400 },
    );
  }

  const submissionId = await createAdminFormData({
    formId: form.id,
    eventId,
    organizationId: userDoc.organizationId,
    submission: parsedSubmission.data,
    submittedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ submissionId });
}
