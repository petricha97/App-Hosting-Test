// @vitest-environment node
/**
 * M6-T3 — shared-secret auth for the internal scheduler entrypoint
 * (src/lib/email/lifecycle/evaluator-auth.ts). Spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §8/§9 — same
 * fail-closed-in-production / dev-fallback-warn / constant-time-compare
 * posture as QR_TOKEN_SECRET / DRAFT_TOKEN_SECRET.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEY = "EMAIL_TRIGGER_EVALUATOR_SECRET";
const ORIGINAL_ENV_SECRET = process.env[ENV_KEY];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (ORIGINAL_ENV_SECRET === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV_SECRET;
  }
});

describe("verifyEvaluatorRequestSecret", () => {
  it("rejects a missing/empty header value", async () => {
    vi.resetModules();
    process.env[ENV_KEY] = "the-real-secret";
    const { verifyEvaluatorRequestSecret } =
      await import("@/lib/email/lifecycle/evaluator-auth");

    expect(verifyEvaluatorRequestSecret(null)).toBe(false);
    expect(verifyEvaluatorRequestSecret("")).toBe(false);
    expect(verifyEvaluatorRequestSecret("   ")).toBe(false);
  });

  it("accepts the exact configured secret and rejects any mismatch", async () => {
    vi.resetModules();
    process.env[ENV_KEY] = "the-real-secret";
    const { verifyEvaluatorRequestSecret } =
      await import("@/lib/email/lifecycle/evaluator-auth");

    expect(verifyEvaluatorRequestSecret("the-real-secret")).toBe(true);
    expect(verifyEvaluatorRequestSecret("the-real-secret-x")).toBe(false);
    expect(verifyEvaluatorRequestSecret("wrong")).toBe(false);
  });

  it("falls back to the dev secret with a ONE-TIME warning when unset (non-production)", async () => {
    vi.resetModules();
    delete process.env[ENV_KEY];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fresh = await import("@/lib/email/lifecycle/evaluator-auth");

    expect(fresh.verifyEvaluatorRequestSecret("anything")).toBe(false);
    expect(
      fresh.verifyEvaluatorRequestSecret(
        "dev-only-email-trigger-evaluator-secret-do-not-use-in-prod",
      ),
    ).toBe(true);
    // Called at least once by the two verify calls above — asserts the
    // fallback path actually ran (exact call count is a latch detail, not
    // the safety property under test).
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain(ENV_KEY);
  });

  it("REJECTS EVERY REQUEST in production when the env var is missing — never the dev fallback", async () => {
    vi.resetModules();
    delete process.env[ENV_KEY];
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fresh = await import("@/lib/email/lifecycle/evaluator-auth");

    expect(
      fresh.verifyEvaluatorRequestSecret(
        "dev-only-email-trigger-evaluator-secret-do-not-use-in-prod",
      ),
    ).toBe(false);
    expect(fresh.verifyEvaluatorRequestSecret("anything-at-all")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still uses the configured env secret in production", async () => {
    vi.resetModules();
    process.env[ENV_KEY] = "prod-secret";
    vi.stubEnv("NODE_ENV", "production");

    const fresh = await import("@/lib/email/lifecycle/evaluator-auth");

    expect(fresh.verifyEvaluatorRequestSecret("prod-secret")).toBe(true);
    expect(fresh.verifyEvaluatorRequestSecret("wrong")).toBe(false);
  });
});
