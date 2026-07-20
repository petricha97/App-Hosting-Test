// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
const timestamp = { __serverTimestamp: true };
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => {
  type Constraint = { kind: string; field?: string; op?: string; value?: unknown; direction?: string; n?: number };
  const col = (name: string) => ({ name, withConverter() { return this; } });
  const ref = (name: string, id: string) => ({ name, id });
  const rows = (target: { name: string; constraints?: Constraint[] }) => {
    let result = [...fake.store.entries()].filter(([p]) => p.startsWith(`${target.name}/`) && p.split("/").length === 2);
    for (const c of target.constraints ?? []) {
      if (c.kind === "where") result = result.filter(([, d]) => c.op === "array-contains" ? Array.isArray(d[c.field!]) && (d[c.field!] as unknown[]).includes(c.value) : d[c.field!] === c.value);
      if (c.kind === "order") result.sort(([, a], [, b]) => ((a[c.field!] as any) < (b[c.field!] as any) ? -1 : (a[c.field!] as any) > (b[c.field!] as any) ? 1 : 0) * (c.direction === "desc" ? -1 : 1));
      if (c.kind === "limit") result = result.slice(0, c.n);
    }
    return result.map(([p, d]) => ({ id: p.split("/")[1], data: () => d }));
  };
  return {
    collection: (_db: unknown, name: string) => col(name),
    doc: (target: { name: string }, id?: string) => ref(target.name, id ?? "auto-0"),
    query: (target: { name: string }, ...constraints: Constraint[]) => ({ ...target, constraints }),
    where: (field: string, op: string, value: unknown) => ({ kind: "where", field, op, value }),
    orderBy: (field: string, direction = "asc") => ({ kind: "order", field, direction }),
    limit: (n: number) => ({ kind: "limit", n }),
    getDocs: async (target: { name: string; constraints?: Constraint[] }) => ({ docs: rows(target) }),
    getDoc: async (r: { name: string; id: string }) => { const data = fake.store.get(`${r.name}/${r.id}`); return { id: r.id, exists: () => data !== undefined, data: () => data }; },
    setDoc: async (r: { name: string; id: string }, data: Record<string, unknown>) => fake.store.set(`${r.name}/${r.id}`, data),
    updateDoc: async (r: { name: string; id: string }, data: Record<string, unknown>) => { const path = `${r.name}/${r.id}`; const old = fake.store.get(path); if (!old) throw new Error("NOT_FOUND"); fake.store.set(path, { ...old, ...data }); },
    deleteDoc: async (r: { name: string; id: string }) => { fake.store.delete(`${r.name}/${r.id}`); },
    serverTimestamp: () => timestamp,
  };
});

const dal = await import("@/lib/db/ticketType");
const base = { organizationId: "org-a", eventId: "event-a", name: "Standard", code: "STD", capacity: 10, registeredCount: 3, salesStart: null, salesEnd: null, isOpen: true, registrationTypeIds: [] as string[], createdAt: 1, updatedAt: 1 };
function seed(id: string, overrides: Record<string, unknown> = {}) { fake.store.set(`TicketType/${id}`, { ...base, ...overrides }); }
beforeEach(() => fake.reset());

describe("ticketType public real DAL", () => {
  it("lists only the requested event and organization in creation order, with empty/default/custom limits", async () => {
    expect(dal.TICKET_TYPE_COLLECTION).toBe("TicketType"); expect(dal.TICKET_TYPE_LIST_LIMIT).toBe(50);
    for (let i = 0; i < 52; i++) seed(`t-${i}`, { createdAt: i });
    seed("other-event", { eventId: "event-b", createdAt: -2 }); seed("other-org", { organizationId: "org-b", createdAt: -1 });
    expect(await dal.getTicketTypesForEvent({ eventId: "missing", organizationId: "org-a" })).toEqual([]);
    const rows = await dal.getTicketTypesForEvent({ eventId: "event-a", organizationId: "org-a" });
    expect(rows).toHaveLength(50); expect(rows.slice(0, 3).map((x) => x.id)).toEqual(["t-0", "t-1", "t-2"]);
    expect((await dal.getTicketTypesForEvent({ eventId: "event-a", organizationId: "org-a", limit: 2 })).map((x) => x.id)).toEqual(["t-0", "t-1"]);
  });

  it("scoped single read returns the exact quantity fields and hides missing/cross-scope ids", async () => {
    seed("owned", { capacity: 3, registeredCount: 3, isOpen: false }); seed("foreign", { organizationId: "org-b" });
    await expect(dal.getTicketTypeForEvent({ ticketTypeId: "owned", eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id: "owned", capacity: 3, registeredCount: 3, isOpen: false });
    await expect(dal.getTicketTypeForEvent({ ticketTypeId: "owned", eventId: "event-b", organizationId: "org-a" })).resolves.toBeNull();
    await expect(dal.getTicketTypeForEvent({ ticketTypeId: "foreign", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
    await expect(dal.getTicketTypeForEvent({ ticketTypeId: "missing", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
  });

  it("creates exact defaults, normalized code, deduplicated eligibility, and zero registered count", async () => {
    const id = await dal.createTicketType({ organizationId: "org-a", eventId: "event-a", name: "VIP", code: " vip ", capacity: 0, isOpen: false, registrationTypeIds: ["r1", "r1", "r2"] });
    expect(fake.store.get(`TicketType/${id}`)).toMatchObject({ organizationId: "org-a", eventId: "event-a", code: "VIP", capacity: 0, registeredCount: 0, salesStart: null, salesEnd: null, isOpen: false, registrationTypeIds: ["r1", "r2"], createdAt: timestamp, updatedAt: timestamp });
  });

  it("updates only supplied mutable fields, including boundary quantities and empty eligibility", async () => {
    seed("owned"); await dal.updateTicketType("owned", { name: "Renamed", code: " new ", capacity: 0, salesStart: null, salesEnd: null, isOpen: false, registrationTypeIds: [] });
    expect(fake.store.get("TicketType/owned")).toMatchObject({ organizationId: "org-a", eventId: "event-a", registeredCount: 3, name: "Renamed", code: "NEW", capacity: 0, isOpen: false, registrationTypeIds: [], updatedAt: timestamp });
    await expect(dal.updateTicketType("missing", {})).rejects.toThrow("NOT_FOUND");
  });

  it("checks normalized code per event with self exclusion and the two-result bound semantics", async () => {
    seed("one", { code: "VIP" }); seed("two", { code: "VIP" }); seed("foreign-event", { eventId: "event-b", code: "ONLYB" });
    await expect(dal.isTicketTypeCodeTaken({ eventId: "event-a", code: " vip " })).resolves.toBe(true);
    await expect(dal.isTicketTypeCodeTaken({ eventId: "event-a", code: "VIP", excludeId: "one" })).resolves.toBe(true);
    await expect(dal.isTicketTypeCodeTaken({ eventId: "event-b", code: "VIP" })).resolves.toBe(false);
  });

  it("finds only owned registration-type references and honors default/custom bounds", async () => {
    for (let i = 0; i < 22; i++) seed(`ref-${i}`, { registrationTypeIds: ["r1"] });
    seed("unrestricted"); seed("other-org", { organizationId: "org-b", registrationTypeIds: ["r1"] }); seed("other-event", { eventId: "event-b", registrationTypeIds: ["r1"] });
    expect(await dal.getTicketTypesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "r1" })).toHaveLength(20);
    expect(await dal.getTicketTypesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "r1", limit: 2 })).toHaveLength(2);
    expect(await dal.getTicketTypesReferencingRegistrationType({ eventId: "event-a", organizationId: "org-a", registrationTypeId: "none" })).toEqual([]);
  });

  it("deletes exactly the requested document", async () => { seed("one"); seed("two"); await dal.deleteTicketType("one"); expect(fake.store.has("TicketType/one")).toBe(false); expect(fake.store.has("TicketType/two")).toBe(true); });
});
