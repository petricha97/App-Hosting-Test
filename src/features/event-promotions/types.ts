// Plain-object types used to pass EventPromotion data from Server Components
// to Client Components. Firestore Timestamps are converted to ISO strings so
// the data is safe to cross the server/client boundary without serialization errors.

// A single condition rule as it appears in a serialized event promotion (e.g. age >= 18).
export interface SerializedEventPromotionCondition {
  field: string;
  operator: string;
  value: string | number;
}

// A fully serialized EventPromotion doc — all Timestamps become ISO strings or null.
// This is the shape passed as props into Client Components like EventPromotionManager.
export interface SerializedEventPromotion {
  id: string;
  organizationId: string;
  // ID of the parent PromotionTemplate this doc was created from.
  templateId: string;
  // When true, "Apply to all" from the parent template will overwrite this doc's fields.
  // When false, this event keeps its own custom values even if the parent is updated.
  inheritFromParent: boolean;
  name: string;
  description: string;
  discountType: string;
  discountValue: number | null;
  conditions: SerializedEventPromotionCondition[];
  // When true, attendee must enter promoCode to claim the discount.
  // When false, discount auto-applies when all conditions are met.
  enablePromoCode: boolean;
  promoCode: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
