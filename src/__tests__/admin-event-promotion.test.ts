// @vitest-environment node
/**
 * M3 review S4 — EventPromotion DAL (src/lib/db/adminEventPromotion.ts):
 * normalized promo-code lookup.
 *
 * Locks:
 *  - create/update stamp promoCodeUpper (trim + uppercase; null when the
 *    code is null/empty); callers can never supply it directly
 *  - getAdminEventPromotionByCode resolves via the EQUALITY query on
 *    promoCodeUpper (case/whitespace-robust) — org-scoped and gated on
 *    enablePromoCode
 *  - LEGACY FALLBACK: docs missing promoCodeUpper (pre-M3) are still found
 *    by the bounded in-memory scan; docs that HAVE the field are never
 *    re-matched by the fallback (the equality query is authoritative)
 *  - template cascades re-stamp promoCodeUpper alongside promoCode
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

import type { EventPromotionDoc } from "@/types/collection";

const {
  createAdminEventPromotion,
  getAdminEventPromotionByCode,
  normalizePromoCodeUpper,
  updateAdminEventPromotion,
} = await import("@/lib/db/adminEventPromotion");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function promoDoc(overrides: Partial<EventPromotionDoc> = {}): EventPromotionDoc {
  return {
    organizationId: ORG_ID,
    templateId: "tpl-1",
    inheritFromParent: true,
    name: "Early bird",
    description: null,
    discountType: "percentage",
    discountValue: 10,
    conditions: [],
    enablePromoCode: true,
    promoCode: "Save10",
    createdAt: { seconds: 1, nanoseconds: 0 } as never,
    updatedAt: { seconds: 1, nanoseconds: 0 } as never,
    ...overrides,
  };
}

function seedPromo(
  id: string,
  data: Record<string, unknown>,
  eventId = EVENT_ID,
) {
  fake.store.set(`Event/${eventId}/EventPromotion/${id}`, {
    organizationId: ORG_ID,
    templateId: "tpl-1",
    inheritFromParent: true,
    name: "Seeded",
    conditions: [],
    enablePromoCode: true,
    ...data,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("normalizePromoCodeUpper", () => {
  it("trims and uppercases; null/empty collapse to null", () => {
    expect(normalizePromoCodeUpper("  save10 ")).toBe("SAVE10");
    expect(normalizePromoCodeUpper("SAVE10")).toBe("SAVE10");
    expect(normalizePromoCodeUpper("")).toBeNull();
    expect(normalizePromoCodeUpper("   ")).toBeNull();
    expect(normalizePromoCodeUpper(null)).toBeNull();
    expect(normalizePromoCodeUpper(undefined)).toBeNull();
  });
});

describe("createAdminEventPromotion — S4 stamp", () => {
  it("stamps promoCodeUpper from promoCode at create", async () => {
    const id = await createAdminEventPromotion(EVENT_ID, promoDoc());
    const stored = fake.store.get(`Event/${EVENT_ID}/EventPromotion/${id}`);
    expect(stored?.promoCode).toBe("Save10");
    expect(stored?.promoCodeUpper).toBe("SAVE10");
  });

  it("stamps null when the promotion has no code", async () => {
    const id = await createAdminEventPromotion(
      EVENT_ID,
      promoDoc({ enablePromoCode: false, promoCode: null }),
    );
    const stored = fake.store.get(`Event/${EVENT_ID}/EventPromotion/${id}`);
    expect(stored?.promoCodeUpper).toBeNull();
  });
});

describe("updateAdminEventPromotion — S4 stamp", () => {
  it("re-stamps promoCodeUpper when promoCode changes", async () => {
    seedPromo("promo-1", { promoCode: "Old", promoCodeUpper: "OLD" });

    await updateAdminEventPromotion(EVENT_ID, "promo-1", {
      promoCode: " newCode ",
    });

    const stored = fake.store.get(`Event/${EVENT_ID}/EventPromotion/promo-1`);
    expect(stored?.promoCodeUpper).toBe("NEWCODE");
  });

  it("clears promoCodeUpper when promoCode is set to null", async () => {
    seedPromo("promo-1", { promoCode: "Old", promoCodeUpper: "OLD" });

    await updateAdminEventPromotion(EVENT_ID, "promo-1", {
      enablePromoCode: false,
      promoCode: null,
    });

    const stored = fake.store.get(`Event/${EVENT_ID}/EventPromotion/promo-1`);
    expect(stored?.promoCodeUpper).toBeNull();
  });

  it("leaves promoCodeUpper untouched when the payload does not touch promoCode", async () => {
    seedPromo("promo-1", { promoCode: "Keep", promoCodeUpper: "KEEP" });

    await updateAdminEventPromotion(EVENT_ID, "promo-1", { name: "Renamed" });

    const stored = fake.store.get(`Event/${EVENT_ID}/EventPromotion/promo-1`);
    expect(stored?.promoCodeUpper).toBe("KEEP");
  });

  it("never accepts a caller-supplied promoCodeUpper (server-derived only)", async () => {
    seedPromo("promo-1", { promoCode: "Real", promoCodeUpper: "REAL" });

    await updateAdminEventPromotion(EVENT_ID, "promo-1", {
      // Attempted desync: derived field must be ignored/re-derived.
      promoCodeUpper: "FORGED",
    } as never);

    const stored = fake.store.get(`Event/${EVENT_ID}/EventPromotion/promo-1`);
    expect(stored?.promoCodeUpper).toBe("REAL");
  });
});

describe("getAdminEventPromotionByCode — equality lookup + legacy fallback", () => {
  it("finds a stamped promotion case/whitespace-insensitively via the equality query", async () => {
    seedPromo("promo-1", { promoCode: "Save10", promoCodeUpper: "SAVE10" });

    const found = await getAdminEventPromotionByCode({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      code: "  save10 ",
    });
    expect(found?.id).toBe("promo-1");
  });

  it("finds a LEGACY promotion missing promoCodeUpper via the bounded fallback scan", async () => {
    seedPromo("legacy-1", { promoCode: "OldCode" }); // no promoCodeUpper field

    const found = await getAdminEventPromotionByCode({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      code: "oldcode",
    });
    expect(found?.id).toBe("legacy-1");
  });

  it("fallback never re-matches docs that HAVE promoCodeUpper (equality query is authoritative)", async () => {
    // A stamped doc whose free-text promoCode would in-memory match a
    // DIFFERENT code must not resolve for that code.
    seedPromo("promo-1", { promoCode: "Save10", promoCodeUpper: "OTHER" });

    const found = await getAdminEventPromotionByCode({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      code: "save10",
    });
    expect(found).toBeNull();
  });

  it("returns null for unknown / code-less / disabled / cross-org promotions", async () => {
    seedPromo("no-code", { promoCode: null, promoCodeUpper: null });
    seedPromo("disabled", {
      enablePromoCode: false,
      promoCode: "Save10",
      promoCodeUpper: "SAVE10",
    });
    seedPromo("cross-org", {
      organizationId: "org-2",
      promoCode: "Save10",
      promoCodeUpper: "SAVE10",
    });

    await expect(
      getAdminEventPromotionByCode({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        code: "save10",
      }),
    ).resolves.toBeNull();
    await expect(
      getAdminEventPromotionByCode({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        code: "",
      }),
    ).resolves.toBeNull();
  });
});
