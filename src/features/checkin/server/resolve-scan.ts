// Shared QR resolution pipeline for the scanner routes (M5-T5) — the public
// team-session routes and the dashboard admin routes both funnel through
// here so the five result states are decided in exactly one place:
//
//   verify HMAC (invalid sig -> INVALID)
//   -> embedded eventId ≠ scanner's event -> WRONG_EVENT (no data leaked)
//   -> Attendee doc get at the deterministic id
//        missing + FormData with status < accepted -> NOT_ACCEPTED
//        missing otherwise -> INVALID
//   -> stored qrTokenHash mismatch -> INVALID (revocation seam)
//   -> status "cancelled" -> CANCELLED
//   -> OK (attendee card)
//
// ALL resolution flows through the token — never a bare attendeeId from the
// client (T5 AC-12). Resolve never writes (resolve ≠ confirm, T5 AC-3).
import "server-only";

import { timestampToIso } from "@/features/attendees/roster";
import type { ScanAttendeeCard } from "@/features/checkin/scan-types";
import { getAdminAttendeeBySubmissionId } from "@/lib/db/adminAttendee";
import { getAdminFormDataForEvent } from "@/lib/db/adminFormData";
import { readFormDataStatus } from "@/lib/db/formDataStatus";
import { constantTimeStringEqual } from "@/lib/draft-token";
import { hashQrToken, verifyQrToken } from "@/lib/qr/qr-token";
import type { AttendeeDoc, WithId } from "@/types/collection";

export type ScanResolution =
  | { status: "OK"; attendee: WithId<AttendeeDoc> }
  | { status: "WRONG_EVENT" }
  | { status: "INVALID" }
  | { status: "NOT_ACCEPTED" }
  | { status: "CANCELLED" };

export async function resolveScanToken(input: {
  eventId: string;
  organizationId: string;
  qrToken: string;
}): Promise<ScanResolution> {
  const verified = verifyQrToken({ token: input.qrToken });
  if (!verified.valid) return { status: "INVALID" };

  // The signature is genuine but the pass belongs to another event — a
  // DISTINCT state from INVALID, and it must not leak anything about the
  // other event (T5 AC-7).
  if (verified.eventId !== input.eventId) return { status: "WRONG_EVENT" };

  const attendee = await getAdminAttendeeBySubmissionId({
    submissionId: verified.formDataId,
    eventId: input.eventId,
    organizationId: input.organizationId,
  });

  if (!attendee) {
    // Valid pass, no attendee yet: a scan BEFORE the submission was accepted
    // resolves to NOT_ACCEPTED ("direct to the help desk"), not INVALID
    // (spec T1 "one QR end-to-end" + T5 AC-7).
    const formData = await getAdminFormDataForEvent({
      responseId: verified.formDataId,
      eventId: input.eventId,
      organizationId: input.organizationId,
    });
    if (formData && readFormDataStatus(formData) !== "accepted") {
      return { status: "NOT_ACCEPTED" };
    }
    return { status: "INVALID" };
  }

  // Revocation seam: the stored hash is the source of truth — a re-minted
  // pass under a rotated field invalidates this token even though its
  // signature still verifies.
  if (!constantTimeStringEqual(hashQrToken(input.qrToken), attendee.qrTokenHash)) {
    return { status: "INVALID" };
  }

  if (attendee.status === "cancelled") return { status: "CANCELLED" };

  return { status: "OK", attendee };
}

// Scanner display name for a recorded check-in identity: team members carry
// their denormalized name; the dashboard path records the admin's user id
// (lowercased email) — shown as-is, it is staff-facing only.
export function checkedInByName(
  checkedInBy: AttendeeDoc["checkedInBy"],
): string | null {
  if (!checkedInBy) return null;
  return checkedInBy.kind === "team-member"
    ? checkedInBy.name
    : checkedInBy.userId;
}

// The between-resolve-and-confirm attendee card (design §4): name, reg-type
// pill, ticket, check-in status — nothing else crosses to the door surface.
export function serializeScanAttendeeCard(
  attendee: WithId<AttendeeDoc>,
): ScanAttendeeCard {
  const name = [attendee.firstName, attendee.lastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");

  return {
    name: name || attendee.email || "Unnamed attendee",
    registrationTypeLabel: attendee.registrationTypeLabel || "—",
    ticketLabel: attendee.ticketLabel || "—",
    checkInState: attendee.checkInState ?? "not-arrived",
    checkedInAtIso: timestampToIso(attendee.checkedInAt),
    checkedInByName: checkedInByName(attendee.checkedInBy),
  };
}
