// Client-safe shapes for the M1 registration spine plus the serializers the
// server pages use to hand Firestore docs to the client workspaces.
// Timestamps never cross the RSC boundary — sales windows travel as UTC ms.

import type {
  RegistrationTypeDoc,
  TicketTypeDoc,
  WithId,
} from "@/types/collection";

export interface SerializedRegistrationType {
  id: string;
  name: string;
  code: string;
  capacity: number | null;
  registeredCount: number;
}

export interface SerializedTicketType {
  id: string;
  name: string;
  code: string;
  capacity: number | null;
  registeredCount: number;
  salesStartMs: number | null;
  salesEndMs: number | null;
  isOpen: boolean;
  registrationTypeIds: string[];
}

// Tolerant Timestamp -> ms conversion (admin Timestamps expose toMillis; a
// plain {seconds, nanoseconds} shape can appear after JSON round-trips).
function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    toMillis?: () => number;
    seconds?: number | string;
  };

  if (typeof candidate.toMillis === "function") {
    return candidate.toMillis();
  }
  if (candidate.seconds !== undefined) {
    return Number(candidate.seconds) * 1000;
  }
  return null;
}

export function serializeRegistrationType(
  doc: WithId<RegistrationTypeDoc>,
): SerializedRegistrationType {
  return {
    id: doc.id,
    name: doc.name,
    code: doc.code,
    capacity: doc.capacity ?? null,
    registeredCount: doc.registeredCount ?? 0,
  };
}

export function serializeTicketType(
  doc: WithId<TicketTypeDoc>,
): SerializedTicketType {
  return {
    id: doc.id,
    name: doc.name,
    code: doc.code,
    capacity: doc.capacity ?? null,
    registeredCount: doc.registeredCount ?? 0,
    salesStartMs: timestampToMillis(doc.salesStart),
    salesEndMs: timestampToMillis(doc.salesEnd),
    isOpen: doc.isOpen ?? true,
    registrationTypeIds: doc.registrationTypeIds ?? [],
  };
}
