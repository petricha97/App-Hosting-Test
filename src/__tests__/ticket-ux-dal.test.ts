// @vitest-environment node
// Exercises the real default-audience transaction and ticket sales allow-list
// against the repository's Firestore fake, including a staged conflict/retry.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
const { ensureAdminDefaultRegistrationType } = await import("@/lib/db/adminRegistrationType");
const { updateAdminTicketType } = await import("@/lib/db/adminTicketType");
const input = { eventId: "event-a", organizationId: "org-a", capacity: null };

beforeEach(() => fake.reset());

describe("ensureAdminDefaultRegistrationType", () => {
  it("creates an ordinary registration type with server-owned fields", async () => {
    const result = await ensureAdminDefaultRegistrationType({ ...input, capacity: 100 });
    expect(result).toMatchObject({ ok: true, name: "General attendee", code: "GENERAL", capacity: 100 });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ type: "create", data: { ...input, capacity: 100, registeredCount: 0, createdAt: expect.anything(), updatedAt: expect.anything() } });
  });

  it("reuses the same identity without overwriting capacity or subsequent organizer edits", async () => {
    const first = await ensureAdminDefaultRegistrationType(input);
    if (!first.ok) throw new Error("Expected default creation");
    const path = `RegistrationType/${first.registrationTypeId}`;
    fake.store.set(path, { ...fake.store.get(path), name: "Conference guests", code: "GUESTS", capacity: 50, registeredCount: 10 });
    const reused = await ensureAdminDefaultRegistrationType({ ...input, capacity: 2 });
    expect(reused).toEqual({ ok: true, registrationTypeId: first.registrationTypeId, name: "Conference guests", code: "GUESTS", capacity: 50 });
    expect(fake.writes).toHaveLength(1);
    expect(fake.store.get(path)?.registeredCount).toBe(10);
  });

  it("uses a shared identity when an overlapping request commits first", async () => {
    let overlappingResult: Awaited<ReturnType<typeof ensureAdminDefaultRegistrationType>> | undefined;
    // The fake stages this transaction, commits the competing request, then
    // retries the first body's now-stale missing-document read like Firestore.
    fake.setTransactionInterleave(async () => {
      overlappingResult = await ensureAdminDefaultRegistrationType({ ...input, capacity: 40 });
    });
    const result = await ensureAdminDefaultRegistrationType({ ...input, capacity: 80 });
    expect(result).toEqual(overlappingResult);
    expect(result).toMatchObject({ capacity: 40 });
    expect(fake.writes).toHaveLength(1);
    expect(fake.store.size).toBe(1);
  });

  it("creates different identities across events and organizations", async () => {
    const results = await Promise.all([
      ensureAdminDefaultRegistrationType(input),
      ensureAdminDefaultRegistrationType({ ...input, eventId: "event-b" }),
      ensureAdminDefaultRegistrationType({ ...input, organizationId: "org-b" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fake.store.size).toBe(3);
    expect(new Set(fake.writes.map((write) => write.path)).size).toBe(3);
  });

  it("rejects an unrelated GENERAL audience instead of adopting or overwriting it", async () => {
    fake.store.set("RegistrationType/other", { ...input, code: "GENERAL", name: "Staff only" });
    await expect(ensureAdminDefaultRegistrationType(input)).resolves.toEqual({ ok: false, code: "CODE_TAKEN" });
    expect(fake.writes).toHaveLength(0);
  });

  it("does not treat another tenant's or event's code as a collision", async () => {
    fake.store.set("RegistrationType/foreign-org", { ...input, organizationId: "org-b", code: "GENERAL" });
    fake.store.set("RegistrationType/foreign-event", { ...input, eventId: "event-b", code: "GENERAL" });
    await expect(ensureAdminDefaultRegistrationType(input)).resolves.toMatchObject({ ok: true });
    expect(fake.writes).toHaveLength(1);
  });

  it.each([{ organizationId: "org-b" }, { eventId: "event-b" }])("does not reuse a stable document with invalid scope %j", async (foreignScope) => {
    const created = await ensureAdminDefaultRegistrationType(input);
    if (!created.ok) throw new Error("Expected default creation");
    const path = `RegistrationType/${created.registrationTypeId}`;
    fake.store.set(path, { ...fake.store.get(path), ...foreignScope });
    await expect(ensureAdminDefaultRegistrationType(input)).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.writes).toHaveLength(1);
  });
});

describe("ticket sales scoped mutation", () => {
  it("pause and resume preserve every field except the switch and update timestamp", async () => {
    const ticket = { ...input, name: "Early bird", code: "EARLY", capacity: 10, registeredCount: 10, isOpen: true, salesStart: { seconds: 10 }, salesEnd: { seconds: 20 }, registrationTypeIds: ["audience-a"], createdAt: { seconds: 1 }, updatedAt: { seconds: 1 } };
    fake.store.set("TicketType/ticket-a", ticket);
    for (const isOpen of [false, true]) {
      await expect(updateAdminTicketType({ ...input, ticketTypeId: "ticket-a" }, { isOpen })).resolves.toEqual({ ok: true });
      expect(fake.store.get("TicketType/ticket-a")).toEqual({ ...ticket, isOpen, updatedAt: expect.anything() });
      expect(Object.keys(fake.writes.at(-1)!.data!).sort()).toEqual(["isOpen", "updatedAt"]);
    }
  });

  it.each([{ organizationId: "org-b" }, { eventId: "event-b" }])("rejects foreign ticket scope %j without writing", async (foreignScope) => {
    fake.store.set("TicketType/ticket-a", { ...input, isOpen: true });
    await expect(updateAdminTicketType({ ...input, ...foreignScope, ticketTypeId: "ticket-a" }, { isOpen: false })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.writes).toHaveLength(0);
  });
});
