// Server-side data access layer for the Order root collection.
// Spec: agents/docs/specs/m2-pricing-commerce.md (M2-T4).
//
// Orders are SERVER-ONLY: there is deliberately NO client repo pair for this
// collection, and firestore.rules denies all client reads/writes. Totals are
// computed exclusively from Firestore state via src/lib/orders/pricing-math.ts
// — client-supplied amounts are never trusted (the finalize transaction
// recomputes and compares; mismatch aborts with PRICE_CHANGED).
//
// Doc IDs are deterministic hashes of (organizationId, eventId,
// idempotencyKey) — see src/lib/orders/order-id.ts — so create-if-absent
// inside the transaction makes finalize idempotent: repeat/concurrent calls
// with the same key yield exactly one order doc and one set of counter
// increments.
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import {
  applyEventPromotionReadDefaults,
  deriveEventPromotionAvailability,
} from "@/lib/db/eventPromotionDefaults";
import { orderIdFromIdempotencyKey } from "@/lib/orders/order-id";
import {
  computeOrderTotals,
  orderAmountsEqual,
  promotionToPricingInput,
  type PricingTax,
} from "@/lib/orders/pricing-math";
import { TAX_LIST_LIMIT } from "@/lib/db/adminTax";
import type {
  Currency,
  EventPromotionDoc,
  FeeDoc,
  OrderAmounts,
  OrderDoc,
  PaymentMethod,
  RegistrationTypeDoc,
  TaxDoc,
  TicketTypeDoc,
  WithId,
} from "@/types/collection";

export const ORDER_COLLECTION = "Order";

// Safety bound for list reads (reports/M7 will define real read surfaces).
export const ORDER_LIST_LIMIT = 50;

// Enough matches to prove "referenced" for delete-protection 409s.
const REFERENCING_ORDERS_LIMIT = 5;

function orderCol() {
  return adminDb.collection(ORDER_COLLECTION);
}

// Lists the event's orders, org-scoped in the query, newest first. Served by
// the composite index Order: eventId ASC, organizationId ASC, createdAt DESC.
export async function getAdminOrdersForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<OrderDoc>[]> {
  const snap = await orderCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("createdAt", "desc")
    .limit(input.limit ?? ORDER_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as OrderDoc) }));
}

// Fetches a single order scoped to event + org. Returns null when the doc
// does not exist OR belongs to another event/org — callers should 404 on
// null (IDOR-safe).
export async function getAdminOrderForEvent(input: {
  orderId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<OrderDoc> | null> {
  const snap = await orderCol().doc(input.orderId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as OrderDoc) };
  if (
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

// Idempotency lookup: resolves the deterministic doc ID and fetches it.
// Returns the existing order (e.g. for pre-flight checks or retry UX) or null.
export async function getAdminOrderByIdempotencyKey(input: {
  organizationId: string;
  eventId: string;
  idempotencyKey: string;
}): Promise<WithId<OrderDoc> | null> {
  return getAdminOrderForEvent({
    orderId: orderIdFromIdempotencyKey(input),
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
}

// Delete protection for fees (M2-T1 AC-5): orders referencing the fee, so the
// fee delete route can 409 and direct to Archive. Equality-only query —
// served by single-field index merging, no composite needed.
export async function getAdminOrdersReferencingFee(input: {
  eventId: string;
  organizationId: string;
  feeId: string;
  limit?: number;
}): Promise<WithId<OrderDoc>[]> {
  const snap = await orderCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("feeId", "==", input.feeId)
    .limit(input.limit ?? REFERENCING_ORDERS_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as OrderDoc) }));
}

// Delete protection for taxes (M2-T3 AC-4): orders whose applied tax lines
// include the tax, so the tax delete route can 409 and direct to deactivate.
// Equalities + array-contains — merge-servable, no composite needed.
export async function getAdminOrdersReferencingTax(input: {
  eventId: string;
  organizationId: string;
  taxId: string;
  limit?: number;
}): Promise<WithId<OrderDoc>[]> {
  const snap = await orderCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("taxIds", "array-contains", input.taxId)
    .limit(input.limit ?? REFERENCING_ORDERS_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as OrderDoc) }));
}

// ============================================================================
// Failed payment records (M2-T4 lifecycle step 2 — card declines)
// ============================================================================

export interface RecordAdminFailedOrderInput {
  organizationId: string;
  eventId: string;
  idempotencyKey: string;
  submissionId?: string | null;
  ticketTypeId: string;
  registrationTypeId: string;
  feeId: string;
  promotionId?: string | null;
  taxIds: string[];
  currency: Currency;
  // The server-computed quote the declined charge was attempted for.
  amounts: OrderAmounts;
  // Frozen at the (failed) attempt — same audit-trail rule as finalize.
  snapshot: OrderDoc["snapshot"];
  paymentProvider?: OrderDoc["paymentProvider"];
  providerPaymentId?: string | null;
  // Injectable clock so the returned readable timestamps are deterministic.
  now?: Date;
}

export interface RecordAdminFailedOrderResult {
  orderId: string;
  order: WithId<OrderDoc>;
  // false = an order already existed for this idempotency key (repeat call);
  // the existing doc is returned untouched.
  created: boolean;
}

// Persists a DECLINED card attempt as a terminal `failed` order (spec T4
// lifecycle step 2: "order kept, counters untouched"). This is deliberately
// NOT the finalize transaction: no counter reads, no counter increments —
// a failed charge must never move registeredCount/usedCount (spec AC-6).
// Create-if-absent on the same deterministic doc ID, so a repeat call with
// the same idempotency key returns the existing record (one doc per key; a
// retry after failure uses a NEW key per the provider contract).
export async function recordAdminFailedOrder(
  input: RecordAdminFailedOrderInput,
): Promise<RecordAdminFailedOrderResult> {
  const orderId = orderIdFromIdempotencyKey({
    organizationId: input.organizationId,
    eventId: input.eventId,
    idempotencyKey: input.idempotencyKey,
  });
  const orderRef = orderCol().doc(orderId);
  const nowMs = (input.now ?? new Date()).getTime();

  return adminDb.runTransaction<RecordAdminFailedOrderResult>(async (tx) => {
    const snap = await tx.get(orderRef);
    if (snap.exists) {
      return {
        orderId,
        order: { id: snap.id, ...(snap.data() as OrderDoc) },
        created: false,
      };
    }

    const orderDoc: OrderDoc = {
      organizationId: input.organizationId,
      eventId: input.eventId,
      submissionId: input.submissionId ?? null,
      ticketTypeId: input.ticketTypeId,
      registrationTypeId: input.registrationTypeId,
      feeId: input.feeId,
      promotionId: input.promotionId ?? null,
      taxIds: input.taxIds,
      currency: input.currency,
      amounts: input.amounts,
      snapshot: input.snapshot,
      // Only card charges can be declined; invoice/comp never reach here.
      paymentMethod: "card",
      paymentStatus: "failed",
      paymentProvider: input.paymentProvider ?? "simulated",
      providerPaymentId: input.providerPaymentId ?? null,
      idempotencyKey: input.idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.create(orderRef, orderDoc);

    return {
      orderId,
      order: {
        id: orderId,
        ...orderDoc,
        createdAt: Timestamp.fromMillis(nowMs),
        updatedAt: Timestamp.fromMillis(nowMs),
      },
      created: true,
    };
  });
}

// ============================================================================
// Finalize transaction
// ============================================================================

// Typed error union (spec M2-T4 lifecycle step 3, plus INVALID_REFERENCE for
// races where a referenced doc vanished/moved between the route's pre-checks
// and the transaction — routes map it to 404/400, never 500).
export type OrderFinalizeErrorCode =
  | "SOLD_OUT" // ticket type at capacity
  | "TYPE_FULL" // registration type at capacity
  | "PROMO_EXHAUSTED" // usageCap reached
  | "PROMO_EXPIRED" // promo inactive, not started, or past validityEnd
  | "PRICE_CHANGED" // re-read state no longer yields the quoted amounts
  | "INVALID_REFERENCE"; // referenced doc missing or belongs to another event/org

export type CreateAdminOrderWithFinalizeResult =
  | {
      ok: true;
      orderId: string;
      order: WithId<OrderDoc>;
      // false = this call found an existing order for the idempotency key and
      // returned it (idempotent success — no counters moved on this call).
      created: boolean;
    }
  | { ok: false; code: OrderFinalizeErrorCode; message: string };

export interface CreateAdminOrderWithFinalizeInput {
  organizationId: string;
  eventId: string;
  idempotencyKey: string;
  // null until M3-T3 wires public registration submissions.
  submissionId?: string | null;
  ticketTypeId: string;
  registrationTypeId: string;
  feeId: string;
  promotionId?: string | null;
  currency: Currency;
  // The quoted amounts the route computed (server-side) before calling the
  // payment provider. Recomputed from re-read docs inside the transaction and
  // compared — any drift aborts with PRICE_CHANGED. NEVER client-supplied.
  expectedAmounts: OrderAmounts;
  paymentMethod: PaymentMethod;
  // Finalize only writes terminal-success statuses. "pending"/"failed" card
  // records are the route's business BEFORE finalize (a failed charge must
  // never move counters, so it never reaches this transaction).
  paymentStatus: "paid" | "outstanding" | "comped";
  paymentProvider?: OrderDoc["paymentProvider"];
  providerPaymentId?: string | null;
  // Injectable clock for promo-validity tests. Defaults to now.
  now?: Date;
}

// Creates + finalizes an order in ONE Firestore transaction:
//   1. create-if-absent on the deterministic doc ID (idempotent repeat -> the
//      existing order is returned, nothing else happens);
//   2. re-read fee, ticketType, registrationType, promotion, taxes;
//   3. validate: fee active/consistent, capacity vs registeredCount on BOTH
//      ticket and registration type (null capacity = unlimited), promotion
//      derived-active + usedCount < usageCap;
//   4. recompute totals from the re-read docs and require equality with the
//      quoted amounts (PRICE_CHANGED otherwise);
//   5. atomically increment ticketType.registeredCount,
//      registrationType.registeredCount, promotion.usedCount (if promo) and
//      create the order with its final status + frozen snapshot.
// Any check failing aborts the transaction: no counter moves, no order doc.
//
// TODO(M3-T4/M5): cancellation — decrement the same three counters in one
// transaction and set a terminal state; counters must never go below 0.
export async function createAdminOrderWithFinalize(
  input: CreateAdminOrderWithFinalizeInput,
): Promise<CreateAdminOrderWithFinalizeResult> {
  const orderId = orderIdFromIdempotencyKey({
    organizationId: input.organizationId,
    eventId: input.eventId,
    idempotencyKey: input.idempotencyKey,
  });

  const orderRef = orderCol().doc(orderId);
  const feeRef = adminDb.collection("Fee").doc(input.feeId);
  const ticketRef = adminDb.collection("TicketType").doc(input.ticketTypeId);
  const regTypeRef = adminDb
    .collection("RegistrationType")
    .doc(input.registrationTypeId);
  const promotionRef = input.promotionId
    ? adminDb
        .collection("Event")
        .doc(input.eventId)
        .collection("EventPromotion")
        .doc(input.promotionId)
    : null;
  const activeTaxQuery = adminDb
    .collection("Tax")
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .limit(TAX_LIST_LIMIT);

  const nowMs = (input.now ?? new Date()).getTime();

  function fail(
    code: OrderFinalizeErrorCode,
    message: string,
  ): CreateAdminOrderWithFinalizeResult {
    return { ok: false, code, message };
  }

  function invalid(message: string): CreateAdminOrderWithFinalizeResult {
    return fail("INVALID_REFERENCE", message);
  }

  return adminDb.runTransaction<CreateAdminOrderWithFinalizeResult>(
    async (tx) => {
      // --- READS (all before any write, per Firestore transaction rules) ---
      const [orderSnap, feeSnap, ticketSnap, regTypeSnap, promoSnap, taxSnap] =
        await Promise.all([
          tx.get(orderRef),
          tx.get(feeRef),
          tx.get(ticketRef),
          tx.get(regTypeRef),
          promotionRef ? tx.get(promotionRef) : Promise.resolve(null),
          tx.get(activeTaxQuery),
        ]);

      // Idempotent repeat: same key -> return the existing order untouched.
      if (orderSnap.exists) {
        const existing = { id: orderSnap.id, ...(orderSnap.data() as OrderDoc) };
        // The hash is scoped to (org, event, key) so a mismatch here means a
        // hash collision or manual doc tampering — refuse rather than leak.
        if (
          existing.organizationId !== input.organizationId ||
          existing.eventId !== input.eventId ||
          existing.idempotencyKey !== input.idempotencyKey
        ) {
          return invalid("Existing order does not match this idempotency scope.");
        }
        return { ok: true, orderId, order: existing, created: false };
      }

      // --- Fee: must exist, belong here, be active, and price this combo ---
      if (!feeSnap.exists) return invalid("Fee not found.");
      const fee = feeSnap.data() as FeeDoc;
      if (
        fee.eventId !== input.eventId ||
        fee.organizationId !== input.organizationId
      ) {
        return invalid("Fee does not belong to this event.");
      }
      if (fee.ticketTypeId !== input.ticketTypeId) {
        return invalid("Fee does not price this ticket type.");
      }
      if (
        fee.registrationTypeId !== null &&
        fee.registrationTypeId !== input.registrationTypeId
      ) {
        return invalid("Fee does not price this registration type.");
      }
      if (fee.status !== "active" || fee.currency !== input.currency) {
        // The offer the quote was based on is no longer purchasable as quoted.
        return fail("PRICE_CHANGED", "The fee is no longer available as quoted.");
      }

      // --- Capacity: ticket type ---
      if (!ticketSnap.exists) return invalid("Ticket type not found.");
      const ticket = ticketSnap.data() as TicketTypeDoc;
      if (
        ticket.eventId !== input.eventId ||
        ticket.organizationId !== input.organizationId
      ) {
        return invalid("Ticket type does not belong to this event.");
      }
      if (ticket.capacity !== null && ticket.registeredCount >= ticket.capacity) {
        return fail("SOLD_OUT", "This ticket is sold out.");
      }

      // --- Capacity: registration type ---
      if (!regTypeSnap.exists) return invalid("Registration type not found.");
      const regType = regTypeSnap.data() as RegistrationTypeDoc;
      if (
        regType.eventId !== input.eventId ||
        regType.organizationId !== input.organizationId
      ) {
        return invalid("Registration type does not belong to this event.");
      }
      if (
        regType.capacity !== null &&
        regType.registeredCount >= regType.capacity
      ) {
        return fail("TYPE_FULL", "This registration type is full.");
      }

      // --- Promotion (optional): derived-active + cap, inside the txn ---
      let promotion: ReturnType<typeof applyEventPromotionReadDefaults> | null =
        null;
      if (promotionRef) {
        if (!promoSnap || !promoSnap.exists) {
          return invalid("Promotion not found.");
        }
        const promoData = promoSnap.data() as EventPromotionDoc;
        if (promoData.organizationId !== input.organizationId) {
          return invalid("Promotion does not belong to this event.");
        }
        promotion = applyEventPromotionReadDefaults(promoData);

        const availability = deriveEventPromotionAvailability({
          isActive: promotion.isActive,
          validityStartMs: promotion.validityStart
            ? promotion.validityStart.toMillis()
            : null,
          validityEndMs: promotion.validityEnd
            ? promotion.validityEnd.toMillis()
            : null,
          usageCap: promotion.usageCap,
          usedCount: promotion.usedCount,
          nowMs,
        });
        if (availability === "exhausted") {
          return fail("PROMO_EXHAUSTED", "This promotion has been fully used.");
        }
        if (availability !== "available") {
          return fail("PROMO_EXPIRED", "This promotion is not currently valid.");
        }
      }

      // --- Recompute totals from re-read state and compare (no trust) ---
      const activeTaxes = taxSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as TaxDoc) }))
        .filter((tax) => tax.isActive);

      const pricingTaxes: PricingTax[] = activeTaxes.map((tax) => ({
        taxId: tax.id,
        code: tax.code,
        type: tax.type,
        rateMilliPercent: tax.rateMilliPercent,
        fixedAmountMinor: tax.fixedAmountMinor,
        fixedCurrency: tax.fixedCurrency,
        isActive: tax.isActive,
      }));

      const pricingPromotion = promotion
        ? promotionToPricingInput(promotion)
        : null;

      const totals = computeOrderTotals(
        { basePriceMinor: fee.basePriceMinor, currency: fee.currency },
        pricingPromotion,
        pricingTaxes,
      );

      if (!orderAmountsEqual(totals, input.expectedAmounts)) {
        return fail(
          "PRICE_CHANGED",
          "Pricing changed while finalizing the order. Please re-quote.",
        );
      }

      // --- WRITES: order create + atomic counter increments ---
      const orderDoc: OrderDoc = {
        organizationId: input.organizationId,
        eventId: input.eventId,
        submissionId: input.submissionId ?? null,
        ticketTypeId: input.ticketTypeId,
        registrationTypeId: input.registrationTypeId,
        feeId: input.feeId,
        promotionId: input.promotionId ?? null,
        taxIds: totals.taxLines.map((line) => line.taxId),
        currency: fee.currency,
        amounts: {
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
        },
        snapshot: {
          feeName: fee.name,
          basePriceMinor: fee.basePriceMinor,
          promoCode:
            pricingPromotion && promotion ? (promotion.promoCode ?? null) : null,
          discountType: pricingPromotion?.discountType ?? null,
          discountValue: pricingPromotion?.discountValue ?? null,
          taxLines: totals.taxLines,
        },
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentStatus,
        paymentProvider: input.paymentProvider ?? "simulated",
        providerPaymentId: input.providerPaymentId ?? null,
        idempotencyKey: input.idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // create() (not set) — throws if the doc appeared since our read, which
      // makes the racing-double-submit lose cleanly and retry as a repeat.
      tx.create(orderRef, orderDoc);

      tx.update(ticketRef, {
        registeredCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(regTypeRef, {
        registeredCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (promotionRef) {
        // The ONLY writer of usedCount (spec M2-T2 AC-7).
        tx.update(promotionRef, {
          usedCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        ok: true,
        orderId,
        // Server timestamps materialize on commit; hand back a readable value.
        order: {
          id: orderId,
          ...orderDoc,
          createdAt: Timestamp.fromMillis(nowMs),
          updatedAt: Timestamp.fromMillis(nowMs),
        },
        created: true,
      };
    },
  );
}
