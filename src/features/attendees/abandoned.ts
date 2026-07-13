// Pure, client-safe helpers for the M5-T3 Abandoned tab.
// Spec: agents/docs/specs/m5-attendees-checkin.md (M5-T3).
//
// PII rule (M3-T5 carried forward): the FULL email is never rendered — or
// even serialized — on this surface. Masking happens server-side in
// serializeAbandonedDrafts, so the local part never crosses the RSC/API
// boundary (T3 AC-3).

import { extractDomain } from "@/lib/domain-utils";
import type { AdminRegistrationDraftListItem } from "@/lib/db/adminRegistrationDraft";
import type { RegistrationDraftStep } from "@/types/collection";
import { timestampToIso } from "@/features/attendees/roster";

export const ABANDONED_EMPTY_FALLBACK = "—";

// Step -> label map from M3-T5 (prototype badges).
export const DRAFT_STEP_LABELS: Record<RegistrationDraftStep, string> = {
  personal_info: "Personal Information",
  ticket_options: "Ticket & Options",
  summary: "Registration Summary",
  payment: "Payment",
};

// Amber badge for the late steps (Registration Summary / Payment — the
// registrant was close), neutral for the early ones (prototype).
export function isLateDraftStep(step: RegistrationDraftStep): boolean {
  return step === "summary" || step === "payment";
}

// Domain-only email mask: "ada@dentsu.com" -> "@dentsu.com". Blank or
// unparseable emails mask to the em-dash fallback — never a partial address.
export function maskEmailDomain(email: string): string {
  const domain = extractDomain(email ?? "");
  return domain ? `@${domain}` : ABANDONED_EMPTY_FALLBACK;
}

export interface SerializedAbandonedDraft {
  id: string;
  // "—" when both name parts are blank (T3 AC-2).
  name: string;
  // Domain-only ("@dentsu.com") or "—" — never the full address.
  maskedEmail: string;
  lastStepReached: RegistrationDraftStep;
  updatedAtIso: string | null;
}

// Serializes ONLY abandoned drafts (isAbandoned is derived by the DAL from
// ABANDONED_AFTER_MS — strict >24h, T3 AC-1); fresher drafts are in-flight
// registrations, not abandoned rows.
export function serializeAbandonedDrafts(
  drafts: AdminRegistrationDraftListItem[],
): SerializedAbandonedDraft[] {
  return drafts
    .filter((draft) => draft.isAbandoned)
    .map((draft) => {
      const name = [draft.firstName?.trim(), draft.lastName?.trim()]
        .filter(Boolean)
        .join(" ")
        .trim();

      return {
        id: draft.id,
        name: name || ABANDONED_EMPTY_FALLBACK,
        maskedEmail: maskEmailDomain(draft.email ?? ""),
        lastStepReached: draft.lastStepReached,
        updatedAtIso: timestampToIso(draft.updatedAt),
      };
    });
}
