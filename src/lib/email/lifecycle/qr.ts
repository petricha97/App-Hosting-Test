// QR-SVG minting for periodic-trigger sends whose template uses {qr_code}
// (today, only the `qr-ready` system default). Mirrors
// src/features/emails/server/sample-context.ts's mintAttendeeQrSvg exactly
// (same deterministic-token + server-side SVG render pattern) — duplicated
// narrowly here rather than importing a Full-Stack T2 module cross-feature,
// same "pure helper, small enough to mirror" call as
// default-definitions.ts's firstPeriodDate/resolvePeriodSchedule split.
import "server-only";

import QRCode from "qrcode";

import { mintQrToken } from "@/lib/qr/qr-token";

// Cheap pre-check so the evaluator only pays for QR minting (crypto +
// SVG render) on the sends that actually need it — most periodic kinds
// (abandoned-reminder, payment-reminder, one-week-to-go, and most custom
// definitions) never reference {qr_code}, which matters at the §8 volume
// scale (thousands of candidates per tick).
export function templateUsesQrCode(template: {
  subject: string;
  body: string;
}): boolean {
  return (
    template.subject.includes("{qr_code}") ||
    template.body.includes("{qr_code}")
  );
}

export async function mintAttendeeQrSvg(input: {
  eventId: string;
  submissionId: string;
}): Promise<string> {
  const token = mintQrToken({
    eventId: input.eventId,
    formDataId: input.submissionId,
  });
  return QRCode.toString(token, { type: "svg", margin: 0 });
}
