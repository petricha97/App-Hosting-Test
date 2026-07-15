// Label maps + display helpers for the M6-T2 emails screen. PURE module —
// no Firebase, safe for client components (design: "mapping owned by
// src/features/emails/utils.ts, never inline strings per-row").
import {
  eventLocalDateTimeToUtcMs,
  utcToEventLocalDate,
} from "@/features/registration/utils";
import type {
  SerializedEmailDefinition,
  SerializedEmailDefinitionTrigger,
} from "@/features/emails/types";
import type {
  EmailDefinitionAudience,
  EmailDefinitionGroup,
} from "@/types/collection";

// "YYYY-MM-DDTHH:MM" <-> event-local instant, for the editor's
// datetime-local input (design §3). "" = no date set.
export function atMsToDateTimeLocalInput(
  atMs: number | null,
  timeZone: string,
): string {
  if (atMs === null) return "";
  const date = utcToEventLocalDate(atMs, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(atMs));
  return `${date}T${time}`;
}

export function dateTimeLocalInputToAtMs(
  value: string,
  timeZone: string,
): number | null {
  if (!value.trim()) return null;
  const [date, time] = value.split("T");
  if (!date || !time) return null;
  return eventLocalDateTimeToUtcMs(date, time, timeZone);
}

export const EMAIL_GROUP_LABELS: Record<EmailDefinitionGroup, string> = {
  "pre-event": "Pre-event",
  "post-registration": "Post-registration",
  "debt-chase": "Debt chase & countdown",
};

export const EMAIL_AUDIENCE_LABELS: Record<EmailDefinitionAudience, string> = {
  "all-invitees": "All invitees",
  abandoned: "Abandoned",
  "pending-approval": "Pending approval",
  "accepted-paid": "Accepted (paid)",
  "accepted-invoice": "Accepted (invoice)",
  "accepted-all": "Accepted (all)",
};

// design §1: custom definitions restricted to Manual | Scheduled (OQ-1).
export const CUSTOM_TRIGGER_TYPE_LABELS = {
  manual: "Manual",
  scheduled: "Scheduled",
} as const;

export const EMAIL_GROUP_OPTIONS: EmailDefinitionGroup[] = [
  "pre-event",
  "post-registration",
  "debt-chase",
];

export const EMAIL_AUDIENCE_OPTIONS: EmailDefinitionAudience[] = [
  "all-invitees",
  "abandoned",
  "pending-approval",
  "accepted-paid",
  "accepted-invoice",
  "accepted-all",
];

// Short timezone abbreviation for a given instant ("EDT", "PST", "GMT+8", …)
// — best-effort via Intl; falls back to the raw IANA name if the runtime
// can't produce a short form (never throws).
function timeZoneAbbreviation(atMs: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date(atMs));
    return (
      parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}

// "Sep 8, 9:00 ET"-style label (design §1) — the tz abbreviation is
// Intl-derived (may render "EDT"/"PST"/"GMT+8" rather than the spec's
// illustrative "ET"; documented deviation, cosmetic only).
export function formatScheduledAt(atMs: number, timeZone: string): string {
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(new Date(atMs));
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(atMs));
  return `${datePart}, ${timePart} ${timeZoneAbbreviation(atMs, timeZone)}`;
}

// Canonical trigger display strings (spec §1 table). "Not scheduled" covers
// both a scheduled kind with no derivable date (no periods) AND a custom
// scheduled definition whose datetime was cleared.
export function triggerDisplayLabel(
  trigger: SerializedEmailDefinitionTrigger,
  timeZone: string,
): string {
  switch (trigger.type) {
    case "manual":
      return "Manual";
    case "on-submit":
      return "Auto · on submit";
    case "on-accept":
      return "Auto · on accept";
    case "abandoned-24h":
      return "Auto · 24h after drop-off";
    case "unpaid-offsets":
      return `Auto · +${trigger.offsetsDays.join(" / ")}d unpaid`;
    case "scheduled":
      return trigger.atMs === null
        ? "Not scheduled"
        : formatScheduledAt(trigger.atMs, timeZone);
    default:
      return "Manual";
  }
}

// Resolves a send-log row's "Email" column: the definition's name when its
// kind matches a known definition, else the raw kind chip (spec §8-4 —
// deleted/unknown kinds NEVER hide the row or crash the resolver).
export function resolveEmailDefinitionName(
  kind: string,
  definitionsByKind: ReadonlyMap<string, SerializedEmailDefinition>,
): string | null {
  return definitionsByKind.get(kind)?.name ?? null;
}

export function buildDefinitionsByKind(
  definitions: readonly SerializedEmailDefinition[],
): Map<string, SerializedEmailDefinition> {
  return new Map(
    definitions.map((definition) => [definition.kind, definition]),
  );
}

export const EMAIL_MESSAGE_STATUS_LABELS = {
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
} as const;

// ?tab= URL sync (pricing-workspace.tsx precedent).
export const EMAIL_WORKSPACE_TABS = ["lifecycle", "log"] as const;
export type EmailWorkspaceTab = (typeof EMAIL_WORKSPACE_TABS)[number];

export function resolveEmailWorkspaceTab(value: unknown): EmailWorkspaceTab {
  return (EMAIL_WORKSPACE_TABS as readonly string[]).includes(value as string)
    ? (value as EmailWorkspaceTab)
    : "lifecycle";
}

// Client-safe DISPLAY copy for the T1 merge-tag catalog (design §3
// merge-tag-menu.tsx). src/lib/email/merge-tags.ts is marked "server-only"
// and cannot be imported into a "use client" component — this list
// duplicates only the TAG NAMES + human labels/source hints, never the
// renderer itself ("never forked" per spec/design — a unit test asserts
// this tag list stays in lockstep with EMAIL_MERGE_TAGS).
export interface EmailMergeTagDisplayEntry {
  tag: string;
  label: string;
  hint: string;
}

export const EMAIL_MERGE_TAG_DISPLAY: EmailMergeTagDisplayEntry[] = [
  { tag: "event_title", label: "Event title", hint: "Event" },
  {
    tag: "event_date",
    label: "Event date",
    hint: "Event — blank if no periods set",
  },
  { tag: "first_name", label: "First name", hint: "Attendee or submission" },
  { tag: "last_name", label: "Last name", hint: "Attendee or submission" },
  { tag: "full_name", label: "Full name", hint: "First + last name" },
  { tag: "email", label: "Email", hint: "Attendee or submission" },
  { tag: "company", label: "Company", hint: "Attendee or submission" },
  { tag: "job_title", label: "Job title", hint: "Attendee or submission" },
  { tag: "ticket_name", label: "Ticket name", hint: "Attendee's ticket" },
  {
    tag: "registration_type",
    label: "Registration type",
    hint: "Attendee's registration type",
  },
  {
    tag: "order_total",
    label: "Order total",
    hint: "Order — blank if no order",
  },
  {
    tag: "payment_status",
    label: "Payment status",
    hint: "Order — blank if no order",
  },
  {
    tag: "qr_code",
    label: "QR code",
    hint: "HTML body only — blank in plain text.",
  },
  { tag: "event_url", label: "Event page URL", hint: "Public event page" },
];
