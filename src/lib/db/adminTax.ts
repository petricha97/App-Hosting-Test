// Server-side data access layer for the Tax root collection.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T3).
//
// Invariants owned here:
// - organizationId / eventId / createdAt are server-owned: create stamps them
//   explicitly and update uses an allow-list.
// - code is normalized (trim + UPPERCASE) on every write and lookup, reusing
//   the M1 registration-code helper; unique per event WITHIN Tax.
// - Exactly one type-specific field group is stored (percentage:
//   rateMilliPercent; fixed: fixedAmountMinor + fixedCurrency) — the unused
//   group is written as null. Rates are exact integers (20.00% -> 20000
//   milli-percent), never floats; the route parses decimal input.
// - List reads are org-scoped in the query, ordered by createdAt asc, bounded.
// Route-level rules the DAL does NOT own: code uniqueness 409/field error
// (via isAdminTaxCodeTaken), the Zod discriminated-union payload validation,
// and the delete block when Orders reference the tax (adminOrder.ts helper).
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type { Currency, TaxDoc, TaxType, WithId } from "@/types/collection";

export const TAX_COLLECTION = "Tax";

// Per-event tax lists are small; safety bound, not pagination.
export const TAX_LIST_LIMIT = 50;

const taxAdminApi = createAdminCollectionApi<TaxDoc>(TAX_COLLECTION);

const { getById: getAdminTaxById } = taxAdminApi;

function taxCol() {
  return adminDb.collection(TAX_COLLECTION);
}

// Lists the event's taxes, org-scoped in the query, ordered by createdAt asc.
// Served by the composite index Tax: eventId ASC, organizationId ASC, createdAt ASC.
export async function getAdminTaxesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<TaxDoc>[]> {
  const snap = await taxCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("createdAt", "asc")
    .limit(input.limit ?? TAX_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as TaxDoc) }));
}

// The taxes that apply to new orders: every ACTIVE tax of the event.
// isActive is filtered in memory over the bounded list (no extra composite;
// per-event tax counts are tiny). Fixed taxes are further narrowed to the
// order's currency by the pricing math, not here.
export async function getAdminActiveTaxesForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<WithId<TaxDoc>[]> {
  const taxes = await getAdminTaxesForEvent(input);
  return taxes.filter((tax) => tax.isActive);
}

// Fetches a single tax scoped to event + org. Returns null when the doc does
// not exist OR belongs to another event/org — callers should 404 on null
// (IDOR-safe: never leak existence across tenants).
export async function getAdminTaxForEvent(input: {
  taxId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<TaxDoc> | null> {
  const doc = await getAdminTaxById(input.taxId);

  if (
    !doc ||
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface CreateAdminTaxInput {
  organizationId: string;
  eventId: string;
  // 1–80 chars (route Zod).
  name: string;
  // M1 code regex, normalized to UPPERCASE here; per-event unique within Tax.
  code: string;
  type: TaxType;
  // Required when type === "percentage": integer milli-percent, 0..100000.
  rateMilliPercent?: number | null;
  // Required when type === "fixed": integer minor units >= 0 + currency.
  fixedAmountMinor?: number | null;
  fixedCurrency?: Currency | null;
  // Default true.
  isActive?: boolean;
}

// Creates a tax. Field list is explicit (server-owned timestamps can never be
// supplied) and the type-specific groups are stored exclusively: the group
// not matching `type` is forced to null regardless of the caller's payload.
// Callers must run isAdminTaxCodeTaken first.
export async function createAdminTax(input: CreateAdminTaxInput): Promise<string> {
  const isPercentage = input.type === "percentage";

  const ref = await taxCol().add({
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    code: normalizeRegistrationCode(input.code),
    type: input.type,
    rateMilliPercent: isPercentage ? (input.rateMilliPercent ?? null) : null,
    fixedAmountMinor: isPercentage ? null : (input.fixedAmountMinor ?? null),
    fixedCurrency: isPercentage ? null : (input.fixedCurrency ?? null),
    isActive: input.isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
}

export interface UpdateAdminTaxInput {
  name?: string;
  code?: string;
  type?: TaxType;
  rateMilliPercent?: number | null;
  fixedAmountMinor?: number | null;
  fixedCurrency?: Currency | null;
  isActive?: boolean;
}

// Allow-list update: organizationId, eventId and createdAt are server-owned
// and unreachable here. Bumps updatedAt. When `type` is present the unused
// field group is forced to null so a percentage->fixed switch (or vice versa)
// can never leave stale values behind. The caller owns code uniqueness
// (excluding self) and the exactly-one-group payload validation.
export async function updateAdminTax(
  taxId: string,
  input: UpdateAdminTaxInput,
): Promise<void> {
  const data: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = normalizeRegistrationCode(input.code);
  if (input.isActive !== undefined) data.isActive = input.isActive;

  if (input.type !== undefined) {
    data.type = input.type;
    if (input.type === "percentage") {
      data.rateMilliPercent = input.rateMilliPercent ?? null;
      data.fixedAmountMinor = null;
      data.fixedCurrency = null;
    } else {
      data.rateMilliPercent = null;
      data.fixedAmountMinor = input.fixedAmountMinor ?? null;
      data.fixedCurrency = input.fixedCurrency ?? null;
    }
  } else {
    if (input.rateMilliPercent !== undefined) {
      data.rateMilliPercent = input.rateMilliPercent;
    }
    if (input.fixedAmountMinor !== undefined) {
      data.fixedAmountMinor = input.fixedAmountMinor;
    }
    if (input.fixedCurrency !== undefined) {
      data.fixedCurrency = input.fixedCurrency;
    }
  }

  await taxCol().doc(taxId).update(data);
}

// Hard delete. Delete protection is BLOCK, not cascade: the route must 409
// (directing to deactivate) when any Order references the tax — check via
// getAdminOrdersReferencingTax in adminOrder.ts.
export async function deleteAdminTax(taxId: string): Promise<void> {
  await taxCol().doc(taxId).delete();
}

// Case-insensitive per-event code uniqueness check within Tax only — a tax
// code may legitimately collide with ticket/registration-type codes.
// Served by the composite index Tax: eventId ASC, code ASC.
export async function isAdminTaxCodeTaken(input: {
  eventId: string;
  code: string;
  excludeId?: string;
}): Promise<boolean> {
  const snap = await taxCol()
    .where("eventId", "==", input.eventId)
    .where("code", "==", normalizeRegistrationCode(input.code))
    .limit(2)
    .get();

  return snap.docs.some((d) => d.id !== input.excludeId);
}
