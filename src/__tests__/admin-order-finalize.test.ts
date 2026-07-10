// @vitest-environment node
/**
 * M2-T4 — createAdminOrderWithFinalize transaction (review B-2).
 * Spec: agents/docs/specs/m2-pricing-commerce.md (T4 ACs 1, 7, 8, 10, 11).
 *
 * The Admin SDK is mocked at the same module boundary the route tests use
 * ("@/app/lib/firestore"): an in-memory doc store + a fake runTransaction
 * that records every tx.create/tx.update, so the assertions lock the WRITE
 * SET (which docs, which counters, which values), not just the return value.
 *
 * Locks:
 *  - idempotent replay returns the existing order, created:false, ZERO writes
 *  - tampered/ drifted expectedAmounts -> PRICE_CHANGED, empty write set
 *  - SOLD_OUT at ticket capacity / TYPE_FULL at registration-type capacity
 *  - PROMO_EXHAUSTED at usageCap, PROMO_EXPIRED past validityEnd
 *  - cross-org fee -> INVALID_REFERENCE (tenancy re-checked inside the txn)
 *  - happy path: order doc at the deterministic ID + increment(1) on ALL
 *    THREE counters + frozen snapshot (promo code, discount, tax lines)
 *  - paymentStatus is a caller INPUT passed through verbatim: the
 *    method -> status mapping (card->paid/failed, invoice->outstanding,
 *    comp->comped) is the finalize-orchestration caller's job (review B-1,
 *    fullstack wiring) — this transaction only accepts terminal successes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DocData = Record<string, unknown>;

const { fakeDb, store, writes } = vi.hoisted(() => {
  const store = new Map<string, DocData>();
  const writes: Array<{
    type: "create" | "update";
    path: string;
    data: DocData;
  }> = [];

  interface FakeQuery {
    __isQuery: true;
    collectionPath: string;
    filters: Array<[string, string, unknown]>;
    where(field: string, op: string, value: unknown): FakeQuery;
    limit(n: number): FakeQuery;
  }

  function makeQuery(
    collectionPath: string,
    filters: Array<[string, string, unknown]>,
  ): FakeQuery {
    return {
      __isQuery: true,
      collectionPath,
      filters,
      where(field, op, value) {
        return makeQuery(collectionPath, [...filters, [field, op, value]]);
      },
      limit() {
        return makeQuery(collectionPath, filters);
      },
    };
  }

  interface FakeRef {
    __isRef: true;
    id: string;
    path: string;
    collection(sub: string): FakeCollection;
  }

  interface FakeCollection {
    doc(id?: string): FakeRef;
    where(field: string, op: string, value: unknown): FakeQuery;
  }

  function makeDocRef(path: string): FakeRef {
    return {
      __isRef: true,
      id: path.split("/").pop()!,
      path,
      collection(sub: string) {
        return makeCollection(`${path}/${sub}`);
      },
    };
  }

  let autoId = 0;
  function makeCollection(path: string): FakeCollection {
    return {
      doc(id?: string) {
        return makeDocRef(`${path}/${id ?? `auto-${autoId++}`}`);
      },
      where(field, op, value) {
        return makeQuery(path, [[field, op, value]]);
      },
    };
  }

  const tx = {
    get(target: FakeRef | FakeQuery) {
      if ("__isQuery" in target && target.__isQuery) {
        const depth = target.collectionPath.split("/").length + 1;
        const docs = [...store.entries()]
          .filter(
            ([p]) =>
              p.startsWith(`${target.collectionPath}/`) &&
              p.split("/").length === depth,
          )
          .filter(([, data]) =>
            target.filters.every(([f, op, v]) =>
              op === "==" ? data[f] === v : true,
            ),
          )
          .map(([p, data]) => ({ id: p.split("/").pop()!, data: () => data }));
        return { docs };
      }
      const ref = target as FakeRef;
      const data = store.get(ref.path);
      return { exists: data !== undefined, id: ref.id, data: () => data };
    },
    create(ref: FakeRef, data: DocData) {
      if (store.has(ref.path)) {
        throw new Error(`ALREADY_EXISTS: ${ref.path}`);
      }
      writes.push({ type: "create", path: ref.path, data });
      store.set(ref.path, data);
    },
    update(ref: FakeRef, data: DocData) {
      writes.push({ type: "update", path: ref.path, data });
    },
  };

  const fakeDb = {
    collection: (name: string) => makeCollection(name),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };

  return { fakeDb, store, writes };
});

vi.mock("@/app/lib/firestore", () => ({ adminDb: fakeDb }));

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  createAdminOrderWithFinalize,
  type CreateAdminOrderWithFinalizeInput,
} from "@/lib/db/adminOrder";
import { orderIdFromIdempotencyKey } from "@/lib/orders/order-id";
import type { OrderAmounts, OrderDoc } from "@/types/collection";

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-other";
const EVENT_ID = "evt-1";
const FEE_ID = "fee-1";
const TICKET_ID = "tt-1";
const REG_TYPE_ID = "rt-1";
const PROMO_ID = "promo-1";
const IDEMPOTENCY_KEY = "reg-abc-attempt-1";

const NOW = new Date("2026-07-10T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// Fixture math (pinned by pricing-math.test.ts): base 10000 minor, 10% promo
// -> discount 1000, taxable 9000, 20% tax -> 1800, total 10800.
const QUOTE: OrderAmounts = {
  subtotalMinor: 10000,
  discountMinor: 1000,
  taxMinor: 1800,
  totalMinor: 10800,
};

function seedBaseline() {
  store.set(`Fee/${FEE_ID}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Standard",
    ticketTypeId: TICKET_ID,
    registrationTypeId: null,
    currency: "USD",
    basePriceMinor: 10000,
    status: "active",
  });
  store.set(`TicketType/${TICKET_ID}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    capacity: 100,
    registeredCount: 10,
  });
  store.set(`RegistrationType/${REG_TYPE_ID}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    capacity: 50,
    registeredCount: 5,
  });
  store.set(`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`, {
    organizationId: ORG_ID,
    templateId: "tpl-1",
    inheritFromParent: false,
    name: "Save 10",
    conditions: [],
    enablePromoCode: true,
    promoCode: "SAVE10",
    discountType: "percentage",
    discountValue: 10,
    level: "event",
    validityStart: null,
    validityEnd: null,
    usageCap: 5,
    usedCount: 1,
    isActive: true,
  });
  store.set("Tax/tax-1", {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "VAT",
    code: "VAT",
    type: "percentage",
    rateMilliPercent: 20000,
    fixedAmountMinor: null,
    fixedCurrency: null,
    isActive: true,
  });
  // Inactive tax must never produce a line (and never perturb PRICE_CHANGED).
  store.set("Tax/tax-off", {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Old levy",
    code: "OLD",
    type: "percentage",
    rateMilliPercent: 5000,
    fixedAmountMinor: null,
    fixedCurrency: null,
    isActive: false,
  });
}

function baseInput(
  overrides: Partial<CreateAdminOrderWithFinalizeInput> = {},
): CreateAdminOrderWithFinalizeInput {
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    ticketTypeId: TICKET_ID,
    registrationTypeId: REG_TYPE_ID,
    feeId: FEE_ID,
    promotionId: PROMO_ID,
    currency: "USD",
    expectedAmounts: { ...QUOTE },
    paymentMethod: "card",
    paymentStatus: "paid",
    now: NOW,
    ...overrides,
  };
}

const ORDER_PATH = `Order/${orderIdFromIdempotencyKey({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
})}`;

beforeEach(() => {
  store.clear();
  writes.length = 0;
  seedBaseline();
});

describe("createAdminOrderWithFinalize — happy path (AC-2/AC-10/AC-11)", () => {
  it("creates the order at the deterministic ID with recomputed amounts and a frozen snapshot", async () => {
    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: true, created: true });
    if (!result.ok) throw new Error("unreachable");
    expect(`Order/${result.orderId}`).toBe(ORDER_PATH);

    const created = writes.find(
      (w) => w.type === "create" && w.path === ORDER_PATH,
    );
    expect(created).toBeDefined();
    const order = created!.data as unknown as OrderDoc;

    // Amounts are the transaction's own recomputation (equal to the quote).
    expect(order.amounts).toEqual(QUOTE);
    expect(order.currency).toBe("USD");
    // Frozen snapshot: fee, promo and tax lines as purchased (AC-10 — later
    // edits to Fee/Tax/Promotion docs can never rewrite this history).
    expect(order.snapshot).toEqual({
      feeName: "Standard",
      basePriceMinor: 10000,
      promoCode: "SAVE10",
      discountType: "percentage",
      discountValue: 10,
      taxLines: [
        {
          taxId: "tax-1",
          code: "VAT",
          rateMilliPercent: 20000,
          fixedAmountMinor: null,
          amountMinor: 1800,
        },
      ],
    });
    // Inactive tax produced no line and no id.
    expect(order.taxIds).toEqual(["tax-1"]);
    // paymentStatus/method are caller inputs passed through verbatim — the
    // card->paid / invoice->outstanding / comp->comped mapping happens in the
    // finalize orchestration BEFORE this transaction (review B-1).
    expect(order.paymentMethod).toBe("card");
    expect(order.paymentStatus).toBe("paid");
    expect(order.idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });

  it("increments all three counters exactly once (AC-11: this txn is the only usedCount writer)", async () => {
    await createAdminOrderWithFinalize(baseInput());

    const updates = writes.filter((w) => w.type === "update");
    expect(updates.map((w) => w.path).sort()).toEqual([
      `Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`,
      `RegistrationType/${REG_TYPE_ID}`,
      `TicketType/${TICKET_ID}`,
    ]);

    const byPath = Object.fromEntries(updates.map((w) => [w.path, w.data]));
    expect(byPath[`TicketType/${TICKET_ID}`].registeredCount).toEqual(
      FieldValue.increment(1),
    );
    expect(byPath[`RegistrationType/${REG_TYPE_ID}`].registeredCount).toEqual(
      FieldValue.increment(1),
    );
    expect(
      byPath[`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`].usedCount,
    ).toEqual(FieldValue.increment(1));
  });

  it("finalizes a promo-less comp order without touching any promotion", async () => {
    store.set(`Fee/${FEE_ID}`, {
      ...store.get(`Fee/${FEE_ID}`)!,
      basePriceMinor: 0,
    });

    const result = await createAdminOrderWithFinalize(
      baseInput({
        promotionId: null,
        paymentMethod: "comp",
        paymentStatus: "comped",
        expectedAmounts: {
          subtotalMinor: 0,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 0,
        },
      }),
    );

    expect(result).toMatchObject({ ok: true, created: true });
    const updates = writes.filter((w) => w.type === "update");
    // Only the two capacity counters — no EventPromotion write.
    expect(updates.map((w) => w.path).sort()).toEqual([
      `RegistrationType/${REG_TYPE_ID}`,
      `TicketType/${TICKET_ID}`,
    ]);
    const order = store.get(ORDER_PATH) as unknown as OrderDoc;
    expect(order.paymentStatus).toBe("comped");
    expect(order.amounts.totalMinor).toBe(0);
  });
});

describe("createAdminOrderWithFinalize — idempotency (AC-7/AC-8)", () => {
  it("replaying the same idempotency key returns the existing order, created:false, and moves NO counters", async () => {
    const first = await createAdminOrderWithFinalize(baseInput());
    expect(first).toMatchObject({ ok: true, created: true });
    const writesAfterFirst = writes.length;

    const replay = await createAdminOrderWithFinalize(baseInput());

    expect(replay).toMatchObject({ ok: true, created: false });
    if (!replay.ok || !first.ok) throw new Error("unreachable");
    expect(replay.orderId).toBe(first.orderId);
    // One order doc, ONE set of increments total (AC-7).
    expect(writes.length).toBe(writesAfterFirst);
  });

  it("refuses an existing doc that does not match the idempotency scope (hash tamper guard)", async () => {
    store.set(ORDER_PATH, {
      organizationId: OTHER_ORG_ID,
      eventId: EVENT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
    expect(writes).toHaveLength(0);
  });
});

describe("createAdminOrderWithFinalize — abort paths commit an EMPTY write set", () => {
  it("returns PRICE_CHANGED when the quoted amounts no longer match the re-read state (AC-1)", async () => {
    const result = await createAdminOrderWithFinalize(
      baseInput({
        expectedAmounts: { ...QUOTE, totalMinor: QUOTE.totalMinor - 1 },
      }),
    );

    expect(result).toMatchObject({ ok: false, code: "PRICE_CHANGED" });
    expect(writes).toHaveLength(0);
    expect(store.has(ORDER_PATH)).toBe(false);
  });

  it("returns PRICE_CHANGED when the fee was archived between quote and finalize", async () => {
    store.set(`Fee/${FEE_ID}`, {
      ...store.get(`Fee/${FEE_ID}`)!,
      status: "archived",
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "PRICE_CHANGED" });
    expect(writes).toHaveLength(0);
  });

  it("returns SOLD_OUT when the ticket type is at capacity (AC-8: the losing racer)", async () => {
    store.set(`TicketType/${TICKET_ID}`, {
      ...store.get(`TicketType/${TICKET_ID}`)!,
      capacity: 100,
      registeredCount: 100,
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "SOLD_OUT" });
    expect(writes).toHaveLength(0);
    expect(store.has(ORDER_PATH)).toBe(false);
  });

  it("returns TYPE_FULL when the registration type is at capacity", async () => {
    store.set(`RegistrationType/${REG_TYPE_ID}`, {
      ...store.get(`RegistrationType/${REG_TYPE_ID}`)!,
      capacity: 5,
      registeredCount: 5,
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "TYPE_FULL" });
    expect(writes).toHaveLength(0);
  });

  it("returns PROMO_EXHAUSTED when usedCount has reached usageCap", async () => {
    store.set(`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`, {
      ...store.get(`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`)!,
      usageCap: 5,
      usedCount: 5,
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "PROMO_EXHAUSTED" });
    expect(writes).toHaveLength(0);
  });

  it("returns PROMO_EXPIRED when now is past validityEnd", async () => {
    store.set(`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`, {
      ...store.get(`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`)!,
      validityEnd: Timestamp.fromMillis(NOW.getTime() - DAY_MS),
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "PROMO_EXPIRED" });
    expect(writes).toHaveLength(0);
  });

  it("returns PROMO_EXPIRED when the promotion is switched inactive", async () => {
    store.set(`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`, {
      ...store.get(`Event/${EVENT_ID}/EventPromotion/${PROMO_ID}`)!,
      isActive: false,
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "PROMO_EXPIRED" });
    expect(writes).toHaveLength(0);
  });

  it("returns INVALID_REFERENCE when the fee belongs to another org (tenancy re-check inside the txn)", async () => {
    store.set(`Fee/${FEE_ID}`, {
      ...store.get(`Fee/${FEE_ID}`)!,
      organizationId: OTHER_ORG_ID,
    });

    const result = await createAdminOrderWithFinalize(baseInput());

    expect(result).toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
    expect(writes).toHaveLength(0);
  });
});
