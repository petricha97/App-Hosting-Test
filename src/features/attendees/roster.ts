// Pure, client-safe roster helpers for the M5-T2 attendees screen.
// Spec: agents/docs/specs/m5-attendees-checkin.md (M5-T2 "Merged view").
//
// The roster MERGES two sources (decision — Attendee docs exist only
// post-accept):
//   (a) Attendee docs — green "Accepted" rows with a live check-in cell;
//   (b) FormData with status ∈ {new, pending, reviewed} — amber "Pending"
//       rows (granular status lives on the Responses screen) with em-dash
//       commerce/check-in cells.
// No Firebase imports — unit-testable and shared by the server page, the
// list/export routes and the client table.

import { readFormDataStatus } from "@/lib/db/formDataStatus";
import type { AttendeeDoc, FormDataDoc, WithId } from "@/types/collection";

// Matches the DAL's "—" denorm fallback (on-submission-accepted.ts).
export const ROSTER_LABEL_FALLBACK = "—";

export type RosterRowStatus = "accepted" | "pending";

export interface SerializedAttendeeRow {
  id: string;
  kind: "attendee" | "pending";
  name: string;
  email: string;
  company: string;
  ticketLabel: string | null;
  // Populated for attendee rows (CSV export column); null on pending rows.
  registrationTypeLabel: string | null;
  status: RosterRowStatus;
  // null on pending rows — the Check-in cell renders an em dash.
  checkInState: "not-arrived" | "checked-in" | null;
  checkedInAtIso: string | null;
  // createdAt (attendee) / submittedAt (pending) UTC ms — merge-sort key and
  // the "load more" cursor value.
  sortMs: number | null;
}

// Tolerant Timestamp -> ISO conversion (admin Timestamps expose toDate; a
// plain {seconds} shape can appear after JSON round-trips).
export function timestampToIso(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as { toDate?: () => Date; seconds?: number | string };
  if (typeof candidate.toDate === "function") {
    return candidate.toDate().toISOString();
  }
  if (candidate.seconds !== undefined) {
    return new Date(Number(candidate.seconds) * 1000).toISOString();
  }
  return null;
}

export function timestampToMs(value: unknown): number | null {
  const iso = timestampToIso(value);
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function buildName(first: string, last: string, email: string): string {
  const name = [first.trim(), last.trim()].filter(Boolean).join(" ").trim();
  return name || email.trim() || "Unnamed attendee";
}

export function serializeAttendeeRow(
  doc: WithId<AttendeeDoc>,
): SerializedAttendeeRow {
  return {
    id: doc.id,
    kind: "attendee",
    name: buildName(doc.firstName ?? "", doc.lastName ?? "", doc.email ?? ""),
    email: doc.email ?? "",
    company: doc.company ?? "",
    ticketLabel: doc.ticketLabel || ROSTER_LABEL_FALLBACK,
    registrationTypeLabel: doc.registrationTypeLabel || ROSTER_LABEL_FALLBACK,
    // "cancelled" is model-only in M5 (no cancel UI) — every Attendee doc
    // renders as an Accepted row (documented).
    status: "accepted",
    checkInState: doc.checkInState ?? "not-arrived",
    checkedInAtIso: timestampToIso(doc.checkedInAt),
    sortMs: timestampToMs(doc.createdAt),
  };
}

// Pre-accept submissions render as amber "Pending" rows. Returns null for
// accepted FormData — those rows come from the Attendee source instead
// (the merge never double-counts a submission).
export function serializePendingRow(
  doc: WithId<FormDataDoc>,
): SerializedAttendeeRow | null {
  if (readFormDataStatus(doc) === "accepted") return null;

  const submission = doc.submission ?? {};
  return {
    id: doc.id,
    kind: "pending",
    name: buildName(
      submission.first_name ?? "",
      submission.last_name ?? "",
      submission.email ?? "",
    ),
    email: submission.email?.trim() ?? "",
    company: submission.company?.trim() ?? "",
    ticketLabel: doc.ticketLabel ?? null,
    registrationTypeLabel: null,
    status: "pending",
    checkInState: null,
    checkedInAtIso: null,
    sortMs: timestampToMs(doc.submittedAt),
  };
}

// Merged roster page: newest first across both sources (rows without a
// resolvable timestamp sort last).
export function mergeRosterRows(
  attendeeRows: SerializedAttendeeRow[],
  pendingRows: SerializedAttendeeRow[],
): SerializedAttendeeRow[] {
  return [...attendeeRows, ...pendingRows].sort(
    (a, b) => (b.sortMs ?? -Infinity) - (a.sortMs ?? -Infinity),
  );
}

// "Checked in 09:42" cell time (design §1: tabular-nums, 24h HH:MM).
export function formatCheckInTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Parses the roster ?status= filter — anything unknown means "All".
export function parseRosterStatusFilter(
  value: string | string[] | undefined | null,
): RosterRowStatus | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "accepted" || candidate === "pending"
    ? candidate
    : undefined;
}
