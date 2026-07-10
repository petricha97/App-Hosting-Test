import type { Timestamp, FieldValue } from "firebase/firestore";

export type WithId<T> = T & { id: string };

export interface OrganizationDoc {
  name: string;
  description?: string;
  logoUrl?: string;
  slug: string;
  type: "organization" | "workspace";
  status: "pending" | "verified" | "suspended";
  domain?: string;
  domainVerified: boolean;
  domainVerifiedAt?: Timestamp;
  inviteCode?: string;
  inviteCodeEnabled: boolean;
  inviteLinkToken?: string;
  inviteLinkEnabled: boolean;
  allowDomainAutoJoin: boolean;
  ownerId: string;
  memberCount: number;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface OrganizationMembership {
  organizationId: string;
  role: "owner" | "admin" | "member";
  joinedAt: Timestamp | FieldValue;
  joinMethod: "created" | "invite_link" | "invite_code" | "domain_auto_join";
}

export type UserPermission =
  | "view:events"
  | "write:events"
  | "view:form"
  | "write:form"
  | "view:invoice"
  | "write:invoice"
  | "view:promotion"
  | "write:promotion"
  | "view:organization"
  | "write:organization"
  | "view:user"
  | "write:user";

export const OWNER_PERMISSIONS: UserPermission[] = [
  "view:events",
  "write:events",
  "view:form",
  "write:form",
  "view:invoice",
  "write:invoice",
  "view:promotion",
  "write:promotion",
  "view:organization",
  "write:organization",
  "view:user",
  "write:user",
];

export const MEMBER_PERMISSIONS: UserPermission[] = [
  "view:events",
  "view:form",
  "view:invoice",
  "view:promotion",
];

export interface UserDoc {
  uid: string;
  name: string;
  email: string;
  avatarUrl?: string;
  organizationId: string;
  organizationRole: "owner" | "admin" | "member";
  organizations: OrganizationMembership[];
  emailVerified: boolean;
  status: "active" | "pending" | "suspended";
  permissions: UserPermission[];
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  lastLoginAt?: Timestamp;
}

export interface InvitationDoc {
  organizationId: string;
  type: "email" | "link" | "code";
  email?: string;
  token?: string;
  code?: string;
  role: "admin" | "member";
  maxUses?: number;
  usedCount: number;
  expiresAt?: Timestamp;
  status: "active" | "expired" | "revoked";
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DomainVerificationDoc {
  organizationId: string;
  domain: string;
  method: "email" | "dns_txt" | "dns_cname";
  verificationEmail?: string;
  verificationToken: string;
  dnsRecordType?: "TXT" | "CNAME";
  dnsRecordValue?: string;
  status: "pending" | "verified" | "failed" | "expired";
  attempts: number;
  lastAttemptAt?: Timestamp;
  verifiedAt?: Timestamp;
  expiresAt: Timestamp;
  initiatedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ConditionRule {
  field: string;
  operator: string;
  value: string | number;
}

export interface PromotionTemplateDoc {
  organizationId: string;
  name: string;
  description?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  conditions: ConditionRule[];
  // When true, attendees must enter promoCode to claim the discount.
  // When false, the discount auto-applies if all conditions are met.
  enablePromoCode: boolean;
  promoCode?: string | null;
  isArchived?: boolean;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// M2-T2 additive fields on EventPromotion (spec: agents/docs/specs/m2-pricing-commerce.md).
// All six are OPTIONAL for migration safety: pre-M2 docs and template-inherited
// docs parse unchanged with read defaults (level "event", no validity window,
// uncapped, usedCount 0, isActive true) applied by
// src/lib/db/eventPromotionDefaults.ts — never backfilled, never rewritten on load.
// They are event-local: the template cascade ("Apply to all" / inheritFromParent)
// must never overwrite them.
export type EventPromotionLevel = "event" | "partner";

export interface EventPromotionDoc {
  organizationId: string;
  templateId: string;
  inheritFromParent: boolean;
  name: string;
  description?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  conditions: ConditionRule[];
  enablePromoCode: boolean;
  promoCode?: string | null;
  // --- M2-T2 additive fields (all optional; defaults applied on read) ---
  level?: EventPromotionLevel;
  // Event-timezone day bounds stored as UTC Timestamps (same storage rule as
  // M1 sales windows). null/absent = no bound.
  validityStart?: Timestamp | null;
  validityEnd?: Timestamp | null;
  // null/absent = uncapped; otherwise integer >= 1.
  usageCap?: number | null;
  // SERVER-OWNED counter: only ever mutated inside the M2-T4 order-finalize
  // transaction (increment) / cancellation (decrement). Every client/admin
  // edit payload must strip or reject it (adminEventPromotion.ts enforces).
  usedCount?: number;
  // Manual toggle. Displayed "Active" badge is DERIVED:
  // isActive && withinValidity(now) && !capExhausted — never stored.
  isActive?: boolean;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface EventDoc {
  allowOverlap: boolean;
  capacity: number;
  createdAt: Timestamp | FieldValue;
  description: string;
  expectedGuests: number;
  eventPagePath?: string;
  formPath: string;
  invoicePath: string;
  name: string;
  organizationPath: string;
  pageMode: "default" | "custom" | "redirect";
  redirectUrl: string;
  registrationPeriod?: Record<string, string>;
  periods: Array<Record<string, string>>;
  status: "Draft" | "Published";
  timezone: string;
  updatedAt: Timestamp | FieldValue;
}

export type FormFieldType = "text" | "email" | "textarea";
export type FormFieldOrigin = "mandatory" | "template" | "event";

export type FormStatus = "draft" | "published";
export type FormTemplateStatus = "active" | "archived";

export interface FormFieldDoc {
  id: string;
  key: string;
  label: string;
  type: FormFieldType;
  placeholder: string;
  helpText: string;
  required: boolean;
  isMandatory: boolean;
  order: number;
  origin?: FormFieldOrigin;
  sourceTemplateFieldId?: string;
  rows?: number;
}

export interface FormTemplateLinkDoc {
  templateId: string;
  templateVersion: number;
  detached: boolean;
  appliedAt: Timestamp | FieldValue;
}

export interface FormDoc {
  eventId: string;
  organizationId: string;
  title: string;
  status: FormStatus;
  fields: FormFieldDoc[];
  templateLink?: FormTemplateLinkDoc;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface FormTemplateDoc {
  organizationId: string;
  title: string;
  description: string;
  status: FormTemplateStatus;
  version: number;
  fields: FormFieldDoc[];
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface FormDataDoc {
  formId: string;
  eventId: string;
  organizationId: string;
  submission: Record<string, string>;
  submittedAt: Timestamp | FieldValue;
}

// M1 — Registration data spine (spec: agents/docs/specs/m1-registration-spine.md).
// Both collections are root collections keyed by canonical organizationId + eventId
// (no legacy organizationPath). `registeredCount` is a server-owned denormalized
// counter: it defaults to 0 at create and is only ever incremented/decremented
// inside the transaction that finalizes or cancels an order/registration
// (M2-T4 / M3-T3). Create/update APIs must strip or reject client-supplied values.

export interface RegistrationTypeDoc {
  organizationId: string;
  eventId: string;
  name: string;
  // Stored uppercase; format ^[A-Z0-9][A-Z0-9/-]{1,11}$ (see src/lib/db/registrationCode.ts).
  // Unique per event within RegistrationType, case-insensitive.
  code: string;
  // null = unlimited; otherwise integer >= 1 (0 is invalid).
  capacity: number | null;
  // Server-owned counter — see block comment above.
  registeredCount: number;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface TicketTypeDoc {
  organizationId: string;
  eventId: string;
  name: string;
  // Same format + per-event uniqueness rules as RegistrationTypeDoc.code, but
  // scoped to TicketType — a ticket code may collide with a reg-type code.
  code: string;
  // null = unlimited; otherwise integer >= 1 (0 is invalid).
  capacity: number | null;
  // Server-owned counter — see block comment above.
  registeredCount: number;
  // Sales window, stored as UTC Timestamps derived from event-local calendar
  // dates (start 00:00:00.000 / end 23:59:59.999 in EventDoc.timezone). null = no bound.
  salesStart: Timestamp | null;
  salesEnd: Timestamp | null;
  // Organizer's manual master switch. Displayed "Open" state is derived:
  // isOpen && within [salesStart, salesEnd] (inclusive) — never stored.
  isOpen: boolean;
  // Eligible RegistrationType ids in the same event. Empty array = unrestricted
  // (ticket is available to every registration type).
  registrationTypeIds: string[];
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// ============================================================================
// M2 — Pricing & Commerce (spec: agents/docs/specs/m2-pricing-commerce.md)
//
// Money is INTEGER MINOR UNITS everywhere — no floats in stored amounts or
// math. All supported currencies currently use 2 minor digits; 0-decimal
// currencies (e.g. JPY) are out of scope until added to CURRENCY_MINOR_DIGITS
// in src/lib/orders/pricing-math.ts. There is NO currency conversion anywhere.
// ============================================================================

export const SUPPORTED_CURRENCIES = ["USD", "GBP", "EUR", "SGD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export type FeeStatus = "active" | "archived";

// A Fee attaches a price to a ticket, per registration type and currency.
// Root collection `Fee`, auto IDs.
export interface FeeDoc {
  organizationId: string;
  eventId: string;
  // 1–80 chars (route Zod).
  name: string;
  // Must belong to the same event (server-checked by the route).
  ticketTypeId: string;
  // null = applies to ALL registration types. Stored explicitly as null (never
  // absent) so the uniqueness equality query works. Resolution rule (fixed):
  // a specific-regType fee WINS over the "All types" fee for the same
  // ticket + currency.
  registrationTypeId: string | null;
  currency: Currency;
  // Integer >= 0 in minor units. 0 renders "Comp" (never "$0.00").
  basePriceMinor: number;
  // Uniqueness: at most one ACTIVE fee per
  // (eventId, ticketTypeId, registrationTypeId-or-null, currency).
  // Archived fees never block uniqueness and are never selectable by order
  // finalize.
  status: FeeStatus;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export type TaxType = "percentage" | "fixed";

// Root collection `Tax`, auto IDs. Exactly one of the type-specific field
// groups is set (percentage: rateMilliPercent; fixed: fixedAmountMinor +
// fixedCurrency) — the other group is stored as null.
export interface TaxDoc {
  organizationId: string;
  eventId: string;
  // 1–80 chars.
  name: string;
  // UPPERCASE, M1 code regex, unique per event WITHIN Tax (e.g. VAT-UK, TAX-NY).
  code: string;
  type: TaxType;
  // Percentage only. Integer milli-percent >= 0: 20.00% -> 20000, 8.875% -> 8875.
  // Exact integer storage, no floats.
  rateMilliPercent: number | null;
  // Fixed only. Integer minor units >= 0; applies only to orders whose
  // currency === fixedCurrency (percentage taxes are currency-agnostic).
  fixedAmountMinor: number | null;
  fixedCurrency: Currency | null;
  // Inactive taxes never apply to any order.
  isActive: boolean;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export type PaymentMethod = "card" | "invoice" | "comp" | "none";
export type PaymentStatus =
  | "pending"
  | "paid"
  | "outstanding"
  | "comped"
  | "failed";

// Server-computed integer amounts, all in OrderDoc.currency minor units.
export interface OrderAmounts {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

// One applied tax line, frozen at purchase time. Exactly one of
// rateMilliPercent / fixedAmountMinor is non-null, matching the tax's type.
export interface OrderTaxLineSnapshot {
  taxId: string;
  code: string;
  rateMilliPercent: number | null;
  fixedAmountMinor: number | null;
  amountMinor: number;
}

// Audit trail frozen at purchase: later fee/tax/promotion edits never rewrite
// an existing order's history.
export interface OrderSnapshot {
  feeName: string;
  basePriceMinor: number;
  promoCode: string | null;
  // As applied at purchase; null when no discount was applied.
  discountType: "percentage" | "fixed" | null;
  discountValue: number | null;
  taxLines: OrderTaxLineSnapshot[];
}

// Root collection `Order`. Doc ID is a deterministic hash of
// (organizationId, eventId, idempotencyKey) — see src/lib/orders/order-id.ts —
// so create-if-absent inside the finalize transaction is atomic and repeat
// submissions are idempotent. Orders are SERVER-ONLY: no client repo exists,
// firestore.rules denies all client access, and the finalize route ignores
// any client-supplied prices/totals (recomputed inside the transaction).
export interface OrderDoc {
  organizationId: string;
  eventId: string;
  // null until M3-T3 wires public registration submissions.
  submissionId: string | null;
  ticketTypeId: string;
  registrationTypeId: string;
  feeId: string;
  promotionId: string | null;
  // Ids of the taxes that produced snapshot.taxLines (delete-protection lookups).
  taxIds: string[];
  currency: Currency;
  amounts: OrderAmounts;
  snapshot: OrderSnapshot;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentProvider: "simulated";
  providerPaymentId: string | null;
  idempotencyKey: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface EventPageDoc {
  eventId: string;
  organizationId: string;
  title: string;
  status: "draft" | "published";
  storagePrefix: string;
  draftContent: Record<string, unknown>;
  publishedContent: Record<string, unknown> | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
