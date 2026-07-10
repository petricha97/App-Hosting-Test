// Migration-safe read defaults + derived availability for EventPromotion's
// M2-T2 fields. PURE module (type-only Firestore import) shared by the client
// repo (eventPromotion.ts), the admin repo (adminEventPromotion.ts), and the
// order-finalize transaction — one source of truth for the six defaults and
// the derived "Active" logic.
//
// Pre-M2 promotion docs (and template-inherited docs) carry none of the six
// fields; they must parse unchanged with these defaults and must NEVER be
// rewritten on load (no backfill).

import type { Timestamp } from "firebase/firestore";

import type { EventPromotionDoc, EventPromotionLevel } from "@/types/collection";

// The six M2-T2 fields with defaults applied (non-optional).
export interface EventPromotionM2Fields {
  level: EventPromotionLevel;
  validityStart: Timestamp | null;
  validityEnd: Timestamp | null;
  usageCap: number | null;
  usedCount: number;
  isActive: boolean;
}

export type EventPromotionWithDefaults = EventPromotionDoc &
  EventPromotionM2Fields;

// Applies the locked-in defaults: level "event", no validity window, uncapped,
// usedCount 0, isActive true. Malformed values (non-integer caps, negative
// counts, unknown levels) degrade to the default instead of throwing —
// existing docs must never produce read errors.
export function applyEventPromotionReadDefaults<T extends EventPromotionDoc>(
  doc: T,
): T & EventPromotionM2Fields {
  return {
    ...doc,
    level: doc.level === "partner" ? "partner" : "event",
    validityStart: doc.validityStart ?? null,
    validityEnd: doc.validityEnd ?? null,
    usageCap:
      typeof doc.usageCap === "number" &&
      Number.isInteger(doc.usageCap) &&
      doc.usageCap >= 1
        ? doc.usageCap
        : null,
    usedCount:
      typeof doc.usedCount === "number" &&
      Number.isInteger(doc.usedCount) &&
      doc.usedCount >= 0
        ? doc.usedCount
        : 0,
    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
  };
}

export type EventPromotionAvailability =
  | "available"
  | "inactive"
  | "not-started"
  | "expired"
  | "exhausted";

// Derived availability — the displayed "Active" badge is
// (availability === "available"), never a stored field. Takes epoch millis so
// it stays pure across client/admin Timestamp flavors (callers convert via
// Timestamp.toMillis()). Validity bounds are inclusive (they are stored as
// event-local day bounds: start 00:00:00.000, end 23:59:59.999).
export function deriveEventPromotionAvailability(input: {
  isActive: boolean;
  validityStartMs: number | null;
  validityEndMs: number | null;
  usageCap: number | null;
  usedCount: number;
  nowMs: number;
}): EventPromotionAvailability {
  if (!input.isActive) return "inactive";
  if (input.validityStartMs !== null && input.nowMs < input.validityStartMs) {
    return "not-started";
  }
  if (input.validityEndMs !== null && input.nowMs > input.validityEndMs) {
    return "expired";
  }
  if (input.usageCap !== null && input.usedCount >= input.usageCap) {
    return "exhausted";
  }
  return "available";
}
