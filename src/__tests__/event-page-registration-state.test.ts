// @vitest-environment node
/**
 * M4-T1 — RegistrationEmbed behavior branch resolution
 * (src/features/event-pages/registration-state.ts).
 * Spec ACs: 13 (≥1 active path → open CTA), 14 (0 paths ever → legacy inline
 * form), 15 (paths exist but unavailable → closed notice, never hidden).
 */
import { describe, expect, it } from "vitest";

import { resolveRegistrationCtaState } from "@/features/event-pages/registration-state";

describe("resolveRegistrationCtaState", () => {
  it("returns no_paths when the event has never configured a path (AC-14)", () => {
    expect(
      resolveRegistrationCtaState({
        hasPublishedForm: true,
        totalPaths: 0,
        activePaths: 0,
      }),
    ).toBe("no_paths");
    // Even without a published form: the legacy inline form card owns its
    // own "not published yet" empty state.
    expect(
      resolveRegistrationCtaState({
        hasPublishedForm: false,
        totalPaths: 0,
        activePaths: 0,
      }),
    ).toBe("no_paths");
  });

  it("returns open with ≥1 active path and a published form (AC-13)", () => {
    expect(
      resolveRegistrationCtaState({
        hasPublishedForm: true,
        totalPaths: 3,
        activePaths: 1,
      }),
    ).toBe("open");
  });

  it("returns closed when paths exist but none is active (AC-15)", () => {
    expect(
      resolveRegistrationCtaState({
        hasPublishedForm: true,
        totalPaths: 2,
        activePaths: 0,
      }),
    ).toBe("closed");
  });

  it("returns closed when paths are active but the form is unpublished (AC-15)", () => {
    expect(
      resolveRegistrationCtaState({
        hasPublishedForm: false,
        totalPaths: 2,
        activePaths: 2,
      }),
    ).toBe("closed");
  });
});
