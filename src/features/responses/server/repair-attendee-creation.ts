import "server-only";

import { onSubmissionAccepted } from "@/features/responses/on-submission-accepted";
import { getAdminFormDataForEvent } from "@/lib/db/adminFormData";

export type RepairAttendeeCreationResult =
  | { ok: true; outcome: "repaired" | "already_complete" }
  | { ok: false; code: "RESPONSE_NOT_FOUND" }
  | { ok: false; code: "RESPONSE_NOT_ACCEPTED" }
  | { ok: false; code: "ATTENDEE_CREATION_FAILED"; error: unknown };

/**
 * Re-reads a response through its event and server-derived organization
 * scope, then invokes the sole idempotent attendee repair primitive once.
 */
export async function repairAttendeeCreation(input: {
  responseId: string;
  eventId: string;
  organizationId: string;
}): Promise<RepairAttendeeCreationResult> {
  const submission = await getAdminFormDataForEvent(input);
  if (!submission) {
    return { ok: false, code: "RESPONSE_NOT_FOUND" };
  }
  if (submission.status !== "accepted") {
    return { ok: false, code: "RESPONSE_NOT_ACCEPTED" };
  }
  if (submission.attendeeCreated === true) {
    return { ok: true, outcome: "already_complete" };
  }

  try {
    await onSubmissionAccepted(submission);
    return { ok: true, outcome: "repaired" };
  } catch (error) {
    return { ok: false, code: "ATTENDEE_CREATION_FAILED", error };
  }
}
