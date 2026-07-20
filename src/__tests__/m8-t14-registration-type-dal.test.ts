// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
const timestamp = { __serverTimestamp: true };
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => {
  type C = { kind: string; field?: string; value?: unknown; direction?: string; n?: number };
  const rows = (q: { name: string; constraints?: C[] }) => { let rs = [...fake.store.entries()].filter(([p]) => p.startsWith(`${q.name}/`) && p.split("/").length === 2); for (const c of q.constraints ?? []) { if (c.kind === "where") rs = rs.filter(([, d]) => d[c.field!] === c.value); if (c.kind === "order") rs.sort(([, a], [, b]) => ((a[c.field!] as any) < (b[c.field!] as any) ? -1 : (a[c.field!] as any) > (b[c.field!] as any) ? 1 : 0) * (c.direction === "desc" ? -1 : 1)); if (c.kind === "limit") rs = rs.slice(0, c.n); } return rs.map(([p, d]) => ({ id: p.split("/")[1], data: () => d })); };
  return { collection: (_: unknown, name: string) => ({ name, withConverter() { return this; } }), doc: (c: { name: string }, id?: string) => ({ name: c.name, id: id ?? "auto-0" }), query: (c: { name: string }, ...constraints: C[]) => ({ ...c, constraints }), where: (field: string, _op: string, value: unknown) => ({ kind: "where", field, value }), orderBy: (field: string, direction = "asc") => ({ kind: "order", field, direction }), limit: (n: number) => ({ kind: "limit", n }), getDocs: async (q: { name: string; constraints?: C[] }) => ({ docs: rows(q) }), getDoc: async (r: { name: string; id: string }) => { const d = fake.store.get(`${r.name}/${r.id}`); return { id: r.id, exists: () => d !== undefined, data: () => d }; }, setDoc: async (r: { name: string; id: string }, d: Record<string, unknown>) => fake.store.set(`${r.name}/${r.id}`, d), updateDoc: async (r: { name: string; id: string }, d: Record<string, unknown>) => { const p = `${r.name}/${r.id}`; const old = fake.store.get(p); if (!old) throw new Error("NOT_FOUND"); fake.store.set(p, { ...old, ...d }); }, deleteDoc: async (r: { name: string; id: string }) => { fake.store.delete(`${r.name}/${r.id}`); }, serverTimestamp: () => timestamp };
});
const dal = await import("@/lib/db/registrationType");
const base = { organizationId: "org-a", eventId: "event-a", name: "General", code: "GEN", capacity: 10, registeredCount: 4, createdAt: 1, updatedAt: 1 };
function seed(id: string, overrides: Record<string, unknown> = {}) { fake.store.set(`RegistrationType/${id}`, { ...base, ...overrides }); }
beforeEach(() => fake.reset());

describe("registrationType public real DAL", () => {
  it("lists only the requested event/org in order with empty/default/custom limits", async () => {
    expect(dal.REGISTRATION_TYPE_COLLECTION).toBe("RegistrationType"); expect(dal.REGISTRATION_TYPE_LIST_LIMIT).toBe(50);
    for (let i = 0; i < 52; i++) seed(`r-${i}`, { createdAt: i }); seed("other-event", { eventId: "event-b", createdAt: -2 }); seed("other-org", { organizationId: "org-b", createdAt: -1 });
    expect(await dal.getRegistrationTypesForEvent({ eventId: "none", organizationId: "org-a" })).toEqual([]);
    const rows = await dal.getRegistrationTypesForEvent({ eventId: "event-a", organizationId: "org-a" }); expect(rows).toHaveLength(50); expect(rows.slice(0, 2).map((x) => x.id)).toEqual(["r-0", "r-1"]);
    expect(await dal.getRegistrationTypesForEvent({ eventId: "event-a", organizationId: "org-a", limit: 2 })).toHaveLength(2);
  });
  it("returns exact capacity/count and hides missing, cross-event, and cross-org ids", async () => {
    seed("owned", { capacity: 4, registeredCount: 4 }); seed("foreign", { organizationId: "org-b" });
    await expect(dal.getRegistrationTypeForEvent({ registrationTypeId: "owned", eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id: "owned", capacity: 4, registeredCount: 4 });
    await expect(dal.getRegistrationTypeForEvent({ registrationTypeId: "owned", eventId: "event-b", organizationId: "org-a" })).resolves.toBeNull(); await expect(dal.getRegistrationTypeForEvent({ registrationTypeId: "foreign", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull(); await expect(dal.getRegistrationTypeForEvent({ registrationTypeId: "missing", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
  });
  it("creates normalized exact fields with zero server-owned count, including capacity boundary", async () => { const id = await dal.createRegistrationType({ organizationId: "org-a", eventId: "event-a", name: "VIP", code: " vip ", capacity: 0 }); expect(fake.store.get(`RegistrationType/${id}`)).toMatchObject({ organizationId: "org-a", eventId: "event-a", name: "VIP", code: "VIP", capacity: 0, registeredCount: 0, createdAt: timestamp, updatedAt: timestamp }); });
  it("updates only mutable fields and preserves scope/counter", async () => { seed("owned"); await dal.updateRegistrationType("owned", { name: "VIP", code: " vip ", capacity: null }); expect(fake.store.get("RegistrationType/owned")).toMatchObject({ organizationId: "org-a", eventId: "event-a", registeredCount: 4, name: "VIP", code: "VIP", capacity: null, updatedAt: timestamp }); await expect(dal.updateRegistrationType("missing", {})).rejects.toThrow("NOT_FOUND"); });
  it("checks normalized per-event uniqueness on both sides and self exclusion", async () => { seed("one", { code: "VIP" }); seed("two", { code: "VIP" }); seed("foreign", { eventId: "event-b", code: "OTHER" }); await expect(dal.isRegistrationTypeCodeTaken({ eventId: "event-a", code: " vip " })).resolves.toBe(true); await expect(dal.isRegistrationTypeCodeTaken({ eventId: "event-a", code: "VIP", excludeId: "one" })).resolves.toBe(true); await expect(dal.isRegistrationTypeCodeTaken({ eventId: "event-a", code: "none" })).resolves.toBe(false); });
  it("deletes exactly the requested id", async () => { seed("one"); seed("two"); await dal.deleteRegistrationType("one"); expect(fake.store.has("RegistrationType/one")).toBe(false); expect(fake.store.has("RegistrationType/two")).toBe(true); });
});
