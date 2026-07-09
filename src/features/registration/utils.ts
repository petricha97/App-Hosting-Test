// Pure sales-window helpers for the M1 registration spine.
// Spec: agents/docs/specs/m1-registration-spine.md (M1-T2 sales window + Open display).
//
// No Firebase imports — safe for client components, server routes, and tests.
// Sales dates are calendar dates interpreted in the EVENT's timezone:
// salesStart = that date 00:00:00.000 event-local, salesEnd = 23:59:59.999
// event-local, persisted as UTC instants. Both boundaries are inclusive.

const SALES_START_WALL = { hour: 0, minute: 0, second: 0, ms: 0 } as const;
const SALES_END_WALL = { hour: 23, minute: 59, second: 59, ms: 999 } as const;

// Returns a usable IANA timezone, falling back to UTC when the event's
// timezone field is empty or not recognised by the runtime.
export function resolveEventTimeZone(
  timezone: string | null | undefined,
): string {
  const candidate = timezone?.trim();
  if (!candidate) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

// Offset of `timeZone` from UTC at the given instant, in milliseconds
// (positive east of UTC, e.g. Asia/Singapore -> +8h).
function getTimeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );

  // formatToParts has second precision; compare against the truncated instant
  // (real-world offsets are whole minutes anyway).
  const msWithinSecond = ((utcMs % 1000) + 1000) % 1000;
  return asUtc - (utcMs - msWithinSecond);
}

// Converts an event-local calendar date ("YYYY-MM-DD") to the UTC instant of
// that date's window boundary in the given timezone: 00:00:00.000 for "start",
// 23:59:59.999 for "end". Two-pass offset lookup so DST transitions on the
// boundary day resolve to the correct instant.
export function eventLocalDateToUtcMs(
  date: string,
  timeZone: string,
  boundary: "start" | "end",
): number {
  const [year, month, day] = date.split("-").map(Number);
  const wall = boundary === "start" ? SALES_START_WALL : SALES_END_WALL;
  const wallMs = Date.UTC(
    year,
    month - 1,
    day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms,
  );

  const firstGuess = wallMs - getTimeZoneOffsetMs(timeZone, wallMs);
  const offset = getTimeZoneOffsetMs(timeZone, firstGuess);
  return wallMs - offset;
}

// Formats a UTC instant as the event-local calendar date "YYYY-MM-DD"
// (inverse of eventLocalDateToUtcMs, used to prefill the edit dialog).
export function utcToEventLocalDate(ms: number, timeZone: string): string {
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export interface TicketOpenFields {
  isOpen: boolean;
  salesStartMs: number | null;
  salesEndMs: number | null;
}

export type TicketOpenState =
  | "open"
  | "closed-manual"
  | "not-started"
  | "ended";

// Derived open state, evaluated at render — never stored (spec M1-T2).
// Manual flag wins first; window boundaries are inclusive at both ends.
export function getTicketOpenState(
  ticket: TicketOpenFields,
  now: Date | number = Date.now(),
): TicketOpenState {
  const nowMs = typeof now === "number" ? now : now.getTime();

  if (!ticket.isOpen) {
    return "closed-manual";
  }
  if (ticket.salesStartMs !== null && nowMs < ticket.salesStartMs) {
    return "not-started";
  }
  if (ticket.salesEndMs !== null && nowMs > ticket.salesEndMs) {
    return "ended";
  }
  return "open";
}

// derivedOpen = isOpen && (start == null || now >= start) && (end == null || now <= end).
export function isTicketOpen(
  ticket: TicketOpenFields,
  now: Date | number = Date.now(),
): boolean {
  return getTicketOpenState(ticket, now) === "open";
}

// "MMM D" in the event timezone, with the year appended when it differs from
// the current year (also evaluated in the event timezone).
export function formatSalesDate(
  ms: number,
  timeZone: string,
  nowMs: number = Date.now(),
): string {
  const yearOf = (instant: number) =>
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(
      new Date(instant),
    );

  const withYear = yearOf(ms) !== yearOf(nowMs);

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(new Date(ms));
}

// Sales-window cell text (spec M1-T2 AC-6):
//   both null            -> "Open"
//   now past salesEnd    -> "Closed"
//   now before salesStart-> "from {date}"
//   open with an end     -> "until {date}"
//   open with only start -> "Open"
export function getSalesWindowLabel(
  ticket: Pick<TicketOpenFields, "salesStartMs" | "salesEndMs">,
  options: { timeZone: string; nowMs?: number },
): string {
  const nowMs = options.nowMs ?? Date.now();
  const { salesStartMs, salesEndMs } = ticket;

  if (salesStartMs === null && salesEndMs === null) {
    return "Open";
  }
  if (salesEndMs !== null && nowMs > salesEndMs) {
    return "Closed";
  }
  if (salesStartMs !== null && nowMs < salesStartMs) {
    return `from ${formatSalesDate(salesStartMs, options.timeZone, nowMs)}`;
  }
  if (salesEndMs !== null) {
    return `until ${formatSalesDate(salesEndMs, options.timeZone, nowMs)}`;
  }
  return "Open";
}
