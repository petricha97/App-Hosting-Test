// Client-safe scan-flow contracts (M5-T5). Shared by the scanner routes
// (public team-session + dashboard admin) and the scanner-surface /
// scan-result-card components so both sides agree on the wire shape.
// PURE module — no Firebase, no server imports.

// The attendee card shown between resolve and confirm (design §4: name,
// reg-type pill, ticket label, check-in status). NO email/company — the
// door surface shows the minimum needed to greet and verify (T5 AC-11).
export interface ScanAttendeeCard {
  name: string;
  registrationTypeLabel: string;
  ticketLabel: string;
  checkInState: "not-arrived" | "checked-in";
  // Populated when already checked in — the amber card's "at 09:42 by Maria".
  checkedInAtIso: string | null;
  checkedInByName: string | null;
}

// POST .../checkin/resolve — resolve NEVER writes (resolve ≠ confirm,
// T5 AC-3). WRONG_EVENT / INVALID / NOT_ACCEPTED / CANCELLED carry no
// attendee data (T5 AC-7).
export type ScanResolveResponse =
  | { status: "OK"; attendee: ScanAttendeeCard }
  | { status: "WRONG_EVENT" }
  | { status: "INVALID" }
  | { status: "NOT_ACCEPTED" }
  | { status: "CANCELLED" };

// POST .../checkin/confirm — idempotent flip. ALREADY_CHECKED_IN carries the
// ORIGINAL timestamp + scanner name (T5 AC-6).
export type ScanConfirmResponse =
  | { status: "CHECKED_IN"; attendee: ScanAttendeeCard; checkedInAtIso: string | null }
  | {
      status: "ALREADY_CHECKED_IN";
      attendee: ScanAttendeeCard;
      checkedInAtIso: string | null;
      checkedInByName: string | null;
    }
  | { status: "WRONG_EVENT" }
  | { status: "INVALID" }
  | { status: "NOT_ACCEPTED" }
  | { status: "CANCELLED" };

// What the result takeover renders (design §4 variants). "resolved" is the
// pre-confirm attendee card with the h-14 "Check in" button; "checked-in" is
// the post-confirm emerald success; "error" is the generic network-retry
// variant (offline is out of scope in M5 — note only).
export type ScanOutcome =
  | { kind: "resolved"; attendee: ScanAttendeeCard }
  | { kind: "checked-in"; attendee: ScanAttendeeCard; checkedInAtIso: string | null }
  | {
      kind: "already";
      attendee: ScanAttendeeCard | null;
      checkedInAtIso: string | null;
      checkedInByName: string | null;
    }
  | { kind: "wrong-event" }
  | { kind: "invalid" }
  | { kind: "cancelled" }
  | { kind: "not-accepted" }
  | { kind: "error" };

// Maps a resolve response to the outcome the takeover renders. An attendee
// who is ALREADY checked in resolves straight to the amber variant with the
// original record — scanning them twice never shows a "Check in" button.
export function outcomeFromResolve(response: ScanResolveResponse): ScanOutcome {
  switch (response.status) {
    case "OK":
      if (response.attendee.checkInState === "checked-in") {
        return {
          kind: "already",
          attendee: response.attendee,
          checkedInAtIso: response.attendee.checkedInAtIso,
          checkedInByName: response.attendee.checkedInByName,
        };
      }
      return { kind: "resolved", attendee: response.attendee };
    case "WRONG_EVENT":
      return { kind: "wrong-event" };
    case "NOT_ACCEPTED":
      return { kind: "not-accepted" };
    case "CANCELLED":
      return { kind: "cancelled" };
    default:
      return { kind: "invalid" };
  }
}

export function outcomeFromConfirm(response: ScanConfirmResponse): ScanOutcome {
  switch (response.status) {
    case "CHECKED_IN":
      return {
        kind: "checked-in",
        attendee: response.attendee,
        checkedInAtIso: response.checkedInAtIso,
      };
    case "ALREADY_CHECKED_IN":
      return {
        kind: "already",
        attendee: response.attendee,
        checkedInAtIso: response.checkedInAtIso,
        checkedInByName: response.checkedInByName,
      };
    case "WRONG_EVENT":
      return { kind: "wrong-event" };
    case "NOT_ACCEPTED":
      return { kind: "not-accepted" };
    case "CANCELLED":
      return { kind: "cancelled" };
    default:
      return { kind: "invalid" };
  }
}

// "09:42" style time for the check-in pills/cards; null-safe.
export function formatCheckedInTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
