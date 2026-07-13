// Signed draft tokens for the public registration flow — PURE module
// (node:crypto only, no Firebase). Spec: agents/docs/specs/m3-registration-paths.md
// (M3-T3 "Signed draft token" decision).
//
// Token format:  "{draftId}.{base64url(HMAC-SHA256(secret, draftId + "." + eventId))}"
//
// The token is the SOLE capability for reading/updating/finalizing a draft —
// there is no session on the public flow. Binding the HMAC to the eventId
// means a token minted for one event can never touch a draft of another.
// Server-side handling rules (enforced by callers):
// - only the SHA-256 hash of the token is ever persisted
//   (RegistrationDraftDoc.draftTokenHash) — a Firestore leak never leaks
//   usable capabilities;
// - verification is constant-time (below);
// - invalid/forged/mismatched tokens surface as 404, indistinguishable from
//   a missing draft;
// - the raw token lives only in the registrant's sessionStorage and request
//   bodies/headers — NEVER in URLs (referrer leakage).

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Server secret env var. On App Hosting configure it as a secret in
// apphosting.yaml; locally put it in .env.local.
export const DRAFT_TOKEN_SECRET_ENV = "DRAFT_TOKEN_SECRET";

// Dev/test-only fallback so local flows work without configuration. Using it
// in production would make tokens forgeable (the secret is source-committed),
// so production FAILS CLOSED instead: a missing secret throws on first use
// (review S5 / security M-1) — a misconfigured deploy breaks loudly rather
// than silently running under a publicly known signing key.
const DEV_FALLBACK_SECRET = "dev-only-draft-token-secret-do-not-use-in-prod";

let warnedFallback = false;

function resolveSecret(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;

  const fromEnv = process.env[DRAFT_TOKEN_SECRET_ENV];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[draft-token] ${DRAFT_TOKEN_SECRET_ENV} is not set. Draft tokens ` +
        "cannot be signed without it in production — configure the " +
        "apphosting.yaml secret (fail-closed; the dev fallback is " +
        "development/test only).",
    );
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[draft-token] ${DRAFT_TOKEN_SECRET_ENV} is not set — falling back to the ` +
        "built-in DEV secret. Draft tokens are forgeable under this secret; " +
        "set the env var (apphosting.yaml secret) before deploying. " +
        "Production throws instead of falling back.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

// Draft doc IDs are minted server-side (not Firestore auto IDs) because the
// signed token must exist before the doc is written, and the tokenHash is
// part of the create payload. 128 bits of randomness, hex — never contains
// the "." token separator.
export function generateDraftId(): string {
  return randomBytes(16).toString("hex");
}

function signDraft(draftId: string, eventId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${draftId}.${eventId}`, "utf8")
    .digest("base64url");
}

export function mintDraftToken(input: {
  draftId: string;
  eventId: string;
  // Test/DI hook; production callers omit it and use the env secret.
  secret?: string;
}): string {
  const signature = signDraft(
    input.draftId,
    input.eventId,
    resolveSecret(input.secret),
  );
  return `${input.draftId}.${signature}`;
}

export type VerifyDraftTokenResult =
  | { valid: true; draftId: string }
  | { valid: false };

// Constant-time verification. Callers must treat { valid: false } exactly
// like "draft not found" (404) — no oracle distinguishing forged signatures
// from missing drafts.
export function verifyDraftToken(input: {
  token: string;
  eventId: string;
  secret?: string;
}): VerifyDraftTokenResult {
  const parts = input.token.split(".");
  if (parts.length !== 2) return { valid: false };

  const [draftId, signature] = parts;
  if (draftId.length === 0 || signature.length === 0) return { valid: false };

  const expected = signDraft(
    draftId,
    input.eventId,
    resolveSecret(input.secret),
  );

  if (!constantTimeStringEqual(signature, expected)) return { valid: false };
  return { valid: true, draftId };
}

// SHA-256 hex of the raw token — the only form that is ever persisted
// (RegistrationDraftDoc.draftTokenHash).
export function hashDraftToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Constant-time string comparison that does not leak length either: both
// inputs are folded through SHA-256 (fixed-width digests) before
// timingSafeEqual. Used for the signature check above and for comparing
// stored token hashes in the DAL.
export function constantTimeStringEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
