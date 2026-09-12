// Server-side data access layer for the RegistrationType root collection.
// Spec: agents/docs/specs/m1-registration-spine.md (M1-T1).
//
// Invariants owned here:
// - organizationId / eventId / registeredCount / createdAt are server-owned:
//   create stamps them explicitly and update uses an allow-list, so callers
//   can never mutate them through this repo.
// - code is normalized to uppercase on every write and every lookup.
// - List reads are org-scoped in the query (no in-memory tenant filtering),
//   ordered by createdAt asc, bounded by a limit.
import "server-only";

import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type { RegistrationTypeDoc, WithId } from "@/types/collection";

export const REGISTRATION_TYPE_COLLECTION = "RegistrationType";

// Per-event registration-type lists are small; this is a safety bound, not pagination.
export const REGISTRATION_TYPE_LIST_LIMIT = 50;

const registrationTypeAdminApi = createAdminCollectionApi<RegistrationTypeDoc>(
  REGISTRATION_TYPE_COLLECTION,
);

const { getById: getAdminRegistrationTypeById } = registrationTypeAdminApi;

function registrationTypeCol() {
  return adminDb.collection(REGISTRATION_TYPE_COLLECTION);
}

// Lists the event's registration types, org-scoped in the query, ordered by
// createdAt asc (stable table order). Served by the composite index
// RegistrationType: eventId ASC, organizationId ASC, createdAt ASC.
export async function getAdminRegistrationTypesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<RegistrationTypeDoc>[]> {
  const snap = await registrationTypeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("createdAt", "asc")
    .limit(input.limit ?? REGISTRATION_TYPE_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as RegistrationTypeDoc),
  }));
}

// Fetches a single registration type scoped to event + org. Returns null when
// the doc does not exist OR belongs to another event/org — callers should 404
// on null (IDOR-safe: never leak existence across tenants).
export async function getAdminRegistrationTypeForEvent(input: {
  registrationTypeId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<RegistrationTypeDoc> | null> {
  const doc = await getAdminRegistrationTypeById(input.registrationTypeId);

  if (
    !doc ||
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface CreateAdminRegistrationTypeInput {
  organizationId: string;
  eventId: string;
  name: string;
  code: string;
  // null = unlimited; otherwise integer >= 1 (validated by the route's Zod schema).
  capacity: number | null;
}

// Creates a registration type. Field list is explicit so client-supplied
// registeredCount/timestamps can never leak into the doc. Callers must run
// isAdminRegistrationTypeCodeTaken first (per-event uniqueness).
export async function createAdminRegistrationType(
  input: CreateAdminRegistrationTypeInput,
): Promise<string> {
  const ref = await registrationTypeCol().add({
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    code: normalizeRegistrationCode(input.code),
    capacity: input.capacity,
    // Server-owned counter — incremented transactionally by M2-T4/M3-T3 only.
    registeredCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
}

export interface UpdateAdminRegistrationTypeInput {
  name?: string;
  code?: string;
  capacity?: number | null;
}

// Allow-list update: only name/code/capacity are writable. organizationId,
// eventId, registeredCount and createdAt are server-owned and silently
// unreachable here regardless of what the caller passes. Bumps updatedAt.
// Route-level rules the caller still owns: code uniqueness (excluding self)
// and capacity >= current registeredCount.
export async function updateAdminRegistrationType(
  registrationTypeId: string,
  input: UpdateAdminRegistrationTypeInput,
): Promise<void> {
  const data: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = normalizeRegistrationCode(input.code);
  if (input.capacity !== undefined) data.capacity = input.capacity;

  await registrationTypeCol().doc(registrationTypeId).update(data);
}

// Hard delete. Delete protection is BLOCK, not cascade: the route must 409
// when registeredCount > 0 or when any TicketType, Fee or RegistrationPath
// references this type — use getAdminTicketTypesReferencingRegistrationType
// (adminTicketType.ts), getAdminFeesReferencingRegistrationType (adminFee.ts)
// and getAdminRegistrationPathsReferencingRegistrationType
// (adminRegistrationPath.ts, M3-T1 AC-6) for the reference checks before
// calling this.
export async function deleteAdminRegistrationType(
  registrationTypeId: string,
): Promise<void> {
  await registrationTypeCol().doc(registrationTypeId).delete();
}

// Case-insensitive per-event code uniqueness check (codes are stored
// uppercase, so an equality query on the normalized code is sufficient).
// Pass excludeId on edit so a doc does not collide with itself.
// Served by the composite index RegistrationType: eventId ASC, code ASC.
export async function isAdminRegistrationTypeCodeTaken(input: {
  eventId: string;
  code: string;
  excludeId?: string;
}): Promise<boolean> {
  const snap = await registrationTypeCol()
    .where("eventId", "==", input.eventId)
    .where("code", "==", normalizeRegistrationCode(input.code))
    .limit(2)
    .get();

  return snap.docs.some((d) => d.id !== input.excludeId);
}

export type EnsureAdminDefaultRegistrationTypeResult =
  | { ok: true; registrationTypeId: string; name: string; code: string; capacity: number | null }
  | { ok: false; code: "CODE_TAKEN" | "NOT_FOUND" };

// Ensures one ordinary General attendee type per event/org on explicit submission.
// The stable document identity serializes concurrent creates; reuse returns saved
// values unchanged, including later organizer edits to its name, code or capacity.
export async function ensureAdminDefaultRegistrationType(input: {
  organizationId: string;
  eventId: string;
  capacity: number | null;
}): Promise<EnsureAdminDefaultRegistrationTypeResult> {
  const identity = createHash("sha256")
    .update(JSON.stringify([input.organizationId, input.eventId]))
    .digest("hex");
  const ref = registrationTypeCol().doc(`default-${identity}`);

  return adminDb.runTransaction<EnsureAdminDefaultRegistrationTypeResult>(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const data = existing.data() as RegistrationTypeDoc;
      if (data.organizationId !== input.organizationId || data.eventId !== input.eventId) {
        return { ok: false, code: "NOT_FOUND" };
      }
      return {
        ok: true,
        registrationTypeId: ref.id,
        name: data.name,
        code: data.code,
        capacity: data.capacity,
      };
    }

    // Do not adopt another audience just because its organizer chose GENERAL.
    // The bounded, tenant-scoped lookup runs before the transaction's write.
    const collision = await tx.get(
      registrationTypeCol()
        .where("eventId", "==", input.eventId)
        .where("organizationId", "==", input.organizationId)
        .where("code", "==", "GENERAL")
        .limit(1),
    );
    if (!collision.empty) return { ok: false, code: "CODE_TAKEN" };

    tx.create(ref, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      name: "General attendee",
      code: "GENERAL",
      capacity: input.capacity,
      registeredCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      ok: true,
      registrationTypeId: ref.id,
      name: "General attendee",
      code: "GENERAL",
      capacity: input.capacity,
    };
  });
}
