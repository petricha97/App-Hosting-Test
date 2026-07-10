// Client-side data access layer for the Fee root collection.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T1).
//
// READ-ONLY on purpose: all Fee mutations are server-only (admin API routes
// via adminFee.ts, enforcing write:events + uniqueness + reference checks),
// and firestore.rules denies every client write to Fee. This repo mirrors
// the admin read surface for dashboard client components (org-scoped reads
// only — the org-membership read rule requires organizationId in the query).
import { limit, orderBy, where } from "firebase/firestore";

import { createCollectionApi } from "@/lib/db/base";
import type { Currency, FeeDoc, WithId } from "@/types/collection";

export const FEE_COLLECTION = "Fee";

// Per-event fee lists are small; safety bound, not pagination.
export const FEE_LIST_LIMIT = 50;

const feeApi = createCollectionApi<FeeDoc>(FEE_COLLECTION);

const { getById: getFeeById, findMany: findManyFees } = feeApi;

// Lists the event's fees, org-scoped in the query, ordered by createdAt asc
// (archived fees included — the Fees tab shows them with a badge). Served by
// the composite index Fee: eventId ASC, organizationId ASC, createdAt ASC.
export async function getFeesForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<FeeDoc>[]> {
  return findManyFees(
    where("eventId", "==", input.eventId),
    where("organizationId", "==", input.organizationId),
    orderBy("createdAt", "asc"),
    limit(input.limit ?? FEE_LIST_LIMIT),
  );
}

// Fetches a single fee scoped to event + org; null when missing or belonging
// to another event/org (treat as not-found, never as forbidden).
export async function getFeeForEvent(input: {
  feeId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<FeeDoc> | null> {
  const doc = await getFeeById(input.feeId);

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
// error ("A fee for this ticket, registration type and currency already
// exists"). ADVISORY ONLY — the authoritative uniqueness check runs
// server-side in the route via isAdminActiveFeeCombinationTaken.
export async function isActiveFeeCombinationTaken(input: {
  eventId: string;
  organizationId: string;
  ticketTypeId: string;
  registrationTypeId: string | null;
  currency: Currency;
  excludeId?: string;
}): Promise<boolean> {
  const matches = await findManyFees(
    where("eventId", "==", input.eventId),
    // organizationId keeps the read inside the org-membership rule scope.
    where("organizationId", "==", input.organizationId),
    where("ticketTypeId", "==", input.ticketTypeId),
    where("registrationTypeId", "==", input.registrationTypeId),
    where("currency", "==", input.currency),
    where("status", "==", "active"),
    limit(2),
  );

  return matches.some((doc) => doc.id !== input.excludeId);
}
