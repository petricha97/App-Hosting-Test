// Pure display helpers for the M7-T3 schedule dialog. No Firebase — safe
// for client components. Spec: agents/docs/specs/m7-scheduled-reports.md §3
// ("Sep 8, 9:00 ET" tz-abbreviation convention, reused from
// src/features/emails/utils.ts's formatScheduledAt for a single instant —
// this module formats a RECURRING hour/minute + weekday/day-of-month
// instead, so it can't reuse that helper directly).
import type { ReportScheduleFrequency } from "@/types/collection";

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const FREQUENCY_LABELS: Record<ReportScheduleFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// Short timezone abbreviation for "now" in the given IANA zone ("EDT",
// "PST", "GMT+8", …) — best-effort via Intl; falls back to the raw IANA
// name if the runtime can't produce a short form (never throws). A
// recurring schedule has no single instant to derive this from, so "now" is
// the only reasonable anchor (matches this app's existing tolerance for
// DST-boundary cosmetic drift, spec/design precedent).
export function currentTimeZoneAbbreviation(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return (
      parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}

// "09:00 ET" — the event-local wall-clock time a schedule fires at, spec §3.
export function formatScheduleTime(
  hour: number,
  minute: number,
  timeZone: string,
): string {
  return `${pad2(hour)}:${pad2(minute)} ${currentTimeZoneAbbreviation(timeZone)}`;
}

// "Daily at 09:00 ET" / "Weekly on Monday at 09:00 ET" / "Monthly on day 31
// at 09:00 ET" — the one-line summary shown in the schedule list (spec §1).
export function formatScheduleCadence(input: {
  frequency: ReportScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  minute: number;
  timeZone: string;
}): string {
  const time = formatScheduleTime(input.hour, input.minute, input.timeZone);
  if (input.frequency === "weekly" && input.dayOfWeek !== null) {
    return `Weekly on ${WEEKDAY_LABELS[input.dayOfWeek]} at ${time}`;
  }
  if (input.frequency === "monthly" && input.dayOfMonth !== null) {
    return `Monthly on day ${input.dayOfMonth} at ${time}`;
  }
  return `${FREQUENCY_LABELS[input.frequency]} at ${time}`;
}
