// Client-safe shapes for M3-T1 registration paths plus the serializer the
// server page uses to hand Firestore docs to the client workspace.
// Timestamps never cross the RSC boundary (the table doesn't render them).

import type {
  Currency,
  PaymentMethod,
  RegistrationPathDoc,
  WithId,
} from "@/types/collection";

export interface SerializedRegistrationPath {
  id: string;
  name: string;
  code: string;
  // null = "Any" audience.
  audienceRegistrationTypeId: string | null;
  paymentMethod: PaymentMethod;
  currency: Currency;
  isActive: boolean;
  sortOrder: number;
}

export function serializeRegistrationPath(
  doc: WithId<RegistrationPathDoc>,
): SerializedRegistrationPath {
  return {
    id: doc.id,
    name: doc.name,
    code: doc.code,
    audienceRegistrationTypeId: doc.audienceRegistrationTypeId ?? null,
    paymentMethod: doc.paymentMethod,
    currency: doc.currency,
    isActive: doc.isActive ?? true,
    sortOrder: doc.sortOrder ?? 0,
  };
}
