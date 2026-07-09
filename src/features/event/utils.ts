import type { EventDoc, WithId } from "@/types/collection";

// Returns true if the event has at least one period or registration window that
// has not yet ended (i.e. ongoing or in the future).
// If no end dates can be found, the event is treated as eligible — we cannot
// prove it ended.
export function isEventOngoingOrFuture(
  event: Pick<EventDoc, "periods" | "registrationPeriod">,
  now: Date = new Date(),
): boolean {
  const endDates: Date[] = [];

  for (const period of event.periods) {
    const endDate = period.endDate;
    const endTime = period.endTime ?? "23:59";
    if (endDate) {
      const d = new Date(`${endDate}T${endTime}`);
      if (!isNaN(d.getTime())) endDates.push(d);
    }
  }

  if (event.registrationPeriod?.endDate) {
    const endTime = event.registrationPeriod.endTime ?? "23:59";
    const d = new Date(`${event.registrationPeriod.endDate}T${endTime}`);
    if (!isNaN(d.getTime())) endDates.push(d);
  }

  if (endDates.length === 0) return true;
  return endDates.some((d) => d >= now);
}

export interface SerializedTimestamp {
  seconds: number | null;
  nanoseconds: number | null;
  isoString: string | null;
}

export type SerializedEvent = Omit<
  WithId<EventDoc>,
  "createdAt" | "updatedAt"
> & {
  createdAt: SerializedTimestamp | null;
  updatedAt: SerializedTimestamp | null;
};

export function buildOrganizationEventPath(organizationId: string) {
  return `Organization/${organizationId}`;
}

export function buildOrganizationPathCandidates(organizationId: string) {
  return [
    buildOrganizationEventPath(organizationId),
    `organization/${organizationId}`,
    `/organization/${organizationId}`,
    `organizations/${organizationId}`,
    `/organizations/${organizationId}`,
  ];
}

export function extractOrganizationIdFromPath(path: string | undefined) {
  if (!path) {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

export function eventBelongsToOrganization(
  event: Pick<EventDoc, "organizationPath">,
  organizationId: string,
) {
  return buildOrganizationPathCandidates(organizationId).includes(
    event.organizationPath,
  );
}

type EventPeriod = EventDoc["periods"][number];

// Legacy event docs stored the first period's schedule under several key
// spellings (`date`/`start`/`startDate`, camelCase vs snake_case times).
// Every date-label helper resolves through this single function so the events
// list and the event bar can never disagree on which keys win.
function resolvePeriodSchedule(period: EventPeriod) {
  return {
    date: period.date ?? period.start ?? period.startDate ?? null,
    startTime: period.startTime ?? period.start_time ?? null,
    endTime: period.endTime ?? period.end_time ?? null,
  };
}

export function getEventPrimaryDateLabel(event: Pick<EventDoc, "periods">) {
  const firstPeriod = event.periods[0];

  if (!firstPeriod) {
    return "Choose dates and schedule blocks";
  }

  const { date, startTime, endTime } = resolvePeriodSchedule(firstPeriod);

  if (date && startTime && endTime) {
    return `${date} - ${startTime} to ${endTime}`;
  }

  if (date && startTime) {
    return `${date} - ${startTime}`;
  }

  if (date) {
    return date;
  }

  return "Schedule details not finalized";
}

// Builds the event-bar meta label: "date, start – end · timezone".
// Returns null when the first period has no usable date so the bar can omit
// the segment (and its separator) entirely.
export function getEventBarDateLabel(
  event: Pick<EventDoc, "periods" | "timezone">,
): string | null {
  const firstPeriod = event.periods[0];

  if (!firstPeriod) {
    return null;
  }

  const { date, startTime, endTime } = resolvePeriodSchedule(firstPeriod);

  if (!date) {
    return null;
  }

  let label = date;

  if (startTime && endTime) {
    label += `, ${startTime} – ${endTime}`;
  } else if (startTime) {
    label += `, ${startTime}`;
  }

  const timezone = event.timezone?.trim();

  return timezone ? `${label} · ${timezone}` : label;
}

export function sortEventsByUpdatedAt(events: WithId<EventDoc>[]) {
  return [...events].sort((left, right) => {
    const leftSeconds =
      typeof left.updatedAt === "object" &&
      left.updatedAt !== null &&
      "seconds" in left.updatedAt
        ? Number(left.updatedAt.seconds)
        : 0;
    const rightSeconds =
      typeof right.updatedAt === "object" &&
      right.updatedAt !== null &&
      "seconds" in right.updatedAt
        ? Number(right.updatedAt.seconds)
        : 0;

    return rightSeconds - leftSeconds;
  });
}

function serializeTimestamp(
  value: EventDoc["createdAt"] | EventDoc["updatedAt"],
): SerializedTimestamp | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const seconds = "seconds" in value ? Number(value.seconds) : null;
  const nanoseconds = "nanoseconds" in value ? Number(value.nanoseconds) : null;
  const isoString =
    typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate().toISOString()
      : seconds !== null
        ? new Date(seconds * 1000).toISOString()
        : null;

  return {
    seconds,
    nanoseconds,
    isoString,
  };
}

export function serializeEvent(event: WithId<EventDoc>): SerializedEvent {
  return {
    ...event,
    createdAt: serializeTimestamp(event.createdAt),
    updatedAt: serializeTimestamp(event.updatedAt),
  };
}

export function serializeEvents(events: WithId<EventDoc>[]) {
  return events.map(serializeEvent);
}
