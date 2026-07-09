/**
 * M1 registration spine — pure sales-window helpers.
 * Spec: agents/docs/specs/m1-registration-spine.md (M1-T2 AC-5/AC-6).
 *
 * Boundary tests are pinned to non-UTC event timezones (Asia/Singapore, +08:00
 * with no DST; America/New_York across a DST transition) so "until Jul 31"
 * provably means 23:59:59.999 *event-local*, inclusive at both ends.
 */
import { describe, expect, it } from "vitest";

import {
  eventLocalDateToUtcMs,
  formatSalesDate,
  getSalesWindowLabel,
  getTicketOpenState,
  isTicketOpen,
  resolveEventTimeZone,
  utcToEventLocalDate,
} from "@/features/registration/utils";

const SG = "Asia/Singapore"; // UTC+8, no DST
const NY = "America/New_York";

describe("resolveEventTimeZone", () => {
  it("passes valid IANA zones through", () => {
    expect(resolveEventTimeZone("Asia/Singapore")).toBe("Asia/Singapore");
  });

  it("falls back to UTC for empty or unknown zones", () => {
    expect(resolveEventTimeZone("")).toBe("UTC");
    expect(resolveEventTimeZone("   ")).toBe("UTC");
    expect(resolveEventTimeZone(undefined)).toBe("UTC");
    expect(resolveEventTimeZone("Not/AZone")).toBe("UTC");
  });
});

describe("eventLocalDateToUtcMs", () => {
  it("maps a start boundary to 00:00:00.000 event-local (Asia/Singapore)", () => {
    // Jul 31 00:00 SGT == Jul 30 16:00 UTC.
    expect(eventLocalDateToUtcMs("2026-07-31", SG, "start")).toBe(
      Date.UTC(2026, 6, 30, 16, 0, 0, 0),
    );
  });

  it("maps an end boundary to 23:59:59.999 event-local (Asia/Singapore)", () => {
    // Jul 31 23:59:59.999 SGT == Jul 31 15:59:59.999 UTC.
    expect(eventLocalDateToUtcMs("2026-07-31", SG, "end")).toBe(
      Date.UTC(2026, 6, 31, 15, 59, 59, 999),
    );
  });

  it("treats UTC as identity", () => {
    expect(eventLocalDateToUtcMs("2026-07-31", "UTC", "start")).toBe(
      Date.UTC(2026, 6, 31, 0, 0, 0, 0),
    );
    expect(eventLocalDateToUtcMs("2026-07-31", "UTC", "end")).toBe(
      Date.UTC(2026, 6, 31, 23, 59, 59, 999),
    );
  });

  it("handles a DST-transition day (America/New_York, Mar 8 2026)", () => {
    // Midnight local is still EST (UTC-5): 05:00 UTC.
    expect(eventLocalDateToUtcMs("2026-03-08", NY, "start")).toBe(
      Date.UTC(2026, 2, 8, 5, 0, 0, 0),
    );
    // End of day local is EDT (UTC-4): 03:59:59.999 UTC next day.
    expect(eventLocalDateToUtcMs("2026-03-08", NY, "end")).toBe(
      Date.UTC(2026, 2, 9, 3, 59, 59, 999),
    );
  });
});

describe("utcToEventLocalDate", () => {
  it("round-trips both boundaries back to the same calendar date", () => {
    const startMs = eventLocalDateToUtcMs("2026-07-31", SG, "start");
    const endMs = eventLocalDateToUtcMs("2026-07-31", SG, "end");
    expect(utcToEventLocalDate(startMs, SG)).toBe("2026-07-31");
    expect(utcToEventLocalDate(endMs, SG)).toBe("2026-07-31");
  });

  it("is timezone-sensitive (same instant, different calendar date)", () => {
    const startMs = eventLocalDateToUtcMs("2026-07-31", SG, "start");
    // Jul 31 00:00 SGT is still Jul 30 in UTC.
    expect(utcToEventLocalDate(startMs, "UTC")).toBe("2026-07-30");
  });
});

describe("getTicketOpenState / isTicketOpen (spec truth table, AC-5)", () => {
  // GC-EB style window: until Jul 31 (SGT); GC-ST style: from Aug 1 (SGT).
  const endJul31 = eventLocalDateToUtcMs("2026-07-31", SG, "end");
  const startAug1 = eventLocalDateToUtcMs("2026-08-01", SG, "start");

  it("manual flag off -> No, regardless of window", () => {
    const ticket = { isOpen: false, salesStartMs: null, salesEndMs: null };
    expect(getTicketOpenState(ticket, Date.now())).toBe("closed-manual");
    expect(isTicketOpen(ticket, Date.now())).toBe(false);
  });

  it("flag on with no dates -> Yes", () => {
    const ticket = { isOpen: true, salesStartMs: null, salesEndMs: null };
    expect(isTicketOpen(ticket, Date.now())).toBe(true);
  });

  it("flag on before the start -> No; at 00:00:00.000 event-local -> Yes (inclusive)", () => {
    const ticket = { isOpen: true, salesStartMs: startAug1, salesEndMs: null };
    expect(getTicketOpenState(ticket, startAug1 - 1)).toBe("not-started");
    expect(isTicketOpen(ticket, startAug1 - 1)).toBe(false);
    expect(isTicketOpen(ticket, startAug1)).toBe(true);
  });

  it("flag on through 23:59:59.999 event-local on the end date -> Yes; 1ms later -> No", () => {
    const ticket = { isOpen: true, salesStartMs: null, salesEndMs: endJul31 };
    expect(isTicketOpen(ticket, endJul31)).toBe(true);
    expect(getTicketOpenState(ticket, endJul31 + 1)).toBe("ended");
    expect(isTicketOpen(ticket, endJul31 + 1)).toBe(false);
  });

  it("manual flag wins over an open window", () => {
    const ticket = { isOpen: false, salesStartMs: null, salesEndMs: endJul31 };
    expect(getTicketOpenState(ticket, endJul31 - 1000)).toBe("closed-manual");
  });

  it("accepts Date instances for now", () => {
    const ticket = { isOpen: true, salesStartMs: startAug1, salesEndMs: null };
    expect(isTicketOpen(ticket, new Date(startAug1))).toBe(true);
  });
});

describe("getSalesWindowLabel (AC-6)", () => {
  // "Now": Jul 15 2026, noon SGT.
  const nowMs = Date.UTC(2026, 6, 15, 4, 0, 0, 0);
  const endJul31 = eventLocalDateToUtcMs("2026-07-31", SG, "end");
  const startAug1 = eventLocalDateToUtcMs("2026-08-01", SG, "start");
  const endJun30 = eventLocalDateToUtcMs("2026-06-30", SG, "end");

  it("both bounds null -> Open", () => {
    expect(
      getSalesWindowLabel(
        { salesStartMs: null, salesEndMs: null },
        { timeZone: SG, nowMs },
      ),
    ).toBe("Open");
  });

  it("ended window -> Closed", () => {
    expect(
      getSalesWindowLabel(
        { salesStartMs: null, salesEndMs: endJun30 },
        { timeZone: SG, nowMs },
      ),
    ).toBe("Closed");
  });

  it("future start -> from {date}", () => {
    expect(
      getSalesWindowLabel(
        { salesStartMs: startAug1, salesEndMs: null },
        { timeZone: SG, nowMs },
      ),
    ).toBe("from Aug 1");
  });

  it("open with an end -> until {date}", () => {
    expect(
      getSalesWindowLabel(
        { salesStartMs: null, salesEndMs: endJul31 },
        { timeZone: SG, nowMs },
      ),
    ).toBe("until Jul 31");
  });

  it("only a past start -> Open", () => {
    const startJul1 = eventLocalDateToUtcMs("2026-07-01", SG, "start");
    expect(
      getSalesWindowLabel(
        { salesStartMs: startJul1, salesEndMs: null },
        { timeZone: SG, nowMs },
      ),
    ).toBe("Open");
  });

  it("still Open at the exact end instant (inclusive boundary)", () => {
    expect(
      getSalesWindowLabel(
        { salesStartMs: null, salesEndMs: endJul31 },
        { timeZone: SG, nowMs: endJul31 },
      ),
    ).toBe("until Jul 31");
  });

  it("formats dates in the EVENT timezone, not UTC", () => {
    // Aug 1 00:00 SGT == Jul 31 16:00 UTC — the label must say Aug 1.
    expect(
      getSalesWindowLabel(
        { salesStartMs: startAug1, salesEndMs: null },
        { timeZone: SG, nowMs },
      ),
    ).toBe("from Aug 1");
    expect(
      getSalesWindowLabel(
        { salesStartMs: startAug1, salesEndMs: null },
        { timeZone: "UTC", nowMs },
      ),
    ).toBe("from Jul 31");
  });

  it("appends the year when it differs from the current year", () => {
    const endJul2027 = eventLocalDateToUtcMs("2027-07-31", SG, "end");
    expect(
      getSalesWindowLabel(
        { salesStartMs: null, salesEndMs: endJul2027 },
        { timeZone: SG, nowMs },
      ),
    ).toBe("until Jul 31, 2027");
  });
});

describe("formatSalesDate", () => {
  const nowMs = Date.UTC(2026, 6, 15);

  it("renders MMM D within the current year", () => {
    const endJul31 = eventLocalDateToUtcMs("2026-07-31", SG, "end");
    expect(formatSalesDate(endJul31, SG, nowMs)).toBe("Jul 31");
  });

  it("compares years in the event timezone", () => {
    // Jan 1 2027 00:00 SGT is still Dec 31 2026 in UTC; in SGT the year
    // differs from now (2026) so it must carry the year.
    const startJan1 = eventLocalDateToUtcMs("2027-01-01", SG, "start");
    expect(formatSalesDate(startJan1, SG, nowMs)).toBe("Jan 1, 2027");
  });
});
