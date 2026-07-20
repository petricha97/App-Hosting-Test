// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
const { TICKET_TYPE_COLLECTION, TICKET_TYPE_LIST_LIMIT, createAdminTicketType, deleteAdminTicketType, getAdminTicketTypeForEvent, getAdminTicketTypesForEvent, getAdminTicketTypesReferencingRegistrationType, isAdminTicketTypeCodeTaken, updateAdminTicketType } = await import("@/lib/db/adminTicketType");

const base = { organizationId: "org-a", eventId: "event-a", name: "Standard", code: "STD", capacity: 100, registeredCount: 7, salesStart: null, salesEnd: null, isOpen: true, registrationTypeIds: [], createdAt: { seconds: 1 }, updatedAt: { seconds: 1 } };
const ownedScope = { ticketTypeId: "ticket", eventId: "event-a", organizationId: "org-a" };
function seed(id: string, overrides: Record<string, unknown> = {}) { fake.store.set(`${TICKET_TYPE_COLLECTION}/${id}`, { ...base, ...overrides }); }
beforeEach(() => fake.reset());

describe("adminTicketType real DAL", () => {
  it("exports constants and creates normalized, deduplicated defaults with a server-owned zero count", async () => {
    expect(TICKET_TYPE_COLLECTION).toBe("TicketType"); expect(TICKET_TYPE_LIST_LIMIT).toBe(50);
    const id = await createAdminTicketType({ organizationId: "org-a", eventId: "event-a", name: "Standard", code: " std ", capacity: null, registrationTypeIds: ["reg-a", "reg-a", "reg-b"] });
    await expect(getAdminTicketTypeForEvent({ ticketTypeId: id, eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id, code: "STD", capacity: null, registeredCount: 0, salesStart: null, salesEnd: null, isOpen: true, registrationTypeIds: ["reg-a", "reg-b"] });
  });

  it("converts Date boundaries to exact Timestamps and preserves Timestamp inputs", async () => {
    const start = new Date("2026-01-02T03:04:05.006Z"); const end = Timestamp.fromMillis(start.getTime() + 999);
    const id = await createAdminTicketType({ organizationId: "org-a", eventId: "event-a", name: "Timed", code: "timed", capacity: 1, salesStart: start, salesEnd: end, isOpen: false });
    const row = fake.store.get(`TicketType/${id}`)!;
    expect((row.salesStart as Timestamp).toMillis()).toBe(start.getTime()); expect(row.salesEnd).toBe(end); expect(row.isOpen).toBe(false);
  });

  it("lists in order with event/org isolation, default/custom limits, and empty results", async () => {
    for (let i = 0; i < 55; i++) seed(`t-${i}`, { createdAt: { seconds: i } });
    seed("foreign-org", { organizationId: "org-b" }); seed("foreign-event", { eventId: "event-b" });
    expect(await getAdminTicketTypesForEvent({ eventId: "none", organizationId: "org-a" })).toEqual([]);
    const rows = await getAdminTicketTypesForEvent({ eventId: "event-a", organizationId: "org-a" });
    expect(rows).toHaveLength(TICKET_TYPE_LIST_LIMIT); expect(rows.slice(0, 2).map((x) => x.id)).toEqual(["t-0", "t-1"]);
    expect(await getAdminTicketTypesForEvent({ eventId: "event-a", organizationId: "org-a", limit: 3 })).toHaveLength(3);
  });

  it("scoped read hides missing, cross-event, and cross-org documents", async () => {
    seed("owned"); seed("foreign", { organizationId: "org-b" });
    await expect(getAdminTicketTypeForEvent({ ticketTypeId: "owned", eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id: "owned" });
    await expect(getAdminTicketTypeForEvent({ ticketTypeId: "foreign", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
    await expect(getAdminTicketTypeForEvent({ ticketTypeId: "owned", eventId: "event-b", organizationId: "org-a" })).resolves.toBeNull();
    await expect(getAdminTicketTypeForEvent({ ticketTypeId: "missing", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
  });

  it("allow-list updates all mutable fields, converts/nulls dates, dedupes ids, and preserves server fields", async () => {
    seed("ticket"); const start = new Date("2026-04-01T00:00:00Z");
    await expect(updateAdminTicketType(ownedScope, { name: "VIP", code: " vip ", capacity: null, salesStart: start, salesEnd: null, isOpen: false, registrationTypeIds: ["reg-b", "reg-b"] })).resolves.toEqual({ ok: true });
    const row = fake.store.get("TicketType/ticket")!;
    expect(row).toMatchObject({ organizationId: "org-a", eventId: "event-a", registeredCount: 7, createdAt: { seconds: 1 }, name: "VIP", code: "VIP", capacity: null, salesEnd: null, isOpen: false, registrationTypeIds: ["reg-b"] });
    expect((row.salesStart as Timestamp).toMillis()).toBe(start.getTime());
  });

  it("an empty update only bumps updatedAt and a missing update rejects", async () => {
    seed("ticket"); await updateAdminTicketType(ownedScope, {}); expect(fake.store.get("TicketType/ticket")).toMatchObject({ ...base, updatedAt: expect.anything() });
    await expect(updateAdminTicketType({ ...ownedScope, ticketTypeId: "missing" }, { name: "x" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("deletes an existing ticket and treats missing delete as idempotent", async () => {
    seed("ticket"); await expect(deleteAdminTicketType(ownedScope)).resolves.toEqual({ ok: true }); expect(fake.store.has("TicketType/ticket")).toBe(false); await expect(deleteAdminTicketType({ ...ownedScope, ticketTypeId: "missing" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("checks normalized per-event code uniqueness with self-exclusion and isolation", async () => {
    seed("one", { code: "VIP" }); seed("other-event", { eventId: "event-b", code: "OTHER" });
    await expect(isAdminTicketTypeCodeTaken({ eventId: "event-a", code: " vip " })).resolves.toBe(true);
    await expect(isAdminTicketTypeCodeTaken({ eventId: "event-a", code: "VIP", excludeId: "one" })).resolves.toBe(false);
    await expect(isAdminTicketTypeCodeTaken({ eventId: "event-a", code: "other" })).resolves.toBe(false);
  });

  it("finds registration-type references, excluding unrestricted and cross-tenant rows, with bounds", async () => {
    for (let i = 0; i < 22; i++) seed(`ref-${i}`, { registrationTypeIds: ["reg-a", "reg-b"] });
    seed("unrestricted"); seed("foreign", { organizationId: "org-b", registrationTypeIds: ["reg-a"] }); seed("other-event", { eventId: "event-b", registrationTypeIds: ["reg-a"] });
    expect(await getAdminTicketTypesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "reg-a" })).toHaveLength(20);
    expect(await getAdminTicketTypesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "reg-a", limit: 2 })).toHaveLength(2);
    expect(await getAdminTicketTypesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "none" })).toEqual([]);
  });

  it("rejects updateAdminTicketType when the id belongs to another organization/event", async () => {
    seed("ticket");
    await expect(updateAdminTicketType({ ...ownedScope, organizationId: "org-b" }, { name: "Hacked" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(updateAdminTicketType({ ...ownedScope, eventId: "event-b" }, { name: "Hacked" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.store.get("TicketType/ticket")).toMatchObject({ name: "Standard" });
    await expect(updateAdminTicketType(ownedScope, { name: "Owned" })).resolves.toEqual({ ok: true });
    expect(fake.store.get("TicketType/ticket")).toMatchObject({ name: "Owned" });
  });
  it("rejects deleteAdminTicketType when the id belongs to another organization/event", async () => {
    seed("ticket");
    await expect(deleteAdminTicketType({ ...ownedScope, organizationId: "org-b" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(deleteAdminTicketType({ ...ownedScope, eventId: "event-b" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.store.has("TicketType/ticket")).toBe(true);
    await expect(deleteAdminTicketType(ownedScope)).resolves.toEqual({ ok: true });
    expect(fake.store.has("TicketType/ticket")).toBe(false);
  });
});
