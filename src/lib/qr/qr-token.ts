// Deterministic attendee QR tokens — PURE module (node:crypto only, no
// Firebase). Spec: agents/docs/specs/m5-attendees-checkin.md (M5-T1 "One QR
// end-to-end" decision). Mirrors src/lib/draft-token.ts exactly (same
// fail-closed-in-prod + dev-fallback-warn pattern, constant-time verify,
// hash-only persistence) under its own secret.
//
// Token format:
//   "{eventId}.{formDataId}.{base64url(HMAC-SHA256(secret, eventId + "." + formDataId))}"
//
// DETERMINISTIC, not stored-random: the same (eventId, formDataId, secret)
// always yields the same token, so it is mintable at *finalize* (before the
// Attendee exists) and re-mintable at *accept* / email-send with zero
// coordination — finalize/accept replays are idempotent by construction.
// The payload carries NO PII: eventId + an opaque submission hash id +
// signature only.
//
// Server-side handling rules (enforced by callers):
// - only the SHA-256 hash of the token is ever persisted
//   (FormDataDoc.qrTokenHash / AttendeeDoc.qrTokenHash) — the stored hash is
//   the revocation seam (rotate = re-mint under a new field, out of M5 scope);
// - verification is constant-time (constantTimeStringEqual);
// - the raw token travels in response bodies (confirmation qrSvg, badge
//   rendering) and scanner request bodies — NEVER in URLs;
// - a forged/garbage token surfaces as the scanner's INVALID state, never an
//   oracle distinguishing "bad signature" from "no such attendee".

import { createHash, createHmac } from "node:crypto";

import { constantTimeStringEqual } from "@/lib/draft-token";

// Server secret env var. On App Hosting configure it as a secret in
// apphosting.yaml (qrTokenSecret); locally put it in .env.local. SEPARATE
// from DRAFT_TOKEN_SECRET and SCANNER_SESSION_SECRET: rotating this one
// invalidates every issued badge/confirmation QR (expensive, deliberate),
// so it must never be coupled to the cheap-to-rotate session secrets.
export const QR_TOKEN_SECRET_ENV = "QR_TOKEN_SECRET";

// Dev/test-only fallback so local flows work without configuration.
// Production FAILS CLOSED instead: a missing secret throws on first use —
// a misconfigured deploy breaks loudly rather than silently signing QR
// passes under a publicly known key (same rule as draft-token S5/M-1).
const DEV_FALLBACK_SECRET = "dev-only-qr-token-secret-do-not-use-in-prod";

let warnedFallback = false;

function resolveSecret(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;

  const fromEnv = process.env[QR_TOKEN_SECRET_ENV];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[qr-token] ${QR_TOKEN_SECRET_ENV} is not set. Attendee QR tokens ` +
        "cannot be signed without it in production — configure the " +
        "apphosting.yaml secret (fail-closed; the dev fallback is " +
        "development/test only).",
    );
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[qr-token] ${QR_TOKEN_SECRET_ENV} is not set — falling back to the ` +
        "built-in DEV secret. QR passes are forgeable under this secret; " +
        "set the env var (apphosting.yaml secret) before deploying. " +
        "Production throws instead of falling back.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

function signQr(eventId: string, formDataId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${eventId}.${formDataId}`, "utf8")
    .digest("base64url");
}

export function mintQrToken(input: {
  eventId: string;
  // The FormData doc id (sha256 hex via formDataIdFromDraftId, or a legacy
  // Firestore auto id) — opaque, carries no PII.
  formDataId: string;
  // Test/DI hook; production callers omit it and use the env secret.
  secret?: string;
}): string {
  // "." is the token separator — both ids come from Firestore auto ids or
  // sha256 hex, which never contain it. Fail loudly instead of minting an
  // unparseable token if that ever changes.
  if (
    input.eventId.length === 0 ||
    input.formDataId.length === 0 ||
    input.eventId.includes(".") ||
    input.formDataId.includes(".")
  ) {
    throw new Error(
      "[qr-token] eventId/formDataId must be non-empty and must not contain '.'",
    );
  }

  const signature = signQr(
    input.eventId,
    input.formDataId,
    resolveSecret(input.secret),
  );
  return `${input.eventId}.${input.formDataId}.${signature}`;
}

export type VerifyQrTokenResult =
  | { valid: true; eventId: string; formDataId: string }
  | { valid: false };

// Constant-time verification against the token's EMBEDDED eventId — the
// scanner's resolve flow verifies the signature first, THEN compares the
// embedded eventId to its own event (mismatch -> WRONG_EVENT, a distinct
// state from INVALID, spec T5). Callers must still constant-time compare
// hashQrToken(token) against the stored AttendeeDoc.qrTokenHash (revocation
// seam) before trusting the resolution.
export function verifyQrToken(input: {
  token: string;
  secret?: string;
}): VerifyQrTokenResult {
  const parts = input.token.split(".");
  if (parts.length !== 3) return { valid: false };

  const [eventId, formDataId, signature] = parts;
  if (
    eventId.length === 0 ||
    formDataId.length === 0 ||
    signature.length === 0
  ) {
    return { valid: false };
  }

  const expected = signQr(eventId, formDataId, resolveSecret(input.secret));

  if (!constantTimeStringEqual(signature, expected)) return { valid: false };
  return { valid: true, eventId, formDataId };
}

// SHA-256 hex of the raw token — the only form that is ever persisted
// (FormDataDoc.qrTokenHash at finalize, AttendeeDoc.qrTokenHash at accept).
export function hashQrToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
