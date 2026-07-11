// @vitest-environment node
/**
 * M5-T1 — deterministic attendee QR token module (src/lib/qr/qr-token.ts).
 * Spec: agents/docs/specs/m5-attendees-checkin.md (T1 "One QR end-to-end",
 * AC-4/AC-5/AC-6).
 *
 * Locks:
 *  - format "{eventId}.{formDataId}.{base64url(HMAC-SHA256(secret,
 *    eventId + "." + formDataId))}" — DETERMINISTIC for the same inputs
 *  - mint/verify round-trip; verify returns the EMBEDDED ids (the caller
 *    compares eventId for WRONG_EVENT, spec T5)
 *  - forged/tampered/foreign-secret/malformed tokens all verify false
 *  - payload carries NO PII: exactly eventId + formDataId + signature (AC-5)
 *  - only the SHA-256 hash is storage-shaped (hex, never equal to the token)
 *  - env secret used when set; missing env falls back to the dev secret with
 *    a ONE-TIME warning in dev/test — but THROWS in production (fail-closed,
 *    AC-4, mirroring draft-token S5/M-1)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QR_TOKEN_SECRET_ENV,
  hashQrToken,
  mintQrToken,
  verifyQrToken,
} from "@/lib/qr/qr-token";

const SECRET = "unit-test-qr-secret";
const EVENT_ID = "evt-1";
const FORM_DATA_ID = "a".repeat(64); // sha256-hex-shaped, like real finalize ids
const ORIGINAL_ENV_SECRET = process.env[QR_TOKEN_SECRET_ENV];

afterEach(() => {
  if (ORIGINAL_ENV_SECRET === undefined) {
    delete process.env[QR_TOKEN_SECRET_ENV];
  } else {
    process.env[QR_TOKEN_SECRET_ENV] = ORIGINAL_ENV_SECRET;
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mintQrToken / verifyQrToken", () => {
  it("round-trips: a minted token verifies and yields its embedded ids", () => {
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: SECRET,
    });

    expect(verifyQrToken({ token, secret: SECRET })).toEqual({
      valid: true,
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
    });
  });

  it('uses the spec format "{eventId}.{formDataId}.{base64url signature}" and is DETERMINISTIC', () => {
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: SECRET,
    });

    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(EVENT_ID);
    expect(parts[1]).toBe(FORM_DATA_ID);
    // base64url alphabet only (no +, /, =).
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
    // Deterministic: re-mint at finalize, accept, or email-send — identical.
    expect(
      mintQrToken({ eventId: EVENT_ID, formDataId: FORM_DATA_ID, secret: SECRET }),
    ).toBe(token);
  });

  it("carries NO PII — the payload is exactly the two ids + signature (AC-5)", () => {
    // Even when the submission is full of personal data, none of it can be
    // in the token: mint only ever sees the two ids.
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: SECRET,
    });

    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain("@");
    expect(token.startsWith(`${EVENT_ID}.${FORM_DATA_ID}.`)).toBe(true);
    // Nothing beyond ids + signature: strip them, only the signature remains.
    const signature = token.slice(`${EVENT_ID}.${FORM_DATA_ID}.`.length);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256-bit HMAC, base64url
  });

  it("binds the signature to the eventId — swapping the embedded eventId fails", () => {
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: SECRET,
    });
    const [, formDataId, signature] = token.split(".");

    expect(
      verifyQrToken({
        token: `evt-2.${formDataId}.${signature}`,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it("binds the signature to the formDataId — swapping it fails", () => {
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: SECRET,
    });
    const [eventId, , signature] = token.split(".");

    expect(
      verifyQrToken({
        token: `${eventId}.${"b".repeat(64)}.${signature}`,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it("rejects a tampered signature", () => {
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: SECRET,
    });
    const parts = token.split(".");
    const flipped =
      parts[2][0] === "A" ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;

    expect(
      verifyQrToken({
        token: `${parts[0]}.${parts[1]}.${flipped}`,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it("rejects a token signed under a different secret", () => {
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: "some-other-secret",
    });

    expect(verifyQrToken({ token, secret: SECRET })).toEqual({ valid: false });
  });

  it.each([
    "",
    "no-separator",
    "a.b",
    "a.b.c.d",
    "..sig-only",
    "evt..sig",
    "evt.form.",
  ])("rejects the malformed token %j", (token) => {
    expect(verifyQrToken({ token, secret: SECRET })).toEqual({ valid: false });
  });

  it("refuses to mint with empty or dot-containing ids (unparseable tokens)", () => {
    expect(() =>
      mintQrToken({ eventId: "", formDataId: FORM_DATA_ID, secret: SECRET }),
    ).toThrow();
    expect(() =>
      mintQrToken({ eventId: "evt.1", formDataId: FORM_DATA_ID, secret: SECRET }),
    ).toThrow();
    expect(() =>
      mintQrToken({ eventId: EVENT_ID, formDataId: "a.b", secret: SECRET }),
    ).toThrow();
  });

  it("reads the secret from the env var when no explicit secret is passed", () => {
    process.env[QR_TOKEN_SECRET_ENV] = "env-secret";

    const viaEnv = mintQrToken({ eventId: EVENT_ID, formDataId: FORM_DATA_ID });
    const viaExplicit = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: "env-secret",
    });

    expect(viaEnv).toBe(viaExplicit);
    expect(verifyQrToken({ token: viaEnv })).toEqual({
      valid: true,
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
    });
  });

  it("falls back to the dev secret with a ONE-TIME warning when the env var is missing", async () => {
    vi.resetModules();
    delete process.env[QR_TOKEN_SECRET_ENV];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Fresh module instance so the once-per-process warning latch is reset.
    const fresh = await import("@/lib/qr/qr-token");

    const token = fresh.mintQrToken({ eventId: EVENT_ID, formDataId: "f1" });
    fresh.mintQrToken({ eventId: EVENT_ID, formDataId: "f2" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(QR_TOKEN_SECRET_ENV);
    expect(fresh.verifyQrToken({ token })).toEqual({
      valid: true,
      eventId: EVENT_ID,
      formDataId: "f1",
    });
  });

  it("THROWS in production when the env var is missing — never the dev fallback (AC-4)", async () => {
    vi.resetModules();
    delete process.env[QR_TOKEN_SECRET_ENV];
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fresh = await import("@/lib/qr/qr-token");

    expect(() =>
      fresh.mintQrToken({ eventId: EVENT_ID, formDataId: FORM_DATA_ID }),
    ).toThrow(QR_TOKEN_SECRET_ENV);
    expect(() =>
      fresh.verifyQrToken({ token: `${EVENT_ID}.${FORM_DATA_ID}.sig` }),
    ).toThrow(QR_TOKEN_SECRET_ENV);
    // Fail-closed means no warn-and-continue path ran.
    expect(warn).not.toHaveBeenCalled();
  });

  it("still uses the configured env secret in production", async () => {
    vi.resetModules();
    process.env[QR_TOKEN_SECRET_ENV] = "prod-secret";
    vi.stubEnv("NODE_ENV", "production");

    const fresh = await import("@/lib/qr/qr-token");
    const token = fresh.mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
    });
    expect(fresh.verifyQrToken({ token })).toEqual({
      valid: true,
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
    });
  });
});

describe("hashQrToken (the only persisted form)", () => {
  it("produces a deterministic SHA-256 hex digest distinct from the token", () => {
    const token = mintQrToken({
      eventId: EVENT_ID,
      formDataId: FORM_DATA_ID,
      secret: SECRET,
    });

    const hash = hashQrToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashQrToken(token));
    expect(hash).not.toBe(token);
    // Two tokens never share a hash.
    const other = mintQrToken({
      eventId: EVENT_ID,
      formDataId: "b".repeat(64),
      secret: SECRET,
    });
    expect(hashQrToken(other)).not.toBe(hash);
  });
});
