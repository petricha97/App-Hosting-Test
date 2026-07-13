// Client-side data access layer for the RegistrationType root collection.
// Spec: agents/docs/specs/m1-registration-spine.md (M1-T1).
//
// M1 dashboard CRUD flows go through the admin API routes (which use
// adminRegistrationType.ts); this client repo mirrors the same method set and
// invariants for client components that read directly, consistent with the
// other collections' client/admin repo pairs.
import {
  limit,
  orderBy,
  serverTimestamp,
  where,
  type UpdateData,
} from "firebase/firestore";

import { createCollectionApi } from "@/lib/db/base";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type { RegistrationTypeDoc, WithId } from "@/types/collection";

export const REGISTRATION_TYPE_COLLECTION = "RegistrationType";

// Per-event registration-type lists are small; this is a safety bound, not pagination.
export const REGISTRATION_TYPE_LIST_LIMIT = 50;

const registrationTypeApi = createCollectionApi<RegistrationTypeDoc>(
  REGISTRATION_TYPE_COLLECTION,
);

const {
  getById: getRegistrationTypeById,
  findMany: findManyRegistrationTypes,
} = registrationTypeApi;

// Lists the event's registration types, org-scoped in the query, ordered by
// createdAt asc. Served by the composite index
// RegistrationType: eventId ASC, organizationId ASC, createdAt ASC.
export async function getRegistrationTypesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<RegistrationTypeDoc>[]> {
  return findManyRegistrationTypes(
    where("eventId", "==", input.eventId),
    where("organizationId", "==", input.organizationId),
    orderBy("createdAt", "asc"),
    limit(input.limit ?? REGISTRATION_TYPE_LIST_LIMIT),
  );
}

// Fetches a single registration type scoped to event + org; null when missing
// or belonging to another event/org (treat as not-found, never as forbidden).
export async function getRegistrationTypeForEvent(input: {
  registrationTypeId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<RegistrationTypeDoc> | null> {
  const doc = await getRegistrationTypeById(input.registrationTypeId);

  if (
    !doc ||
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface CreateRegistrationTypeInput {
  organizationId: string;
  eventId: string;
  name: string;
  code: string;
  // null = unlimited; otherwise integer >= 1.
  capacity: number | null;
}

// Creates a registration type with server timestamps and registeredCount 0.
// Field list is explicit — registeredCount/timestamps can never be supplied.
export async function createRegistrationType(
  input: CreateRegistrationTypeInput,
): Promise<string> {
  return registrationTypeApi.create({
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    code: normalizeRegistrationCode(input.code),
    capacity: input.capacity,
    // Server-owned counter — incremented transactionally by M2-T4/M3-T3 only.
    registeredCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export interface UpdateRegistrationTypeInput {
  name?: string;
  code?: string;
  capacity?: number | null;
}

// Allow-list update: only name/code/capacity are writable. organizationId,
// eventId, registeredCount and createdAt are server-owned and unreachable
// here. Bumps updatedAt.
export async function updateRegistrationType(
  registrationTypeId: string,
  input: UpdateRegistrationTypeInput,
): Promise<void> {
  const data: UpdateData<RegistrationTypeDoc> = {
    updatedAt: serverTimestamp(),
  };

  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = normalizeRegistrationCode(input.code);
  if (input.capacity !== undefined) data.capacity = input.capacity;

  await registrationTypeApi.update(registrationTypeId, data);
}

// Hard delete. Delete protection is BLOCK, not cascade — enforce "no ticket
// references + registeredCount === 0" before calling (the server route is the
// authoritative enforcement point).
export async function deleteRegistrationType(
  registrationTypeId: string,
): Promise<void> {
  await registrationTypeApi.remove(registrationTypeId);
}

// Case-insensitive per-event code uniqueness check (codes are stored
// uppercase). Pass excludeId on edit so a doc does not collide with itself.
// Served by the composite index RegistrationType: eventId ASC, code ASC.
export async function isRegistrationTypeCodeTaken(input: {
  eventId: string;
  code: string;
  excludeId?: string;
}): Promise<boolean> {
  const matches = await findManyRegistrationTypes(
    where("eventId", "==", input.eventId),
    where("code", "==", normalizeRegistrationCode(input.code)),
    limit(2),
  );

  return matches.some((doc) => doc.id !== input.excludeId);
}
