// Deliberately mirrors src/lib/qr/qr-token.ts's pure token math (HMAC-SHA256
// over "{eventId}.{formDataId}", base64url signature, "." separator) so the
// harness can mint the EXACT real token the app itself would re-mint for a
// given (eventId, formDataId) — this is legitimate, not a bypass: the token
// is deterministic BY SPEC (m5-attendees-checkin.md, M5-T1 "One QR
// end-to-end" decision) specifically so it can be re-derived at
// finalize/accept/email-send with zero coordination. We do not import the
// real src/lib/qr/qr-token.ts module directly because Playwright's ts
// execution does not resolve the app's "@/" path alias — this is a
// deliberate, minimal re-implementation for the test harness only, verified
// byte-for-byte against a live Attendee.qrTokenHash before use (see the
// M5/M6 QA report).
import { createHash, createHmac } from "node:crypto";

// Same dev fallback the app itself uses when QR_TOKEN_SECRET is unset
// locally (src/lib/qr/qr-token.ts DEV_FALLBACK_SECRET) — this repo's
// .env.local does not set QR_TOKEN_SECRET, so both the running dev server
// and this harness fall back to the identical constant.
const DEV_FALLBACK_SECRET = "dev-only-qr-token-secret-do-not-use-in-prod";

function resolveSecret(): string {
  const fromEnv = process.env.QR_TOKEN_SECRET;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return DEV_FALLBACK_SECRET;
}

function signQr(eventId: string, formDataId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${eventId}.${formDataId}`, "utf8")
    .digest("base64url");
}

export function mintQrTokenForHarness(
  eventId: string,
  formDataId: string,
): string {
  const signature = signQr(eventId, formDataId, resolveSecret());
  return `${eventId}.${formDataId}.${signature}`;
}

export function hashQrTokenForHarness(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
