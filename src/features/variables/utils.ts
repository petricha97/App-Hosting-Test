import type {
  EventDoc,
  OrganizationDoc,
  VariableDoc,
  VariableScope,
  WithId,
} from "@/types/collection";
import { normalizeVariableKey } from "@/features/variables/schema";

export const ORGANIZATION_BUILT_IN_VARIABLE_KEYS = ["ORGANIZATION_NAME"] as const;
export const EVENT_BUILT_IN_VARIABLE_KEYS = [
  "EVENT_NAME",
  "EVENT_STATUS",
  "EVENT_START_DATE",
  "EVENT_END_DATE",
  "EVENT_TIMEZONE",
] as const;

export const RESERVED_VARIABLE_KEYS = new Set<string>([
  ...ORGANIZATION_BUILT_IN_VARIABLE_KEYS,
  ...EVENT_BUILT_IN_VARIABLE_KEYS,
]);

export interface SerializedVariable {
  id: string;
  scope: VariableScope;
  eventId: string | null;
  key: string;
  token: string;
  value: string;
  description: string;
  updatedAtIso: string | null;
  updatedAtLabel: string;
}

export interface BuiltInVariable {
  id: string;
  scope: VariableScope;
  key: string;
  token: string;
  value: string;
  description: string;
  source: "system";
}

export interface VariableResolutionResult {
  output: string;
  unknownKeys: string[];
}

function serializeTimestamp(
  value: VariableDoc["updatedAt"] | VariableDoc["createdAt"],
): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if ("seconds" in value) {
    return new Date(Number(value.seconds) * 1000).toISOString();
  }

  return null;
}

export function formatVariableUpdatedAt(isoString: string | null) {
  if (!isoString) {
    return "Updated recently";
  }

  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

export function buildVariableToken(key: string) {
  return `{{${key}}}`;
}

export function serializeVariable(variable: WithId<VariableDoc>): SerializedVariable {
  const updatedAtIso = serializeTimestamp(variable.updatedAt);

  return {
    id: variable.id,
    scope: variable.scope,
    eventId: variable.eventId ?? null,
    key: variable.key,
    token: buildVariableToken(variable.key),
    value: variable.value,
    description: variable.description ?? "",
    updatedAtIso,
    updatedAtLabel: formatVariableUpdatedAt(updatedAtIso),
  };
}

export function sortVariables(variables: WithId<VariableDoc>[]) {
  return [...variables].sort((left, right) => {
    const leftIso = serializeTimestamp(left.updatedAt);
    const rightIso = serializeTimestamp(right.updatedAt);
    return (rightIso ? Date.parse(rightIso) : 0) - (leftIso ? Date.parse(leftIso) : 0);
  });
}

function resolvePeriodDate(period: EventDoc["periods"][number]) {
  return {
    startDate: period.startDate ?? period.start ?? period.date ?? null,
    endDate: period.endDate ?? period.startDate ?? period.start ?? period.date ?? null,
  };
}

function getEventStartDate(event: Pick<EventDoc, "periods">) {
  const firstPeriod = event.periods[0];
  if (!firstPeriod) return "";
  return resolvePeriodDate(firstPeriod).startDate ?? "";
}

function getEventEndDate(event: Pick<EventDoc, "periods">) {
  const lastPeriod = event.periods[event.periods.length - 1];
  if (!lastPeriod) return "";
  return resolvePeriodDate(lastPeriod).endDate ?? "";
}

export function buildOrganizationBuiltInVariables(
  organization: Pick<OrganizationDoc, "name"> | null | undefined,
): BuiltInVariable[] {
  return [
    {
      id: "system:organization_name",
      scope: "organization",
      key: "ORGANIZATION_NAME",
      token: "{{ORGANIZATION_NAME}}",
      value: organization?.name ?? "",
      description: "The active organization name.",
      source: "system",
    },
  ];
}

export function buildEventBuiltInVariables(
  event:
    | (Pick<EventDoc, "name" | "timezone" | "periods"> &
        Partial<Pick<EventDoc, "status">>)
    | null
    | undefined,
): BuiltInVariable[] {
  return [
    {
      id: "system:event_name",
      scope: "event",
      key: "EVENT_NAME",
      token: "{{EVENT_NAME}}",
      value: event?.name ?? "",
      description: "The current event name.",
      source: "system",
    },
    {
      id: "system:event_status",
      scope: "event",
      key: "EVENT_STATUS",
      token: "{{EVENT_STATUS}}",
      value: event?.status ?? "",
      description: "The current event status.",
      source: "system",
    },
    {
      id: "system:event_start_date",
      scope: "event",
      key: "EVENT_START_DATE",
      token: "{{EVENT_START_DATE}}",
      value: event ? getEventStartDate(event) : "",
      description: "The first scheduled event date.",
      source: "system",
    },
    {
      id: "system:event_end_date",
      scope: "event",
      key: "EVENT_END_DATE",
      token: "{{EVENT_END_DATE}}",
      value: event ? getEventEndDate(event) : "",
      description: "The last scheduled event date.",
      source: "system",
    },
    {
      id: "system:event_timezone",
      scope: "event",
      key: "EVENT_TIMEZONE",
      token: "{{EVENT_TIMEZONE}}",
      value: event?.timezone ?? "",
      description: "The event timezone.",
      source: "system",
    },
  ];
}

interface ResolveVariablesInput {
  text: string;
  organizationVariables?: Array<Pick<SerializedVariable, "key" | "value">>;
  eventVariables?: Array<Pick<SerializedVariable, "key" | "value">>;
  organizationBuiltIns?: Array<Pick<BuiltInVariable, "key" | "value">>;
  eventBuiltIns?: Array<Pick<BuiltInVariable, "key" | "value">>;
}

const VARIABLE_TOKEN_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_\s-]*)\s*\}\}/g;

export function resolveVariables({
  text,
  organizationVariables = [],
  eventVariables = [],
  organizationBuiltIns = [],
  eventBuiltIns = [],
}: ResolveVariablesInput): VariableResolutionResult {
  const values = new Map<string, string>();

  for (const entry of organizationBuiltIns) values.set(entry.key, entry.value);
  for (const entry of eventBuiltIns) values.set(entry.key, entry.value);
  for (const entry of organizationVariables) values.set(entry.key, entry.value);
  for (const entry of eventVariables) values.set(entry.key, entry.value);

  const unknownKeys = new Set<string>();
  const output = text.replace(VARIABLE_TOKEN_PATTERN, (match, rawKey: string) => {
    const key = normalizeVariableKey(rawKey);
    if (!values.has(key)) {
      unknownKeys.add(key);
      return match;
    }
    return values.get(key) ?? "";
  });

  return {
    output,
    unknownKeys: [...unknownKeys],
  };
}
