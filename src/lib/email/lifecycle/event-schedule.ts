// Catch-up-window cutoff for the §5 `scheduled` trigger (spec
// agents/docs/specs/m6-lifecycle-triggers.md §5): "this catch-up stops at
// the event's first period start — reusing the existing
// firstPeriodDate/resolveEventTimeZone helpers ... never forked."
//
// This module reuses BOTH exactly: firstPeriodDate is now exported from
// src/features/emails/default-definitions.ts (T2's virtual-catalog module)
// for this one purpose, and resolveEventTimeZone is already exported from
// src/features/registration/utils.ts. The cutoff is midnight event-local on
// the first period's date — the day the event starts, not a specific
// start-of-day time (the periods shape does not reliably carry a start time
// across legacy key spellings; §5 only asks for "first period start", and a
// day-level boundary is the honest, defensible reading given the available
// data — see data-model doc for the full rationale).
import "server-only";

import { firstPeriodDate } from "@/features/emails/default-definitions";
import {
  eventLocalDateToUtcMs,
  resolveEventTimeZone,
} from "@/features/registration/utils";
import type { EventDoc } from "@/types/collection";

export type EventScheduleInput = Pick<EventDoc, "periods" | "timezone">;

// Returns the UTC-ms instant of the event's first period start (midnight
// event-local on that date), or null when the event has no periods to
// derive one from — a null cutoff means "no catch-up boundary", matching
// spec §5's own note ("an event with no periods... has no catch-up
// cutoff — acceptable, since such an event also can't have a derived
// scheduled `at` in the first place").
export function resolveEventFirstPeriodStartMs(
  event: EventScheduleInput | null | undefined,
): number | null {
  const date = firstPeriodDate(event);
  if (!date) return null;

  const timeZone = resolveEventTimeZone(event?.timezone);
  return eventLocalDateToUtcMs(date, timeZone, "start");
}
