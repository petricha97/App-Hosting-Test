// Server-side data access layer for the RegistrationPath root collection.
// Spec: agents/docs/specs/m3-registration-paths.md (M3-T1).
//
// A RegistrationPath is the public flow config: one per audience × payment
// method, pinning the checkout currency. SERVER-ONLY collection: no client
// repo pair exists and firestore.rules denies all client access — the admin
// table reads through dashboard routes and the public picker reads through
// the public register routes (both Admin SDK).
//
// Invariants owned here:
// - organizationId / eventId / createdAt are server-owned: create stamps
//   them explicitly and update uses an allow-list.
// - code is normalized to uppercase on every write and every lookup (M1
//   rules; unique per event WITHIN RegistrationPath).
// - audienceRegistrationTypeId is stored EXPLICITLY as null for "Any"
//   (never absent) so equality reference-queries work.
// - List reads are org-scoped in the query, ordered by sortOrder asc, bounded.
// Route-level rules the DAL deliberately does NOT own (cross-doc context):
// audience membership in the same event, the code-uniqueness 409 (via
// isAdminRegistrationPathCodeTaken), and the delete BLOCK when drafts or
// submissions reference the path (getAdminRegistrationDraftsReferencingPath /
// getAdminFormDataReferencingPath).
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type {
  Currency,
  PaymentMethod,
  RegistrationPathDoc,
  WithId,
} from "@/types/collection";

export const REGISTRATION_PATH_COLLECTION = "RegistrationPath";

// Per-event path lists are small (one per audience × payment method);
// safety bound, not pagination.
export const REGISTRATION_PATH_LIST_LIMIT = 50;

// Enough names for a useful 409 "blocked by paths X, Y, Z" message.
const REFERENCING_PATHS_LIMIT = 20;

function registrationPathCol() {
  return adminDb.collection(REGISTRATION_PATH_COLLECTION);
}

// Lists the event's paths, org-scoped in the query, ordered by sortOrder asc
// (drives the admin table AND the public picker order). Served by the
// composite index RegistrationPath: eventId ASC, organizationId ASC, sortOrder ASC.
// Includes inactive paths (the admin table shows them with an amber badge).
export async function getAdminRegistrationPathsForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<RegistrationPathDoc>[]> {
  const snap = await registrationPathCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("sortOrder", "asc")
    .limit(input.limit ?? REGISTRATION_PATH_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as RegistrationPathDoc),
  }));
}

// Active paths only — the public picker / auto-select surface (T3 AC-1;
// inactive paths never appear there but remain in the admin list). Same
// bounded sortOrder query with the isActive filter applied in memory —
// per-event path counts are tiny, so no extra composite (same convention as
// getAdminActiveTaxesForEvent).
export async function getAdminActiveRegistrationPathsForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<RegistrationPathDoc>[]> {
  const paths = await getAdminRegistrationPathsForEvent(input);
  return paths.filter((path) => path.isActive);
}

// Fetches a single path scoped to event + org. Returns null when the doc
// does not exist OR belongs to another event/org — callers should 404 on
// null (IDOR-safe: never leak existence across tenants).
export async function getAdminRegistrationPathForEvent(input: {
  pathId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<RegistrationPathDoc> | null> {
  const snap = await registrationPathCol().doc(input.pathId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as RegistrationPathDoc) };
  if (
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface CreateAdminRegistrationPathInput {
  organizationId: string;
  eventId: string;
  // 1–120 chars (route Zod).
  name: string;
  code: string;
  // null = "Any"; else must belong to the same event (route-validated).
  audienceRegistrationTypeId: string | null;
  paymentMethod: PaymentMethod;
  currency: Currency;
  isActive?: boolean;
  // Omit to default to max+1 within the event (spec T1).
  sortOrder?: number;
}

// Creates a path. Field list is explicit so client-supplied timestamps can
// never leak into the doc. Callers must run isAdminRegistrationPathCodeTaken
// first (per-event uniqueness) and validate the audience reference.
export async function createAdminRegistrationPath(
  input: CreateAdminRegistrationPathInput,
): Promise<string> {
  const sortOrder =
    input.sortOrder ??
    (await getAdminNextRegistrationPathSortOrder({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }));

  const ref = await registrationPathCol().add({
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    code: normalizeRegistrationCode(input.code),
    // Stored explicitly (null, not absent) so equality reference-queries work.
    audienceRegistrationTypeId: input.audienceRegistrationTypeId,
    paymentMethod: input.paymentMethod,
    currency: input.currency,
    isActive: input.isActive ?? true,
    sortOrder,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
}

export interface UpdateAdminRegistrationPathInput {
  name?: string;
  code?: string;
  // Pass null explicitly to widen the audience to "Any".
  audienceRegistrationTypeId?: string | null;
  paymentMethod?: PaymentMethod;
  currency?: Currency;
  isActive?: boolean;
  sortOrder?: number;
}

// Allow-list update: organizationId, eventId and createdAt are server-owned
// and unreachable here regardless of what the caller passes. Bumps updatedAt.
// The caller still owns code uniqueness (excluding self) and audience
// reference validation.
export async function updateAdminRegistrationPath(
  pathId: string,
  input: UpdateAdminRegistrationPathInput,
): Promise<void> {
  const data: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = normalizeRegistrationCode(input.code);
  if (input.audienceRegistrationTypeId !== undefined) {
    data.audienceRegistrationTypeId = input.audienceRegistrationTypeId;
  }
  if (input.paymentMethod !== undefined) {
    data.paymentMethod = input.paymentMethod;
  }
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

  await registrationPathCol().doc(pathId).update(data);
}

// Hard delete. Delete protection is BLOCK, not cascade: the route must 409
// ("Deactivate instead") when any RegistrationDraft or FormData references
// the path — check via getAdminRegistrationDraftsReferencingPath
// (adminRegistrationDraft.ts) and getAdminFormDataReferencingPath
// (adminFormData.ts) before calling this.
export async function deleteAdminRegistrationPath(pathId: string): Promise<void> {
  await registrationPathCol().doc(pathId).delete();
}

// Case-insensitive per-event code uniqueness check (codes stored uppercase,
// so an equality query on the normalized code is sufficient). Pass excludeId
// on edit so a doc does not collide with itself.
// Served by the composite index RegistrationPath: eventId ASC, code ASC.
export async function isAdminRegistrationPathCodeTaken(input: {
  eventId: string;
  code: string;
  excludeId?: string;
}): Promise<boolean> {
  const snap = await registrationPathCol()
    .where("eventId", "==", input.eventId)
    .where("code", "==", normalizeRegistrationCode(input.code))
    .limit(2)
    .get();

  return snap.docs.some((d) => d.id !== input.excludeId);
}

// Delete protection for registration types (spec T1 AC-6): paths in this
// event whose audience pins the given registration type, so the M1 reg-type
// delete route can 409 and name the blocking paths ("Any"-audience paths
// never match — deleting a type does not affect them). Equality-only query —
// served by single-field index merging, no composite needed.
export async function getAdminRegistrationPathsReferencingRegistrationType(input: {
  eventId: string;
  organizationId: string;
  registrationTypeId: string;
  limit?: number;
}): Promise<WithId<RegistrationPathDoc>[]> {
  const snap = await registrationPathCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("audienceRegistrationTypeId", "==", input.registrationTypeId)
    .limit(input.limit ?? REFERENCING_PATHS_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as RegistrationPathDoc),
  }));
}

// Default sortOrder for a new path: max+1 within the event (0 when the event
// has no paths yet). Reuses the bounded sortOrder-asc list and takes the last
// entry — per-event path counts are tiny, so no reverse-order composite.
export async function getAdminNextRegistrationPathSortOrder(input: {
  eventId: string;
  organizationId: string;
}): Promise<number> {
  const paths = await getAdminRegistrationPathsForEvent(input);
  if (paths.length === 0) return 0;
  return paths[paths.length - 1].sortOrder + 1;
}
