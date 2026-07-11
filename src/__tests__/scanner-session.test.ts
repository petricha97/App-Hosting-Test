// @vitest-environment node
/**
 * M5-T4/T5 — scanner session tokens + access codes
 * (src/lib/qr/scanner-session.ts). Spec: agents/docs/specs/
 * m5-attendees-checkin.md (T4 AC-4/AC-5; T5 AC-1/AC-2).
 *
 * Locks:
 *  - session token format "{teamMemberId}.{expiresAtMs}.{base64url HMAC}",
 *    default TTL 12h, HMAC binds teamMemberId + eventId + expiry
 *  - expired / forged / cross-event / tampered-expiry / malformed -> false
 *  - fail-closed in production without SCANNER_SESSION_SECRET; dev fallback
 *    warns once
 *  - access codes: >= 128 bits entropy (28 chars x 5-bit alphabet = 140),
 *    dashed groups of 4, normalize is case/format-insensitive, hash is
 *    SHA-256 hex of the NORMALIZED code (the only persisted form)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SCANNER_ACCESS_CODE_ALPHABET,
  SCANNER_SESSION_SECRET_ENV,
  SCANNER_SESSION_TTL_MS,
  generateScannerAccessCode,
  hashScannerAccessCode,
  mintScannerSessionToken,
  normalizeScannerAccessCode,
  verifyScannerSessionToken,
} from "@/lib/qr/scanner-session";

const SECRET = "unit-test-scanner-secret";
const EVENT_ID = "evt-1";
const MEMBER_ID = "member-1";
const NOW = 1_750_000_000_000;
const ORIGINAL_ENV_SECRET = process.env[SCANNER_SESSION_SECRET_ENV];

afterEach(() => {
  if (ORIGINAL_ENV_SECRET === undefined) {
    delete process.env[SCANNER_SESSION_SECRET_ENV];
  } else {
    process.env[SCANNER_SESSION_SECRET_ENV] = ORIGINAL_ENV_SECRET;
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mint(overrides: Partial<Parameters<typeof mintScannerSessionToken>[0]> = {}) {
  return mintScannerSessionToken({
    teamMemberId: MEMBER_ID,
    eventId: EVENT_ID,
    nowMs: NOW,
    secret: SECRET,
    ...overrides,
  });
}

describe("mintScannerSessionToken / verifyScannerSessionToken", () => {
  it("round-trips with the default 12h TTL", () => {
    const token = mint();

    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(MEMBER_ID);
    expect(Number(parts[1])).toBe(NOW + SCANNER_SESSION_TTL_MS);
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(
      verifyScannerSessionToken({
        token,
        eventId: EVENT_ID,
        nowMs: NOW + 1000,
        secret: SECRET,
      }),
    ).toEqual({
      valid: true,
      teamMemberId: MEMBER_ID,
      expiresAtMs: NOW + SCANNER_SESSION_TTL_MS,
    });
  });

  it("rejects an EXPIRED token (>= expiry) — 12h lifetime is enforced", () => {
    const token = mint();
    const expiry = NOW + SCANNER_SESSION_TTL_MS;

    // One ms before expiry: still valid.
    expect(
      verifyScannerSessionToken({
        token,
        eventId: EVENT_ID,
        nowMs: expiry - 1,
        secret: SECRET,
      }),
    ).toMatchObject({ valid: true });
    // At and after expiry: invalid.
    for (const nowMs of [expiry, expiry + 1, expiry + 86_400_000]) {
      expect(
        verifyScannerSessionToken({ token, eventId: EVENT_ID, nowMs, secret: SECRET }),
      ).toEqual({ valid: false });
    }
  });

  it("binds to the eventId — a token never opens another event's scanner", () => {
    const token = mint();

    expect(
      verifyScannerSessionToken({
        token,
        eventId: "evt-2",
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it("rejects a stretched expiry (tampered expiresAtMs breaks the HMAC)", () => {
    const token = mint();
    const [memberId, , signature] = token.split(".");
    const stretched = `${memberId}.${NOW + 10 * SCANNER_SESSION_TTL_MS}.${signature}`;

    expect(
      verifyScannerSessionToken({
        token: stretched,
        eventId: EVENT_ID,
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it("rejects a swapped teamMemberId and a foreign-secret signature", () => {
    const token = mint();
    const [, expiresAt, signature] = token.split(".");

    expect(
      verifyScannerSessionToken({
        token: `member-2.${expiresAt}.${signature}`,
        eventId: EVENT_ID,
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });

    const foreign = mint({ secret: "other-secret" });
    expect(
      verifyScannerSessionToken({
        token: foreign,
        eventId: EVENT_ID,
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it.each([
    "",
    "no-separator",
    "a.b",
    "a.b.c.d",
    ".123.sig",
    "member.not-a-number.sig",
    "member.123.",
    `member.${"9".repeat(20)}.sig`, // absurd expiry width rejected pre-HMAC
  ])("rejects the malformed token %j", (token) => {
    expect(
      verifyScannerSessionToken({
        token,
        eventId: EVENT_ID,
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toEqual({ valid: false });
  });

  it("refuses to mint with empty or dot-containing ids", () => {
    expect(() => mint({ teamMemberId: "" })).toThrow();
    expect(() => mint({ teamMemberId: "a.b" })).toThrow();
    expect(() => mint({ eventId: "evt.1" })).toThrow();
  });

  it("falls back to the dev secret with a ONE-TIME warning when the env var is missing", async () => {
    vi.resetModules();
    delete process.env[SCANNER_SESSION_SECRET_ENV];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fresh = await import("@/lib/qr/scanner-session");

    const token = fresh.mintScannerSessionToken({
      teamMemberId: MEMBER_ID,
      eventId: EVENT_ID,
      nowMs: NOW,
    });
    fresh.mintScannerSessionToken({
      teamMemberId: "member-2",
      eventId: EVENT_ID,
      nowMs: NOW,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(SCANNER_SESSION_SECRET_ENV);
    expect(
      fresh.verifyScannerSessionToken({ token, eventId: EVENT_ID, nowMs: NOW }),
    ).toMatchObject({ valid: true, teamMemberId: MEMBER_ID });
  });

  it("THROWS in production when the env var is missing — never the dev fallback", async () => {
    vi.resetModules();
    delete process.env[SCANNER_SESSION_SECRET_ENV];
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fresh = await import("@/lib/qr/scanner-session");

    expect(() =>
      fresh.mintScannerSessionToken({
        teamMemberId: MEMBER_ID,
        eventId: EVENT_ID,
      }),
    ).toThrow(SCANNER_SESSION_SECRET_ENV);
    expect(() =>
      fresh.verifyScannerSessionToken({
        token: `${MEMBER_ID}.123.sig`,
        eventId: EVENT_ID,
      }),
    ).toThrow(SCANNER_SESSION_SECRET_ENV);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("scanner access codes (T4 AC-4/AC-5)", () => {
  it("mints dashed groups of 4 from the 32-symbol alphabet with >= 128 bits entropy", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const code = generateScannerAccessCode();
      expect(code).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);

      const raw = code.replace(/-/g, "");
      expect(raw).toHaveLength(28); // 28 chars x 5 bits = 140 bits >= 128
      for (const char of raw) {
        expect(SCANNER_ACCESS_CODE_ALPHABET).toContain(char);
      }
      seen.add(code);
    }
    expect(seen.size).toBe(50);
    // Exactly 5 bits per symbol.
    expect(SCANNER_ACCESS_CODE_ALPHABET).toHaveLength(32);
  });

  it("normalizes case, dashes and whitespace to one canonical form", () => {
    expect(normalizeScannerAccessCode("gc7q-4kxn p2mb.9rtd")).toBe(
      "GC7Q4KXNP2MB9RTD",
    );
    const code = generateScannerAccessCode();
    expect(normalizeScannerAccessCode(code)).toBe(code.replace(/-/g, ""));
  });

  it("hashes the NORMALIZED code — dashed/lowercase entries verify identically", () => {
    const code = generateScannerAccessCode();

    const hash = hashScannerAccessCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashScannerAccessCode(code.toLowerCase())).toBe(hash);
    expect(hashScannerAccessCode(code.replace(/-/g, ""))).toBe(hash);
    expect(hashScannerAccessCode(` ${code} `)).toBe(hash);
    // And it is one-way storage: never the code itself.
    expect(hash).not.toBe(code);
    expect(hashScannerAccessCode(generateScannerAccessCode())).not.toBe(hash);
  });
});
