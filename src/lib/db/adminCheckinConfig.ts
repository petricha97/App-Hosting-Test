// Server-side data access layer for the CheckinConfig root collection.
// Spec: agents/docs/specs/m5-attendees-checkin.md (M5-T4).
//
// SERVER-ONLY (firestore.rules deny-all, no client repo pair). DOC ID =
// eventId — exactly one config per event, so reads and upserts are direct
// doc operations (no query, no index).
//
// LAZY LIFECYCLE (spec T4 AC-3): no doc exists until the first save. Reads
// apply CHECKIN_CONFIG_DEFAULTS in memory — a fresh event renders the
// prototype defaults (Off/Off/On/On/On) with ZERO writes. The first PATCH
// creates the doc (defaults + patch); later PATCHes merge through the
// boolean allow-list only — organizationId/eventId/createdAt are
// server-owned and unreachable.
//
// Tenancy: routes gate on session -> org -> getAdminEventForOrganization
// BEFORE touching this module, and every method here re-checks the stored
// organizationId anyway (cross-org -> null / defaults, IDOR-safe).
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import type { CheckinConfigDoc } from "@/types/collection";

export const CHECKIN_CONFIG_COLLECTION = "CheckinConfig";

// Just the five toggles — the mutable surface of the doc.
export interface CheckinConfigSettings {
  signatureCollection: boolean;
  photoCapture: boolean;
  photoIdVerification: boolean;
  selfPrintBadges: boolean;
  walletPasses: boolean;
}

// Prototype defaults (spec T4): Off / Off / On / On / On. Read-time only —
// never written until the organizer saves. walletPasses stores a boolean
// only; no pass generation exists in M5 (Q4 placeholder).
export const CHECKIN_CONFIG_DEFAULTS: CheckinConfigSettings = {
  signatureCollection: false,
  photoCapture: false,
  photoIdVerification: true,
  selfPrintBadges: true,
  walletPasses: true,
};

const SETTING_KEYS = [
  "signatureCollection",
  "photoCapture",
  "photoIdVerification",
  "selfPrintBadges",
  "walletPasses",
] as const satisfies ReadonlyArray<keyof CheckinConfigSettings>;

function checkinConfigCol() {
  return adminDb.collection(CHECKIN_CONFIG_COLLECTION);
}

// Allow-list projection: keeps ONLY the five known boolean keys with boolean
// values — unknown keys and non-boolean values are dropped (routes also Zod
// this, but the DAL never trusts its caller with the doc shape).
function pickSettings(
  patch: Partial<CheckinConfigSettings>,
): Partial<CheckinConfigSettings> {
  const picked: Partial<CheckinConfigSettings> = {};
  for (const key of SETTING_KEYS) {
    const value = patch[key];
    if (typeof value === "boolean") picked[key] = value;
  }
  return picked;
}

// Get-or-default read (ZERO writes): the stored toggles when a doc exists,
// CHECKIN_CONFIG_DEFAULTS otherwise. A doc whose organizationId does not
// match reads as defaults too — never another tenant's settings (defensive;
// routes already verified event ∈ org, and doc id = eventId makes a
// mismatch impossible without data corruption).
export async function getAdminCheckinConfigForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<CheckinConfigSettings> {
  const snap = await checkinConfigCol().doc(input.eventId).get();
  if (!snap.exists) return { ...CHECKIN_CONFIG_DEFAULTS };

  const doc = snap.data() as CheckinConfigDoc;
  if (doc.organizationId !== input.organizationId) {
    return { ...CHECKIN_CONFIG_DEFAULTS };
  }

  return {
    ...CHECKIN_CONFIG_DEFAULTS,
    ...pickSettings(doc),
  };
}

// Upsert through the allow-list, inside a transaction:
// - no doc -> create defaults + patch (lazy first save, T4 AC-3);
// - doc exists -> update ONLY the patched toggle keys (+ updatedAt);
// - cross-org doc -> null (route 404s; never merges into another tenant).
// Returns the resulting settings.
export async function upsertAdminCheckinConfig(input: {
  eventId: string;
  organizationId: string;
  patch: Partial<CheckinConfigSettings>;
}): Promise<CheckinConfigSettings | null> {
  const ref = checkinConfigCol().doc(input.eventId);
  const patch = pickSettings(input.patch);

  return adminDb.runTransaction<CheckinConfigSettings | null>(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      const settings = { ...CHECKIN_CONFIG_DEFAULTS, ...patch };
      const doc: CheckinConfigDoc = {
        organizationId: input.organizationId,
        eventId: input.eventId,
        ...settings,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.create(ref, doc);
      return settings;
    }

    const existing = snap.data() as CheckinConfigDoc;
    if (existing.organizationId !== input.organizationId) return null;

    if (Object.keys(patch).length > 0) {
      tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    }

    return {
      ...CHECKIN_CONFIG_DEFAULTS,
      ...pickSettings(existing),
      ...patch,
    };
  });
}
