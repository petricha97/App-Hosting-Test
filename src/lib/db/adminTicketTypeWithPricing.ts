// Server-side transactional DAL for the M9-T1 "Create ticket" wizard.
// Spec: agents/docs/specs/m9-ticket-wizard.md §4.
//
// New file (OQ-2, resolved by Backend): NOT added to adminTicketType.ts or
// adminFee.ts. This function reaches across both the TicketType and Fee
// collections inside one transaction and has no single natural home in
// either existing file; a dedicated module keeps both of those files'
// existing exports untouched, as the spec requires. Collection-name string
// constants are duplicated here (TicketType/Fee/RegistrationType) rather
// than imported from adminTicketType.ts/adminFee.ts/adminRegistrationType.ts
// — those files' own *Col() helpers are already module-private, near-
// identical one-liners (spec §7 notes this as an existing, accepted repo
// pattern), so duplicating the string keeps this module independent of
// their internals instead of reaching into another DAL file's privates.
//
// Invariant owned here: the ticket doc and every priced Fee doc for it are
// created atomically, or nothing is written at all. This is done with a
// real Firestore transaction, not a WriteBatch, specifically because a batch
// has no read capability and so could never re-validate code uniqueness /
// registration-type membership immediately before writing (spec §4.4).
//
// Firestore's hard rule — every read in a transaction must happen before any
// write — is why this function's body is shaped in three strict phases:
//   1. READS  (§4.1): ticket-code uniqueness + per-id registration-type
//      membership, both via tx.get so they participate in the transaction's
//      optimistic-concurrency check (a plain, non-transactional .get() would
//      not be re-validated against a concurrent writer).
//   2. DECISION (§4.2): both reads are fully resolved before this function
//      looks at either result, and neither error path throws — a thrown
//      error inside a transaction body triggers Firestore's automatic
//      retry-from-scratch behavior, which is wrong for a genuine validation
//      failure (retrying won't fix a taken code). Failures are instead
//      returned as a discriminated result, mirroring the existing
//      AdminTicketTypeMutationResult / AdminFeeMutationResult convention in
//      adminTicketType.ts / adminFee.ts.
//   3. WRITES (§4.3): only reached once both reads have passed the decision
//      point — one TicketType doc, then one Fee doc per `prices` entry.
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import {
  generateWizardFeeName,
  WIZARD_ALL_REGISTRATION_TYPES_LABEL,
} from "@/lib/fees/wizard-fee-name";
import { normalizeRegistrationCode } from "@/lib/db/registrationCode";
import type { Currency, RegistrationTypeDoc } from "@/types/collection";

const TICKET_TYPE_COLLECTION = "TicketType";
const FEE_COLLECTION = "Fee";
const REGISTRATION_TYPE_COLLECTION = "RegistrationType";

function ticketTypeCol() {
  return adminDb.collection(TICKET_TYPE_COLLECTION);
}
function feeCol() {
  return adminDb.collection(FEE_COLLECTION);
}
function registrationTypeCol() {
  return adminDb.collection(REGISTRATION_TYPE_COLLECTION);
}

// Locked per spec §0: no currency picker in v1. Every Fee this transaction
// creates uses this fixed constant explicitly — same field, same Currency
// type as every other Fee, nothing new on EventDoc. Exported so the route
// (and any future server-side caller) references the single source of
// truth instead of a re-typed "USD" literal.
export const WIZARD_DEFAULT_CURRENCY: Currency = "USD";

export interface WizardPriceEntryInput {
  // null is reserved for a future "All registration types" row (Fee-model
  // parity) — see wizard-fee-name.ts's WIZARD_ALL_REGISTRATION_TYPES_LABEL.
  registrationTypeId: string | null;
  // Integer minor units >= 0 (route-validated). 0 is a deliberate "Comp" fee.
  basePriceMinor: number;
}

// Sales boundaries arrive from the route as plain Dates (routes must not
// import firebase-admin directly, same convention as adminTicketType.ts's
// SalesBoundaryInput) — converted to Timestamp here so that type never
// leaks outside the DAL.
export type WizardSalesBoundaryInput = Timestamp | Date | null;

function toSalesTimestamp(value: WizardSalesBoundaryInput): Timestamp | null {
  if (value === null) return null;
  return value instanceof Date ? Timestamp.fromDate(value) : value;
}

export interface CreateAdminTicketTypeWithPricingInput {
  organizationId: string;
  eventId: string;
  name: string;
  code: string;
  capacity: number | null;
  salesStart: WizardSalesBoundaryInput;
  salesEnd: WizardSalesBoundaryInput;
  isOpen: boolean;
  // One entry per priced registration type. registrationTypeIds on the
  // created ticket is ALWAYS derived from this array's non-null ids — never
  // accepted as a separate, independently-trusted input (spec §3.1 "Why no
  // client-supplied registrationTypeIds").
  prices: WizardPriceEntryInput[];
}

export type AdminTicketTypeWithPricingResult =
  | { ok: true; ticketTypeId: string; feeIds: string[] }
  | { ok: false; code: "CODE_TAKEN" }
  | { ok: false; code: "UNKNOWN_REGISTRATION_TYPE"; ids: string[] };

// Creates one TicketType and one Fee per `prices` entry inside a single
// Firestore transaction. Callers (the route) may run an OPTIONAL outer
// pre-check (findUnknownRegistrationTypeIds) for a faster 400 on an
// obviously-bad id, but must not treat that pre-check as authoritative —
// this function re-validates both the code and every registration-type id
// itself, which is the only check that closes the TOCTOU window between an
// outer pre-check and the actual write.
export async function createAdminTicketTypeWithPricing(
  input: CreateAdminTicketTypeWithPricingInput,
): Promise<AdminTicketTypeWithPricingResult> {
  const normalizedCode = normalizeRegistrationCode(input.code);

  // Unique non-null registration-type ids, first-seen order. The route's
  // Zod schema already rejects payload-level duplicate registrationTypeIds
  // (including duplicate nulls), so this dedupe is purely about turning N
  // price rows into the SET of ids that both (a) need a membership read
  // below and (b) become TicketType.registrationTypeIds.
  const uniqueRegistrationTypeIds = Array.from(
    new Set(
      input.prices
        .map((price) => price.registrationTypeId)
        .filter((id): id is string => id !== null),
    ),
  );

  return adminDb.runTransaction<AdminTicketTypeWithPricingResult>(
    async (tx) => {
      // ---------------------------------------------------------------
      // 1. READS — every read must happen before any write in this
      // transaction (Firestore rule, not a style choice).
      // ---------------------------------------------------------------

      // Ticket-code uniqueness, read fresh INSIDE the transaction. The
      // plain isAdminTicketTypeCodeTaken() helper (adminTicketType.ts) does
      // its own un-transactional .get() — fine for the route's optional
      // outer pre-check, but only a transactional read here closes the race
      // between that pre-check and this write actually landing.
      const codeSnap = await tx.get(
        ticketTypeCol()
          .where("eventId", "==", input.eventId)
          .where("code", "==", normalizedCode)
          .limit(2),
      );

      // Registration-type membership, re-read per unique non-null id
      // (mirrors findUnknownRegistrationTypeIds's per-id-scoped-get
      // discipline in registration-type-membership.ts, but via tx.get on a
      // doc ref — transactional reads must go through the transaction
      // handle, not that plain query helper).
      const registrationTypeSnaps = await Promise.all(
        uniqueRegistrationTypeIds.map((id) =>
          tx.get(registrationTypeCol().doc(id)),
        ),
      );

      // ---------------------------------------------------------------
      // 2. DECISION POINT — both reads are fully resolved above; decide
      // before touching any write API.
      // ---------------------------------------------------------------

      if (codeSnap.docs.length > 0) {
        return { ok: false, code: "CODE_TAKEN" };
      }

      const registrationTypeById = new Map<string, RegistrationTypeDoc>();
      const unknownIds: string[] = [];
      uniqueRegistrationTypeIds.forEach((id, index) => {
        const snap = registrationTypeSnaps[index];
        const doc = snap.exists ? (snap.data() as RegistrationTypeDoc) : null;
        // Missing and foreign (wrong event/org) are indistinguishable here,
        // same IDOR-safe convention as every other M1/M9 membership check —
        // both count as "unknown".
        if (
          !doc ||
          doc.eventId !== input.eventId ||
          doc.organizationId !== input.organizationId
        ) {
          unknownIds.push(id);
          return;
        }
        registrationTypeById.set(id, doc);
      });

      if (unknownIds.length > 0) {
        return {
          ok: false,
          code: "UNKNOWN_REGISTRATION_TYPE",
          ids: unknownIds,
        };
      }

      // ---------------------------------------------------------------
      // 3. WRITES — only reached once both reads passed the decision
      // point above.
      // ---------------------------------------------------------------

      // Transactions cannot use collection.add(); reserve an auto-id ref up
      // front (matches the existing transactional-ref pattern already used
      // by updateAdminTicketType/deleteAdminTicketType in adminTicketType.ts).
      const ticketRef = ticketTypeCol().doc();
      // Not explicitly typed as TicketTypeDoc: that interface's
      // Timestamp/FieldValue fields come from the CLIENT "firebase/firestore"
      // package (types/collection.ts is shared with client repos), while
      // this DAL writes firebase-admin Timestamps — same cross-package shape
      // the rest of this repo's admin DAL avoids by passing object literals
      // straight into tx.set()/`.add()` uncast, exactly as
      // createAdminTicketType/createAdminFee already do.
      const ticketDoc = {
        organizationId: input.organizationId,
        eventId: input.eventId,
        name: input.name,
        code: normalizedCode,
        capacity: input.capacity,
        // Server-owned counter, same as every other TicketType create path.
        registeredCount: 0,
        salesStart: toSalesTimestamp(input.salesStart),
        salesEnd: toSalesTimestamp(input.salesEnd),
        isOpen: input.isOpen,
        registrationTypeIds: uniqueRegistrationTypeIds,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.set(ticketRef, ticketDoc);

      // No isAdminActiveFeeCombinationTaken-style uniqueness read happens
      // (or is even possible) here: ticketRef.id does not exist anywhere in
      // Firestore until THIS transaction commits, so no existing Fee
      // document can already reference it — the invariant that check
      // protects ("no second fee duplicates an existing ticket's
      // (ticketTypeId, registrationTypeId, currency) combination") holds by
      // construction for every fee this transaction creates. Uniqueness
      // WITHIN this payload is instead enforced by the route's Zod
      // duplicate-registrationTypeId refine before the transaction ever
      // opens — that is sufficient because the race this DAL check
      // normally guards against ("someone else priced this exact
      // combination between your read and your write") cannot happen for a
      // ticket id that has never been allocated.
      const feeIds: string[] = [];
      for (const price of input.prices) {
        const feeRef = feeCol().doc();
        const registrationTypeLabel =
          price.registrationTypeId === null
            ? WIZARD_ALL_REGISTRATION_TYPES_LABEL
            : (registrationTypeById.get(price.registrationTypeId)?.name ??
              WIZARD_ALL_REGISTRATION_TYPES_LABEL);
        // Same reasoning as ticketDoc above — deliberately not typed as
        // FeeDoc to avoid the client/admin Timestamp package mismatch.
        const feeDoc = {
          organizationId: input.organizationId,
          eventId: input.eventId,
          name: generateWizardFeeName(
            input.name,
            registrationTypeLabel,
            WIZARD_DEFAULT_CURRENCY,
          ),
          ticketTypeId: ticketRef.id,
          registrationTypeId: price.registrationTypeId,
          currency: WIZARD_DEFAULT_CURRENCY,
          basePriceMinor: price.basePriceMinor,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        tx.set(feeRef, feeDoc);
        feeIds.push(feeRef.id);
      }

      return { ok: true, ticketTypeId: ticketRef.id, feeIds };
    },
  );
}
