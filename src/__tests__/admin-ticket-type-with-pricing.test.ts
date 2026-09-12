// @vitest-environment node
/**
 * M9-T1 — createAdminTicketTypeWithPricing transaction write-set tests.
 * Spec: agents/docs/specs/m9-ticket-wizard.md §4.
 *
 * The Admin SDK is mocked at the same module boundary the other DAL
 * transaction tests use ("@/app/lib/firestore", see
 * admin-order-finalize.test.ts) via the shared in-memory fake
 * (src/__tests__/helpers/fake-admin-db.ts) — real assertions on the WRITE
 * SET, not a mocked return value, which is what AC-6/AC-9/AC-10 need:
 *
 *  - AC-6: exactly 1 + prices.length tx.set calls on success, ALL inside
 *    one transaction; a CODE_TAKEN/UNKNOWN_REGISTRATION_TYPE abort writes
 *    ZERO documents (no partial ticket, no partial fees).
 *  - AC-7: TicketType.registrationTypeIds is the deduplicated non-null
 *    registrationTypeId set from `prices`.
 *  - AC-8: an empty `prices` array is valid — zero fees, registrationTypeIds: [].
 *  - AC-9: every created Fee is active/WIZARD_DEFAULT_CURRENCY/bounded-name/
 *    points at the newly-created ticket.
 *  - AC-10: no Fee-uniqueness query runs — verified by asserting the ONLY
 *    query this transaction issues is the ticket-code uniqueness check
 *    (registration-type membership is a direct doc get, not a query).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

// Records which collection a `.where(...)` query was built against — used
// by the AC-10 test below to prove no Fee-collection QUERY (i.e. a
// uniqueness check) ever runs, as distinct from the expected Fee `.doc()`
// WRITES every price row performs. fake-admin-db's own `queryDocReads`
// counter only tracks non-transactional `query.get()` calls, not `tx.get()`
// on a query — this transaction only ever reads via `tx.get()`, so a
// collection-name-scoped `.where()` spy is the accurate signal here.
const whereCalls: string[] = [];
function trackedCollection(name: string) {
  const col = fake.db.collection(name);
  return {
    ...col,
    where: (...args: Parameters<typeof col.where>) => {
      whereCalls.push(name);
      return col.where(...args);
    },
  };
}
const trackedDb = { ...fake.db, collection: trackedCollection };

vi.mock("@/app/lib/firestore", () => ({ adminDb: trackedDb }));

// Dynamic import (not a static `import ... from`) so this module load
// happens AFTER `fake`/`trackedDb` above are initialized — a static import
// would be hoisted ahead of those `const` lines and hit the mock factory
// while they are still in their temporal dead zone (same convention already
// used by admin-checkin-team-member.test.ts / admin-attendee.test.ts).
const { createAdminTicketTypeWithPricing } =
  await import("@/lib/db/adminTicketTypeWithPricing");

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

function seedRegistrationType(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  fake.store.set(`RegistrationType/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Delegate",
    code: "DEL",
    capacity: null,
    registeredCount: 0,
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
  whereCalls.length = 0;
});

describe("createAdminTicketTypeWithPricing — success write set (AC-6/AC-7)", () => {
  it("writes exactly 1 + prices.length docs, all inside one transaction", async () => {
    seedRegistrationType("rt-1", { name: "Delegate" });
    seedRegistrationType("rt-2", { name: "Press" });

    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [
        { registrationTypeId: "rt-1", basePriceMinor: 75000 },
        { registrationTypeId: "rt-2", basePriceMinor: 0 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.feeIds).toHaveLength(2);

    const setWrites = fake.writes.filter((w) => w.type === "set");
    expect(setWrites).toHaveLength(3); // 1 ticket + 2 fees
    expect(
      setWrites.filter((w) => w.path.startsWith("TicketType/")),
    ).toHaveLength(1);
    expect(setWrites.filter((w) => w.path.startsWith("Fee/"))).toHaveLength(2);
  });

  it("derives registrationTypeIds as the deduplicated non-null ids from prices", async () => {
    seedRegistrationType("rt-1");
    seedRegistrationType("rt-2");

    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [
        { registrationTypeId: "rt-1", basePriceMinor: 100 },
        { registrationTypeId: "rt-2", basePriceMinor: 200 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const ticketDoc = fake.store.get(`TicketType/${result.ticketTypeId}`);
    expect(new Set(ticketDoc?.registrationTypeIds as string[])).toEqual(
      new Set(["rt-1", "rt-2"]),
    );
  });

  it("creates an empty-prices ticket with registrationTypeIds: [] and zero fees (AC-8)", async () => {
    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.feeIds).toEqual([]);
    const ticketDoc = fake.store.get(`TicketType/${result.ticketTypeId}`);
    expect(ticketDoc?.registrationTypeIds).toEqual([]);
    const setWrites = fake.writes.filter((w) => w.type === "set");
    expect(setWrites).toHaveLength(1);
  });

  it("allows a zero-priced (Comp) row and stores basePriceMinor: 0 on an active fee", async () => {
    seedRegistrationType("rt-1");

    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [{ registrationTypeId: "rt-1", basePriceMinor: 0 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const feeDoc = fake.store.get(`Fee/${result.feeIds[0]}`);
    expect(feeDoc?.basePriceMinor).toBe(0);
    expect(feeDoc?.status).toBe("active");
  });
});

describe("createAdminTicketTypeWithPricing — abort paths write nothing (AC-4/AC-5/AC-6)", () => {
  it("writes zero documents when the code is already taken", async () => {
    fake.store.set("TicketType/existing", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      code: "GC-EB",
      name: "Existing",
    });

    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "gc-eb",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [{ registrationTypeId: null, basePriceMinor: 500 }],
    });

    expect(result).toEqual({ ok: false, code: "CODE_TAKEN" });
    expect(fake.writes).toHaveLength(0);
  });

  it("writes zero documents when a registration type is unknown/foreign (IDOR-safe)", async () => {
    seedRegistrationType("rt-1");
    fake.store.set("RegistrationType/rt-foreign", {
      organizationId: "other-org",
      eventId: EVENT_ID,
      name: "Foreign",
      code: "FOR",
      capacity: null,
      registeredCount: 0,
    });

    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [
        { registrationTypeId: "rt-1", basePriceMinor: 100 },
        { registrationTypeId: "rt-foreign", basePriceMinor: 200 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      code: "UNKNOWN_REGISTRATION_TYPE",
      ids: ["rt-foreign"],
    });
    expect(fake.writes).toHaveLength(0);
  });

  it("writes zero documents when a registration type id is missing entirely", async () => {
    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [{ registrationTypeId: "does-not-exist", basePriceMinor: 100 }],
    });

    expect(result).toEqual({
      ok: false,
      code: "UNKNOWN_REGISTRATION_TYPE",
      ids: ["does-not-exist"],
    });
    expect(fake.writes).toHaveLength(0);
  });
});

describe("createAdminTicketTypeWithPricing — Fee doc shape (AC-9) and no uniqueness read (AC-10)", () => {
  it("every created Fee is active, WIZARD_DEFAULT_CURRENCY, bounded-length, and points at the new ticket", async () => {
    seedRegistrationType("rt-1", { name: "Delegate" });

    const result = await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [{ registrationTypeId: "rt-1", basePriceMinor: 75000 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const feeDoc = fake.store.get(`Fee/${result.feeIds[0]}`) as Record<
      string,
      unknown
    >;
    expect(feeDoc.status).toBe("active");
    expect(feeDoc.currency).toBe("USD");
    expect(feeDoc.ticketTypeId).toBe(result.ticketTypeId);
    expect(typeof feeDoc.name).toBe("string");
    expect((feeDoc.name as string).length).toBeGreaterThan(0);
    expect((feeDoc.name as string).length).toBeLessThanOrEqual(80);
    expect(feeDoc.name).toBe("GC Early Bird — Delegate (USD)");
  });

  it("performs no Fee-collection query — the only .where() query issued is the code-uniqueness check", async () => {
    seedRegistrationType("rt-1");

    await createAdminTicketTypeWithPricing({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      prices: [{ registrationTypeId: "rt-1", basePriceMinor: 100 }],
    });

    // Registration-type membership is a direct doc get (not a query), so
    // the ONLY `.where()` query this transaction ever builds is the
    // ticket-code uniqueness check against TicketType. A Fee-uniqueness
    // check (isAdminActiveFeeCombinationTaken) would build a `.where()`
    // query against the Fee collection — none should exist, which is
    // exactly the invariant AC-10 documents.
    expect(whereCalls.filter((name) => name === "Fee")).toHaveLength(0);
    expect(whereCalls.filter((name) => name === "TicketType")).toHaveLength(1);
  });
});
