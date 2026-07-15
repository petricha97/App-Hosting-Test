// Server-side data access layer for the EmailSettings root collection —
// per-event sender identity. Spec: agents/docs/specs/m6-email-infrastructure.md
// (§4). SERVER-ONLY (firestore.rules deny-all, no client repo pair).
//
// DOC ID = eventId — exactly one settings doc per event, direct doc ops, no
// query/index (CheckinConfig pattern). LAZY: no doc exists until the first
// save; READS NEVER WRITE. Default resolution (event-name fromName +
// EMAIL_DEFAULT_FROM fromAddress) lives ABOVE the DAL in
// src/lib/email/sender-identity.ts — this module returns the stored doc or
// null, exactly what is persisted.
//
// Validation: the write path parses through emailSenderIdentitySchema
// (Zod — RFC-shape lowercased addresses, bounded, control-char-free,
// header-safe display name). The send service RE-CHECKS the same schema at
// send time (defense in depth: a doc corrupted out-of-band lands the
// message `failed`, never sent with a malformed header).
//
// Tenancy: routes gate session -> org -> getAdminEventForOrganization
// BEFORE touching this module, and every method re-checks the stored
// organizationId anyway (cross-org -> null, IDOR-safe, M5 convention).
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import {
  emailSenderIdentitySchema,
  type EmailSenderIdentityInput,
} from "@/lib/email/schemas";
import type { EmailSettingsDoc, WithId } from "@/types/collection";

export const EMAIL_SETTINGS_COLLECTION = "EmailSettings";

function emailSettingsCol() {
  return adminDb.collection(EMAIL_SETTINGS_COLLECTION);
}

// Stored settings or null (no doc yet / cross-org mismatch). NO lazy write
// on read (spec §4 AC-1): callers resolve defaults in memory via
// resolveEmailSenderIdentity (src/lib/email/sender-identity.ts).
export async function getAdminEmailSettingsForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<WithId<EmailSettingsDoc> | null> {
  const snap = await emailSettingsCol().doc(input.eventId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as EmailSettingsDoc) };
  if (doc.organizationId !== input.organizationId) return null;

  return doc;
}

export type UpsertAdminEmailSettingsResult =
  | { ok: true; settings: WithId<EmailSettingsDoc> }
  // VALIDATION -> the route 400s with the issues; CROSS_ORG -> 404 (IDOR).
  | { ok: false; code: "VALIDATION"; issues: string[] }
  | { ok: false; code: "CROSS_ORG" };

// Zod-validated upsert (the write route itself ships with T2's screen —
// the DAL contract exists now so T2 adds only HTTP). First save creates the
// doc lazily; later saves replace the three identity fields. organizationId
// / eventId / createdAt are server-owned and unreachable from the patch.
export async function upsertAdminEmailSettings(input: {
  eventId: string;
  organizationId: string;
  settings: EmailSenderIdentityInput;
}): Promise<UpsertAdminEmailSettingsResult> {
  const parsed = emailSenderIdentitySchema.safeParse(input.settings);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const ref = emailSettingsCol().doc(input.eventId);

  return adminDb.runTransaction<UpsertAdminEmailSettingsResult>(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      const doc: EmailSettingsDoc = {
        organizationId: input.organizationId,
        eventId: input.eventId,
        fromName: parsed.data.fromName,
        fromAddress: parsed.data.fromAddress,
        replyTo: parsed.data.replyTo,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.create(ref, doc);
      return { ok: true, settings: { id: input.eventId, ...doc } };
    }

    const existing = snap.data() as EmailSettingsDoc;
    if (existing.organizationId !== input.organizationId) {
      return { ok: false, code: "CROSS_ORG" };
    }

    const patch = {
      fromName: parsed.data.fromName,
      fromAddress: parsed.data.fromAddress,
      replyTo: parsed.data.replyTo,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.update(ref, patch);

    return {
      ok: true,
      settings: { id: snap.id, ...existing, ...patch },
    };
  });
}

// ============================================================================
// M6-T2 addition (Full-Stack slice, flagged for Backend review): "Reset to
// platform default" (design §6 / spec §6 AC-3 — "BE picks delete-doc vs
// sentinel, documented in the data model"). DELETE-DOC was chosen over a
// sentinel: EmailSettings is already a lazy CheckinConfig-style doc (no row
// = defaults resolved in memory by resolveEmailSenderIdentity), so removing
// the doc is the natural "go back to inheriting platform defaults" operation
// — no new field/sentinel value needed anywhere else in the model.
// ============================================================================

export type DeleteAdminEmailSettingsResult =
  // ok:true covers BOTH "a doc existed and was deleted" and "no doc existed"
  // — resetting an already-default event is a harmless no-op, not an error
  // (idempotent, matches the lazy-doc read convention).
  | { ok: true }
  // CROSS_ORG: a doc exists at this eventId but belongs to another org
  // (IDOR-safe, zero writes) — the route surfaces 404.
  | { ok: false; code: "CROSS_ORG" };

export async function deleteAdminEmailSettings(input: {
  eventId: string;
  organizationId: string;
}): Promise<DeleteAdminEmailSettingsResult> {
  const ref = emailSettingsCol().doc(input.eventId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };

  const existing = snap.data() as EmailSettingsDoc;
  if (existing.organizationId !== input.organizationId) {
    return { ok: false, code: "CROSS_ORG" };
  }

  await ref.delete();
  return { ok: true };
}
