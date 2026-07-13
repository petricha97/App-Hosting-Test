// Client-side data access layer for the TicketType root collection.
// Spec: agents/docs/specs/m1-registration-spine.md (M1-T2).
//
// M1 dashboard CRUD flows go through the admin API routes (which use
// adminTicketType.ts); this client repo mirrors the same method set and
// invariants, consistent with the other collections' client/admin repo pairs.
import {
  limit,
  orderBy,
  serverTimestamp,
  where,
  type Timestamp,
  type UpdateData,
} from "firebase/firestore";

import { createCollectionApi } from "@/lib/db/base";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type { TicketTypeDoc, WithId } from "@/types/collection";

export const TICKET_TYPE_COLLECTION = "TicketType";

// Per-event ticket lists are small; this is a safety bound, not pagination.
export const TICKET_TYPE_LIST_LIMIT = 50;

// Enough names for a useful "blocked by tickets X, Y, Z" message.
const REFERENCING_TICKETS_LIMIT = 20;

const ticketTypeApi = createCollectionApi<TicketTypeDoc>(TICKET_TYPE_COLLECTION);

const { getById: getTicketTypeById, findMany: findManyTicketTypes } =
  ticketTypeApi;

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// Lists the event's ticket types, org-scoped in the query, ordered by
// createdAt asc. Served by the composite index
// TicketType: eventId ASC, organizationId ASC, createdAt ASC.
// Search + registration-type filtering (contains-or-empty semantics) happen
// client-side over this bounded page — array-contains cannot express the
// OR-empty branch, per spec.
export async function getTicketTypesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<TicketTypeDoc>[]> {
  return findManyTicketTypes(
    where("eventId", "==", input.eventId),
    where("organizationId", "==", input.organizationId),
    orderBy("createdAt", "asc"),
    limit(input.limit ?? TICKET_TYPE_LIST_LIMIT),
  );
}

// Fetches a single ticket type scoped to event + org; null when missing or
// belonging to another event/org (treat as not-found, never as forbidden).
export async function getTicketTypeForEvent(input: {
  ticketTypeId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<TicketTypeDoc> | null> {
  const doc = await getTicketTypeById(input.ticketTypeId);

  if (
    !doc ||
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface CreateTicketTypeInput {
  organizationId: string;
  eventId: string;
  name: string;
  code: string;
  // null = unlimited; otherwise integer >= 1.
  capacity: number | null;
  // UTC Timestamps derived from event-local calendar dates; null = no bound.
  salesStart?: Timestamp | null;
  salesEnd?: Timestamp | null;
  // Manual master switch; displayed "Open" is derived at read time. Default true.
  isOpen?: boolean;
  // Eligible RegistrationType ids of the same event; [] = unrestricted. Default [].
  registrationTypeIds?: string[];
}

// Creates a ticket type with server timestamps and registeredCount 0.
// Field list is explicit — registeredCount/timestamps can never be supplied.
export async function createTicketType(
  input: CreateTicketTypeInput,
): Promise<string> {
  return ticketTypeApi.create({
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    code: normalizeRegistrationCode(input.code),
    capacity: input.capacity,
    // Server-owned counter — incremented transactionally by M2-T4/M3-T3 only.
    registeredCount: 0,
    salesStart: input.salesStart ?? null,
    salesEnd: input.salesEnd ?? null,
    isOpen: input.isOpen ?? true,
    registrationTypeIds: dedupeIds(input.registrationTypeIds ?? []),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export interface UpdateTicketTypeInput {
  name?: string;
  code?: string;
  capacity?: number | null;
  salesStart?: Timestamp | null;
  salesEnd?: Timestamp | null;
  isOpen?: boolean;
  registrationTypeIds?: string[];
}

// Allow-list update: organizationId, eventId, registeredCount and createdAt
// are server-owned and unreachable here. Bumps updatedAt.
export async function updateTicketType(
  ticketTypeId: string,
  input: UpdateTicketTypeInput,
): Promise<void> {
  const data: UpdateData<TicketTypeDoc> = {
    updatedAt: serverTimestamp(),
  };

  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = normalizeRegistrationCode(input.code);
  if (input.capacity !== undefined) data.capacity = input.capacity;
  if (input.salesStart !== undefined) data.salesStart = input.salesStart;
  if (input.salesEnd !== undefined) data.salesEnd = input.salesEnd;
  if (input.isOpen !== undefined) data.isOpen = input.isOpen;
  if (input.registrationTypeIds !== undefined) {
    data.registrationTypeIds = dedupeIds(input.registrationTypeIds);
  }

  await ticketTypeApi.update(ticketTypeId, data);
}

// Hard delete. Delete protection is BLOCK, not cascade — the server route 409s
// when registeredCount > 0.
export async function deleteTicketType(ticketTypeId: string): Promise<void> {
  await ticketTypeApi.remove(ticketTypeId);
}

// Case-insensitive per-event code uniqueness check within TicketType only —
// a ticket code may legitimately collide with a registration-type code.
// Served by the composite index TicketType: eventId ASC, code ASC.
export async function isTicketTypeCodeTaken(input: {
  eventId: string;
  code: string;
  excludeId?: string;
}): Promise<boolean> {
  const matches = await findManyTicketTypes(
    where("eventId", "==", input.eventId),
    where("code", "==", normalizeRegistrationCode(input.code)),
    limit(2),
  );

  return matches.some((doc) => doc.id !== input.excludeId);
}

// Tickets in this event whose registrationTypeIds reference the given
// registration type (delete protection for registration types; also usable
// for pre-delete warnings in the UI). Unrestricted tickets (empty array)
// never match. Served by the composite index
// TicketType: eventId ASC, organizationId ASC, registrationTypeIds CONTAINS.
export async function getTicketTypesReferencingRegistrationType(input: {
  eventId: string;
  organizationId: string;
  registrationTypeId: string;
  limit?: number;
}): Promise<WithId<TicketTypeDoc>[]> {
  return findManyTicketTypes(
    where("eventId", "==", input.eventId),
    where("organizationId", "==", input.organizationId),
    where("registrationTypeIds", "array-contains", input.registrationTypeId),
    limit(input.limit ?? REFERENCING_TICKETS_LIMIT),
  );
}
