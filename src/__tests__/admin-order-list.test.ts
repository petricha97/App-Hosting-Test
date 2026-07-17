// @vitest-environment node
/**
 * M7-T2 — Order & transaction details report data source
 * (src/lib/db/adminOrder.ts's getAdminOrdersForEvent cursor extension).
 * Spec: agents/docs/specs/m7-report-templates.md §2/§7, Gap analysis
 * ("extend getAdminOrdersForEvent with startAfterCreatedAtMs cursor params").
 *
 * Locks:
 *  - org-scoped equality filters, newest-first (createdAt DESC) — unchanged
 *    from the pre-M7-T2 shape
 *  - NEW: startAfterCreatedAtMs cursor advances correctly across a page
 *    boundary with zero duplicate/missing rows (same convention as every
 *    other paginated list in this app — listAdminAttendeesForEvent,
 *    listAdminEmailMessagesForEvent, listAdminOrdersForEventByPaymentStatus)
 *  - cross-org / cross-event rows never leak into any page
 *  - `limit` accepts values well above the default ORDER_LIST_LIMIT (50),
 *    up to and including the export path's 200-row internal batch size and
 *    the 1000-row export ceiling — the DAL itself imposes no smaller,
 *    hidden cap
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { getAdminOrdersForEvent, ORDER_LIST_LIMIT } =
  await import("@/lib/db/adminOrder");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function seedOrder(id: string, overrides: Record<string, unknown> = {}): void {
  fake.store.set(`Order/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: `sub-${id}`,
    ticketTypeId: "tt-1",
    registrationTypeId: "rt-1",
    feeId: "fee-1",
    promotionId: null,
    taxIds: [],
    currency: "USD",
    amounts: {
      subtotalMinor: 1000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1000,
    },
    snapshot: {
      feeName: "Fee",
      basePriceMinor: 1000,
      promoCode: null,
      discountType: null,
      discountValue: null,
      taxLines: [],
    },
    paymentMethod: "invoice",
    paymentStatus: "outstanding",
    paymentProvider: "simulated",
    providerPaymentId: null,
    idempotencyKey: id,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("getAdminOrdersForEvent — base shape (unchanged)", () => {
  it("returns the event's orders newest first, org-scoped", async () => {
    seedOrder("o-1", { createdAt: { seconds: 10 } });
    seedOrder("o-2", { createdAt: { seconds: 30 } });
    seedOrder("o-3", { createdAt: { seconds: 20 } });

    const rows = await getAdminOrdersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows.map((r) => r.id)).toEqual(["o-2", "o-3", "o-1"]);
  });

  it("never leaks another org's or event's orders", async () => {
    seedOrder("o-mine", { createdAt: { seconds: 1 } });
    seedOrder("o-other-org", {
      organizationId: "org-other",
      createdAt: { seconds: 2 },
    });
    seedOrder("o-other-event", {
      eventId: "evt-other",
      createdAt: { seconds: 3 },
    });

    const rows = await getAdminOrdersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows.map((r) => r.id)).toEqual(["o-mine"]);
  });

  it("defaults to ORDER_LIST_LIMIT when no limit is given", async () => {
    for (let i = 0; i < ORDER_LIST_LIMIT + 5; i += 1) {
      seedOrder(`o-${i}`, { createdAt: { seconds: i } });
    }

    const rows = await getAdminOrdersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toHaveLength(ORDER_LIST_LIMIT);
  });
});

describe("getAdminOrdersForEvent — startAfterCreatedAtMs cursor (M7-T2, Run pagination)", () => {
  it("advances the cursor across a page boundary with zero duplicate/missing rows", async () => {
    const TOTAL = 120;
    for (let i = 0; i < TOTAL; i += 1) {
      seedOrder(`o-${i}`, { createdAt: { seconds: i } });
    }

    const seenIds: string[] = [];
    let cursorMs: number | undefined;
    for (let page = 0; page < 3; page += 1) {
      const rows = await getAdminOrdersForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        limit: 50,
        startAfterCreatedAtMs: cursorMs,
      });
      seenIds.push(...rows.map((r) => r.id));
      const last = rows[rows.length - 1];
      cursorMs =
        typeof last.createdAt === "object" &&
        last.createdAt !== null &&
        "seconds" in last.createdAt
          ? (last.createdAt as { seconds: number }).seconds * 1000
          : undefined;
    }

    // Newest-first pages: [119..70], [69..20], [19..0] — 50 + 50 + 20.
    expect(seenIds).toHaveLength(TOTAL);
    expect(new Set(seenIds).size).toBe(TOTAL); // no duplicates
    expect(seenIds[0]).toBe("o-119");
    expect(seenIds[seenIds.length - 1]).toBe("o-0");
  });

  it("the cursor is scoped to this event/org — a same-timestamp row in another org never leaks in", async () => {
    seedOrder("o-mine-1", { createdAt: { seconds: 10 } });
    seedOrder("o-mine-2", { createdAt: { seconds: 20 } });
    seedOrder("o-other-org", {
      organizationId: "org-other",
      createdAt: { seconds: 15 },
    });

    const page = await getAdminOrdersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 1,
      startAfterCreatedAtMs: 20 * 1000,
    });

    expect(page.map((r) => r.id)).toEqual(["o-mine-1"]);
  });
});

describe("getAdminOrdersForEvent — export-volume limit (M7-T2 D2/D3)", () => {
  it("honors a limit well above the default ORDER_LIST_LIMIT (200-row export batch size)", async () => {
    const TOTAL = 250;
    for (let i = 0; i < TOTAL; i += 1) {
      seedOrder(`o-${i}`, { createdAt: { seconds: i } });
    }

    const batch = await getAdminOrdersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 200,
    });

    expect(batch).toHaveLength(200);
  });

  it("honors a limit at the full 1000-row export ceiling with no hidden internal cap", async () => {
    const TOTAL = 1000;
    for (let i = 0; i < TOTAL; i += 1) {
      seedOrder(`o-${i}`, { createdAt: { seconds: i } });
    }

    const all = await getAdminOrdersForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 1000,
    });

    expect(all).toHaveLength(1000);
  });
});
