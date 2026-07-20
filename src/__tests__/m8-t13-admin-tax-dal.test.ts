// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  TAX_COLLECTION,
  TAX_LIST_LIMIT,
  createAdminTax,
  deleteAdminTax,
  getAdminActiveTaxesForEvent,
  getAdminTaxForEvent,
  getAdminTaxesForEvent,
  isAdminTaxCodeTaken,
  updateAdminTax,
} = await import("@/lib/db/adminTax");

const base = {
  organizationId: "org-a",
  eventId: "event-a",
  name: "GST",
  code: "GST",
  type: "percentage",
  rateMilliPercent: 9_000,
  fixedAmountMinor: null,
  fixedCurrency: null,
  isActive: true,
  createdAt: { seconds: 1 },
  updatedAt: { seconds: 1 },
};
const ownedScope = { taxId: "tax", eventId: "event-a", organizationId: "org-a" };

function seed(id: string, overrides: Record<string, unknown> = {}) {
  fake.store.set(`${TAX_COLLECTION}/${id}`, { ...base, ...overrides });
}

beforeEach(() => fake.reset());

describe("adminTax real DAL", () => {
  it("exports the collection contract and creates exact percentage fields with defaults", async () => {
    expect(TAX_COLLECTION).toBe("Tax");
    expect(TAX_LIST_LIMIT).toBe(50);
    const id = await createAdminTax({
      organizationId: "org-a", eventId: "event-a", name: "Goods tax",
      code: "  gst-9 ", type: "percentage", rateMilliPercent: 9_125,
      fixedAmountMinor: 777, fixedCurrency: "USD",
    });
    const row = await getAdminTaxForEvent({ taxId: id, eventId: "event-a", organizationId: "org-a" });
    expect(row).toMatchObject({ id, name: "Goods tax", code: "GST-9", type: "percentage", rateMilliPercent: 9_125, fixedAmountMinor: null, fixedCurrency: null, isActive: true });
  });

  it("creates fixed tax fields exactly, including zero minor units and inactive", async () => {
    const id = await createAdminTax({ organizationId: "org-a", eventId: "event-a", name: "Levy", code: "levy", type: "fixed", fixedAmountMinor: 0, fixedCurrency: "SGD", rateMilliPercent: 99_999, isActive: false });
    expect(fake.store.get(`Tax/${id}`)).toMatchObject({ code: "LEVY", rateMilliPercent: null, fixedAmountMinor: 0, fixedCurrency: "SGD", isActive: false });
  });

  it("lists in creation order, scopes by event and org, honors explicit/default limits, and handles empty", async () => {
    for (let i = 0; i < 55; i++) seed(`a-${i}`, { createdAt: { seconds: i }, name: `Tax ${i}` });
    seed("other-org", { organizationId: "org-b" });
    seed("other-event", { eventId: "event-b" });
    expect(await getAdminTaxesForEvent({ eventId: "missing", organizationId: "org-a" })).toEqual([]);
    const bounded = await getAdminTaxesForEvent({ eventId: "event-a", organizationId: "org-a" });
    expect(bounded).toHaveLength(TAX_LIST_LIMIT);
    expect(bounded.map((x) => x.name).slice(0, 2)).toEqual(["Tax 0", "Tax 1"]);
    expect(await getAdminTaxesForEvent({ eventId: "event-a", organizationId: "org-a", limit: 3 })).toHaveLength(3);
  });

  it("returns only active owned taxes and hides missing/cross-tenant ids", async () => {
    seed("active"); seed("inactive", { isActive: false }); seed("foreign", { organizationId: "org-b" });
    expect((await getAdminActiveTaxesForEvent({ eventId: "event-a", organizationId: "org-a" })).map((x) => x.id)).toEqual(["active"]);
    await expect(getAdminTaxForEvent({ taxId: "active", eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id: "active" });
    await expect(getAdminTaxForEvent({ taxId: "foreign", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
    await expect(getAdminTaxForEvent({ taxId: "active", eventId: "event-b", organizationId: "org-a" })).resolves.toBeNull();
    await expect(getAdminTaxForEvent({ taxId: "missing", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
  });

  it("updates only supplied fields, normalizes code, and preserves server-owned fields", async () => {
    seed("tax");
    await expect(updateAdminTax(ownedScope, { name: "Renamed", code: " new ", isActive: false, rateMilliPercent: 8_875 })).resolves.toEqual({ ok: true });
    expect(fake.store.get("Tax/tax")).toMatchObject({ organizationId: "org-a", eventId: "event-a", name: "Renamed", code: "NEW", isActive: false, rateMilliPercent: 8_875, createdAt: { seconds: 1 } });
  });

  it("clears stale type-specific fields on both type transitions", async () => {
    seed("tax");
    await updateAdminTax(ownedScope, { type: "fixed", fixedAmountMinor: 1_234, fixedCurrency: "SGD" });
    expect(fake.store.get("Tax/tax")).toMatchObject({ type: "fixed", rateMilliPercent: null, fixedAmountMinor: 1_234, fixedCurrency: "SGD" });
    await updateAdminTax(ownedScope, { type: "percentage", rateMilliPercent: 20_000 });
    expect(fake.store.get("Tax/tax")).toMatchObject({ type: "percentage", rateMilliPercent: 20_000, fixedAmountMinor: null, fixedCurrency: null });
  });

  it("updates fixed fields without a type change and rejects a missing id", async () => {
    seed("tax", { type: "fixed", rateMilliPercent: null, fixedAmountMinor: 100, fixedCurrency: "USD" });
    await updateAdminTax(ownedScope, { fixedAmountMinor: 101, fixedCurrency: null });
    expect(fake.store.get("Tax/tax")).toMatchObject({ fixedAmountMinor: 101, fixedCurrency: null });
    await expect(updateAdminTax({ ...ownedScope, taxId: "missing" }, { name: "x" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("deletes an existing tax and missing deletes are idempotent", async () => {
    seed("tax"); await expect(deleteAdminTax(ownedScope)).resolves.toEqual({ ok: true }); expect(fake.store.has("Tax/tax")).toBe(false);
    await expect(deleteAdminTax({ ...ownedScope, taxId: "missing" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("checks normalized per-event code uniqueness, archived state, exclusion, and event isolation", async () => {
    seed("one", { code: "GST" }); seed("other-event", { eventId: "event-b", code: "ONLY-B" });
    await expect(isAdminTaxCodeTaken({ eventId: "event-a", code: " gst " })).resolves.toBe(true);
    await expect(isAdminTaxCodeTaken({ eventId: "event-a", code: "GST", excludeId: "one" })).resolves.toBe(false);
    await expect(isAdminTaxCodeTaken({ eventId: "event-a", code: "only-b" })).resolves.toBe(false);
  });

  it("rejects updateAdminTax when the id belongs to another organization/event", async () => {
    seed("tax");
    await expect(updateAdminTax({ ...ownedScope, organizationId: "org-b" }, { name: "Hacked" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(updateAdminTax({ ...ownedScope, eventId: "event-b" }, { name: "Hacked" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.store.get("Tax/tax")).toMatchObject({ name: "GST" });
    await expect(updateAdminTax(ownedScope, { name: "Owned" })).resolves.toEqual({ ok: true });
    expect(fake.store.get("Tax/tax")).toMatchObject({ name: "Owned" });
  });
  it("rejects deleteAdminTax when the id belongs to another organization/event", async () => {
    seed("tax");
    await expect(deleteAdminTax({ ...ownedScope, organizationId: "org-b" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(deleteAdminTax({ ...ownedScope, eventId: "event-b" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.store.has("Tax/tax")).toBe(true);
    await expect(deleteAdminTax(ownedScope)).resolves.toEqual({ ok: true });
    expect(fake.store.has("Tax/tax")).toBe(false);
  });
});
