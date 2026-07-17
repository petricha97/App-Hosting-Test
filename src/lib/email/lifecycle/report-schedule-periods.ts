// Pure calendar math for the M7-T3 `ReportSchedule` "next/due periods"
// computation (spec agents/docs/specs/m7-scheduled-reports.md D3/D4). NO
// Firebase imports — reuses ONLY the already-shipped, DST-safe event-local
// <-> UTC conversion helpers from src/features/registration/utils.ts (T2's
// exact `trigger.at` materialization helpers, per D3's own instruction to
// extend rather than fork them). Safe to import from client code too (a
// future "fires next on <date>" preview in the schedule dialog would reuse
// this verbatim) — hence no "server-only" marker.
//
// `periodKey` is a DETERMINISTIC string computed from the schedule's own
// config + a calendar instant, never a random id and never separately
// persisted as "already fired" state (spec D3):
//   - daily   -> the event-local calendar date, "YYYY-MM-DD".
//   - weekly  -> the event-local calendar date of that week's configured
//                dayOfWeek occurrence, "YYYY-MM-DD".
//   - monthly -> "YYYY-MM" (the clamped day is a fixed function of the
//                month, so the month alone is a sufficient, unambiguous key).
//
// Monthly clamping (D3, stated explicitly): dayOfMonth 31 fires on the last
// REAL day of a shorter month (min(dayOfMonth, daysInMonth)) — Feb 28/29,
// never silently skipped, never rolled to March 1.
import {
  eventLocalDateTimeToUtcMs,
  utcToEventLocalDate,
} from "@/features/registration/utils";
import type { ReportScheduleFrequency } from "@/types/collection";

export interface ReportSchedulePeriod {
  periodKey: string;
  dueMs: number;
}

export interface ResolveDueReportSchedulePeriodsInput {
  frequency: ReportScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  minute: number;
  timeZone: string;
  nowMs: number;
  // D4's second floor: never backfill a period that predates the
  // schedule's own existence — pass schedule.createdAt (as ms).
  notBeforeMs: number;
  // D4's `MAX_CATCHUP_PERIODS` ceiling — caller-supplied so this pure
  // module never hardcodes the policy constant (src/lib/db/
  // reportScheduleSchemas.ts owns the real value).
  maxPeriods: number;
}

interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatYmd(date: CalendarDate): string {
  return `${date.y}-${pad2(date.m)}-${pad2(date.d)}`;
}

function formatYm(date: Pick<CalendarDate, "y" | "m">): string {
  return `${date.y}-${pad2(date.m)}`;
}

function parseYmd(value: string): CalendarDate {
  const [y, m, d] = value.split("-").map(Number);
  return { y, m, d };
}

// Pure calendar-day arithmetic — treats (y, m, d) as a CALENDAR object, not
// a real instant (no timezone/DST involved here; that conversion happens
// only once, at the very end, via eventLocalDateTimeToUtcMs).
function addCalendarDays(date: CalendarDate, deltaDays: number): CalendarDate {
  const utc = new Date(Date.UTC(date.y, date.m - 1, date.d));
  utc.setUTCDate(utc.getUTCDate() + deltaDays);
  return {
    y: utc.getUTCFullYear(),
    m: utc.getUTCMonth() + 1,
    d: utc.getUTCDate(),
  };
}

function calendarDayOfWeek(date: CalendarDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  // Day 0 of the NEXT month == the last day of THIS month.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Integer-index month arithmetic (never JS's `%`, which is sign-preserving
// and wrong for negative deltas) — same technique as every other
// month-rollover computation in this codebase's date helpers.
function addCalendarMonths(
  date: Pick<CalendarDate, "y" | "m">,
  deltaMonths: number,
): { y: number; m: number } {
  const index = date.y * 12 + (date.m - 1) + deltaMonths;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return { y, m };
}

function candidateForIndex(
  input: ResolveDueReportSchedulePeriodsInput,
  today: CalendarDate,
  i: number,
): { date: CalendarDate; periodKey: string } {
  if (input.frequency === "daily") {
    const date = addCalendarDays(today, -i);
    return { date, periodKey: formatYmd(date) };
  }

  if (input.frequency === "weekly") {
    const dow = input.dayOfWeek ?? 0;
    const todayDow = calendarDayOfWeek(today);
    const backToThisWeeksOccurrence = (todayDow - dow + 7) % 7;
    const date = addCalendarDays(today, -(backToThisWeeksOccurrence + i * 7));
    return { date, periodKey: formatYmd(date) };
  }

  // monthly
  const dom = input.dayOfMonth ?? 1;
  const { y, m } = addCalendarMonths(today, -i);
  const clampedDay = Math.min(dom, daysInMonth(y, m));
  const date: CalendarDate = { y, m, d: clampedDay };
  return { date, periodKey: formatYm(date) };
}

// Returns due periods NEWEST-FIRST (i=0 is "today"'s occurrence), bounded to
// AT MOST `maxPeriods` entries, never earlier than `notBeforeMs`, never
// later than `nowMs`. Callers that need chronological send order (D4's
// "period N before period N+1" contract) should reverse the result — this
// function deliberately stays order-agnostic so both a caller-facing
// "next 3 fires" preview and the evaluator's oldest-first send loop can
// reuse it unmodified.
export function resolveDueReportSchedulePeriods(
  input: ResolveDueReportSchedulePeriodsInput,
): ReportSchedulePeriod[] {
  const today = parseYmd(utcToEventLocalDate(input.nowMs, input.timeZone));
  const timeStr = `${pad2(input.hour)}:${pad2(input.minute)}`;

  // A small, fixed safety margin above maxPeriods: at most ONE extra
  // candidate is ever needed (today's own occurrence, when not yet due) —
  // the +2 margin is deliberately generous so a future caller tweak here
  // can never silently reintroduce an infinite loop.
  const maxCandidates = input.maxPeriods + 2;
  const periods: ReportSchedulePeriod[] = [];

  for (
    let i = 0;
    i < maxCandidates && periods.length < input.maxPeriods;
    i += 1
  ) {
    const { date, periodKey } = candidateForIndex(input, today, i);
    const dueMs = eventLocalDateTimeToUtcMs(
      formatYmd(date),
      timeStr,
      input.timeZone,
    );
    if (dueMs === null) continue; // defensive — cannot happen for valid inputs

    if (dueMs > input.nowMs) continue; // not due yet (only possible at i===0)
    if (dueMs < input.notBeforeMs) break; // D4 floor: predates the schedule itself

    periods.push({ periodKey, dueMs });
  }

  return periods;
}
