// Serialization helpers for converting Firestore PromotionTemplate documents
// into plain objects safe to pass from Server Components to Client Components.
import type { WithId } from "@/types/collection";
import type { PromotionTemplateDoc } from "@/types/collection";
import type { SerializedPromotionTemplate } from "@/features/promotion-templates/types";

// Converts a Firestore Timestamp object to an ISO string, or null if not set.
function serializeTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && "seconds" in (value as object)) {
    return new Date(
      Number((value as { seconds: number }).seconds) * 1000,
    ).toISOString();
  }
  return null;
}

// Converts a raw Firestore doc (with Timestamps) into a serializable object
// with string dates and normalized defaults for optional fields.
export function serializePromotionTemplate(
  doc: WithId<PromotionTemplateDoc>,
): SerializedPromotionTemplate {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    name: doc.name,
    description: doc.description ?? "",
    discountType: doc.discountType ?? "",
    discountValue: doc.discountValue ?? 0,
    conditions: doc.conditions ?? [],
    isArchived: doc.isArchived ?? false,
    createdAt: serializeTimestamp(doc.createdAt),
    updatedAt: serializeTimestamp(doc.updatedAt),
  };
}
