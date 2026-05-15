// Utilities for the event-promotions feature.
// Contains three exports:
//   serializeEventPromotion  — converts a Firestore doc to a safe client-side shape
//   formatConditionRule      — turns a condition rule into a human-readable string (e.g. "Age ≥ 18")
//   evaluateConditions       — checks whether all conditions pass for a given attendee data object

import type { WithId } from "@/types/collection";
import type { EventPromotionDoc } from "@/types/collection";
import type {
  SerializedEventPromotion,
  SerializedEventPromotionCondition,
} from "@/features/event-promotions/types";
import { CONDITION_FIELD_OPTIONS } from "@/features/promotion-templates/fields";

// Converts a Firestore Timestamp object to an ISO date string, or null if not set.
// Handles both live Timestamp objects (which have .seconds) and FieldValue sentinels.
function serializeTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && "seconds" in (value as object)) {
    return new Date(
      Number((value as { seconds: number }).seconds) * 1000,
    ).toISOString();
  }
  return null;
}

// Converts a raw EventPromotion Firestore doc (with Timestamps) into a plain
// serializable object with normalized defaults for optional nullable fields.
// enablePromoCode and promoCode default to false/null for docs created before
// these fields were added.
export function serializeEventPromotion(
  doc: WithId<EventPromotionDoc>,
): SerializedEventPromotion {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    templateId: doc.templateId,
    inheritFromParent: doc.inheritFromParent,
    name: doc.name,
    description: doc.description ?? "",
    discountType: doc.discountType ?? "",
    discountValue: doc.discountValue ?? null,
    conditions: doc.conditions ?? [],
    enablePromoCode: doc.enablePromoCode ?? false,
    promoCode: doc.promoCode ?? null,
    createdAt: serializeTimestamp(doc.createdAt),
    updatedAt: serializeTimestamp(doc.updatedAt),
  };
}

// Maps raw operator symbols to human-readable labels for display on the event page.
const OPERATOR_LABELS: Record<string, string> = {
  "=": "=",
  "!=": "≠",
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  contains: "contains",
};

// Converts a single condition rule into a readable string shown on the event page.
// Example: { field: "age", operator: ">=", value: 18 } → "Age ≥ 18"
// Falls back to the raw field key if no display label is found.
export function formatConditionRule(
  rule: SerializedEventPromotionCondition,
): string {
  const fieldLabel =
    CONDITION_FIELD_OPTIONS.find((opt) => opt.key === rule.field)?.label ??
    rule.field;
  const operatorLabel = OPERATOR_LABELS[rule.operator] ?? rule.operator;
  return `${fieldLabel} ${operatorLabel} ${rule.value}`;
}

// Evaluates all condition rules against a flat attendee data object.
// Returns true only if every condition passes; false if any condition fails
// or if a field value is missing from attendeeData.
// Used for auto-apply logic when enablePromoCode is false.
//
// attendeeData is expected to be a Record<string, string | number> built from
// the registration form submission (e.g. { age: "25", nationality: "Singapore" }).
export function evaluateConditions(
  conditions: SerializedEventPromotionCondition[],
  attendeeData: Record<string, string | number>,
): boolean {
  // If there are no conditions, the promotion applies to everyone.
  if (conditions.length === 0) return true;

  return conditions.every((rule) => {
    const rawValue = attendeeData[rule.field];
    if (rawValue === undefined || rawValue === null) return false;

    const actual = typeof rawValue === "number" ? rawValue : String(rawValue);
    const expected =
      typeof rule.value === "number" ? rule.value : String(rule.value);

    switch (rule.operator) {
      case "=":
        return String(actual) === String(expected);
      case "!=":
        return String(actual) !== String(expected);
      case ">":
        return Number(actual) > Number(expected);
      case ">=":
        return Number(actual) >= Number(expected);
      case "<":
        return Number(actual) < Number(expected);
      case "<=":
        return Number(actual) <= Number(expected);
      case "contains":
        return String(actual)
          .toLowerCase()
          .includes(String(expected).toLowerCase());
      default:
        return false;
    }
  });
}
