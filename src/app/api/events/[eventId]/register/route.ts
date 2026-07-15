import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { fireApprovalPendingEmail } from "@/features/emails/server/fire-on-submit-email";
import { buildFormSubmissionSchema } from "@/features/form/schema";
import { extractOrganizationIdFromPath } from "@/features/event/utils";
import { getAdminPublishedFormForPublicEvent } from "@/lib/db/adminForm";
import { createAdminFormData } from "@/lib/db/adminFormData";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";

const PublicEventRegistrationRequestSchema = z.object({
  submission: z.record(z.string(), z.string()),
});

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const event = await getAdminPublishedEventById(eventId);

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const organizationId =
    extractOrganizationIdFromPath(event.organizationPath) ?? "";

  const form = await getAdminPublishedFormForPublicEvent({
    eventId,
    eventName: event.name,
    organizationId,
    formPath: event.formPath,
  });

  if (!form) {
    return NextResponse.json(
      { error: "Registration is not available yet" },
      { status: 404 },
    );
  }

  const body = await request.json();
  const parsedRequest = PublicEventRegistrationRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: parsedRequest.error.flatten() },
      { status: 400 },
    );
  }

  const submissionSchema = buildFormSubmissionSchema(form.fields);
  const parsedSubmission = submissionSchema.safeParse(
    parsedRequest.data.submission,
  );

  if (!parsedSubmission.success) {
    return NextResponse.json(
      { error: parsedSubmission.error.flatten() },
      { status: 400 },
    );
  }

  const submissionId = await createAdminFormData({
    formId: form.id,
    eventId,
    organizationId: form.organizationId || organizationId,
    submission: parsedSubmission.data,
    submittedAt: FieldValue.serverTimestamp(),
  });

  // M6-T3: on-submit trigger. createAdminFormData has no replay path (every
  // POST mints a fresh doc), so — unlike the stepper's create-if-absent
  // finalize — this call site has no `created` flag to gate on; firing
  // unconditionally here is still exactly-once per submission (spec §1).
  // Isolated from the response — an email problem here must never surface
  // as a registration failure (the FormData write already committed above).
  try {
    await fireApprovalPendingEmail({
      organizationId: form.organizationId || organizationId,
      eventId,
      event,
      submissionId,
      submission: parsedSubmission.data,
    });
  } catch (error) {
    console.error(
      `[register] on-submit approval-pending email crashed for submission ${submissionId}`,
      error,
    );
  }

  return NextResponse.json({ submissionId });
}
