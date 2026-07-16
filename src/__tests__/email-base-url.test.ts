// @vitest-environment node
/**
 * M6-T4 B-1 follow-up — src/lib/email/base-url.ts, the ABSOLUTE-origin
 * resolver every real call site's registrationCta wiring depends on
 * (RegistrationEmbed's registerHref must pass isEmailSafeUrl, which rejects
 * every relative/protocol-relative path by construction — see
 * src/lib/email/schemas.ts's isEmailSafeUrl).
 *
 * Locks:
 *  - NEXT_PUBLIC_APP_URL, when a well-formed absolute http(s) URL, resolves
 *    to its normalized origin (trailing path/slash/query stripped);
 *  - a non-http(s) scheme (e.g. javascript:, ftp:) is rejected -> null;
 *  - a relative/malformed value is rejected -> null;
 *  - unset -> null;
 *  - NEVER derived from request headers (Host/X-Forwarded-Host are
 *    client-controlled input — trusting them would let a forged request
 *    embed a spoofed link in a real outbound email).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveEmailBaseUrl } from "@/lib/email/base-url";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_ENV;
  }
});

describe("NEXT_PUBLIC_APP_URL", () => {
  it("resolves to the normalized origin, trailing slash stripped", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    await expect(resolveEmailBaseUrl()).resolves.toBe(
      "https://app.example.com",
    );
  });

  it("strips any accidental trailing path/query down to the origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/some/path?x=1";
    await expect(resolveEmailBaseUrl()).resolves.toBe(
      "https://app.example.com",
    );
  });

  it("accepts http:// (e.g. local dev)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    await expect(resolveEmailBaseUrl()).resolves.toBe("http://localhost:3000");
  });

  it("rejects a non-http(s) scheme -> null", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "javascript:alert(1)";
    await expect(resolveEmailBaseUrl()).resolves.toBeNull();
  });

  it("rejects a relative/malformed value -> null", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "/events";
    await expect(resolveEmailBaseUrl()).resolves.toBeNull();
  });

  it("unset -> null", async () => {
    await expect(resolveEmailBaseUrl()).resolves.toBeNull();
  });

  it("blank/whitespace-only -> null", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    await expect(resolveEmailBaseUrl()).resolves.toBeNull();
  });
});
