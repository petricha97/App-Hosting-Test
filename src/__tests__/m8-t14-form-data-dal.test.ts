// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
vi.mock("@/features/responses/on-submission-accepted", () => ({ onSubmissionAccepted: vi.fn() }));
const dal = await import("@/lib/db/adminFormData");

const base = { formId: "form-a", eventId: "event-a", organizationId: "org-a", submission: { name: "Ada", quantity: "1" }, submittedAt: { seconds: 100, toMillis: () => 100_000 }, status: "new", orderId: "order-a", pathId: "path-a", ticketLabel: "Standard", statusUpdatedAt: null, acceptedAt: null, attendeeCreated: false };
function seed(id: string, overrides: Record<string, unknown> = {}) { fake.store.set(`FormData/${id}`, { ...base, ...overrides }); }
beforeEach(() => fake.reset());

describe("adminFormData real DAL reads and owned transitions", () => {
  it("legacy organization read scopes exactly and sorts newest-first, treating malformed timestamps as oldest", async () => {
    seed("older", { submittedAt: { seconds: 10 } }); seed("newer", { submittedAt: { seconds: 20 } }); seed("malformed", { submittedAt: "legacy" }); seed("foreign", { organizationId: "org-b", submittedAt: { seconds: 99 } });
    expect((await dal.getAdminFormDataForOrganization("org-a")).map((x) => x.id)).toEqual(["newer", "older", "malformed"]);
    expect(await dal.getAdminFormDataForOrganization("missing")).toEqual([]);
  });

  it("event list isolates event/org, orders descending, filters both status branches, paginates, and honors limits", async () => {
    seed("newest", { submittedAt: { seconds: 30, toMillis: () => 30_000 }, status: "new" }); seed("middle", { submittedAt: { seconds: 20, toMillis: () => 20_000 }, status: "reviewed" }); seed("oldest", { submittedAt: { seconds: 10, toMillis: () => 10_000 }, status: "new" }); seed("other-event", { eventId: "event-b", submittedAt: { seconds: 40 } }); seed("other-org", { organizationId: "org-b", submittedAt: { seconds: 50 } });
    expect((await dal.listAdminFormDataForEvent({ eventId: "event-a", organizationId: "org-a", limit: 2 })).map((x) => x.id)).toEqual(["newest", "middle"]);
    expect((await dal.listAdminFormDataForEvent({ eventId: "event-a", organizationId: "org-a", status: "new" })).map((x) => x.id)).toEqual(["newest", "oldest"]);
    expect((await dal.listAdminFormDataForEvent({ eventId: "event-a", organizationId: "org-a", startAfterSubmittedAtMs: 20_000 })).map((x) => x.id)).toEqual(["oldest"]);
    expect(await dal.listAdminFormDataForEvent({ eventId: "missing", organizationId: "org-a" })).toEqual([]);
  });

  it("organization list spans owned events only with optional status/cursor and default limit", async () => {
    for (let i = 0; i < 52; i++) seed(`r-${i}`, { eventId: i % 2 ? "event-a" : "event-b", status: i % 2 ? "pending" : "accepted", submittedAt: { seconds: i, toMillis: () => i * 1000 } }); seed("foreign", { organizationId: "org-b", submittedAt: { seconds: 999 } });
    const all = await dal.listAdminFormDataForOrganization({ organizationId: "org-a" }); expect(all).toHaveLength(dal.FORM_DATA_LIST_LIMIT); expect(all[0].id).toBe("r-51");
    const pending = await dal.listAdminFormDataForOrganization({ organizationId: "org-a", status: "pending", startAfterSubmittedAtMs: 49_000, limit: 2 }); expect(pending.map((x) => x.id)).toEqual(["r-47", "r-45"]);
  });

  it("multi-status event list includes only requested statuses/scope with cursor and bounds", async () => {
    seed("new", { status: "new", submittedAt: { seconds: 30 } }); seed("pending", { status: "pending", submittedAt: { seconds: 20 } }); seed("accepted", { status: "accepted", submittedAt: { seconds: 10 } }); seed("foreign", { organizationId: "org-b", status: "pending", submittedAt: { seconds: 40 } });
    expect((await dal.listAdminFormDataForEventByStatuses({ eventId: "event-a", organizationId: "org-a", statuses: ["new", "pending"] })).map((x) => x.id)).toEqual(["new", "pending"]);
    expect((await dal.listAdminFormDataForEventByStatuses({ eventId: "event-a", organizationId: "org-a", statuses: ["new", "pending"], startAfterSubmittedAtMs: 30_000, limit: 1 })).map((x) => x.id)).toEqual(["pending"]);
    expect(await dal.listAdminFormDataForEventByStatuses({ eventId: "event-a", organizationId: "org-a", statuses: [] })).toEqual([]);
  });

  it("single response read preserves concrete submission values and hides missing/cross-scope ids", async () => {
    seed("owned", { submission: { quantity: "0", amountMinor: "1099" } }); seed("foreign", { organizationId: "org-b" });
    await expect(dal.getAdminFormDataForEvent({ responseId: "owned", eventId: "event-a", organizationId: "org-a" })).resolves.toMatchObject({ id: "owned", submission: { quantity: "0", amountMinor: "1099" } });
    await expect(dal.getAdminFormDataForEvent({ responseId: "owned", eventId: "event-b", organizationId: "org-a" })).resolves.toBeNull(); await expect(dal.getAdminFormDataForEvent({ responseId: "foreign", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull(); await expect(dal.getAdminFormDataForEvent({ responseId: "missing", eventId: "event-a", organizationId: "org-a" })).resolves.toBeNull();
  });

  it("path references are tenant/event scoped and honor default/custom bounds", async () => {
    for (let i = 0; i < 7; i++) seed(`p-${i}`, { pathId: "path-a" }); seed("different", { pathId: "path-b" }); seed("foreign-event", { eventId: "event-b" }); seed("foreign-org", { organizationId: "org-b" });
    expect(await dal.getAdminFormDataReferencingPath({ eventId: "event-a", organizationId: "org-a", pathId: "path-a" })).toHaveLength(5);
    expect(await dal.getAdminFormDataReferencingPath({ eventId: "event-a", organizationId: "org-a", pathId: "path-a", limit: 2 })).toHaveLength(2);
    expect(await dal.getAdminFormDataReferencingPath({ eventId: "event-a", organizationId: "org-a", pathId: "missing" })).toEqual([]);
  });

  it("attendee-created marker is idempotent and only backfills a supplied QR hash", async () => {
    seed("owned", { status: "accepted", attendeeCreated: false, qrTokenHash: "original" }); await dal.markAdminFormDataAttendeeCreated({ formDataId: "owned" }); expect(fake.store.get("FormData/owned")).toMatchObject({ status: "accepted", attendeeCreated: true, qrTokenHash: "original" });
    await dal.markAdminFormDataAttendeeCreated({ formDataId: "owned", qrTokenHash: "backfill" }); await dal.markAdminFormDataAttendeeCreated({ formDataId: "owned", qrTokenHash: "backfill" }); expect(fake.store.get("FormData/owned")).toMatchObject({ attendeeCreated: true, qrTokenHash: "backfill" });
    await expect(dal.markAdminFormDataAttendeeCreated({ formDataId: "missing" })).rejects.toThrow("NOT_FOUND");
  });

  it("rejects attendeeCreated flips unless the submission is accepted", async () => {
    seed("pending", { status: "pending", attendeeCreated: false });
    await expect(dal.markAdminFormDataAttendeeCreated({ formDataId: "pending" })).rejects.toThrow("RESPONSE_NOT_ACCEPTED");
    expect(fake.store.get("FormData/pending")).toMatchObject({ status: "pending", attendeeCreated: false });

    seed("accepted", { status: "accepted", attendeeCreated: false });
    await dal.markAdminFormDataAttendeeCreated({ formDataId: "accepted" });
    await dal.markAdminFormDataAttendeeCreated({ formDataId: "accepted" });
    expect(fake.store.get("FormData/accepted")).toMatchObject({ status: "accepted", attendeeCreated: true });

    seed("legacy", { attendeeCreated: false });
    delete fake.store.get("FormData/legacy")!.status;
    await dal.markAdminFormDataAttendeeCreated({ formDataId: "legacy", qrTokenHash: "legacy-hash" });
    expect(fake.store.get("FormData/legacy")).toMatchObject({ attendeeCreated: true, qrTokenHash: "legacy-hash" });
  });

  it("base exported CRUD functions operate on exact documents", async () => {
    const id = await dal.createAdminFormData(base as any); expect(fake.store.get(`FormData/${id}`)).toMatchObject({ submission: { name: "Ada", quantity: "1" } });
    await dal.setAdminFormData("set-id", { ...base, ticketLabel: "VIP" } as any); await dal.updateAdminFormData("set-id", { ticketLabel: "Updated" }); await expect(dal.getAdminFormDataById("set-id")).resolves.toMatchObject({ id: "set-id", ticketLabel: "Updated" });
    expect(await dal.findAdminFormDataByField("organizationId", "org-a")).toHaveLength(2); await dal.deleteAdminFormData("set-id"); expect(fake.store.has("FormData/set-id")).toBe(false);
  });
});
