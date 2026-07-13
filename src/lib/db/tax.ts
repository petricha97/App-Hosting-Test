// Client-side data access layer for the Tax root collection.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T3).
//
// READ-ONLY on purpose: all Tax mutations are server-only (admin API routes
// via adminTax.ts, enforcing write:events + code uniqueness), and
// firestore.rules denies every client write to Tax. This repo mirrors the
// admin read surface for dashboard client components (org-scoped reads only).
import { limit, orderBy, where } from "firebase/firestore";

import { createCollectionApi } from "@/lib/db/base";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type { TaxDoc, WithId } from "@/types/collection";

export const TAX_COLLECTION = "Tax";

// Per-event tax lists are small; safety bound, not pagination.
export const TAX_LIST_LIMIT = 50;

const taxApi = createCollectionApi<TaxDoc>(TAX_COLLECTION);

const { getById: getTaxById, findMany: findManyTaxes } = taxApi;

// Lists the event's taxes, org-scoped in the query, ordered by createdAt asc.
// Served by the composite index Tax: eventId ASC, organizationId ASC, createdAt ASC.
export async function getTaxesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<TaxDoc>[]> {
  return findManyTaxes(
    where("eventId", "==", input.eventId),
    where("organizationId", "==", input.organizationId),
    orderBy("createdAt", "asc"),
    limit(input.limit ?? TAX_LIST_LIMIT),
  );
}

// Fetches a single tax scoped to event + org; null when missing or belonging
// to another event/org (treat as not-found, never as forbidden).
export async function getTaxForEvent(input: {
  taxId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<TaxDoc> | null> {
  const doc = await getTaxById(input.taxId);

  if (
    !doc ||
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

// Client-side pre-check for the create/edit dialog's field-level duplicate
// code error. ADVISORY ONLY — the authoritative check runs server-side via
// isAdminTaxCodeTaken. organizationId keeps the read inside the
// org-membership rule scope.
export async function isTaxCodeTaken(input: {
  eventId: string;
  organizationId: string;
  code: string;
  excludeId?: string;
}): Promise<boolean> {
  const matches = await findManyTaxes(
    where("eventId", "==", input.eventId),
    where("organizationId", "==", input.organizationId),
    where("code", "==", normalizeRegistrationCode(input.code)),
    limit(2),
  );

  return matches.some((doc) => doc.id !== input.excludeId);
}
