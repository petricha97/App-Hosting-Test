// @vitest-environment node
/**
 * M3-T3 — signed draft token module (src/lib/draft-token.ts).
 * Spec: agents/docs/specs/m3-registration-paths.md (T3 "Signed draft token",
 * AC-3; T5 AC-5).
 *
 * Locks:
 *  - format "{draftId}.{base64url(HMAC-SHA256(secret, draftId + "." + eventId))}"
 *  - mint/verify round-trip; eventId binding (cross-event tokens fail)
 *  - forged/tampered/foreign-secret/malformed tokens all verify false
 *  - only the SHA-256 hash is storage-shaped (hex, never equal to the token)
 *  - env secret is used when set; missing env falls back to the dev secret
 *    with a ONE-TIME warning in dev/test — but THROWS in production
 *    (fail-closed, review S5 / security M-1)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_TOKEN_SECRET_ENV,
  constantTimeStringEqual,
  generateDraftId,
  hashDraftToken,
  mintDraftToken,
  verifyDraftToken,
} from "@/lib/draft-token";

const SECRET = "unit-test-secret";
const EVENT_ID = "evt-1";
const ORIGINAL_ENV_SECRET = process.env[DRAFT_TOKEN_SECRET_ENV];

afterEach(() => {
  if (ORIGINAL_ENV_SECRET === undefined) {
    delete process.env[DRAFT_TOKEN_SECRET_ENV];
  } else {
    process.env[DRAFT_TOKEN_SECRET_ENV] = ORIGINAL_ENV_SECRET;
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("generateDraftId", () => {
  it("mints 32-char hex ids that never contain the token separator", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = generateDraftId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(id).not.toContain(".");
      seen.add(id);
    }
    expect(seen.size).toBe(100);
  });
});

describe("mintDraftToken / verifyDraftToken", () => {
  it("round-trips: a minted token verifies and yields its draftId", () => {
    const draftId = generateDraftId();
    const token = mintDraftToken({ draftId, eventId: EVENT_ID, secret: SECRET });

    expect(verifyDraftToken({ token, eventId: EVENT_ID, secret: SECRET })).toEqual({
      valid: true,
      draftId,
    });
  });

  it('uses the spec format "{draftId}.{base64url signature}"', () => {
    const draftId = generateDraftId();
    const token = mintDraftToken({ draftId, eventId: EVENT_ID, secret: SECRET });

    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(draftId);
    // base64url alphabet only (no +, /, =).
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    // Deterministic for the same inputs.
    expect(mintDraftToken({ draftId, eventId: EVENT_ID, secret: SECRET })).toBe(
      token,
    );
  });

  it("binds the signature to the eventId — a token never works on another event", () => {
    const token = mintDraftToken({
      draftId: generateDraftId(),
      eventId: EVENT_ID,
      secret: SECRET,
    });

    expect(verifyDraftToken({ token, eventId: "evt-2", secret: SECRET })).toEqual({
      valid: false,
    });
  });

  it("rejects a tampered signature (forged token with a real draftId)", () => {
    const draftId = generateDraftId();
    const token = mintDraftToken({ draftId, eventId: EVENT_ID, secret: SECRET });
    const [, signature] = token.split(".");
    const flipped =
      signature[0] === "A" ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;

    expect(
      verifyDraftToken({
        token: `${draftId}.${flipped}`,
        eventId: EVENT_ID,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it("rejects a token signed under a different secret", () => {
    const token = mintDraftToken({
      draftId: generateDraftId(),
      eventId: EVENT_ID,
      secret: "some-other-secret",
    });

    expect(verifyDraftToken({ token, eventId: EVENT_ID, secret: SECRET })).toEqual({
      valid: false,
    });
  });

  it.each(["", "no-separator", "a.b.c", ".signature-only", "draft-id-only."])(
    "rejects the malformed token %j",
    (token) => {
      expect(verifyDraftToken({ token, eventId: EVENT_ID, secret: SECRET })).toEqual(
        { valid: false },
      );
    },
  );

  it("reads the secret from the env var when no explicit secret is passed", () => {
    process.env[DRAFT_TOKEN_SECRET_ENV] = "env-secret";
    const draftId = generateDraftId();

    const viaEnv = mintDraftToken({ draftId, eventId: EVENT_ID });
    const viaExplicit = mintDraftToken({
      draftId,
      eventId: EVENT_ID,
      secret: "env-secret",
    });

    expect(viaEnv).toBe(viaExplicit);
    expect(verifyDraftToken({ token: viaEnv, eventId: EVENT_ID })).toEqual({
      valid: true,
      draftId,
    });
  });

  it("falls back to the dev secret with a ONE-TIME warning when the env var is missing", async () => {
    vi.resetModules();
    delete process.env[DRAFT_TOKEN_SECRET_ENV];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Fresh module instance so the once-per-process warning latch is reset.
    const fresh = await import("@/lib/draft-token");

    const token = fresh.mintDraftToken({ draftId: "d1", eventId: EVENT_ID });
    fresh.mintDraftToken({ draftId: "d2", eventId: EVENT_ID });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(DRAFT_TOKEN_SECRET_ENV);
    // Verification works under the same fallback secret.
    expect(fresh.verifyDraftToken({ token, eventId: EVENT_ID })).toEqual({
      valid: true,
      draftId: "d1",
    });
  });

  it("THROWS in production when the env var is missing — never the dev fallback (S5/M-1)", async () => {
    vi.resetModules();
    delete process.env[DRAFT_TOKEN_SECRET_ENV];
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fresh = await import("@/lib/draft-token");

    expect(() =>
      fresh.mintDraftToken({ draftId: "d1", eventId: EVENT_ID }),
    ).toThrow(DRAFT_TOKEN_SECRET_ENV);
    expect(() =>
      fresh.verifyDraftToken({ token: "d1.sig", eventId: EVENT_ID }),
    ).toThrow(DRAFT_TOKEN_SECRET_ENV);
    // Fail-closed means no warn-and-continue path ran.
    expect(warn).not.toHaveBeenCalled();
  });

  it("still uses the configured env secret in production", async () => {
    vi.resetModules();
    process.env[DRAFT_TOKEN_SECRET_ENV] = "prod-secret";
    vi.stubEnv("NODE_ENV", "production");

    const fresh = await import("@/lib/draft-token");
    const token = fresh.mintDraftToken({ draftId: "d1", eventId: EVENT_ID });
    expect(fresh.verifyDraftToken({ token, eventId: EVENT_ID })).toEqual({
      valid: true,
      draftId: "d1",
    });
  });
});

describe("hashDraftToken (the only persisted form)", () => {
  it("produces a deterministic SHA-256 hex digest distinct from the token", () => {
    const token = mintDraftToken({
      draftId: generateDraftId(),
      eventId: EVENT_ID,
      secret: SECRET,
    });

    const hash = hashDraftToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashDraftToken(token));
    expect(hash).not.toBe(token);
    // The hash is one-way storage: two tokens never share a hash.
    const other = mintDraftToken({
      draftId: generateDraftId(),
      eventId: EVENT_ID,
      secret: SECRET,
    });
    expect(hashDraftToken(other)).not.toBe(hash);
  });
});

describe("constantTimeStringEqual", () => {
  it("compares strings correctly regardless of length", () => {
    expect(constantTimeStringEqual("abc", "abc")).toBe(true);
    expect(constantTimeStringEqual("abc", "abd")).toBe(false);
    expect(constantTimeStringEqual("abc", "abcd")).toBe(false);
    expect(constantTimeStringEqual("", "")).toBe(true);
  });
});
