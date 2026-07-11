// @vitest-environment node
/**
 * M4-T1 — CountdownTimer pure logic (src/features/event-pages/countdown.ts).
 * Spec ACs: 9 (eventStart target tracks the event doc), 10 (invalid custom →
 * event start; nothing → null/completed), 11 (zero/past → null, never
 * negative parts), 12 (B1 regression: offset-less custom targets resolve in
 * the EVENT timezone, identically regardless of the process TZ — no
 * server/client hydration divergence), plus event-start resolution from
 * period wall clocks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  diffCountdown,
  formatCountdownTarget,
  resolveCountdownTargetMs,
  resolveEventStartMs,
} from "@/features/event-pages/countdown";
import { eventLocalDateTimeToUtcMs } from "@/features/registration/utils";

const EVENT_START_ISO = "2026-09-15T13:00:00.000Z";
const EVENT_START_MS = Date.parse(EVENT_START_ISO);

describe("resolveCountdownTargetMs", () => {
  it("resolves eventStart mode from the injected event start (AC-9)", () => {
    expect(
      resolveCountdownTargetMs({
        target: "eventStart",
        customDateTime: "2030-01-01T00:00",
        eventStartIso: EVENT_START_ISO,
        timezone: "UTC",
      }),
    ).toBe(EVENT_START_MS);
  });

  it("uses a parseable custom target in custom mode", () => {
    const customMs = Date.parse("2030-01-01T00:00:00.000Z");
    expect(
      resolveCountdownTargetMs({
        target: "custom",
        customDateTime: "2030-01-01T00:00:00.000Z",
        eventStartIso: EVENT_START_ISO,
        timezone: "America/New_York",
      }),
    ).toBe(customMs);
  });

  it("falls back to event start when the custom value is invalid or empty (AC-10)", () => {
    for (const bad of ["", "   ", "not-a-date"]) {
      expect(
        resolveCountdownTargetMs({
          target: "custom",
          customDateTime: bad,
          eventStartIso: EVENT_START_ISO,
          timezone: "UTC",
        }),
      ).toBe(EVENT_START_MS);
    }
  });

  it("returns null when neither custom nor event start resolves (AC-10 → completedMessage)", () => {
    expect(
      resolveCountdownTargetMs({
        target: "custom",
        customDateTime: "garbage",
        eventStartIso: null,
        timezone: "UTC",
      }),
    ).toBeNull();
    expect(
      resolveCountdownTargetMs({
        target: "eventStart",
        customDateTime: "",
        eventStartIso: null,
        timezone: "UTC",
      }),
    ).toBeNull();
  });
});

describe("resolveCountdownTargetMs — offset-less custom targets (B1 regression, AC-12)", () => {
  // Node ≥16 re-reads process.env.TZ on Date operations, so stubbing it
  // simulates the server (UTC) vs. visitor-browser (any zone) split that
  // caused the original bug (bare Date.parse of datetime-local strings).
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function resolveWithProcessTz(processTz: string) {
    vi.stubEnv("TZ", processTz);
    return resolveCountdownTargetMs({
      target: "custom",
      customDateTime: "2026-09-15T09:00", // datetime-local shape, no offset
      eventStartIso: EVENT_START_ISO,
      timezone: "Asia/Singapore",
    });
  }

  it("anchors the wall clock to the EVENT timezone, not the process TZ", () => {
    // 09:00 in Singapore (UTC+8, no DST) on 2026-09-15 is 01:00 UTC.
    expect(resolveWithProcessTz("UTC")).toBe(
      Date.UTC(2026, 8, 15, 1, 0, 0, 0),
    );
  });

  it("resolves the SAME instant regardless of the executing environment's TZ", () => {
    const instants = ["UTC", "America/New_York", "Asia/Singapore", "Pacific/Kiritimati"].map(
      resolveWithProcessTz,
    );
    expect(new Set(instants).size).toBe(1);
    expect(instants[0]).toBe(
      eventLocalDateTimeToUtcMs("2026-09-15", "09:00", "Asia/Singapore"),
    );
  });

  it("handles offset-less seconds/millis variants and DST wall clocks in the event zone", () => {
    // Seconds variant.
    expect(
      resolveCountdownTargetMs({
        target: "custom",
        customDateTime: "2026-09-15T09:00:30",
        eventStartIso: null,
        timezone: "Asia/Singapore",
      }),
    ).toBe(Date.UTC(2026, 8, 15, 1, 0, 30, 0));
    // DST day in New York: 09:00 local on 2026-03-08 is already EDT (UTC-4).
    expect(
      resolveCountdownTargetMs({
        target: "custom",
        customDateTime: "2026-03-08T09:00",
        eventStartIso: null,
        timezone: "America/New_York",
      }),
    ).toBe(Date.UTC(2026, 2, 8, 13, 0, 0, 0));
  });

  it("keeps explicit-offset ISO strings on Date.parse semantics in any process TZ", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(
      resolveCountdownTargetMs({
        target: "custom",
        customDateTime: "2030-01-01T00:00:00+08:00",
        eventStartIso: null,
        timezone: "UTC",
      }),
    ).toBe(Date.parse("2030-01-01T00:00:00+08:00"));
  });

  it("formats a stable absolute-target line from the resolved instant (SSR = client)", () => {
    const targetMs = resolveWithProcessTz("UTC");
    const labels = ["UTC", "America/New_York", "Asia/Singapore"].map((tz) => {
      vi.stubEnv("TZ", tz);
      return formatCountdownTarget(targetMs as number, "Asia/Singapore");
    });
    expect(new Set(labels).size).toBe(1);
    expect(labels[0]).toBe("September 15, 2026 · 9:00 AM");
  });
});

describe("diffCountdown", () => {
  it("splits remaining time into days/hours/minutes/seconds", () => {
    const now = 0;
    const target =
      2 * 86400_000 + 3 * 3600_000 + 4 * 60_000 + 5_000;
    expect(diffCountdown(target, now)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
  });

  it("returns null at exactly zero and for past targets — never negatives (AC-11)", () => {
    expect(diffCountdown(1000, 1000)).toBeNull();
    expect(diffCountdown(1000, 5000)).toBeNull();
  });

  it("counts a sub-second remainder as still pending, floored to 0s parts", () => {
    expect(diffCountdown(1500, 1000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });
});

describe("resolveEventStartMs", () => {
  it("resolves the first period's date + startTime in the event timezone", () => {
    const ms = resolveEventStartMs({
      periods: [{ date: "2026-09-15", startTime: "09:00" }],
      timezone: "America/New_York",
    });
    // 09:00 ET on 2026-09-15 is 13:00 UTC (EDT, UTC-4).
    expect(ms).toBe(Date.parse("2026-09-15T13:00:00.000Z"));
  });

  it("supports legacy key spellings and defaults missing time to midnight", () => {
    const ms = resolveEventStartMs({
      periods: [{ startDate: "2026-01-02" }],
      timezone: "UTC",
    });
    expect(ms).toBe(Date.parse("2026-01-02T00:00:00.000Z"));
  });

  it("returns null with no periods or no usable date", () => {
    expect(resolveEventStartMs({ periods: [], timezone: "UTC" })).toBeNull();
    expect(
      resolveEventStartMs({ periods: [{ startTime: "10:00" }], timezone: "UTC" }),
    ).toBeNull();
  });

  it("falls back to midnight when the stored time is malformed", () => {
    const ms = resolveEventStartMs({
      periods: [{ date: "2026-01-02", startTime: "25:99" }],
      timezone: "UTC",
    });
    expect(ms).toBe(Date.parse("2026-01-02T00:00:00.000Z"));
  });
});

describe("formatCountdownTarget", () => {
  it("formats deterministically in the event timezone", () => {
    expect(formatCountdownTarget(EVENT_START_MS, "America/New_York")).toBe(
      "September 15, 2026 · 9:00 AM",
    );
  });

  it("falls back to UTC for unusable timezones", () => {
    expect(formatCountdownTarget(EVENT_START_MS, "Not/AZone")).toBe(
      "September 15, 2026 · 1:00 PM",
    );
  });
});
