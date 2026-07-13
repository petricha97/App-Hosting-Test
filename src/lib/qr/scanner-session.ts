// Scanner session tokens + scanner access codes — PURE module (node:crypto
// only, no Firebase). Spec: agents/docs/specs/m5-attendees-checkin.md
// (M5-T4 team members, M5-T5 scan flow).
//
// Two credentials live here:
//
// 1. SCANNER ACCESS CODE — the long-lived door credential a team member types
//    once per shift. Server-minted random (140 bits), displayed EXACTLY ONCE
//    in the add-team-member dialog; only its SHA-256 hash is ever persisted
//    (CheckinTeamMemberDoc.accessCodeHash — draft-token hashing pattern).
//
// 2. SCANNER SESSION TOKEN — the short-lived signed token the access-code
//    exchange returns (POST /api/events/[eventId]/checkin/session). Format:
//    "{teamMemberId}.{expiresAtMs}.{base64url(HMAC-SHA256(secret,
//      teamMemberId + "." + eventId + "." + expiresAtMs))}"
//    TTL 12h, held in sessionStorage, sent in request bodies/headers — NEVER
//    in URLs. The HMAC binds teamMemberId + eventId + expiry, so a token can
//    never be replayed against another event or with a stretched lifetime.
//    Verification is stateless; REVOCATION is not: resolve/confirm routes
//    must re-load the team member and reject when isActive is false
//    (T5 AC-9) — verifying the signature alone is never enough.
//
// The dashboard scanner does NOT use these: it authenticates with the admin
// session (write:events) and records checkedInBy.kind = "admin".

import { createHash, createHmac, randomBytes } from "node:crypto";

import { constantTimeStringEqual } from "@/lib/draft-token";

// Server secret env var (apphosting.yaml secret scannerSessionSecret /
// .env.local). SEPARATE from QR_TOKEN_SECRET by design: scanner sessions are
// cheap to rotate (staff re-enter their access code), while rotating the QR
// secret voids every printed badge — coupling them would make the cheap
// rotation impossible.
export const SCANNER_SESSION_SECRET_ENV = "SCANNER_SESSION_SECRET";

// Dev/test-only fallback; production FAILS CLOSED (same rule as
// draft-token / qr-token).
const DEV_FALLBACK_SECRET =
  "dev-only-scanner-session-secret-do-not-use-in-prod";

let warnedFallback = false;

function resolveSecret(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;

  const fromEnv = process.env[SCANNER_SESSION_SECRET_ENV];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[scanner-session] ${SCANNER_SESSION_SECRET_ENV} is not set. Scanner ` +
        "session tokens cannot be signed without it in production — " +
        "configure the apphosting.yaml secret (fail-closed; the dev " +
        "fallback is development/test only).",
    );
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[scanner-session] ${SCANNER_SESSION_SECRET_ENV} is not set — falling ` +
        "back to the built-in DEV secret. Scanner sessions are forgeable " +
        "under this secret; set the env var (apphosting.yaml secret) before " +
        "deploying. Production throws instead of falling back.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

// ============================================================================
// Scanner session token (spec T5: TTL 12h)
// ============================================================================

export const SCANNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function signSession(
  teamMemberId: string,
  eventId: string,
  expiresAtMs: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${teamMemberId}.${eventId}.${expiresAtMs}`, "utf8")
    .digest("base64url");
}

export function mintScannerSessionToken(input: {
  teamMemberId: string;
  eventId: string;
  // Test seams; production callers omit them.
  nowMs?: number;
  ttlMs?: number;
  secret?: string;
}): string {
  if (
    input.teamMemberId.length === 0 ||
    input.eventId.length === 0 ||
    input.teamMemberId.includes(".") ||
    input.eventId.includes(".")
  ) {
    throw new Error(
      "[scanner-session] teamMemberId/eventId must be non-empty and must " +
        "not contain '.'",
    );
  }

  const expiresAtMs = (input.nowMs ?? Date.now()) +
    (input.ttlMs ?? SCANNER_SESSION_TTL_MS);
  const signature = signSession(
    input.teamMemberId,
    input.eventId,
    expiresAtMs,
    resolveSecret(input.secret),
  );
  return `${input.teamMemberId}.${expiresAtMs}.${signature}`;
}

export type VerifyScannerSessionTokenResult =
  | { valid: true; teamMemberId: string; expiresAtMs: number }
  | { valid: false };

// Constant-time verification, bound to the CALLER's eventId (a token minted
// for one event never opens another's scanner). Expired, forged, tampered
// and malformed tokens are all { valid: false } — routes 401 uniformly and
// send staff back to the access-code gate (no oracle). Callers must still
// check the team member's isActive flag (revocation, T5 AC-9).
export function verifyScannerSessionToken(input: {
  token: string;
  eventId: string;
  nowMs?: number;
  secret?: string;
}): VerifyScannerSessionTokenResult {
  const parts = input.token.split(".");
  if (parts.length !== 3) return { valid: false };

  const [teamMemberId, expiresAtRaw, signature] = parts;
  if (
    teamMemberId.length === 0 ||
    signature.length === 0 ||
    !/^\d{1,15}$/.test(expiresAtRaw)
  ) {
    return { valid: false };
  }

  const expiresAtMs = Number(expiresAtRaw);
  const expected = signSession(
    teamMemberId,
    input.eventId,
    expiresAtMs,
    resolveSecret(input.secret),
  );

  if (!constantTimeStringEqual(signature, expected)) return { valid: false };
  if ((input.nowMs ?? Date.now()) >= expiresAtMs) return { valid: false };

  return { valid: true, teamMemberId, expiresAtMs };
}

// ============================================================================
// Scanner access codes (spec T4: >= 128 bits entropy, shown once, hash-only
// storage)
// ============================================================================

// Crockford-style alphabet: 32 symbols (exactly 5 bits each), no ambiguous
// 0/O/1/I/L confusion beyond the digits themselves being canonical. 28 chars
// * 5 bits = 140 bits of entropy (AC-5 requires >= 128).
export const SCANNER_ACCESS_CODE_ALPHABET =
  "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const ACCESS_CODE_CHARS = 28;
const ACCESS_CODE_GROUP = 4;

// Mints a random access code, formatted in dashed groups of 4 for the
// one-time display panel (e.g. "GC7Q-4KXN-P2MB-9RTD-XXXX-XXXX-XXXX").
// 256 % 32 === 0, so `byte & 31` is bias-free.
export function generateScannerAccessCode(): string {
  const bytes = randomBytes(ACCESS_CODE_CHARS);
  let raw = "";
  for (let i = 0; i < ACCESS_CODE_CHARS; i += 1) {
    raw += SCANNER_ACCESS_CODE_ALPHABET[bytes[i] & 31];
  }

  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += ACCESS_CODE_GROUP) {
    groups.push(raw.slice(i, i + ACCESS_CODE_GROUP));
  }
  return groups.join("-");
}

// Canonical form for hashing/lookup: uppercase, alphanumerics only — staff
// can type the code with or without dashes/spaces, in any case.
export function normalizeScannerAccessCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// SHA-256 hex of the NORMALIZED code — the only form that is ever persisted
// (CheckinTeamMemberDoc.accessCodeHash). The raw code exists exactly once,
// in the add-team-member response body.
export function hashScannerAccessCode(rawCode: string): string {
  return createHash("sha256")
    .update(normalizeScannerAccessCode(rawCode), "utf8")
    .digest("hex");
}
