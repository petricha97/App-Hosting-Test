// @vitest-environment node
/**
 * M6-T2 — src/features/emails/utils.ts (client-safe display helpers).
 * Spec: agents/docs/specs/m6-emails-admin.md (§1 trigger-string table).
 *
 * Locks:
 *  - canonical trigger display strings match the spec §1 table verbatim;
 *  - a scheduled trigger with no derivable date reads "Not scheduled"
 *    (§1 AC-3), never a crash;
 *  - EMAIL_MERGE_TAG_DISPLAY (the client-safe catalog copy, since
 *    src/lib/email/merge-tags.ts is server-only and can't be imported into
 *    "use client" components) stays in LOCKSTEP with EMAIL_MERGE_TAGS — the
 *    design's "never forked" rule, enforced here since the fork is now two
 *    files instead of one import;
 *  - the datetime-local <-> event-instant round trip is stable.
 */
import { describe, expect, it } from "vitest";

import {
  atMsToDateTimeLocalInput,
  dateTimeLocalInputToAtMs,
  EMAIL_MERGE_TAG_DISPLAY,
  isAutomatedTrigger,
  triggerDisplayLabel,
} from "@/features/emails/utils";
import { EMAIL_MERGE_TAGS } from "@/lib/email/merge-tags";

describe("triggerDisplayLabel — spec §1 canonical strings", () => {
  it("manual", () => {
    expect(triggerDisplayLabel({ type: "manual" }, "UTC")).toBe("Manual");
  });
  it("on-submit / on-accept / abandoned-24h", () => {
    expect(triggerDisplayLabel({ type: "on-submit" }, "UTC")).toBe(
      "Auto · on submit",
    );
    expect(triggerDisplayLabel({ type: "on-accept" }, "UTC")).toBe(
      "Auto · on accept",
    );
    expect(triggerDisplayLabel({ type: "abandoned-24h" }, "UTC")).toBe(
      "Auto · 24h after drop-off",
    );
  });
  it("unpaid-offsets", () => {
    expect(
      triggerDisplayLabel(
        { type: "unpaid-offsets", offsetsDays: [7, 14, 21] },
        "UTC",
      ),
    ).toBe("Auto · +7 / 14 / 21d unpaid");
  });
  it("scheduled with a date formats in the event timezone", () => {
    const atMs = Date.UTC(2026, 8, 8, 13, 0); // 2026-09-08T13:00:00Z
    const label = triggerDisplayLabel(
      { type: "scheduled", atMs },
      "America/New_York",
    );
    expect(label).toContain("Sep 8");
    expect(label).toContain("9:00");
  });
  it("scheduled with NO date reads 'Not scheduled' (spec §1 AC-3, never a crash)", () => {
    expect(triggerDisplayLabel({ type: "scheduled", atMs: null }, "UTC")).toBe(
      "Not scheduled",
    );
  });
});

describe("isAutomatedTrigger — the M6-T3-not-built info affordance gate", () => {
  it("manual is NOT automated (no info icon, real test-send exists)", () => {
    expect(isAutomatedTrigger({ type: "manual" })).toBe(false);
  });
  it("every other trigger type IS automated", () => {
    expect(isAutomatedTrigger({ type: "on-submit" })).toBe(true);
    expect(isAutomatedTrigger({ type: "on-accept" })).toBe(true);
    expect(isAutomatedTrigger({ type: "abandoned-24h" })).toBe(true);
    expect(
      isAutomatedTrigger({ type: "unpaid-offsets", offsetsDays: [7] }),
    ).toBe(true);
    expect(isAutomatedTrigger({ type: "scheduled", atMs: null })).toBe(true);
  });
});

describe("EMAIL_MERGE_TAG_DISPLAY — stays in lockstep with the T1 catalog", () => {
  it("has exactly the same tag names as EMAIL_MERGE_TAGS, in the same order", () => {
    expect(EMAIL_MERGE_TAG_DISPLAY.map((entry) => entry.tag)).toEqual([
      ...EMAIL_MERGE_TAGS,
    ]);
  });

  it("qr_code carries the 'HTML body only' hint (design §3)", () => {
    const qrEntry = EMAIL_MERGE_TAG_DISPLAY.find(
      (entry) => entry.tag === "qr_code",
    );
    expect(qrEntry?.hint).toMatch(/HTML body only/);
  });
});

describe("datetime-local <-> event-instant round trip", () => {
  it("round-trips through the event timezone", () => {
    const atMs = Date.UTC(2026, 8, 8, 13, 0);
    const inputValue = atMsToDateTimeLocalInput(atMs, "America/New_York");
    expect(inputValue).toBe("2026-09-08T09:00");
    expect(dateTimeLocalInputToAtMs(inputValue, "America/New_York")).toBe(atMs);
  });

  it("empty input maps to null (clearing a schedule)", () => {
    expect(atMsToDateTimeLocalInput(null, "UTC")).toBe("");
    expect(dateTimeLocalInputToAtMs("", "UTC")).toBeNull();
  });
});
