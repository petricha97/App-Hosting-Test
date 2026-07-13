// Client-safe shapes for the M2 pricing screens plus the serializers the
// server pages use to hand Firestore docs to the client workspace.
// Timestamps never cross the RSC boundary — validity windows travel as UTC ms.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T1/T2/T3).

import type { EventPromotionWithDefaults } from "@/lib/db/eventPromotionDefaults";
import { timestampToMillis } from "@/features/registration/types";
import type {
  Currency,
  FeeDoc,
  FeeStatus,
  TaxDoc,
  TaxType,
  WithId,
} from "@/types/collection";

export interface SerializedFee {
  id: string;
  name: string;
  ticketTypeId: string;
  // null = all registration types.
  registrationTypeId: string | null;
  currency: Currency;
  // Integer minor units; 0 renders "Comp".
  basePriceMinor: number;
  status: FeeStatus;
}

export interface SerializedTax {
  id: string;
  name: string;
  code: string;
  type: TaxType;
  // Percentage only (integer milli-percent, e.g. 8.875% -> 8875).
  rateMilliPercent: number | null;
  // Fixed only.
  fixedAmountMinor: number | null;
  fixedCurrency: Currency | null;
  isActive: boolean;
}

// Read-only projection of an EventPromotion doc for the Discounts tab.
// The base fields are managed by the Overview promotions screen; only the
// M2 discount-settings fields (level / validity / cap / active) are editable
// here, via DiscountSettingsDialog.
export interface SerializedDiscount {
  id: string;
  name: string;
  enablePromoCode: boolean;
  promoCode: string | null;
  // Loose stored string, narrowed at display time ("percentage" | "fixed").
  discountType: string | null;
  discountValue: number | null;
  level: "event" | "partner";
  validityStartMs: number | null;
  validityEndMs: number | null;
  usageCap: number | null;
  // Server-owned counter — display only, never editable.
  usedCount: number;
  isActive: boolean;
  createdAtMs: number | null;
}

export function serializeFee(doc: WithId<FeeDoc>): SerializedFee {
  return {
    id: doc.id,
    name: doc.name,
    ticketTypeId: doc.ticketTypeId,
    registrationTypeId: doc.registrationTypeId ?? null,
    currency: doc.currency,
    basePriceMinor: doc.basePriceMinor,
    status: doc.status,
  };
}

export function serializeTax(doc: WithId<TaxDoc>): SerializedTax {
  return {
    id: doc.id,
    name: doc.name,
    code: doc.code,
    type: doc.type,
    rateMilliPercent: doc.rateMilliPercent ?? null,
    fixedAmountMinor: doc.fixedAmountMinor ?? null,
    fixedCurrency: doc.fixedCurrency ?? null,
    isActive: doc.isActive ?? true,
  };
}

// Input is the defaults-applied admin read shape, so the six M2 fields are
// guaranteed present (legacy docs already parsed with defaults — no rewrite).
export function serializeDiscount(
  doc: WithId<EventPromotionWithDefaults>,
): SerializedDiscount {
  return {
    id: doc.id,
    name: doc.name,
    enablePromoCode: doc.enablePromoCode ?? false,
    promoCode: doc.promoCode ?? null,
    discountType: doc.discountType ?? null,
    discountValue: doc.discountValue ?? null,
    level: doc.level,
    validityStartMs: timestampToMillis(doc.validityStart),
    validityEndMs: timestampToMillis(doc.validityEnd),
    usageCap: doc.usageCap,
    usedCount: doc.usedCount,
    isActive: doc.isActive,
    createdAtMs: timestampToMillis(doc.createdAt),
  };
}
