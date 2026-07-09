// Server-side data access layer for the TicketType root collection.
// Spec: agents/docs/specs/m1-registration-spine.md (M1-T2).
//
// Invariants owned here:
// - organizationId / eventId / registeredCount / createdAt are server-owned:
//   create stamps them explicitly and update uses an allow-list.
// - code is normalized to uppercase on every write and every lookup.
// - registrationTypeIds is deduplicated on write; empty array = unrestricted
//   (available to every registration type). Validating that each id is a
//   registration type of the same event is the route's job (it has the
//   event context) — use getAdminRegistrationTypesForEvent for that.
// - List reads are org-scoped in the query, ordered by createdAt asc, bounded.
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type { TicketTypeDoc, WithId } from "@/types/collection";

export const TICKET_TYPE_COLLECTION = "TicketType";

// Per-event ticket lists are small; this is a safety bound, not pagination.
export const TICKET_TYPE_LIST_LIMIT = 50;

// Enough names for a useful 409 "blocked by tickets X, Y, Z" message.
const REFERENCING_TICKETS_LIMIT = 20;

const ticketTypeAdminApi = createAdminCollectionApi<TicketTypeDoc>(
  TICKET_TYPE_COLLECTION,
);

const { getById: getAdminTicketTypeById } = ticketTypeAdminApi;

function ticketTypeCol() {
  return adminDb.collection(TICKET_TYPE_COLLECTION);
}

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// Sales boundaries arrive from routes as plain Dates (routes must not import
// firebase-admin directly); convert here so the Timestamp type never leaks
// outside the DAL. Added by fullstack-dev for M1 — flagged for Backend review.
export type SalesBoundaryInput = Timestamp | Date | null;

function toSalesTimestamp(value: SalesBoundaryInput | undefined): Timestamp | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? Timestamp.fromDate(value) : value;
}

// Lists the event's ticket types, org-scoped in the query, ordered by
// createdAt asc. Served by the composite index
// TicketType: eventId ASC, organizationId ASC, createdAt ASC.
// Search + registration-type filtering (contains-or-empty semantics) are
// client-side over this bounded page — array-contains cannot express the
// OR-empty branch, per spec.
export async function getAdminTicketTypesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<TicketTypeDoc>[]> {
  const snap = await ticketTypeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("createdAt", "asc")
    .limit(input.limit ?? TICKET_TYPE_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as TicketTypeDoc),
  }));
}

// Fetches a single ticket type scoped to event + org. Returns null when the
// doc does not exist OR belongs to another event/org — callers should 404 on
// null (IDOR-safe: never leak existence across tenants).
export async function getAdminTicketTypeForEvent(input: {
  ticketTypeId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<TicketTypeDoc> | null> {
  const doc = await getAdminTicketTypeById(input.ticketTypeId);

  if (
    !doc ||
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface CreateAdminTicketTypeInput {
  organizationId: string;
  eventId: string;
  name: string;
  code: string;
  // null = unlimited; otherwise integer >= 1 (validated by the route's Zod schema).
  capacity: number | null;
  // UTC instants derived from event-local calendar dates (start 00:00:00.000,
  // end 23:59:59.999 in the event's timezone). null = no bound. The route owns
  // the salesEnd >= salesStart validation. Dates are converted to Timestamps here.
  salesStart?: SalesBoundaryInput;
  salesEnd?: SalesBoundaryInput;
  // Manual master switch; displayed "Open" is derived at read time. Default true.
  isOpen?: boolean;
  // Eligible RegistrationType ids of the same event; [] = unrestricted. Default [].
  registrationTypeIds?: string[];
}

// Creates a ticket type. Field list is explicit so client-supplied
// registeredCount/timestamps can never leak into the doc. Callers must run
// isAdminTicketTypeCodeTaken first and validate registrationTypeIds against
// the event's actual registration types.
export async function createAdminTicketType(
  input: CreateAdminTicketTypeInput,
): Promise<string> {
  const ref = await ticketTypeCol().add({
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    code: normalizeRegistrationCode(input.code),
    capacity: input.capacity,
    // Server-owned counter — incremented transactionally by M2-T4/M3-T3 only.
    registeredCount: 0,
    salesStart: toSalesTimestamp(input.salesStart),
    salesEnd: toSalesTimestamp(input.salesEnd),
    isOpen: input.isOpen ?? true,
    registrationTypeIds: dedupeIds(input.registrationTypeIds ?? []),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
}

export interface UpdateAdminTicketTypeInput {
  name?: string;
  code?: string;
  capacity?: number | null;
  salesStart?: SalesBoundaryInput;
  salesEnd?: SalesBoundaryInput;
  isOpen?: boolean;
  registrationTypeIds?: string[];
}

// Allow-list update: organizationId, eventId, registeredCount and createdAt
// are server-owned and unreachable here regardless of what the caller passes.
// Bumps updatedAt. Route-level rules the caller still owns: code uniqueness
// (excluding self), capacity >= current registeredCount, salesEnd >= salesStart,
// and registrationTypeIds membership in the same event.
export async function updateAdminTicketType(
  ticketTypeId: string,
  input: UpdateAdminTicketTypeInput,
): Promise<void> {
  const data: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = normalizeRegistrationCode(input.code);
  if (input.capacity !== undefined) data.capacity = input.capacity;
  if (input.salesStart !== undefined) {
    data.salesStart = toSalesTimestamp(input.salesStart);
  }
  if (input.salesEnd !== undefined) {
    data.salesEnd = toSalesTimestamp(input.salesEnd);
  }
  if (input.isOpen !== undefined) data.isOpen = input.isOpen;
  if (input.registrationTypeIds !== undefined) {
    data.registrationTypeIds = dedupeIds(input.registrationTypeIds);
  }

  await ticketTypeCol().doc(ticketTypeId).update(data);
}

// Hard delete. Delete protection is BLOCK, not cascade: the route must 409
// when registeredCount > 0. (M2 extends the block to tickets referenced by fees.)
export async function deleteAdminTicketType(ticketTypeId: string): Promise<void> {
  await ticketTypeCol().doc(ticketTypeId).delete();
}

// Case-insensitive per-event code uniqueness check within TicketType only —
// a ticket code may legitimately collide with a registration-type code.
// Served by the composite index TicketType: eventId ASC, code ASC.
export async function isAdminTicketTypeCodeTaken(input: {
  eventId: string;
  code: string;
  excludeId?: string;
}): Promise<boolean> {
  const snap = await ticketTypeCol()
    .where("eventId", "==", input.eventId)
    .where("code", "==", normalizeRegistrationCode(input.code))
    .limit(2)
    .get();

  return snap.docs.some((d) => d.id !== input.excludeId);
}

// Delete protection for registration types (M1-T1 AC-8 / M1-T2 AC-12): returns
// the tickets in this event whose registrationTypeIds reference the given
// registration type, so the reg-type delete route can 409 and name the
// blocking tickets. Unrestricted tickets (empty array) never match — deleting
// a type does not affect them. Served by the composite index
// TicketType: eventId ASC, organizationId ASC, registrationTypeIds CONTAINS.
export async function getAdminTicketTypesReferencingRegistrationType(input: {
  eventId: string;
  organizationId: string;
  registrationTypeId: string;
  limit?: number;
}): Promise<WithId<TicketTypeDoc>[]> {
  const snap = await ticketTypeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("registrationTypeIds", "array-contains", input.registrationTypeId)
    .limit(input.limit ?? REFERENCING_TICKETS_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as TicketTypeDoc),
  }));
}
