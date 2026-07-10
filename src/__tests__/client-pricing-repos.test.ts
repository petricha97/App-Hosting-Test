/**
 * M2 — client repo pairs for the pricing surface (review S-1; spec T2 AC-10).
 *
 * Exercises the read-only client repos fee.ts, tax.ts and eventPromotion.ts
 * with the SDK mocked at the same boundaries the existing client-repo tests
 * use (event-org-scoping.test.ts): @/lib/db/base for the root collections,
 * firebase/firestore + @/lib/firebase for the subcollection repo.
 *
 * Locks:
 *  - list reads are event- AND org-scoped in the query and bounded (limit 50)
 *  - single-doc getters null out cross-org/cross-event docs (not-found, never
 *    forbidden)
 *  - advisory uniqueness helpers: excludeId semantics, explicit-null
 *    registrationTypeId equality (fees), code normalization (taxes)
 *  - eventPromotion reads apply the migration-safe M2 defaults and org-check
 *    getEventPromotionById
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getByIdMock, findManyMock, getDoc, getDocs } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  findManyMock: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  where: (field: string, op: string, value: unknown) => ({
    kind: "where",
    field,
    op,
    value,
  }),
  orderBy: (field: string, direction?: string) => ({
    kind: "orderBy",
    field,
    direction,
  }),
  limit: (n: number) => ({ kind: "limit", n }),
  collection: (_db: unknown, ...path: string[]) => ({
    kind: "collection",
    path,
  }),
  doc: (parent: { path?: string[] }, id: string) => ({
    kind: "doc",
    parent,
    id,
  }),
  query: (target: unknown, ...constraints: unknown[]) => ({
    kind: "query",
    target,
    constraints,
  }),
  getDoc,
  getDocs,
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

// Root-collection repos go through createCollectionApi; the mock records the
// collection each call came from so Fee and Tax assertions stay distinct.
vi.mock("@/lib/db/base", () => ({
  createCollectionApi: (collectionName: string) => ({
    create: vi.fn(),
    set: vi.fn(),
    getById: (id: string) => getByIdMock(collectionName, id),
    getAll: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    findWhere: vi.fn(),
    findMany: (...constraints: unknown[]) =>
      findManyMock(collectionName, ...constraints),
  }),
}));

import {
  getFeeForEvent,
  getFeesForEvent,
  isActiveFeeCombinationTaken,
} from "@/lib/db/fee";
import {
  getTaxForEvent,
  getTaxesForEvent,
  isTaxCodeTaken,
} from "@/lib/db/tax";
import {
  getEventPromotionById,
  getEventPromotionsForEvent,
} from "@/lib/db/eventPromotion";

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

interface Constraint {
  kind: string;
  field?: string;
  value?: unknown;
  n?: number;
  direction?: string;
}

function constraintsOf(call: unknown[]): Constraint[] {
  return call.slice(1) as Constraint[];
}

function whereValue(constraints: Constraint[], field: string): unknown {
  return constraints.find((c) => c.kind === "where" && c.field === field)
    ?.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  getByIdMock.mockResolvedValue(null);
  getDocs.mockResolvedValue({ docs: [] });
  getDoc.mockResolvedValue({ exists: () => false });
});

describe("client fee repo (fee.ts)", () => {
  const fee = {
    id: "fee-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "GC-EB Delegate USD",
    ticketTypeId: "tt-1",
    registrationTypeId: null,
    currency: "USD",
    basePriceMinor: 95000,
    status: "active",
  };

  it("lists fees scoped to event + org, ordered by createdAt asc, bounded to 50", async () => {
    findManyMock.mockResolvedValue([fee]);

    const result = await getFeesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual([fee]);
    const [collectionName, ...constraints] = findManyMock.mock.calls[0];
    expect(collectionName).toBe("Fee");
    expect(whereValue(constraints as Constraint[], "eventId")).toBe(EVENT_ID);
    expect(whereValue(constraints as Constraint[], "organizationId")).toBe(
      ORG_ID,
    );
    expect(constraints).toContainEqual(
      expect.objectContaining({ kind: "orderBy", field: "createdAt" }),
    );
    expect(constraints).toContainEqual(
      expect.objectContaining({ kind: "limit", n: 50 }),
    );
  });

  it("getFeeForEvent nulls out cross-org and cross-event fees", async () => {
    getByIdMock.mockResolvedValue({ ...fee, organizationId: "org-other" });
    await expect(
      getFeeForEvent({ feeId: "fee-1", eventId: EVENT_ID, organizationId: ORG_ID }),
    ).resolves.toBeNull();

    getByIdMock.mockResolvedValue({ ...fee, eventId: "evt-other" });
    await expect(
      getFeeForEvent({ feeId: "fee-1", eventId: EVENT_ID, organizationId: ORG_ID }),
    ).resolves.toBeNull();

    getByIdMock.mockResolvedValue(fee);
    await expect(
      getFeeForEvent({ feeId: "fee-1", eventId: EVENT_ID, organizationId: ORG_ID }),
    ).resolves.toEqual(fee);
  });

  it("advisory uniqueness passes explicit-null registrationTypeId into the equality query", async () => {
    findManyMock.mockResolvedValue([fee]);

    const taken = await isActiveFeeCombinationTaken({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      ticketTypeId: "tt-1",
      registrationTypeId: null,
      currency: "USD",
    });

    expect(taken).toBe(true);
    const constraints = constraintsOf(findManyMock.mock.calls[0]);
    // null must reach the where() (stored explicitly — spec T1).
    expect(whereValue(constraints, "registrationTypeId")).toBeNull();
    expect(whereValue(constraints, "status")).toBe("active");
    expect(whereValue(constraints, "organizationId")).toBe(ORG_ID);
  });

  it("advisory uniqueness excludes self on edit", async () => {
    findManyMock.mockResolvedValue([fee]);

    await expect(
      isActiveFeeCombinationTaken({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        ticketTypeId: "tt-1",
        registrationTypeId: null,
        currency: "USD",
        excludeId: "fee-1",
      }),
    ).resolves.toBe(false);
  });
});

describe("client tax repo (tax.ts)", () => {
  const tax = {
    id: "tax-ny",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "New York Sales Tax",
    code: "TAX-NY",
    type: "percentage",
    rateMilliPercent: 8875,
    fixedAmountMinor: null,
    fixedCurrency: null,
    isActive: true,
  };

  it("lists taxes scoped to event + org, bounded", async () => {
    findManyMock.mockResolvedValue([tax]);

    const result = await getTaxesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual([tax]);
    const [collectionName, ...constraints] = findManyMock.mock.calls[0];
    expect(collectionName).toBe("Tax");
    expect(whereValue(constraints as Constraint[], "eventId")).toBe(EVENT_ID);
    expect(whereValue(constraints as Constraint[], "organizationId")).toBe(
      ORG_ID,
    );
    expect(constraints).toContainEqual(
      expect.objectContaining({ kind: "limit", n: 50 }),
    );
  });

  it("getTaxForEvent nulls out cross-org taxes", async () => {
    getByIdMock.mockResolvedValue({ ...tax, organizationId: "org-other" });
    await expect(
      getTaxForEvent({ taxId: "tax-ny", eventId: EVENT_ID, organizationId: ORG_ID }),
    ).resolves.toBeNull();

    getByIdMock.mockResolvedValue(tax);
    await expect(
      getTaxForEvent({ taxId: "tax-ny", eventId: EVENT_ID, organizationId: ORG_ID }),
    ).resolves.toEqual(tax);
  });

  it("isTaxCodeTaken normalizes the code (case-insensitive uniqueness) and excludes self", async () => {
    findManyMock.mockResolvedValue([tax]);

    const taken = await isTaxCodeTaken({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      code: "tax-ny",
    });

    expect(taken).toBe(true);
    const constraints = constraintsOf(findManyMock.mock.calls[0]);
    expect(whereValue(constraints, "code")).toBe("TAX-NY");

    await expect(
      isTaxCodeTaken({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        code: "TAX-NY",
        excludeId: "tax-ny",
      }),
    ).resolves.toBe(false);
  });
});

describe("client eventPromotion repo (eventPromotion.ts) — spec T2 AC-10", () => {
  // Legacy pre-M2 doc: none of the six M2 fields exist.
  const legacyPromotion = {
    organizationId: ORG_ID,
    name: "GCUS10",
    promoCode: "GCUS10",
    discountType: "percentage",
    discountValue: 10,
  };

  it("lists promotions org-scoped and applies the migration-safe defaults", async () => {
    getDocs.mockResolvedValue({
      docs: [{ id: "promo-1", data: () => legacyPromotion }],
    });

    const result = await getEventPromotionsForEvent(EVENT_ID, ORG_ID);

    expect(result).toHaveLength(1);
    // The six defaults (spec T2): level event, no window, uncapped, unused,
    // active — legacy docs parse unchanged, never rewritten.
    expect(result[0]).toMatchObject({
      id: "promo-1",
      level: "event",
      validityStart: null,
      validityEnd: null,
      usageCap: null,
      usedCount: 0,
      isActive: true,
    });

    // The query carries the org scope (rules + cross-org leak guard).
    const queryArg = getDocs.mock.calls[0][0] as {
      constraints: Array<{ kind: string; field?: string; value?: unknown }>;
    };
    expect(queryArg.constraints).toContainEqual(
      expect.objectContaining({
        kind: "where",
        field: "organizationId",
        value: ORG_ID,
      }),
    );
    expect(queryArg.constraints).toContainEqual(
      expect.objectContaining({ kind: "limit", n: 50 }),
    );
  });

  it("getEventPromotionById org-checks the doc (cross-org -> null, IDOR-safe)", async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: "promo-1",
      data: () => ({ ...legacyPromotion, organizationId: "org-other" }),
    });

    await expect(
      getEventPromotionById(EVENT_ID, "promo-1", ORG_ID),
    ).resolves.toBeNull();
  });

  it("getEventPromotionById returns the doc with defaults for the owning org", async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: "promo-1",
      data: () => ({ ...legacyPromotion, usageCap: 3, usedCount: 1 }),
    });

    const result = await getEventPromotionById(EVENT_ID, "promo-1", ORG_ID);

    expect(result).toMatchObject({
      id: "promo-1",
      promoCode: "GCUS10",
      usageCap: 3,
      usedCount: 1,
      isActive: true,
      level: "event",
    });
  });

  it("getEventPromotionById returns null for a missing doc", async () => {
    await expect(
      getEventPromotionById(EVENT_ID, "missing", ORG_ID),
    ).resolves.toBeNull();
  });

  it("malformed M2 values degrade to defaults instead of erroring (AC-5)", async () => {
    getDocs.mockResolvedValue({
      docs: [
        {
          id: "promo-bad",
          data: () => ({
            ...legacyPromotion,
            usageCap: 0, // below 1 -> uncapped
            usedCount: -4, // negative -> 0
            level: "galactic", // unknown -> event
            isActive: "yes", // non-boolean -> true
          }),
        },
      ],
    });

    const result = await getEventPromotionsForEvent(EVENT_ID, ORG_ID);

    expect(result[0]).toMatchObject({
      usageCap: null,
      usedCount: 0,
      level: "event",
      isActive: true,
    });
  });
});
