// The eight default lifecycle emails (spec §2 catalog) — VIRTUAL, never
// seeded to Firestore (Shared decisions: "Default email set is virtual, not
// seeded"). A fresh event has zero EmailDefinition docs; the list screen
// merges stored docs (src/lib/db/adminEmailDefinition.ts) over this in-code
// catalog by `kind`, and a doc is materialized only on first edit.
//
// PURE module — no Firebase, no network I/O — but transitively SERVER-ONLY
// via its merge-tags.ts import (that module is marked "server-only", and
// emailDefinitionId uses node:crypto) — import only from the server page /
// API routes, never from a "use client" component; client components
// receive the merged, SERIALIZED SerializedEmailDefinition[] as props
// instead. Every template tag used below must exist in the T1 catalog
// (src/lib/email/merge-tags.ts) — verified by a unit test.
import { emailDefinitionId } from "@/lib/db/emailDefinitionId";
import { EMAIL_MERGE_TAGS } from "@/lib/email/merge-tags";
import {
  eventLocalDateTimeToUtcMs,
  resolveEventTimeZone,
} from "@/features/registration/utils";
import type {
  SerializedEmailDefinition,
  SerializedEmailDefinitionTrigger,
} from "@/features/emails/types";
import type {
  EmailDefinitionAudience,
  EmailDefinitionDoc,
  EmailDefinitionGroup,
  EventDoc,
  WithId,
} from "@/types/collection";

// ---------------------------------------------------------------------------
// Scheduled-trigger date derivation ("event start - N days, HH:MM event tz")
// ---------------------------------------------------------------------------

type DefaultTriggerSpec =
  | { type: "manual" }
  | { type: "on-submit" }
  | { type: "on-accept" }
  | { type: "abandoned-24h" }
  | { type: "unpaid-offsets"; offsetsDays: number[] }
  | {
      type: "scheduled-before-start";
      offsetDays: number;
      hour: number;
      minute: number;
    };

export interface EmailDefaultDefinition {
  kind: string;
  name: string;
  group: EmailDefinitionGroup;
  audience: EmailDefinitionAudience;
  triggerSpec: DefaultTriggerSpec;
  subject: string;
  body: string;
  sortOrder: number;
}

type EventScheduleInput =
  Pick<EventDoc, "periods" | "timezone"> | null | undefined;

// Legacy-tolerant first-period date lookup — same key fallbacks as
// src/features/event/utils.ts's resolvePeriodSchedule (not exported there,
// duplicated narrowly here rather than widening that module's surface).
// EXPORTED (M6-T3 addition): the lifecycle-trigger evaluator's "scheduled"
// catch-up cutoff (spec agents/docs/specs/m6-lifecycle-triggers.md §5 —
// "stops at the event's first period start") reuses this EXACT helper
// rather than forking a second first-period lookup.
export function firstPeriodDate(event: EventScheduleInput): string | null {
  const period = event?.periods?.[0];
  if (!period) return null;
  return period.date ?? period.start ?? period.startDate ?? null;
}

function subtractCalendarDays(date: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const shifted = new Date(ms - days * 24 * 60 * 60 * 1000);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Resolves a "scheduled-before-start" spec to a concrete Date, or null when
// the event has no periods to derive a date from (spec §1 AC-3 "Not
// scheduled" — never a crash).
export function resolveScheduledDefaultAt(
  event: EventScheduleInput,
  spec: { offsetDays: number; hour: number; minute: number },
): Date | null {
  const startDate = firstPeriodDate(event);
  if (!startDate) return null;

  const shiftedDate = subtractCalendarDays(startDate, spec.offsetDays);
  if (!shiftedDate) return null;

  const timeZone = resolveEventTimeZone(event?.timezone);
  const hh = String(spec.hour).padStart(2, "0");
  const mm = String(spec.minute).padStart(2, "0");

  const ms = eventLocalDateTimeToUtcMs(shiftedDate, `${hh}:${mm}`, timeZone);
  return ms === null ? null : new Date(ms);
}

function resolveTrigger(
  spec: DefaultTriggerSpec,
  event: EventScheduleInput,
): SerializedEmailDefinitionTrigger {
  if (spec.type === "scheduled-before-start") {
    const at = resolveScheduledDefaultAt(event, spec);
    return { type: "scheduled", atMs: at ? at.getTime() : null };
  }
  return spec;
}

// ---------------------------------------------------------------------------
// The eight defaults (spec §2 table) — subject/body use ONLY T1 catalog tags
// (verified by a unit test against EMAIL_MERGE_TAGS).
// ---------------------------------------------------------------------------

export const EMAIL_DEFAULT_DEFINITIONS: EmailDefaultDefinition[] = [
  {
    kind: "invitation",
    name: "Invitation",
    group: "pre-event",
    audience: "all-invitees",
    triggerSpec: { type: "manual" },
    subject: "You're invited — {event_title}",
    body:
      "Dear {first_name},\n\nYou're invited to {event_title} on {event_date}. " +
      "Register here: {event_url}\n\nWe hope to see you there.",
    sortOrder: 0,
  },
  {
    kind: "abandoned-reminder",
    name: "Abandoned registration reminder",
    group: "pre-event",
    audience: "abandoned",
    triggerSpec: { type: "abandoned-24h" },
    subject: "Finish your registration for {event_title}",
    body:
      "Dear {first_name},\n\nWe noticed you started registering for " +
      "{event_title} but didn't finish. Pick up where you left off: " +
      "{event_url}",
    sortOrder: 1,
  },
  {
    kind: "approval-pending",
    name: "Approval pending notification",
    group: "post-registration",
    audience: "pending-approval",
    triggerSpec: { type: "on-submit" },
    subject: "Your registration for {event_title} is under review",
    body:
      "Dear {first_name},\n\nThanks for registering for {event_title}. " +
      "Your submission is under review — we'll email you as soon as it's " +
      "approved.",
    sortOrder: 2,
  },
  {
    kind: "confirmation-paid",
    name: "Registration confirmation — paid",
    group: "post-registration",
    audience: "accepted-paid",
    triggerSpec: { type: "on-accept" },
    subject: "Registration confirmed — {event_title}",
    body:
      "Dear {first_name},\n\nYour registration for {event_title} is " +
      "confirmed. Your pass: {ticket_name}.\n\n{qr_code}\n\nDelegate " +
      "check-in QR — please have it ready at the venue on {event_date}.",
    sortOrder: 3,
  },
  {
    kind: "confirmation-payment-due",
    name: "Registration confirmation — payment due",
    group: "post-registration",
    audience: "accepted-invoice",
    triggerSpec: { type: "on-accept" },
    subject: "Registration confirmed — payment due — {event_title}",
    body:
      "Dear {first_name},\n\nYour registration for {event_title} is " +
      "confirmed. Your pass: {ticket_name}. An invoice for {order_total} " +
      "is on its way — payment status: {payment_status}.\n\n{qr_code}",
    sortOrder: 4,
  },
  {
    kind: "payment-reminder",
    name: "Payment reminder 1–3",
    group: "debt-chase",
    audience: "accepted-invoice",
    triggerSpec: { type: "unpaid-offsets", offsetsDays: [7, 14, 21] },
    subject: "Payment reminder — {event_title}",
    body:
      "Dear {first_name},\n\nThis is a reminder that {order_total} is " +
      "still due for your registration to {event_title}. Current status: " +
      "{payment_status}.",
    sortOrder: 5,
  },
  {
    kind: "one-week-to-go",
    name: "One week to go",
    group: "debt-chase",
    audience: "accepted-all",
    triggerSpec: {
      type: "scheduled-before-start",
      offsetDays: 7,
      hour: 9,
      minute: 0,
    },
    subject: "One week to go — {event_title}",
    body:
      "Dear {first_name},\n\n{event_title} is one week away, on " +
      "{event_date}. We can't wait to see you there.",
    sortOrder: 6,
  },
  {
    kind: "qr-ready",
    name: "Have your QR code ready",
    group: "debt-chase",
    audience: "accepted-all",
    triggerSpec: {
      type: "scheduled-before-start",
      offsetDays: 1,
      hour: 9,
      minute: 0,
    },
    subject: "Have your QR code ready — {event_title}",
    body:
      "Dear {first_name},\n\n{event_title} is tomorrow. Have your QR code " +
      "ready for check-in:\n\n{qr_code}",
    sortOrder: 7,
  },
];

const DEFAULT_BY_KIND = new Map(
  EMAIL_DEFAULT_DEFINITIONS.map((definition) => [definition.kind, definition]),
);

export function isDefaultEmailKind(kind: string): boolean {
  return DEFAULT_BY_KIND.has(kind);
}

export function getDefaultEmailDefinition(
  kind: string,
): EmailDefaultDefinition | undefined {
  return DEFAULT_BY_KIND.get(kind);
}

// The "ifAbsent" shape upsertAdminEmailDefinition needs to materialize a
// system default's first edit — sourced from the catalog UNCONDITIONALLY on
// every edit call (data-model note: "ifAbsent must be supplied on every edit
// call, not just the first one").
export function defaultDefinitionIfAbsent(
  kind: string,
  event: EventScheduleInput,
): {
  name: string;
  group: EmailDefinitionGroup;
  trigger:
    | { type: "manual" }
    | { type: "on-submit" }
    | { type: "on-accept" }
    | { type: "abandoned-24h" }
    | { type: "unpaid-offsets"; offsetsDays: number[] }
    | { type: "scheduled"; at: Date | null };
  audience: EmailDefinitionAudience;
  enabled: boolean;
  subject: string;
  body: string;
  sortOrder: number;
} | null {
  const entry = DEFAULT_BY_KIND.get(kind);
  if (!entry) return null;

  const trigger =
    entry.triggerSpec.type === "scheduled-before-start"
      ? {
          type: "scheduled" as const,
          at: resolveScheduledDefaultAt(event, entry.triggerSpec),
        }
      : entry.triggerSpec;

  return {
    name: entry.name,
    group: entry.group,
    trigger,
    audience: entry.audience,
    enabled: true,
    subject: entry.subject,
    body: entry.body,
    sortOrder: entry.sortOrder,
  };
}

// Converts a STORED trigger (Timestamp | FieldValue | null `at`) back to the
// Date-based draft shape `upsertAdminEmailDefinition`'s `ifAbsent.trigger`
// needs — used by the PATCH route when re-supplying an EXISTING custom
// definition's unchanged trigger alongside a patch to other fields (data-
// model note: "ifAbsent must be supplied on every edit call, not just the
// first one").
export function storedTriggerToDraft(
  trigger: EmailDefinitionDoc["trigger"],
):
  | { type: "manual" }
  | { type: "on-submit" }
  | { type: "on-accept" }
  | { type: "abandoned-24h" }
  | { type: "unpaid-offsets"; offsetsDays: number[] }
  | { type: "scheduled"; at: Date | null } {
  if (trigger.type !== "scheduled") return trigger;
  const at = trigger.at;
  if (at === null) return { type: "scheduled", at: null };
  if (typeof (at as { toDate?: () => Date }).toDate === "function") {
    return { type: "scheduled", at: (at as { toDate: () => Date }).toDate() };
  }
  return { type: "scheduled", at: null };
}

// ---------------------------------------------------------------------------
// Merge: stored docs (materialized) win over the virtual catalog by kind.
// Zero Firestore reads happen here — callers pass whatever
// listAdminEmailDefinitionsForEvent already returned (spec §1 AC-1: a fresh
// event renders the full catalog with ZERO writes).
// ---------------------------------------------------------------------------

function serializeStoredTrigger(
  trigger: EmailDefinitionDoc["trigger"],
): SerializedEmailDefinitionTrigger {
  if (trigger.type !== "scheduled") return trigger;
  const at = trigger.at;
  if (at === null) return { type: "scheduled", atMs: null };
  if (typeof (at as { toMillis?: () => number }).toMillis === "function") {
    return {
      type: "scheduled",
      atMs: (at as { toMillis: () => number }).toMillis(),
    };
  }
  return { type: "scheduled", atMs: null };
}

function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === "function") return candidate.toMillis();
  if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  return null;
}

// Exported for the definitions routes (PATCH/POST responses) so a stored
// Firestore doc is never handed to NextResponse.json raw — Timestamp
// instances don't survive JSON serialization meaningfully.
export function serializeStoredDefinition(
  doc: WithId<EmailDefinitionDoc>,
): SerializedEmailDefinition {
  return {
    id: doc.id,
    kind: doc.kind,
    name: doc.name,
    group: doc.group,
    trigger: serializeStoredTrigger(doc.trigger),
    audience: doc.audience,
    enabled: doc.enabled,
    subject: doc.subject,
    body: doc.body,
    isSystem: doc.isSystem,
    sortOrder: doc.sortOrder,
    materialized: true,
    createdAtMs: timestampToMillis(doc.createdAt),
    // M6-T4 (spec §2 AC-5): a doc written before this ticket shipped lacks
    // these fields entirely — reads as "text" / [] here, the exact same
    // "schema default proven by loading a legacy doc unmodified" pattern
    // used everywhere else in this fallback (?? defaults, no backfill).
    bodyMode: doc.bodyMode ?? "text",
    bodyBlocks: doc.bodyBlocks ?? [],
  };
}

function serializeVirtualDefault(
  entry: EmailDefaultDefinition,
  event: EventScheduleInput,
  organizationId: string,
  eventId: string,
): SerializedEmailDefinition {
  return {
    id: emailDefinitionId({ organizationId, eventId, kind: entry.kind }),
    kind: entry.kind,
    name: entry.name,
    group: entry.group,
    trigger: resolveTrigger(entry.triggerSpec, event),
    audience: entry.audience,
    enabled: true,
    subject: entry.subject,
    body: entry.body,
    isSystem: true,
    sortOrder: entry.sortOrder,
    materialized: false,
    createdAtMs: null,
    // A virtual default has never been materialized/edited — it starts in
    // Plain-text mode with an empty design, by definition (spec §2).
    bodyMode: "text",
    bodyBlocks: [],
  };
}

// Merges the virtual catalog with stored docs (stored always wins, spec §2
// AC-3), then orders each group by sortOrder then createdAt — defaults
// (sortOrder 0-7, createdAtMs null) always sort before customs (data-model
// note: "the consumer's job over this bounded page").
export function mergeEmailDefinitions(input: {
  stored: WithId<EmailDefinitionDoc>[];
  event: EventScheduleInput;
  organizationId: string;
  eventId: string;
}): SerializedEmailDefinition[] {
  const storedByKind = new Map(input.stored.map((doc) => [doc.kind, doc]));

  const merged: SerializedEmailDefinition[] = EMAIL_DEFAULT_DEFINITIONS.map(
    (entry) => {
      const stored = storedByKind.get(entry.kind);
      return stored
        ? serializeStoredDefinition(stored)
        : serializeVirtualDefault(
            entry,
            input.event,
            input.organizationId,
            input.eventId,
          );
    },
  );

  for (const doc of input.stored) {
    if (DEFAULT_BY_KIND.has(doc.kind)) continue; // already merged above
    merged.push(serializeStoredDefinition(doc));
  }

  return merged.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0);
  });
}

// Every default template uses only catalog tags — guards against a future
// edit introducing a typo'd tag into the SHIPPED defaults (tested).
export function usedDefaultTemplateTags(): string[] {
  const tagRe = /\{([a-z][a-z0-9_]*)\}/g;
  const found = new Set<string>();
  for (const entry of EMAIL_DEFAULT_DEFINITIONS) {
    for (const match of `${entry.subject}\n${entry.body}`.matchAll(tagRe)) {
      found.add(match[1]);
    }
  }
  return [...found];
}

export const EMAIL_MERGE_TAG_CATALOG = EMAIL_MERGE_TAGS;
