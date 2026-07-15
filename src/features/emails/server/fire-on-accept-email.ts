// Real-time `on-accept` trigger (confirmation-paid / confirmation-payment-
// due) — spec: agents/docs/specs/m6-lifecycle-triggers.md §2.
//
// Called by onSubmissionAccepted (src/features/responses/
// on-submission-accepted.ts) AFTER the Attendee doc exists — the SAME
// at-most-once envelope that hook's attendee creation already has: accept is
// terminal in the forward-only status machine, and a healing re-invoke of
// the whole hook (M5-T1 S-1 path) replays onto the exact same attendeeId,
// so the dedupeKey below makes a replay of THIS function safe too, with zero
// extra bookkeeping.
//
// Kind selection (Shared-decisions discriminator, spec §2): paid/comped ->
// confirmation-paid; outstanding -> confirmation-payment-due; missing or
// unresolvable order -> confirmation-paid (documented fallback — fewer false
// "payment due" nudges than the alternative). The `enabled` check applies
// ONLY to the selected kind — no fallback to the sibling kind when it is
// off (spec §2: "not the wrong one").
//
// dedupeKey = attendeeId.
import "server-only";

import QRCode from "qrcode";

import { deriveBodyHtmlTemplate } from "@/features/emails/server/render";
import { resolveEffectiveEmailDefinition } from "@/features/emails/server/resolve-definition";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminOrderForEvent } from "@/lib/db/adminOrder";
import { buildEmailMergeContext } from "@/lib/email/merge-context";
import { sendEventEmail } from "@/lib/email/send-service";
import { mintQrToken } from "@/lib/qr/qr-token";
import type { AttendeeDoc, WithId } from "@/types/collection";

export const CONFIRMATION_PAID_KIND = "confirmation-paid";
export const CONFIRMATION_PAYMENT_DUE_KIND = "confirmation-payment-due";

export interface FireOnAcceptConfirmationEmailInput {
  organizationId: string;
  eventId: string;
  // The FormData doc id the attendee was born from — needed to re-derive the
  // deterministic confirmation QR token (same inputs the M5 scanner and the
  // finalize response both use).
  submissionId: string;
  attendee: WithId<AttendeeDoc>;
}

export async function fireOnAcceptConfirmationEmail(
  input: FireOnAcceptConfirmationEmailInput,
): Promise<void> {
  try {
    const order = input.attendee.orderId
      ? await getAdminOrderForEvent({
          orderId: input.attendee.orderId,
          eventId: input.eventId,
          organizationId: input.organizationId,
        })
      : null;

    const kind =
      order?.paymentStatus === "outstanding"
        ? CONFIRMATION_PAYMENT_DUE_KIND
        : CONFIRMATION_PAID_KIND;

    const definition = await resolveEffectiveEmailDefinition({
      kind,
      eventId: input.eventId,
      organizationId: input.organizationId,
    });
    if (!definition || !definition.enabled) return;

    const event = await getAdminEventForOrganization(
      input.eventId,
      input.organizationId,
    );
    if (!event) return; // defense-in-depth: event vanished mid-accept

    const qrToken = mintQrToken({
      eventId: input.eventId,
      formDataId: input.submissionId,
    });
    const qrCodeSvg = await QRCode.toString(qrToken, {
      type: "svg",
      margin: 0,
    });

    const context = buildEmailMergeContext({
      event,
      attendee: input.attendee,
      order,
      qrCodeSvg,
    });

    const recipientName = [input.attendee.firstName, input.attendee.lastName]
      .filter((part) => part.trim().length > 0)
      .join(" ")
      .trim();

    const result = await sendEventEmail({
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: event.name,
      kind,
      dedupeKey: input.attendee.id,
      definitionId: definition.definitionId,
      recipient: { name: recipientName, email: input.attendee.email },
      attendeeId: input.attendee.id,
      submissionId: input.submissionId,
      template: {
        subject: definition.subject,
        bodyHtml: deriveBodyHtmlTemplate(definition.body),
        bodyText: definition.body,
      },
      context,
    });

    if (!result.ok) {
      console.error(
        `[emails] ${kind} send failed for attendee ${input.attendee.id}: ` +
          (result.outcome === "rejected" ? result.message : result.reason),
      );
    }
  } catch (error) {
    // Failure isolation (spec §2): by the time this runs, the accept commit
    // and attendeeCreated:true have already landed — an email problem here
    // (typed rejection, transport throw, unexpected infra error) must NEVER
    // look like an accept-hook failure. Log loudly, never rethrow.
    console.error(
      `[emails] on-accept confirmation email crashed for attendee ${input.attendee.id}`,
      error,
    );
  }
}
