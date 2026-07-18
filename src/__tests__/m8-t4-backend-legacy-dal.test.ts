// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const fake = vi.hoisted(() => ({ rows: new Map<string, Row>(), nextId: 0, failDelete: false, timestamp: { __serverTimestamp: true } }));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => {
  const ref = (collectionName: string, id?: string) => ({ collectionName, id: id ?? `auto-${fake.nextId++}` });
  return {
    collection: (_db: unknown, name: string) => ({ collectionName: name, withConverter() { return this; } }),
    doc: (target: any, first?: string, second?: string) => second !== undefined ? ref(first!, second) : ref(target.collectionName, first),
    setDoc: async (r: any, data: Row) => { fake.rows.set(`${r.collectionName}/${r.id}`, { ...data }); },
    updateDoc: async (r: any, data: Row) => { const path = `${r.collectionName}/${r.id}`; const old = fake.rows.get(path); if (!old) throw new Error("NOT_FOUND"); fake.rows.set(path, { ...old, ...data }); },
    deleteDoc: async (r: any) => { if (fake.failDelete) throw new Error("delete failed"); fake.rows.delete(`${r.collectionName}/${r.id}`); },
    getDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(), orderBy: vi.fn(), onSnapshot: vi.fn(),
    serverTimestamp: () => fake.timestamp,
  };
});

const { createOrganization } = await import("@/lib/db/organization");
const { createRegistrationType, updateRegistrationType, deleteRegistrationType } = await import("@/lib/db/registrationType");
const { createTicketType, updateTicketType, deleteTicketType } = await import("@/lib/db/ticketType");
const { createUser, updateUser } = await import("@/lib/db/user");

beforeEach(() => { fake.rows.clear(); fake.nextId = 0; fake.failDelete = false; });

describe("legacy organization and user DAL mutations", () => {
  it("createOrganization writes only the requested validated document and returns its generated ID", async () => {
    const payload = { name: "Acme", slug: "acme", domain: "acme.test", allowDomainAutoJoin: false } as any;
    await expect(createOrganization(payload)).resolves.toBe("auto-0");
    expect([...fake.rows.entries()]).toEqual([["Organization/auto-0", payload]]);
  });

  it("createUser lowercases the requested identity and creates no other user", async () => {
    const payload = { email: "person@example.com", name: "Person", permissions: [], status: "active" } as any;
    await createUser("Person@Example.COM", payload);
    expect([...fake.rows.entries()]).toEqual([["User/person@example.com", payload]]);
  });

  it("updateUser targets only the lowercased requested identity and preserves unrelated data", async () => {
    fake.rows.set("User/person@example.com", { name: "Old", email: "person@example.com", organizationId: "org-a" });
    fake.rows.set("User/other@example.com", { name: "Other" });
    await updateUser("Person@Example.COM", { name: "New" });
    expect(fake.rows.get("User/person@example.com")).toMatchObject({ name: "New", email: "person@example.com", organizationId: "org-a", updatedAt: fake.timestamp });
    expect(fake.rows.get("User/other@example.com")).toEqual({ name: "Other" });
  });
});

describe("legacy registration-type DAL mutations", () => {
  it("createRegistrationType persists normalized fields under the intended event and owns counters/timestamps", async () => {
    const id = await createRegistrationType({ organizationId: "org-a", eventId: "event-a", name: "General", code: " gen ", capacity: 50 });
    expect(fake.rows.get(`RegistrationType/${id}`)).toMatchObject({ organizationId: "org-a", eventId: "event-a", name: "General", code: "GEN", capacity: 50, registeredCount: 0, createdAt: fake.timestamp, updatedAt: fake.timestamp });
  });

  it("updateRegistrationType changes only the requested allow-listed fields and preserves tenant/counter data", async () => {
    fake.rows.set("RegistrationType/a", { organizationId: "org-a", eventId: "event-a", name: "Old", code: "OLD", capacity: 10, registeredCount: 4 });
    fake.rows.set("RegistrationType/b", { organizationId: "org-b", name: "Other" });
    await updateRegistrationType("a", { name: "New", code: " vip " });
    expect(fake.rows.get("RegistrationType/a")).toMatchObject({ organizationId: "org-a", eventId: "event-a", name: "New", code: "VIP", capacity: 10, registeredCount: 4 });
    expect(fake.rows.get("RegistrationType/b")?.name).toBe("Other");
  });

  it("deleteRegistrationType deletes only the requested ID and surfaces storage failure", async () => {
    fake.rows.set("RegistrationType/a", {}); fake.rows.set("RegistrationType/b", {});
    await deleteRegistrationType("a");
    expect(fake.rows.has("RegistrationType/a")).toBe(false); expect(fake.rows.has("RegistrationType/b")).toBe(true);
    fake.failDelete = true;
    await expect(deleteRegistrationType("b")).rejects.toThrow("delete failed");
    expect(fake.rows.has("RegistrationType/b")).toBe(true);
  });
});

describe("legacy ticket-type DAL mutations", () => {
  it("createTicketType persists normalized defaults, deduplicated registration types, and intended tenant/event", async () => {
    const id = await createTicketType({ organizationId: "org-a", eventId: "event-a", name: "Standard", code: " std ", capacity: null, registrationTypeIds: ["r1", "r1", "r2"] });
    expect(fake.rows.get(`TicketType/${id}`)).toMatchObject({ organizationId: "org-a", eventId: "event-a", code: "STD", registeredCount: 0, salesStart: null, salesEnd: null, isOpen: true, registrationTypeIds: ["r1", "r2"] });
  });

  it("updateTicketType changes only the requested document/allow-list and preserves unrelated fields", async () => {
    fake.rows.set("TicketType/a", { organizationId: "org-a", eventId: "event-a", name: "Old", registeredCount: 7, registrationTypeIds: ["r1"] });
    fake.rows.set("TicketType/b", { organizationId: "org-b", name: "Other" });
    await updateTicketType("a", { name: "New", registrationTypeIds: ["r2", "r2"], isOpen: false });
    expect(fake.rows.get("TicketType/a")).toMatchObject({ organizationId: "org-a", eventId: "event-a", name: "New", registeredCount: 7, registrationTypeIds: ["r2"], isOpen: false });
    expect(fake.rows.get("TicketType/b")?.name).toBe("Other");
  });

  it("deleteTicketType deletes only the requested ID and surfaces storage failure", async () => {
    fake.rows.set("TicketType/a", {}); fake.rows.set("TicketType/b", {});
    await deleteTicketType("a");
    expect(fake.rows.has("TicketType/a")).toBe(false); expect(fake.rows.has("TicketType/b")).toBe(true);
    fake.failDelete = true;
    await expect(deleteTicketType("b")).rejects.toThrow("delete failed");
    expect(fake.rows.has("TicketType/b")).toBe(true);
  });
});
