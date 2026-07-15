// Sample merge context for the T2 preview surfaces (editor live preview,
// confirmation card) and the real recipient context for test-send. Spec §3:
// "first attendee's buildEmailMergeContext when one exists, else the
// 'Sample Attendee' placeholder context — M5-T4 badge-preview precedent."
import "server-only";

import QRCode from "qrcode";

import { listAdminAttendeesForEvent } from "@/lib/db/adminAttendee";
import { getAdminOrderForEvent } from "@/lib/db/adminOrder";
import {
  buildEmailMergeContext,
  type BuildEmailMergeContextInput,
} from "@/lib/email/merge-context";
import type { EmailMergeContext } from "@/lib/email/merge-tags";
import { mintQrToken } from "@/lib/qr/qr-token";
import type { AttendeeDoc, EventDoc, WithId } from "@/types/collection";

// M5 badge-preview "Sample Attendee" precedent (badge-preview-card.tsx
// SAMPLE_BADGE) — used verbatim as the zero-attendee merge-context fallback
// so {first_name}/{full_name}/etc render believable sample copy instead of
// going blank (spec §8-6).
const SAMPLE_ATTENDEE: BuildEmailMergeContextInput["attendee"] = {
  firstName: "Sample",
  lastName: "Attendee",
  email: "sample.attendee@example.com",
  company: "Sample Co",
  jobTitle: "Attendee",
  ticketLabel: "General Admission",
  registrationTypeLabel: "Delegate",
};

const SAMPLE_ORDER: BuildEmailMergeContextInput["order"] = {
  amounts: {
    subtotalMinor: 15000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 15000,
  },
  currency: "USD",
  paymentStatus: "paid",
};

export interface SampleEmailContextResult {
  context: EmailMergeContext;
  // true = a real attendee backs this context (real decodable QR, spec §4
  // AC-1); false = the zero-attendee placeholder (never a mintable token).
  isRealAttendee: boolean;
  attendee: WithId<AttendeeDoc> | null;
}

// Real-attendee QR: mints the SAME deterministic token the M5 scanner
// resolves (spec §4 AC-1) and renders it to SVG server-side — never a raw
// token in any response body outside this SVG geometry (M5-T1 AC-6 carry-
// over, L-6 invariant).
async function mintAttendeeQrSvg(input: {
  eventId: string;
  submissionId: string;
}): Promise<string> {
  const token = mintQrToken({
    eventId: input.eventId,
    formDataId: input.submissionId,
  });
  return QRCode.toString(token, { type: "svg", margin: 0 });
}

export async function loadSampleEmailContext(input: {
  eventId: string;
  organizationId: string;
  event: WithId<Pick<EventDoc, "name" | "periods" | "timezone">>;
}): Promise<SampleEmailContextResult> {
  const attendees = await listAdminAttendeesForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
    status: "accepted",
    limit: 1,
  });
  const attendee = attendees[0] ?? null;

  if (!attendee) {
    return {
      context: buildEmailMergeContext({
        event: input.event,
        attendee: SAMPLE_ATTENDEE,
        order: SAMPLE_ORDER,
        qrCodeSvg: null,
      }),
      isRealAttendee: false,
      attendee: null,
    };
  }

  const [qrCodeSvg, order] = await Promise.all([
    mintAttendeeQrSvg({
      eventId: input.eventId,
      submissionId: attendee.submissionId,
    }),
    attendee.orderId
      ? getAdminOrderForEvent({
          orderId: attendee.orderId,
          eventId: input.eventId,
          organizationId: input.organizationId,
        })
      : Promise.resolve(null),
  ]);

  return {
    context: buildEmailMergeContext({
      event: input.event,
      attendee,
      order,
      qrCodeSvg,
    }),
    isRealAttendee: true,
    attendee,
  };
}
