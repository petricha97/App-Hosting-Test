// Plain-object types used to pass promotion template data from Server Components
// to Client Components. Firestore Timestamps are converted to ISO strings so the
// data is safe to cross the server/client boundary without serialization errors.

// A single condition rule after serialization.
export interface SerializedConditionRule {
  field: string;
  operator: string;
  value: string | number;
}

// A promotion template doc with all Timestamps converted to ISO strings.
export interface SerializedPromotionTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  discountType: string;
  discountValue: number;
  conditions: SerializedConditionRule[];
  isArchived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}
