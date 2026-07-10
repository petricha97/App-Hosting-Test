// M3-T4 accept side-effect hook — NO-OP LOGGING STUB.
// Spec: agents/docs/specs/m3-registration-paths.md (M3-T4 "Accept side-effect").
//
// Called by transitionAdminFormDataStatus (src/lib/db/adminFormData.ts) after
// a submission transitions into "accepted". Fires AT MOST ONCE per
// submission: "accepted" is terminal, so a second accept attempt fails with
// INVALID_TRANSITION before the hook is ever reached again.
//
// M5-T1 replaces this body with attendee creation (mint the Attendee doc +
// QR, then flip FormDataDoc.attendeeCreated to true). Keep the signature.

import type { FormDataDoc, WithId } from "@/types/collection";

export async function onSubmissionAccepted(
  submission: WithId<FormDataDoc>,
): Promise<void> {
  console.info(
    `[responses] submission ${submission.id} accepted (event ${submission.eventId}) — ` +
      "attendee creation lands in M5-T1",
  );
}
