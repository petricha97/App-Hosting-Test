import type { EventDoc, WithId } from "@/types/collection";

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

export function eventBelongsToOrganization(
  event: Pick<EventDoc, "organizationPath">,
  organizationId: string,
) {
  return buildOrganizationPathCandidates(organizationId).includes(
    event.organizationPath,
  );
}

export function getEventPrimaryDateLabel(event: Pick<EventDoc, "periods">) {
  const firstPeriod = event.periods[0];

  if (!firstPeriod) {
    return "Choose dates and schedule blocks";
  }

  const date = firstPeriod.date ?? firstPeriod.start ?? firstPeriod.startDate;
  const startTime = firstPeriod.startTime ?? firstPeriod.start_time;
  const endTime = firstPeriod.endTime ?? firstPeriod.end_time;

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
