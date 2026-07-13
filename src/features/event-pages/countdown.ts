// Pure countdown target/tick logic for the M4 CountdownTimer block.
// No Firebase, no Date.now() — everything takes explicit instants so the
// component stays hydration-safe (M4 AC-12) and the rules are unit testable.
//
// Target resolution (M4 AC-9/10):
// - target=eventStart → the event doc's start instant (resolved server-side
//   per request, so rescheduling follows without a republish);
// - target=custom → the block's customDateTime string; offset-less
//   datetime-local values are interpreted in the EVENT timezone (never the
//   executing environment's — see parseCustomTargetMs); invalid or
//   unparseable → falls back to event start; no event start either → null,
//   which callers render as the completedMessage.

import {
  eventLocalDateTimeToUtcMs,
  resolveEventTimeZone,
} from "@/features/registration/utils";

export type CountdownTargetMode = "eventStart" | "custom";

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function parseInstantMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

// The editor's <input type="datetime-local"> emits offset-less strings like
// "2026-09-15T09:00[:SS[.mmm]]". Per the ES spec, Date.parse would interpret
// those in the EXECUTING environment's timezone — a different instant on the
// server vs. each visitor's browser (hydration mismatch, wrong countdown).
const OFFSETLESS_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.\d{1,3})?$/;

// Custom target parsing: offset-less wall clocks resolve in the EVENT
// timezone (DST-safe via eventLocalDateTimeToUtcMs); strings carrying an
// explicit offset/Z keep using Date.parse (deterministic everywhere).
function parseCustomTargetMs(value: unknown, timezone: string): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const offsetless = OFFSETLESS_DATE_TIME.exec(trimmed);
  if (offsetless) {
    return eventLocalDateTimeToUtcMs(
      offsetless[1],
      offsetless[2],
      resolveEventTimeZone(timezone),
    );
  }

  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

// The event's start instant from its first period (legacy key spellings
// included, mirroring resolvePeriodSchedule in features/event/utils). No
// usable date → null.
export function resolveEventStartMs(event: {
  periods: Array<Record<string, string>>;
  timezone: string;
}): number | null {
  const period = event.periods[0];
  if (!period) return null;

  const date = period.date ?? period.start ?? period.startDate ?? null;
  if (!date) return null;

  const time = period.startTime ?? period.start_time ?? "00:00";
  const timeZone = resolveEventTimeZone(event.timezone);

  return (
    eventLocalDateTimeToUtcMs(date, time, timeZone) ??
    eventLocalDateTimeToUtcMs(date, "00:00", timeZone)
  );
}

// AC-10: custom invalid/unparseable → event start; no event start → null.
// `timezone` anchors offset-less custom values to the event's wall clock so
// the resolved instant is identical on server and client (AC-12).
export function resolveCountdownTargetMs(input: {
  target: string;
  customDateTime: string;
  eventStartIso: string | null;
  timezone: string;
}): number | null {
  // eventStartIso is always a full "Z" ISO string (server builds it via
  // toISOString), so parseInstantMs stays environment-independent here.
  const eventStartMs = parseInstantMs(input.eventStartIso);
  if (input.target === "custom") {
    return (
      parseCustomTargetMs(input.customDateTime, input.timezone) ?? eventStartMs
    );
  }
  return eventStartMs;
}

// Remaining time split into display units. Returns null once the target is
// reached or passed (remaining <= 0) — the caller swaps in completedMessage;
// negative numbers can never render (AC-11).
export function diffCountdown(
  targetMs: number,
  nowMs: number,
): CountdownParts | null {
  const remainingMs = targetMs - nowMs;
  if (remainingMs <= 0) return null;

  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

// Absolute target line under the tiles: "September 15, 2026 · 9:00 AM".
// Fixed locale + explicit timezone → deterministic between server and client.
export function formatCountdownTarget(
  targetMs: number,
  timezone: string,
): string {
  const timeZone = resolveEventTimeZone(timezone);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(targetMs));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(targetMs));
  return `${date} · ${time}`;
}
