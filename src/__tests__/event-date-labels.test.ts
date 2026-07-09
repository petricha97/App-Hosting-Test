import { describe, expect, it } from "vitest";

import {
  getEventBarDateLabel,
  getEventPrimaryDateLabel,
} from "@/features/event/utils";
import { getInitials } from "@/lib/utils";

function eventWith(
  periods: Array<Record<string, string>>,
  timezone = "",
): { periods: Array<Record<string, string>>; timezone: string } {
  return { periods, timezone };
}

describe("getEventBarDateLabel", () => {
  it("returns null when the event has no periods", () => {
    expect(getEventBarDateLabel(eventWith([]))).toBeNull();
  });

  it("returns null when the first period has no date under any known key", () => {
    expect(
      getEventBarDateLabel(eventWith([{ startTime: "09:00" }])),
    ).toBeNull();
  });

  it("returns the date alone when no times are set", () => {
    expect(getEventBarDateLabel(eventWith([{ date: "2026-07-10" }]))).toBe(
      "2026-07-10",
    );
  });

  it("formats a full time range", () => {
    expect(
      getEventBarDateLabel(
        eventWith([
          { date: "2026-07-10", startTime: "09:00", endTime: "17:00" },
        ]),
      ),
    ).toBe("2026-07-10, 09:00 – 17:00");
  });

  it("formats a start-only time", () => {
    expect(
      getEventBarDateLabel(eventWith([{ date: "2026-07-10", startTime: "09:00" }])),
    ).toBe("2026-07-10, 09:00");
  });

  it("ignores an end time without a start time", () => {
    expect(
      getEventBarDateLabel(eventWith([{ date: "2026-07-10", endTime: "17:00" }])),
    ).toBe("2026-07-10");
  });

  it("reads legacy snake_case time keys", () => {
    expect(
      getEventBarDateLabel(
        eventWith([
          { date: "2026-07-10", start_time: "09:00", end_time: "17:00" },
        ]),
      ),
    ).toBe("2026-07-10, 09:00 – 17:00");
  });

  it("appends the timezone when present", () => {
    expect(
      getEventBarDateLabel(
        eventWith(
          [{ date: "2026-07-10", startTime: "09:00", endTime: "17:00" }],
          "Asia/Kuala_Lumpur",
        ),
      ),
    ).toBe("2026-07-10, 09:00 – 17:00 · Asia/Kuala_Lumpur");
  });

  it("omits a whitespace-only timezone", () => {
    expect(
      getEventBarDateLabel(eventWith([{ date: "2026-07-10" }], "   ")),
    ).toBe("2026-07-10");
  });

  it("supports the legacy `start` date key", () => {
    expect(getEventBarDateLabel(eventWith([{ start: "2026-07-10" }]))).toBe(
      "2026-07-10",
    );
  });

  it("supports the legacy `startDate` date key", () => {
    expect(getEventBarDateLabel(eventWith([{ startDate: "2026-07-10" }]))).toBe(
      "2026-07-10",
    );
  });

  it("resolves conflicting date keys as date > start > startDate", () => {
    expect(
      getEventBarDateLabel(
        eventWith([
          { date: "2026-07-10", start: "2026-07-11", startDate: "2026-07-12" },
        ]),
      ),
    ).toBe("2026-07-10");
    expect(
      getEventBarDateLabel(
        eventWith([{ start: "2026-07-11", startDate: "2026-07-12" }]),
      ),
    ).toBe("2026-07-11");
  });

  it("only reads the first period", () => {
    expect(
      getEventBarDateLabel(
        eventWith([{ startTime: "09:00" }, { date: "2026-07-10" }]),
      ),
    ).toBeNull();
  });
});

describe("getEventPrimaryDateLabel", () => {
  it("prompts for scheduling when the event has no periods", () => {
    expect(getEventPrimaryDateLabel(eventWith([]))).toBe(
      "Choose dates and schedule blocks",
    );
  });

  it("falls back when the first period has no date", () => {
    expect(getEventPrimaryDateLabel(eventWith([{ startTime: "09:00" }]))).toBe(
      "Schedule details not finalized",
    );
  });

  it("formats date with a time range", () => {
    expect(
      getEventPrimaryDateLabel(
        eventWith([
          { date: "2026-07-10", startTime: "09:00", endTime: "17:00" },
        ]),
      ),
    ).toBe("2026-07-10 - 09:00 to 17:00");
  });

  it("formats date with a start time only", () => {
    expect(
      getEventPrimaryDateLabel(
        eventWith([{ date: "2026-07-10", startTime: "09:00" }]),
      ),
    ).toBe("2026-07-10 - 09:00");
  });
});

// Both labels resolve the period schedule through the same helper; these
// tests pin that alignment so the events list and the event bar cannot show
// different dates for the same legacy document.
describe("period-key alignment between list and event-bar labels", () => {
  const legacyPeriods: Array<Record<string, string>> = [
    { start: "2026-07-11" },
    { startDate: "2026-07-12" },
    { date: "2026-07-10", start: "2026-07-11", startDate: "2026-07-12" },
    { date: "2026-07-10", start_time: "09:00", end_time: "17:00" },
  ];

  it.each(legacyPeriods.map((period) => [period]))(
    "picks the same date for period %o",
    (period) => {
      const event = eventWith([period]);
      const primary = getEventPrimaryDateLabel(event);
      const bar = getEventBarDateLabel(event);

      expect(bar).not.toBeNull();
      // The primary label always starts with the resolved date; the bar label
      // must start with the same date.
      const resolvedDate = primary.split(" - ")[0];
      expect(bar!.startsWith(resolvedDate)).toBe(true);
    },
  );
});

describe("getInitials", () => {
  it("takes the first letter of the first two words, uppercased", () => {
    expect(getInitials("Annual gala")).toBe("AG");
  });

  it("ignores extra words and blank segments", () => {
    expect(getInitials("  one   two three ")).toBe("OT");
  });

  it("returns a single initial for one word", () => {
    expect(getInitials("Summit")).toBe("S");
  });

  it("returns an empty string for blank input", () => {
    expect(getInitials("   ")).toBe("");
  });
});
