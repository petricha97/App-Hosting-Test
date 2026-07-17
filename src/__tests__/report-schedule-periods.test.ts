// @vitest-environment node
/**
 * M7-T3 — resolveDueReportSchedulePeriods (src/lib/email/lifecycle/
 * report-schedule-periods.ts). Spec: agents/docs/specs/m7-scheduled-reports.md
 * D3 (periodKey formulas, monthly clamping) / D4 (bounded catch-up window,
 * never-before-createdAt floor).
 *
 * Locks:
 *  - daily/weekly/monthly due/not-due computation, event-local time
 *  - monthly dayOfMonth 31 clamps to Feb 28 (non-leap) / Feb 29 (leap)
 *  - catch-up never exceeds MAX_CATCHUP_PERIODS(4) periods
 *  - catch-up never predates the schedule's own createdAt (notBeforeMs)
 */
import { describe, expect, it } from "vitest";

import { resolveDueReportSchedulePeriods } from "@/lib/email/lifecycle/report-schedule-periods";

const UTC = "UTC";
const EARLY_FLOOR = Date.parse("2000-01-01T00:00:00.000Z");

describe("resolveDueReportSchedulePeriods — daily", () => {
  it("fires once now has reached today's due instant, periodKey = YYYY-MM-DD", () => {
    const nowMs = Date.parse("2026-07-20T09:00:00.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      // notBeforeMs pinned to yesterday's due instant so only today's
      // period is in range — isolates "is today's period due" from D4's
      // separate catch-up-window behavior (covered below).
      notBeforeMs: nowMs - 12 * 60 * 60 * 1000,
      maxPeriods: 4,
    });

    expect(periods).toHaveLength(1);
    expect(periods[0]).toEqual({ periodKey: "2026-07-20", dueMs: nowMs });
  });

  it("does not include today's period before its due instant", () => {
    const nowMs = Date.parse("2026-07-20T08:59:59.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: EARLY_FLOOR,
      maxPeriods: 4,
    });

    // Nothing due today yet — the newest due period is yesterday's.
    expect(periods[0].periodKey).toBe("2026-07-19");
  });

  it("caps catch-up at MAX_CATCHUP_PERIODS, never more", () => {
    // 10 days of silence — only the most recent 4 should be returned.
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: Date.parse("2026-07-01T00:00:00.000Z"),
      maxPeriods: 4,
    });

    expect(periods).toHaveLength(4);
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-07-20",
      "2026-07-19",
      "2026-07-18",
      "2026-07-17",
    ]);
  });

  it("never backfills a period that predates the schedule's own createdAt", () => {
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");
    const notBeforeMs = Date.parse("2026-07-19T15:00:00.000Z"); // schedule created mid-day on the 19th
    const periods = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs,
      maxPeriods: 4,
    });

    // The 19th's 09:00 due-instant is BEFORE notBeforeMs (created at 15:00
    // that day) — only today's period qualifies.
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-07-20"]);
  });
});

describe("resolveDueReportSchedulePeriods — weekly", () => {
  it("fires once per week on the configured dayOfWeek occurrence only", () => {
    // 2026-07-20 is a Monday (dayOfWeek 1).
    const monday9am = Date.parse("2026-07-20T09:00:00.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "weekly",
      dayOfWeek: 1,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs: monday9am,
      // Pinned so only this week's occurrence is in range — isolates
      // "which day fires" from D4's separate catch-up-window behavior
      // (covered by the dedicated catch-up test below).
      notBeforeMs: monday9am - 6 * 24 * 60 * 60 * 1000,
      maxPeriods: 4,
    });

    expect(periods).toHaveLength(1);
    expect(periods[0].periodKey).toBe("2026-07-20");
  });

  it("mid-week ticks never fire on a day other than the configured occurrence", () => {
    // 2026-07-22 is a Wednesday — the most recent Monday occurrence is the 20th.
    const wednesday = Date.parse("2026-07-22T12:00:00.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "weekly",
      dayOfWeek: 1,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs: wednesday,
      notBeforeMs: wednesday - 6 * 24 * 60 * 60 * 1000,
      maxPeriods: 4,
    });

    expect(periods).toHaveLength(1);
    expect(periods[0].periodKey).toBe("2026-07-20"); // still the Monday, not the 22nd
  });

  it("caps weekly catch-up at MAX_CATCHUP_PERIODS weeks back", () => {
    const nowMs = Date.parse("2026-08-17T12:00:00.000Z"); // a Monday, many weeks of silence
    const periods = resolveDueReportSchedulePeriods({
      frequency: "weekly",
      dayOfWeek: 1,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: Date.parse("2026-01-01T00:00:00.000Z"),
      maxPeriods: 4,
    });

    expect(periods).toHaveLength(4);
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-08-17",
      "2026-08-10",
      "2026-08-03",
      "2026-07-27",
    ]);
  });
});

describe("resolveDueReportSchedulePeriods — monthly", () => {
  it("dayOfMonth 31 clamps to Feb 28 in a non-leap year", () => {
    const nowMs = Date.parse("2027-02-28T09:00:00.000Z"); // 2027 is not a leap year
    const periods = resolveDueReportSchedulePeriods({
      frequency: "monthly",
      dayOfWeek: null,
      dayOfMonth: 31,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: EARLY_FLOOR,
      maxPeriods: 1,
    });

    expect(periods).toHaveLength(1);
    expect(periods[0]).toEqual({ periodKey: "2027-02", dueMs: nowMs });
  });

  it("dayOfMonth 31 clamps to Feb 29 in a leap year", () => {
    const nowMs = Date.parse("2028-02-29T09:00:00.000Z"); // 2028 IS a leap year
    const periods = resolveDueReportSchedulePeriods({
      frequency: "monthly",
      dayOfWeek: null,
      dayOfMonth: 31,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: EARLY_FLOOR,
      maxPeriods: 1,
    });

    expect(periods).toHaveLength(1);
    expect(periods[0]).toEqual({ periodKey: "2028-02", dueMs: nowMs });
  });

  it("periodKey is YYYY-MM only — the month alone identifies the (clamped) period", () => {
    const nowMs = Date.parse("2026-07-15T09:00:00.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "monthly",
      dayOfWeek: null,
      dayOfMonth: 15,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: EARLY_FLOOR,
      maxPeriods: 1,
    });

    expect(periods[0].periodKey).toBe("2026-07");
  });

  it("dayOfMonth 30 in a 31-day month does NOT clamp — fires exactly on the 30th", () => {
    // Regression guard for the inverse of the clamping tests above: a
    // dayOfMonth that IS valid for the current month must pass through
    // unmodified, not get pulled into the clamping code path.
    const nowMs = Date.parse("2026-07-30T09:00:00.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "monthly",
      dayOfWeek: null,
      dayOfMonth: 30,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: EARLY_FLOOR,
      maxPeriods: 1,
    });

    expect(periods).toHaveLength(1);
    expect(periods[0]).toEqual({ periodKey: "2026-07", dueMs: nowMs });
  });

  it("caps monthly catch-up at MAX_CATCHUP_PERIODS months back", () => {
    const nowMs = Date.parse("2026-12-01T09:00:00.000Z");
    const periods = resolveDueReportSchedulePeriods({
      frequency: "monthly",
      dayOfWeek: null,
      dayOfMonth: 1,
      hour: 9,
      minute: 0,
      timeZone: UTC,
      nowMs,
      notBeforeMs: Date.parse("2026-01-01T00:00:00.000Z"),
      maxPeriods: 4,
    });

    expect(periods).toHaveLength(4);
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-12",
      "2026-11",
      "2026-10",
      "2026-09",
    ]);
  });
});

describe("resolveDueReportSchedulePeriods — event timezone", () => {
  it("resolves the due instant in the event's own timezone, not UTC", () => {
    // 09:00 in America/New_York (UTC-4 in July, DST) is 13:00 UTC.
    const nowMsBeforeLocal = Date.parse("2026-07-20T12:59:00.000Z");
    const nowMsAtLocal = Date.parse("2026-07-20T13:00:00.000Z");

    const notYetDue = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: "America/New_York",
      nowMs: nowMsBeforeLocal,
      notBeforeMs: EARLY_FLOOR,
      maxPeriods: 4,
    });
    expect(notYetDue[0].periodKey).toBe("2026-07-19"); // today's not due yet

    const due = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: "America/New_York",
      nowMs: nowMsAtLocal,
      notBeforeMs: EARLY_FLOOR,
      maxPeriods: 4,
    });
    expect(due[0].periodKey).toBe("2026-07-20");
  });

  it("resolves correctly for a FRACTIONAL UTC offset (Asia/Kolkata, UTC+5:30) — exactly-at-boundary fires, one minute before does not", () => {
    // Whole-hour offsets (the America/New_York case above) can pass even
    // when the underlying math naively floors/truncates minutes — a
    // half-hour offset zone is a stricter regression guard against that
    // class of bug. 09:00 IST on 2026-07-20 = 03:30 UTC.
    const dueUtcMs = Date.parse("2026-07-20T03:30:00.000Z");

    const atBoundary = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: "Asia/Kolkata",
      nowMs: dueUtcMs,
      notBeforeMs: dueUtcMs - 60 * 60 * 1000,
      maxPeriods: 4,
    });
    expect(atBoundary).toHaveLength(1);
    expect(atBoundary[0]).toEqual({ periodKey: "2026-07-20", dueMs: dueUtcMs });

    const oneMinuteBefore = resolveDueReportSchedulePeriods({
      frequency: "daily",
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: 0,
      timeZone: "Asia/Kolkata",
      nowMs: dueUtcMs - 60 * 1000,
      notBeforeMs: dueUtcMs - 25 * 60 * 60 * 1000,
      maxPeriods: 4,
    });
    // Today's period not yet due -> newest returned is yesterday's.
    expect(oneMinuteBefore[0].periodKey).toBe("2026-07-19");
  });
});
