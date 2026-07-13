// Server-side data access layer for the Fee root collection.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T1).
//
// A Fee attaches a price to a ticket, per registration type and currency.
// Invariants owned here:
// - organizationId / eventId / createdAt are server-owned: create stamps them
//   explicitly and update uses an allow-list.
// - registrationTypeId is stored EXPLICITLY as null for "All registration
//   types" (never absent) so the uniqueness equality query works.
// - basePriceMinor is integer minor units (>= 0); 0 = comp fee. Parsing major
//   units to minor is the route/UI's job — no floats reach this module.
// - List reads are org-scoped in the query, ordered by createdAt asc, bounded.
// Route-level rules the DAL deliberately does NOT own (they need cross-doc
// context): ticketTypeId/registrationTypeId membership in the same event,
// the uniqueness 409/field error (via isAdminActiveFeeCombinationTaken),
// and the delete block when Orders reference the fee (adminOrder.ts helper).
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { Currency, FeeDoc, FeeStatus, WithId } from "@/types/collection";

export const FEE_COLLECTION = "Fee";

// Per-event fee lists are small; safety bound, not pagination.
export const FEE_LIST_LIMIT = 50;

// Enough names for a useful 409 "blocked by fees X, Y, Z" message.
const REFERENCING_FEES_LIMIT = 20;

const feeAdminApi = createAdminCollectionApi<FeeDoc>(FEE_COLLECTION);

const { getById: getAdminFeeById } = feeAdminApi;

function feeCol() {
  return adminDb.collection(FEE_COLLECTION);
}

// Lists the event's fees, org-scoped in the query, ordered by createdAt asc.
// Served by the composite index Fee: eventId ASC, organizationId ASC, createdAt ASC.
// Archived fees are included (the Fees tab shows them with a badge).
export async function getAdminFeesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<FeeDoc>[]> {
  const snap = await feeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("createdAt", "asc")
    .limit(input.limit ?? FEE_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeeDoc) }));
}

// Fetches a single fee scoped to event + org. Returns null when the doc does
// not exist OR belongs to another event/org — callers should 404 on null
// (IDOR-safe: never leak existence across tenants).
export async function getAdminFeeForEvent(input: {
  feeId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<FeeDoc> | null> {
  const doc = await getAdminFeeById(input.feeId);

  if (
    !doc ||
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface CreateAdminFeeInput {
  organizationId: string;
  eventId: string;
  // 1–80 chars (route Zod).
  name: string;
  // Must belong to the same event (route-validated).
  ticketTypeId: string;
  // null = all registration types; else must belong to the same event.
  registrationTypeId: string | null;
  currency: Currency;
  // Integer minor units >= 0 (route parses major-unit input, <= 2 decimals).
  basePriceMinor: number;
  status?: FeeStatus;
}

// Creates a fee. Field list is explicit so client-supplied timestamps can
// never leak into the doc. Callers must run isAdminActiveFeeCombinationTaken
// first (uniqueness) and validate the ticket/registration-type references.
export async function createAdminFee(input: CreateAdminFeeInput): Promise<string> {
  const ref = await feeCol().add({
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    ticketTypeId: input.ticketTypeId,
    // Stored explicitly (null, not absent) so the uniqueness equality works.
    registrationTypeId: input.registrationTypeId,
    currency: input.currency,
    basePriceMinor: input.basePriceMinor,
    status: input.status ?? "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
}

export interface UpdateAdminFeeInput {
  name?: string;
  ticketTypeId?: string;
  // null = all registration types (pass null explicitly to widen a fee).
  registrationTypeId?: string | null;
  currency?: Currency;
  basePriceMinor?: number;
  status?: FeeStatus;
}

// Allow-list update: organizationId, eventId and createdAt are server-owned
// and unreachable here regardless of what the caller passes. Bumps updatedAt.
// The caller still owns uniqueness (excluding self) and reference validation.
export async function updateAdminFee(
  feeId: string,
  input: UpdateAdminFeeInput,
): Promise<void> {
  const data: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (input.name !== undefined) data.name = input.name;
  if (input.ticketTypeId !== undefined) data.ticketTypeId = input.ticketTypeId;
  if (input.registrationTypeId !== undefined) {
    data.registrationTypeId = input.registrationTypeId;
  }
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.basePriceMinor !== undefined) {
    data.basePriceMinor = input.basePriceMinor;
  }
  if (input.status !== undefined) data.status = input.status;

  await feeCol().doc(feeId).update(data);
}

// Hard delete. Delete protection is BLOCK, not cascade: the route must 409
// (directing to Archive) when any Order references the fee — check via
// getAdminOrdersReferencingFee in adminOrder.ts.
export async function deleteAdminFee(feeId: string): Promise<void> {
  await feeCol().doc(feeId).delete();
}

// Uniqueness check: at most one ACTIVE fee per
// (eventId, ticketTypeId, registrationTypeId-or-null, currency).
// Archived fees never block; self is excluded on edit via excludeId.
// Served by the composite index
// Fee: eventId ASC, ticketTypeId ASC, registrationTypeId ASC, currency ASC, status ASC.
export async function isAdminActiveFeeCombinationTaken(input: {
  eventId: string;
  ticketTypeId: string;
  registrationTypeId: string | null;
  currency: Currency;
  excludeId?: string;
}): Promise<boolean> {
  const snap = await feeCol()
    .where("eventId", "==", input.eventId)
    .where("ticketTypeId", "==", input.ticketTypeId)
    .where("registrationTypeId", "==", input.registrationTypeId)
    .where("currency", "==", input.currency)
    .where("status", "==", "active")
    .limit(2)
    .get();

  return snap.docs.some((d) => d.id !== input.excludeId);
}

// Fee resolution for order pricing (fixed rule, used by T4/M3): among ACTIVE
// fees for (ticket, currency), a fee pinned to the buyer's registration type
// WINS over the "All types" (registrationTypeId null) fee. Returns null when
// no active fee prices this combination (route responds 400).
// Equality-only query — served by Firestore's single-field index merging
// (no orderBy, so no composite required); specific-vs-null picked in memory.
export async function resolveAdminFeeForOrder(input: {
  eventId: string;
  organizationId: string;
  ticketTypeId: string;
  registrationTypeId: string;
  currency: Currency;
}): Promise<WithId<FeeDoc> | null> {
  const snap = await feeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("ticketTypeId", "==", input.ticketTypeId)
    .where("currency", "==", input.currency)
    .where("status", "==", "active")
    .limit(FEE_LIST_LIMIT)
    .get();

  const fees = snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeeDoc) }));

  const specific = fees.find(
    (fee) => fee.registrationTypeId === input.registrationTypeId,
  );
  if (specific) return specific;

  return fees.find((fee) => fee.registrationTypeId === null) ?? null;
}

// Delete protection for ticket types (M2-T1 AC-6): fees in this event that
// price the given ticket, so the M1 ticket-type delete route can 409 and name
// the blocking fees. Equality-only query — merge-servable, no composite needed.
export async function getAdminFeesReferencingTicketType(input: {
  eventId: string;
  organizationId: string;
  ticketTypeId: string;
  limit?: number;
}): Promise<WithId<FeeDoc>[]> {
  const snap = await feeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("ticketTypeId", "==", input.ticketTypeId)
    .limit(input.limit ?? REFERENCING_FEES_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeeDoc) }));
}

// Delete protection for registration types (M2-T1 AC-6): fees in this event
// pinned to the given registration type ("All types" fees never match —
// deleting a type does not affect them). Equality-only query — merge-servable.
export async function getAdminFeesReferencingRegistrationType(input: {
  eventId: string;
  organizationId: string;
  registrationTypeId: string;
  limit?: number;
}): Promise<WithId<FeeDoc>[]> {
  const snap = await feeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("registrationTypeId", "==", input.registrationTypeId)
    .limit(input.limit ?? REFERENCING_FEES_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeeDoc) }));
}
