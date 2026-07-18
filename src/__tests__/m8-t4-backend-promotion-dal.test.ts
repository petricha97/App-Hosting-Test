// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const store = new Map<string, Row>();
const writes: Array<{ type: string; path: string; data?: Row }> = [];

function matchingPromotions(filters: Array<[string, unknown]>) {
  return [...store.entries()].filter(([path, row]) => path.includes("/EventPromotion/") && filters.every(([field, value]) => row[field] === value)).map(([path, row]) => {
    const parts = path.split("/");
    const ref: any = { path, parent: { parent: { id: parts[1] } } };
    return { id: parts.at(-1), ref, data: () => row };
  });
}

const adminDb = {
  collection(name: string) {
    return { doc(id: string) { return { collection(child: string) { return { doc(childId: string) { return { async delete() { const path = `${name}/${id}/${child}/${childId}`; writes.push({ type: "delete", path }); store.delete(path); } }; } }; } }; } };
  },
  collectionGroup() {
    const filters: Array<[string, unknown]> = [];
    const query: any = { where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; }, async get() { const docs = matchingPromotions(filters); return { docs, empty: docs.length === 0 }; } };
    return query;
  },
  batch() {
    const pending: Array<{ ref: any; data: Row }> = [];
    return { update(ref: any, data: Row) { pending.push({ ref, data }); }, async commit() { for (const item of pending) { writes.push({ type: "update", path: item.ref.path, data: item.data }); store.set(item.ref.path, { ...store.get(item.ref.path), ...item.data }); } } };
  },
};

vi.mock("@/app/lib/firestore", () => ({ adminDb }));
const { deleteAdminEventPromotion } = await import("@/lib/db/adminEventPromotion");
const { applyTemplateToInheritingEvents, applyTemplateToSpecificEvents } = await import("@/lib/db/adminPromotionTemplate");

const fields = { name: "New", description: null, discountType: "percentage", discountValue: 20, conditions: [], enablePromoCode: true, promoCode: "SAVE" };

beforeEach(() => { store.clear(); writes.length = 0; });

describe("promotion DAL mutation regressions", () => {
  it("deleteAdminEventPromotion deletes exactly the requested event-scoped document", async () => {
    store.set("Event/event-a/EventPromotion/same-id", { organizationId: "org-a" });
    store.set("Event/event-b/EventPromotion/same-id", { organizationId: "org-b" });
    await deleteAdminEventPromotion("event-a", "same-id");
    expect(store.has("Event/event-a/EventPromotion/same-id")).toBe(false);
    expect(store.has("Event/event-b/EventPromotion/same-id")).toBe(true);
    expect(writes).toEqual([{ type: "delete", path: "Event/event-a/EventPromotion/same-id" }]);
  });

  it("applyTemplateToInheritingEvents updates only inheriting promotions in the template organization", async () => {
    store.set("Event/a/EventPromotion/inherit", { organizationId: "org-a", templateId: "tpl", inheritFromParent: true, name: "Old" });
    store.set("Event/a/EventPromotion/custom", { organizationId: "org-a", templateId: "tpl", inheritFromParent: false, name: "Custom" });
    store.set("Event/b/EventPromotion/foreign", { organizationId: "org-b", templateId: "tpl", inheritFromParent: true, name: "Foreign" });
    await expect(applyTemplateToInheritingEvents("tpl", "org-a", fields)).resolves.toBe(1);
    expect(store.get("Event/a/EventPromotion/inherit")).toMatchObject({ name: "New", promoCodeUpper: "SAVE" });
    expect(store.get("Event/a/EventPromotion/custom")?.name).toBe("Custom");
    expect(store.get("Event/b/EventPromotion/foreign")?.name).toBe("Foreign");
  });

  it("applyTemplateToSpecificEvents updates only explicit same-org rows and guards customized/missing targets", async () => {
    store.set("Event/a/EventPromotion/p", { organizationId: "org-a", templateId: "tpl", inheritFromParent: true, name: "A" });
    store.set("Event/custom/EventPromotion/p", { organizationId: "org-a", templateId: "tpl", inheritFromParent: false, name: "Custom" });
    store.set("Event/not-requested/EventPromotion/p", { organizationId: "org-a", templateId: "tpl", inheritFromParent: true, name: "Other" });
    store.set("Event/foreign/EventPromotion/p", { organizationId: "org-b", templateId: "tpl", inheritFromParent: true, name: "Foreign" });
    await expect(applyTemplateToSpecificEvents("tpl", "org-a", ["a", "custom", "foreign", "missing"], fields, { overwriteCustom: false })).resolves.toEqual({ updated: 0, skippedCustom: [], skippedMissing: ["foreign", "missing"] });
    expect(store.get("Event/a/EventPromotion/p")?.name).toBe("A");
    expect(store.get("Event/custom/EventPromotion/p")?.name).toBe("Custom");
    expect(store.get("Event/not-requested/EventPromotion/p")?.name).toBe("Other");
    expect(store.get("Event/foreign/EventPromotion/p")?.name).toBe("Foreign");
  });

  it("apply-to-events rejects a mixed owned/foreign event list atomically before changing the owned promotion (P0 tenancy proof)", async () => {
    store.set("Event/owned/EventPromotion/p", { organizationId: "org-a", templateId: "tpl", inheritFromParent: true, name: "Owned" });
    store.set("Event/foreign/EventPromotion/p", { organizationId: "org-b", templateId: "tpl", inheritFromParent: true, name: "Foreign" });

    await expect(
      applyTemplateToSpecificEvents("tpl", "org-a", ["owned", "foreign"], fields, { overwriteCustom: true }),
    ).resolves.toEqual({ updated: 0, skippedCustom: [], skippedMissing: ["foreign"] });
    expect(store.get("Event/owned/EventPromotion/p")?.name).toBe("Owned");
    expect(writes).toEqual([]);
  });

  it("apply-to-events also rejects a foreign-first mixed event list before changing the owned promotion", async () => {
    store.set("Event/owned/EventPromotion/p", { organizationId: "org-a", templateId: "tpl", inheritFromParent: true, name: "Owned" });
    store.set("Event/foreign/EventPromotion/p", { organizationId: "org-b", templateId: "tpl", inheritFromParent: true, name: "Foreign" });

    await expect(
      applyTemplateToSpecificEvents("tpl", "org-a", ["foreign", "owned"], fields, { overwriteCustom: true }),
    ).resolves.toEqual({ updated: 0, skippedCustom: [], skippedMissing: ["foreign"] });
    expect(store.get("Event/owned/EventPromotion/p")?.name).toBe("Owned");
    expect(store.get("Event/foreign/EventPromotion/p")?.name).toBe("Foreign");
    expect(writes).toEqual([]);
  });
});
