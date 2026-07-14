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
  // Normalized (trim + uppercase) copy of promoCode, stamped by the DAL on
  // every write path so the public promo lookup is a Firestore EQUALITY
  // query (M3 review S4). OPTIONAL: legacy docs written before M3 lack it
  // and are found via a bounded in-memory fallback scan — never backfilled
  // on read. null when promoCode is null/empty.
  promoCodeUpper?: string | null;
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

// M3-T2: "ticket-selector" and "promo-code" are EVENT-ONLY commerce field
// types (never allowed in FormTemplates — they bind to event-scoped
// TicketTypes/EventPromotions). At most one of each per form; fixed keys
// "ticket" / "promo_code". See src/features/form/schema.ts.
export type FormFieldType =
  "text" | "email" | "textarea" | "ticket-selector" | "promo-code";
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

// M3-T4 — response approval workflow (spec: agents/docs/specs/m3-registration-paths.md).
// Forward-only status machine: new < pending < reviewed < accepted (skipping
// forward allowed, backward rejected, accepted terminal in M3 — no "rejected"
// until M5). See src/lib/db/formDataStatus.ts for the pure transition rules.
export type FormDataStatus = "new" | "pending" | "reviewed" | "accepted";

export interface FormDataDoc {
  formId: string;
  eventId: string;
  organizationId: string;
  submission: Record<string, string>;
  submittedAt: Timestamp | FieldValue;
  // --- M3-T4 additive fields (ALL optional for migration safety: legacy docs
  // read as status "new" with null order/path/ticket via the read-time
  // defaults in src/lib/db/formDataStatus.ts — no backfill, never rewritten
  // on load). Finalized M3-T3 submissions carry them populated. ---
  status?: FormDataStatus;
  // Order created by the finalize transaction; null for flat legacy submits.
  orderId?: string | null;
  // Registration path the registrant walked; null for flat legacy submits.
  pathId?: string | null;
  // Denormalized at finalize from the order's fee/ticket snapshot so the
  // responses tables render the Ticket column without an Order join.
  ticketLabel?: string | null;
  // Bumped on every status transition (transitionAdminFormDataStatus).
  statusUpdatedAt?: Timestamp | FieldValue | null;
  // Stamped exactly once, on the transition into "accepted" (terminal).
  acceptedAt?: Timestamp | FieldValue | null;
  // false until M5-T1's attendee-creation hook flips it. status "accepted"
  // with attendeeCreated false is the "hook pending" signal — healed by an
  // idempotent re-invoke of onSubmissionAccepted.
  attendeeCreated?: boolean;
  // M5-T1 additive: SHA-256 hex of the deterministic attendee QR token
  // (src/lib/qr/qr-token.ts) — the RAW token is never stored. Stamped at
  // finalize (createAdminFormDataForDraft); legacy/flat submissions lack it
  // and get one minted by the accept hook (backfill-safe read: absent means
  // "mint on accept", never a crash).
  qrTokenHash?: string | null;
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
  "pending" | "paid" | "outstanding" | "comped" | "failed";

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

// ============================================================================
// M3 — Registration Paths & Public Flow
// (spec: agents/docs/specs/m3-registration-paths.md)
//
// Both are ROOT collections (PascalCase singular) keyed by canonical
// organizationId + eventId. Both are SERVER-ONLY: no client repo pair exists
// and firestore.rules denies all client access (RegistrationDraft especially —
// it carries registrant PII and draft-token hashes).
// ============================================================================

// A RegistrationPath is the flow configuration a registrant walks through —
// one per audience × payment method. It pins the checkout currency (fee
// resolution needs (ticket, regType, currency); the path is the flow config).
// Root collection `RegistrationPath`, auto IDs.
export interface RegistrationPathDoc {
  organizationId: string;
  eventId: string;
  // 1–120 chars, free text (organizers include the "2." / "2.1" numbering
  // convention in the name per the prototype).
  name: string;
  // M1 code rules (normalizeRegistrationCode / REGISTRATION_CODE_PATTERN),
  // stored uppercase, unique per event WITHIN RegistrationPath.
  code: string;
  // null = "Any" audience. Otherwise a RegistrationType id belonging to the
  // same event (route-validated). Audience resolution rule (T1, used by T3):
  // set -> the order's registrationTypeId IS the audience; Any -> derived
  // from the selected ticket's registrationTypeIds (exactly one -> that one;
  // multiple/empty -> the registrant picks in step 2).
  audienceRegistrationTypeId: string | null;
  // Same union as OrderDoc. Step 4 (Payment) is skipped for comp/none paths.
  // At finalize, paymentMethod and currency are read from THIS doc — never
  // from the client.
  paymentMethod: PaymentMethod;
  currency: Currency;
  // Inactive paths never appear on the public picker but remain listed in
  // the admin table. Default true.
  isActive: boolean;
  // Integer >= 0; drives the admin table AND the public picker order.
  // Default max+1 within the event.
  sortOrder: number;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// Last step the registrant COMPLETED (public flow, fixed 5-step M3 flow).
// Display mapping (prototype badges): personal_info -> "Personal Information",
// ticket_options -> "Ticket & Options", summary -> "Registration Summary",
// payment -> "Payment".
export type RegistrationDraftStep =
  "personal_info" | "ticket_options" | "summary" | "payment";

// An in-progress public registration. Doubles as the abandoned-registration
// record (M3-T5): completed drafts are DELETED at finalize (only after Order
// AND FormData both exist), so existence = incomplete. A draft older than
// ABANDONED_AFTER_MS (src/lib/db/adminRegistrationDraft.ts) counts as
// abandoned — derived at read time, never stored.
//
// PII minimization (Q3 locked): stores ONLY what completion requires.
// NEVER stored: payment details of any kind, promo code TEXT (only the
// resolved promotionId), IP / user-agent.
// Root collection `RegistrationDraft`, doc IDs minted server-side by
// generateDraftId() (src/lib/draft-token.ts).
export interface RegistrationDraftDoc {
  organizationId: string;
  eventId: string;
  pathId: string;
  formId: string;
  // SHA-256 hex of the signed draft token — the RAW token is never stored.
  // Possession of a bare draftId grants no access: every read/update goes
  // through getAdminRegistrationDraftByIdAndTokenHash.
  draftTokenHash: string;
  lastStepReached: RegistrationDraftStep;
  // Validated step-1 answers (non-commerce form fields) — needed for resume
  // and for building the final FormData submission at finalize.
  stepAnswers: Record<string, string>;
  // Step-2 selections; null until chosen.
  ticketTypeId: string | null;
  registrationTypeId: string | null;
  // Resolved EventPromotion id only — the promo code TEXT is never stored.
  promotionId: string | null;
  // Finalize attempt counter (T3): starts at 1, incremented ONLY after
  // PAYMENT_FAILED so double-clicks collapse onto one idempotency key but
  // declined-card retries get a fresh key (M2 provider contract).
  attempt: number;
  // Denormalized from stepAnswers for the abandoned surface (M5-T3);
  // "" until entered. Admin lists mask the email (domain only).
  firstName: string;
  lastName: string;
  email: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// ============================================================================
// M5 — Attendees & Check-in
// (spec: agents/docs/specs/m5-attendees-checkin.md)
//
// All three are ROOT collections keyed by canonical organizationId + eventId,
// and ALL are SERVER-ONLY: no client repo pairs exist and firestore.rules
// denies all client access (Attendee carries registrant PII + QR token
// hashes; CheckinTeamMember carries access-code hashes).
// ============================================================================

// Attendee lifecycle is ORTHOGONAL to the FormData status machine: an
// Attendee is a different record, born at accept. "cancelled" exists for
// forward-compat only — no cancel UI ships in M5 (documented gap).
export type AttendeeStatus = "accepted" | "cancelled";

export type AttendeeCheckInState = "not-arrived" | "checked-in";

// Who flipped the check-in: the dashboard scanner (admin session; userId is
// the User doc id, i.e. the lowercased email) or a door team member
// (scanner session token; name denormalized for the ALREADY_CHECKED_IN
// result card — "at 09:42 by Maria").
export type AttendeeCheckedInBy =
  | { kind: "admin"; userId: string }
  | { kind: "team-member"; teamMemberId: string; name: string };

// Root collection `Attendee`. Doc id is DETERMINISTIC:
// attendeeIdFromSubmissionId(org, event, submissionId)
// (src/lib/db/attendeeId.ts) — duplicate accepts collapse onto one doc.
export interface AttendeeDoc {
  organizationId: string;
  eventId: string;
  // The FormData doc id this attendee was born from (1:1).
  submissionId: string;
  // null for legacy flat submissions that never went through finalize.
  orderId: string | null;
  pathId: string | null;
  // Denormalized from the submission map keys first_name / last_name /
  // email / company / job_title — "" when the form lacked the key.
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  jobTitle: string;
  // Denormalized from the linked Order (+ RegistrationType doc name) at
  // accept; null ids + "—" labels for legacy flat submissions.
  registrationTypeId: string | null;
  registrationTypeLabel: string;
  ticketTypeId: string | null;
  ticketLabel: string;
  // "accepted" initial; "cancelled" is model-only in M5 (no UI).
  status: AttendeeStatus;
  // Orthogonal to status. "not-arrived" initial.
  checkInState: AttendeeCheckInState;
  // Both null until the first (and only) check-in flip — never overwritten
  // (duplicate scans return the ORIGINAL values, spec T5 AC-6).
  checkedInAt: Timestamp | FieldValue | null;
  checkedInBy: AttendeeCheckedInBy | null;
  // SHA-256 hex of the deterministic QR token (src/lib/qr/qr-token.ts) —
  // the RAW token is never stored. Revocation seam: resolve compares the
  // presented token's hash against this field.
  qrTokenHash: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// Root collection `CheckinConfig`, DOC ID = eventId (1:1 per event, lazy
// upsert — no doc until the first save; reads apply CHECKIN_CONFIG_DEFAULTS,
// src/lib/db/adminCheckinConfig.ts). Toggles are stored booleans; what they
// gate is enforced in later milestones (documented).
export interface CheckinConfigDoc {
  organizationId: string;
  eventId: string;
  signatureCollection: boolean;
  photoCapture: boolean;
  photoIdVerification: boolean;
  selfPrintBadges: boolean;
  walletPasses: boolean;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// Root collection `CheckinTeamMember`, auto IDs. The scanner's credential:
// a server-minted random access code (>= 128 bits, displayed exactly once)
// whose SHA-256 hash is the ONLY persisted code material
// (src/lib/qr/scanner-session.ts). Revoke = isActive:false — the next
// resolve/confirm under any outstanding session token 401s (T5 AC-9).
export interface CheckinTeamMemberDoc {
  organizationId: string;
  eventId: string;
  name: string;
  deviceLabel: string;
  // sha256 hex of the NORMALIZED access code — the raw code is never stored.
  accessCodeHash: string;
  isActive: boolean;
  // Bumped on session exchange and on each resolve/confirm; null = never used.
  lastSeenAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// ============================================================================
// M6 — Email infrastructure (spec: agents/docs/specs/m6-email-infrastructure.md)
//
// Both are ROOT collections and BOTH are SERVER-ONLY: no client repo pairs
// exist and firestore.rules denies all client access (EmailMessage carries
// recipient PII + rendered message bodies).
// ============================================================================

// Status flow: queued -> sent | failed; failed -> queued (explicit retry,
// src/lib/db/adminEmailMessage.ts) -> sent | failed. "sent" is TERMINAL —
// a sent doc is never re-sent or mutated (a re-send is a NEW logical send
// under a new dedupeKey). No "sending" state in T1: the dev transport is
// synchronous; a real async provider may add one later (documented seam).
export type EmailMessageStatus = "queued" | "sent" | "failed";

export interface EmailRecipient {
  name: string;
  // Stored lowercased (Zod-normalized at enqueue) — matches the lowercased
  // form hashed into the deterministic doc id (emailMessageId.ts).
  email: string;
}

// Resolved sender identity SNAPSHOT frozen at enqueue (from EmailSettings or
// the read-time defaults) — never merge-rendered, never client-supplied.
export interface EmailFromIdentity {
  name: string;
  address: string;
}

// Last transport failure — message is TRUNCATED (bounded length, no stack
// traces / PII; see EMAIL_LAST_ERROR_MAX_CHARS in adminEmailMessage.ts).
export interface EmailMessageLastError {
  message: string;
  at: Timestamp | FieldValue;
}

// Root collection `EmailMessage` — the outbox / send log, one doc per
// recipient per logical send. Doc id is DETERMINISTIC:
// emailMessageId(org, event, kind, recipientEmailLower, dedupeKey)
// (src/lib/db/emailMessageId.ts) — replayed hooks / double-clicked "send"
// collapse onto exactly one doc via create-if-absent (never double-send by
// construction). Stores the RENDERED snapshot (audit parity with
// OrderSnapshot: later template edits never rewrite what was sent).
export interface EmailMessageDoc {
  organizationId: string;
  eventId: string;
  // null until M6-T2 ships the EmailDefinition entity; kind is the free-text
  // join key T2 uses to attach history to definitions without a T1 schema
  // change (e.g. "confirmation-paid", "manual").
  definitionId: string | null;
  kind: string;
  // Caller-supplied per logical send (e.g. submissionId for a confirmation,
  // an ISO date for a scheduled blast, a client-minted uuid for ad-hoc
  // manual sends). Part of the deterministic doc id.
  dedupeKey: string;
  recipient: EmailRecipient;
  attendeeId: string | null;
  submissionId: string | null;
  from: EmailFromIdentity;
  replyTo: string | null;
  // Rendered snapshot, frozen at enqueue — the transport receives these
  // exact strings; templates live with definitions (T2/T4).
  subject: string;
  bodyHtml: string;
  bodyText: string;
  status: EmailMessageStatus;
  // Completed transport attempts (incremented when an attempt lands
  // sent/failed — see adminEmailMessage.ts).
  attemptCount: number;
  lastError: EmailMessageLastError | null;
  providerMessageId: string | null;
  provider: "dev-outbox";
  queuedAt: Timestamp | FieldValue;
  sentAt: Timestamp | FieldValue | null;
  failedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// Root collection `EmailSettings`, DOC ID = eventId (1:1 per event, lazy —
// CheckinConfig pattern: no doc until the first save; reads without a doc
// resolve the documented defaults IN MEMORY, zero writes — see
// src/lib/email/sender-identity.ts). Zod-validated at write AND re-checked
// at send (src/lib/email/schemas.ts).
export interface EmailSettingsDoc {
  organizationId: string;
  eventId: string;
  fromName: string;
  // Lowercased RFC-shape email, <= 254 chars, no control characters.
  fromAddress: string;
  replyTo: string | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface EventPageDoc {
  eventId: string;
  organizationId: string;
  // M4-T2: "default" for the event's default page, else a RegistrationPath id
  // of the same event (route-validated). Legacy docs lack the field and read
  // as "default" via the schema default — no backfill. Uniqueness: one page
  // per (eventId, pageKey), enforced by lookup-then-create in adminEventPage.
  pageKey?: string;
  title: string;
  status: "draft" | "published";
  storagePrefix: string;
  draftContent: Record<string, unknown>;
  publishedContent: Record<string, unknown> | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
