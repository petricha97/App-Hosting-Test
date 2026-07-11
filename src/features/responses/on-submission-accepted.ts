// M5-T1 accept side-effect hook — REAL implementation (replaces the M3 no-op
// stub, signature kept). Spec: agents/docs/specs/m5-attendees-checkin.md
// (M5-T1 "fills the M3 onSubmissionAccepted stub").
//
// Called by transitionAdminFormDataStatus (src/lib/db/adminFormData.ts)
// AFTER the accept transaction commits, at most once per submission through
// that path ("accepted" is terminal — a second accept fails
// INVALID_TRANSITION before the hook is reached).
//
// What it does, in order:
//   1. resolve the attendee's qrTokenHash — INHERIT the finalize-stamped
//      FormDataDoc.qrTokenHash, or MINT one for legacy flat submissions
//      (deterministic token, so inherit == re-mint under an unrotated secret);
//   2. denormalize personal fields from the submission map
//      (first_name/last_name/email/company/job_title -> "" when absent) and
//      regType/ticket from the linked Order (+ RegistrationType name);
//      legacy submissions (null orderId) get null ids + "—" labels;
//   3. create-if-absent the Attendee at the DETERMINISTIC id
//      (attendeeIdFromSubmissionId) — replays return the existing doc with
//      zero attendee writes;
//   4. flip FormDataDoc.attendeeCreated = true (+ backfill qrTokenHash when
//      the doc lacked it).
//
// FAILURE / RETRY CONTRACT (spec T1): the accept commit stands even if this
// hook throws — the submission is NEVER un-accepted. `status: "accepted"` +
// `attendeeCreated: false` is the "hook pending" signal; every step above is
// idempotent, so healing = re-invoking this function with the same
// submission (it is exported for exactly that — a future repair path calls
// it directly, since the status machine will not fire it twice).
//
// DEGRADED DATA (documented decision): an orderId that no longer resolves
// (corruption/manual deletion) degrades to the legacy shape (null ids, "—"
// labels) instead of crashing — a submission must never become
// un-checkinable because a denorm source vanished.

import { createAdminAttendeeIfAbsent } from "@/lib/db/adminAttendee";
import { markAdminFormDataAttendeeCreated } from "@/lib/db/adminFormData";
import { getAdminOrderForEvent } from "@/lib/db/adminOrder";
import { getAdminRegistrationTypeForEvent } from "@/lib/db/adminRegistrationType";
import { hashQrToken, mintQrToken } from "@/lib/qr/qr-token";
import type { FormDataDoc, WithId } from "@/types/collection";

// Roster/badge fallback label for missing regType/ticket denorms (spec T1).
export const ATTENDEE_LABEL_FALLBACK = "—";

// Pure denorm of the personal fields from the submission map — exported for
// tests. Keys match the public flow's mandatory field keys
// (src/features/responses/utils.ts uses the same first_name/last_name/email).
export function attendeePersonalFieldsFromSubmission(
  submission: Record<string, string>,
): {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  jobTitle: string;
} {
  const read = (key: string): string => {
    const value = submission[key];
    return typeof value === "string" ? value.trim() : "";
  };

  return {
    firstName: read("first_name"),
    lastName: read("last_name"),
    email: read("email"),
    company: read("company"),
    jobTitle: read("job_title"),
  };
}

export async function onSubmissionAccepted(
  submission: WithId<FormDataDoc>,
): Promise<void> {
  const { eventId, organizationId } = submission;

  // 1. QR identity: inherit the finalize-stamped hash; mint for legacy docs.
  const storedHash =
    typeof submission.qrTokenHash === "string" &&
    submission.qrTokenHash.length > 0
      ? submission.qrTokenHash
      : null;
  const qrTokenHash =
    storedHash ??
    hashQrToken(mintQrToken({ eventId, formDataId: submission.id }));

  // 2. Denorms.
  const personal = attendeePersonalFieldsFromSubmission(
    submission.submission ?? {},
  );

  const orderId = submission.orderId ?? null;
  let registrationTypeId: string | null = null;
  let ticketTypeId: string | null = null;
  let registrationTypeLabel = ATTENDEE_LABEL_FALLBACK;

  if (orderId !== null) {
    const order = await getAdminOrderForEvent({
      orderId,
      eventId,
      organizationId,
    });
    if (order) {
      registrationTypeId = order.registrationTypeId ?? null;
      ticketTypeId = order.ticketTypeId ?? null;
      if (registrationTypeId !== null) {
        const registrationType = await getAdminRegistrationTypeForEvent({
          registrationTypeId,
          eventId,
          organizationId,
        });
        if (registrationType) registrationTypeLabel = registrationType.name;
      }
    }
  }

  const ticketLabel =
    typeof submission.ticketLabel === "string" &&
    submission.ticketLabel.trim().length > 0
      ? submission.ticketLabel
      : ATTENDEE_LABEL_FALLBACK;

  // 3. Create-if-absent at the deterministic id (idempotent replay).
  await createAdminAttendeeIfAbsent({
    organizationId,
    eventId,
    submissionId: submission.id,
    orderId,
    pathId: submission.pathId ?? null,
    ...personal,
    registrationTypeId,
    registrationTypeLabel,
    ticketTypeId,
    ticketLabel,
    qrTokenHash,
  });

  // 4. Clear the "hook pending" signal (+ backfill the hash for legacy docs).
  await markAdminFormDataAttendeeCreated({
    formDataId: submission.id,
    qrTokenHash: storedHash === null ? qrTokenHash : undefined,
  });
}
