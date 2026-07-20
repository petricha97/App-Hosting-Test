// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
const { FEE_COLLECTION, FEE_LIST_LIMIT, createAdminFee, deleteAdminFee, getAdminFeeForEvent, getAdminFeesForEvent, getAdminFeesReferencingRegistrationType, getAdminFeesReferencingTicketType, isAdminActiveFeeCombinationTaken, resolveAdminFeeForOrder, updateAdminFee } = await import("@/lib/db/adminFee");

const base = { organizationId: "org-a", eventId: "event-a", name: "General", ticketTypeId: "ticket-a", registrationTypeId: null, currency: "USD", basePriceMinor: 10_001, status: "active", createdAt: { seconds: 1 }, updatedAt: { seconds: 1 } };
const ownedScope = { feeId: "fee", eventId: "event-a", organizationId: "org-a" };
function seed(id: string, overrides: Record<string, unknown> = {}) { fake.store.set(`${FEE_COLLECTION}/${id}`, { ...base, ...overrides }); }
beforeEach(() => fake.reset());

describe("adminFee real DAL", () => {
  it("exports constants and creates/readbacks exact money, explicit null, and default status", async () => {
    expect(FEE_COLLECTION).toBe("Fee"); expect(FEE_LIST_LIMIT).toBe(50);
    const id = await createAdminFee({ organizationId: "org-a", eventId: "event-a", name: "Zero fee", ticketTypeId: "ticket-a", registrationTypeId: null, currency: "SGD", basePriceMinor: 0 });
    await expect(getAdminFeeForEvent({ feeId: id, eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id, registrationTypeId: null, currency: "SGD", basePriceMinor: 0, status: "active" });
  });

  it("preserves an explicit archived status", async () => {
    const id = await createAdminFee({ organizationId: "org-a", eventId: "event-a", name: "Old", ticketTypeId: "ticket-a", registrationTypeId: "reg-a", currency: "USD", basePriceMinor: 9_007_199_254_740_991, status: "archived" });
    expect(fake.store.get(`Fee/${id}`)).toMatchObject({ basePriceMinor: 9_007_199_254_740_991, status: "archived", registrationTypeId: "reg-a" });
  });

  it("lists archived and active in order, isolates tenants, limits, and returns empty", async () => {
    for (let i = 0; i < 55; i++) seed(`f-${i}`, { createdAt: { seconds: i }, status: i % 2 ? "archived" : "active" });
    seed("foreign-org", { organizationId: "org-b" }); seed("foreign-event", { eventId: "event-b" });
    expect(await getAdminFeesForEvent({ eventId: "none", organizationId: "org-a" })).toEqual([]);
    const rows = await getAdminFeesForEvent({ eventId: "event-a", organizationId: "org-a" });
    expect(rows).toHaveLength(FEE_LIST_LIMIT); expect(rows.slice(0, 2).map((x) => x.id)).toEqual(["f-0", "f-1"]);
    expect(await getAdminFeesForEvent({ eventId: "event-a", organizationId: "org-a", limit: 4 })).toHaveLength(4);
  });

  it("scoped read hides missing, other-event, and other-org documents", async () => {
    seed("owned"); seed("foreign", { organizationId: "org-b" });
    await expect(getAdminFeeForEvent({ feeId: "owned", eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id: "owned" });
    await expect(getAdminFeeForEvent({ feeId: "foreign", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
    await expect(getAdminFeeForEvent({ feeId: "owned", eventId: "event-b", organizationId: "org-a" })).resolves.toBeNull();
    await expect(getAdminFeeForEvent({ feeId: "missing", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
  });

  it("allow-list updates every mutable field, supports null widening, and preserves ownership", async () => {
    seed("fee", { registrationTypeId: "reg-a" });
    await expect(updateAdminFee(ownedScope, { name: "VIP", ticketTypeId: "ticket-b", registrationTypeId: null, currency: "SGD", basePriceMinor: 12_345, status: "archived" })).resolves.toEqual({ ok: true });
    expect(fake.store.get("Fee/fee")).toMatchObject({ organizationId: "org-a", eventId: "event-a", name: "VIP", ticketTypeId: "ticket-b", registrationTypeId: null, currency: "SGD", basePriceMinor: 12_345, status: "archived", createdAt: { seconds: 1 } });
    await expect(updateAdminFee({ ...ownedScope, feeId: "missing" }, { name: "x" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("deletes an existing fee and treats a missing delete as idempotent", async () => {
    seed("fee"); await expect(deleteAdminFee(ownedScope)).resolves.toEqual({ ok: true }); expect(fake.store.has("Fee/fee")).toBe(false); await expect(deleteAdminFee({ ...ownedScope, feeId: "missing" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("detects only active exact combinations with exclusion and event isolation", async () => {
    seed("active"); seed("archived", { registrationTypeId: "reg-z", status: "archived" }); seed("other-event", { eventId: "event-b", ticketTypeId: "ticket-b" });
    const query = { eventId: "event-a", ticketTypeId: "ticket-a", registrationTypeId: null, currency: "USD" as const };
    await expect(isAdminActiveFeeCombinationTaken(query)).resolves.toBe(true);
    await expect(isAdminActiveFeeCombinationTaken({ ...query, excludeId: "active" })).resolves.toBe(false);
    await expect(isAdminActiveFeeCombinationTaken({ ...query, registrationTypeId: "reg-z" })).resolves.toBe(false);
    await expect(isAdminActiveFeeCombinationTaken({ ...query, ticketTypeId: "ticket-b" })).resolves.toBe(false);
  });

  it("resolves specific active fee over all-types fallback with complete tenant/currency filtering", async () => {
    seed("fallback", { basePriceMinor: 100 }); seed("specific", { registrationTypeId: "reg-a", basePriceMinor: 200 });
    seed("archived-specific", { registrationTypeId: "reg-b", status: "archived" }); seed("foreign", { organizationId: "org-b", registrationTypeId: "reg-b" }); seed("wrong-currency", { currency: "SGD", registrationTypeId: "reg-b" });
    const q = { eventId: "event-a", organizationId: "org-a", ticketTypeId: "ticket-a", currency: "USD" as const };
    await expect(resolveAdminFeeForOrder({ ...q, registrationTypeId: "reg-a" })).resolves.toMatchObject({ id: "specific", basePriceMinor: 200 });
    await expect(resolveAdminFeeForOrder({ ...q, registrationTypeId: "reg-b" })).resolves.toMatchObject({ id: "fallback", basePriceMinor: 100 });
    await expect(resolveAdminFeeForOrder({ ...q, ticketTypeId: "none", registrationTypeId: "reg-a" })).resolves.toBeNull();
  });

  it("finds ticket references with tenant scope and default/custom bounds", async () => {
    for (let i = 0; i < 22; i++) seed(`ref-${i}`);
    seed("wrong-ticket", { ticketTypeId: "other" }); seed("foreign", { organizationId: "org-b" });
    expect(await getAdminFeesReferencingTicketType({ eventId: "event-a", organizationId: "org-a", ticketTypeId: "ticket-a" })).toHaveLength(20);
    expect(await getAdminFeesReferencingTicketType({ eventId: "event-a", organizationId: "org-a", ticketTypeId: "ticket-a", limit: 2 })).toHaveLength(2);
    expect(await getAdminFeesReferencingTicketType({ eventId: "none", organizationId: "org-a", ticketTypeId: "ticket-a" })).toEqual([]);
  });

  it("finds registration references while excluding null and other tenants", async () => {
    seed("specific", { registrationTypeId: "reg-a" }); seed("all", { registrationTypeId: null }); seed("foreign", { organizationId: "org-b", registrationTypeId: "reg-a" });
    expect((await getAdminFeesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "reg-a" })).map((x) => x.id)).toEqual(["specific"]);
    expect(await getAdminFeesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "reg-a", limit: 0 })).toEqual([]);
  });

  it("rejects updateAdminFee when the id belongs to another organization/event", async () => {
    seed("fee");
    await expect(updateAdminFee({ ...ownedScope, organizationId: "org-b" }, { basePriceMinor: 1 })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(updateAdminFee({ ...ownedScope, eventId: "event-b" }, { basePriceMinor: 1 })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.store.get("Fee/fee")).toMatchObject({ basePriceMinor: 10_001 });
    await expect(updateAdminFee(ownedScope, { basePriceMinor: 1 })).resolves.toEqual({ ok: true });
    expect(fake.store.get("Fee/fee")).toMatchObject({ basePriceMinor: 1 });
  });
  it("rejects deleteAdminFee when the id belongs to another organization/event", async () => {
    seed("fee");
    await expect(deleteAdminFee({ ...ownedScope, organizationId: "org-b" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(deleteAdminFee({ ...ownedScope, eventId: "event-b" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.store.has("Fee/fee")).toBe(true);
    await expect(deleteAdminFee(ownedScope)).resolves.toEqual({ ok: true });
    expect(fake.store.has("Fee/fee")).toBe(false);
  });
});
