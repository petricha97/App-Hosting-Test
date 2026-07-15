// Shared-secret auth for the internal, unattended scheduler entrypoint
// (spec agents/docs/specs/m6-lifecycle-triggers.md §8/§9) — the SAME
// fail-closed-in-production + dev-fallback-warn + constant-time-compare
// posture as QR_TOKEN_SECRET (src/lib/qr/qr-token.ts) and DRAFT_TOKEN_SECRET
// (src/lib/draft-token.ts). This is deliberately NOT a session/cookie check:
// nothing about this route runs on a human's session (§9 — "a new
// authentication pattern for this codebase").
import "server-only";

import { constantTimeStringEqual } from "@/lib/draft-token";

export const EMAIL_TRIGGER_EVALUATOR_SECRET_ENV =
  "EMAIL_TRIGGER_EVALUATOR_SECRET";

// Dev/test-only fallback so local + CI runs work without configuration.
// Production FAILS CLOSED instead: an unset secret makes EVERY request
// reject, never a silent "any caller is trusted" bypass.
const DEV_FALLBACK_SECRET =
  "dev-only-email-trigger-evaluator-secret-do-not-use-in-prod";

let warnedFallback = false;

function resolveSecret(): string | null {
  const fromEnv = process.env[EMAIL_TRIGGER_EVALUATOR_SECRET_ENV];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    // Fail closed: return null (never a hardcoded/guessable value in prod)
    // — the caller below rejects every request rather than throwing, so a
    // misconfigured deploy 500s-as-401 loudly instead of crash-looping.
    return null;
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[email-trigger-evaluator] ${EMAIL_TRIGGER_EVALUATOR_SECRET_ENV} is ` +
        "not set — falling back to the built-in DEV secret. The internal " +
        "trigger-evaluation endpoint is unauthenticated under this secret; " +
        "set the env var (apphosting.yaml secret) before deploying. " +
        "Production rejects every request instead of falling back.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

// Header name the internal route checks — a plain shared-secret bearer
// value, matching spec §8's "shared secret header" description literally
// (no HMAC/signature scheme needed: the caller is trusted infra, not an
// untrusted public client presenting a capability token).
export const EMAIL_TRIGGER_EVALUATOR_HEADER = "x-email-trigger-secret";

export function verifyEvaluatorRequestSecret(
  providedHeaderValue: string | null,
): boolean {
  if (!providedHeaderValue || providedHeaderValue.trim().length === 0) {
    return false;
  }
  const expected = resolveSecret();
  if (expected === null) return false; // production, unset secret: fail closed
  return constantTimeStringEqual(providedHeaderValue, expected);
}
