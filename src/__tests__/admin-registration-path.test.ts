// @vitest-environment node
/**
 * M3-T1 — RegistrationPath admin DAL (src/lib/db/adminRegistrationPath.ts).
 * Spec: agents/docs/specs/m3-registration-paths.md (T1 AC-2/AC-4/AC-5/AC-6/AC-8/AC-10).
 *
 * Locks:
 *  - list: org-scoped in the query, sortOrder asc, bounded, includes inactive
 *  - active list: inactive paths filtered (public picker source)
 *  - scoped get: null for cross-org / cross-event ids (IDOR-safe 404s)
 *  - create: explicit field stamps (server-owned org/event/timestamps),
 *    uppercase code, isActive default true, sortOrder default max+1
 *  - update: allow-list only, code re-normalized, updatedAt bumped
 *  - code uniqueness: case-insensitive per event, excludeId on edit
 *  - reference check: paths pinning a registration type as audience
 *    ("Any"-audience paths never match) — the M1 delete-block extension
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

import type { RegistrationPathDoc } from "@/types/collection";

const {
  createAdminRegistrationPath,
  deleteAdminRegistrationPath,
  getAdminActiveRegistrationPathsForEvent,
  getAdminNextRegistrationPathSortOrder,
  getAdminRegistrationPathForEvent,
  getAdminRegistrationPathsForEvent,
  getAdminRegistrationPathsReferencingRegistrationType,
  isAdminRegistrationPathCodeTaken,
  updateAdminRegistrationPath,
} = await import("@/lib/db/adminRegistrationPath");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function seedPath(
  id: string,
  overrides: Partial<RegistrationPathDoc> = {},
): void {
  fake.store.set(`RegistrationPath/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: `Path ${id}`,
    code: id.toUpperCase(),
    audienceRegistrationTypeId: null,
    paymentMethod: "card",
    currency: "USD",
    isActive: true,
    sortOrder: 0,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("getAdminRegistrationPathsForEvent", () => {
  it("lists org-scoped paths ordered by sortOrder asc, including inactive ones", async () => {
    seedPath("p-b", { sortOrder: 2, isActive: false });
    seedPath("p-a", { sortOrder: 1 });
    seedPath("p-c", { sortOrder: 3 });
    // Same event id, FOREIGN org — must never leak into the list.
    seedPath("p-foreign", { organizationId: "org-other", sortOrder: 0 });
    // Same org, other event.
    seedPath("p-other-event", { eventId: "evt-2", sortOrder: 0 });

    const paths = await getAdminRegistrationPathsForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(paths.map((p) => p.id)).toEqual(["p-a", "p-b", "p-c"]);
  });

  it("bounds the read with the limit", async () => {
    for (let i = 0; i < 5; i += 1) seedPath(`p-${i}`, { sortOrder: i });

    const paths = await getAdminRegistrationPathsForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 2,
    });

    expect(paths).toHaveLength(2);
  });
});

describe("getAdminActiveRegistrationPathsForEvent (public picker source)", () => {
  it("filters inactive paths but keeps sortOrder order (T1 AC-4 / T3 AC-1)", async () => {
    seedPath("p-active-2", { sortOrder: 2 });
    seedPath("p-inactive", { sortOrder: 1, isActive: false });
    seedPath("p-active-1", { sortOrder: 0 });

    const paths = await getAdminActiveRegistrationPathsForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(paths.map((p) => p.id)).toEqual(["p-active-1", "p-active-2"]);
  });
});

describe("getAdminRegistrationPathForEvent — IDOR-safe scoping", () => {
  it("returns the doc for the owning event+org and null otherwise", async () => {
    seedPath("p-1");

    await expect(
      getAdminRegistrationPathForEvent({
        pathId: "p-1",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toMatchObject({ id: "p-1" });

    await expect(
      getAdminRegistrationPathForEvent({
        pathId: "p-1",
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).resolves.toBeNull();

    await expect(
      getAdminRegistrationPathForEvent({
        pathId: "p-1",
        eventId: "evt-2",
        organizationId: ORG_ID,
      }),
    ).resolves.toBeNull();

    await expect(
      getAdminRegistrationPathForEvent({
        pathId: "missing",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toBeNull();
  });
});

describe("createAdminRegistrationPath", () => {
  it("stamps explicit server-owned fields, uppercases the code and defaults isActive/sortOrder", async () => {
    seedPath("p-existing", { sortOrder: 3 });

    const id = await createAdminRegistrationPath({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "2. Sponsor — Card",
      code: "spn-cc",
      audienceRegistrationTypeId: "rt-sponsor",
      paymentMethod: "card",
      currency: "USD",
    });

    const stored = fake.store.get(`RegistrationPath/${id}`)!;
    expect(stored).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "2. Sponsor — Card",
      code: "SPN-CC",
      audienceRegistrationTypeId: "rt-sponsor",
      paymentMethod: "card",
      currency: "USD",
      isActive: true,
      // max existing sortOrder (3) + 1
      sortOrder: 4,
    });
    expect(stored.createdAt).toBeDefined();
    expect(stored.updatedAt).toBeDefined();
  });

  it("stores an Any audience EXPLICITLY as null and honors explicit sortOrder/isActive", async () => {
    const id = await createAdminRegistrationPath({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Comp",
      code: "COMP",
      audienceRegistrationTypeId: null,
      paymentMethod: "none",
      currency: "USD",
      isActive: false,
      sortOrder: 7,
    });

    const stored = fake.store.get(`RegistrationPath/${id}`)!;
    expect(stored.audienceRegistrationTypeId).toBeNull();
    expect("audienceRegistrationTypeId" in stored).toBe(true);
    expect(stored.isActive).toBe(false);
    expect(stored.sortOrder).toBe(7);
  });

  it("defaults sortOrder to 0 for the event's first path", async () => {
    await expect(
      getAdminNextRegistrationPathSortOrder({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toBe(0);
  });
});

describe("updateAdminRegistrationPath — allow-list", () => {
  it("updates only the provided writable fields, re-normalizes code, bumps updatedAt", async () => {
    seedPath("p-1", { code: "OLD", sortOrder: 1 });

    await updateAdminRegistrationPath("p-1", {
      code: "new-code",
      isActive: false,
      sortOrder: 9,
    });

    const stored = fake.store.get("RegistrationPath/p-1")!;
    expect(stored.code).toBe("NEW-CODE");
    expect(stored.isActive).toBe(false);
    expect(stored.sortOrder).toBe(9);
    // Untouched fields survive; server-owned fields unchanged.
    expect(stored.name).toBe("Path p-1");
    expect(stored.organizationId).toBe(ORG_ID);
    expect(stored.eventId).toBe(EVENT_ID);
    expect(stored.createdAt).toEqual({ seconds: 1 });
    expect(stored.updatedAt).not.toEqual({ seconds: 1 });

    // The write set never contains server-owned keys.
    const update = fake.writes.find((w) => w.type === "update");
    expect(Object.keys(update!.data!).sort()).toEqual([
      "code",
      "isActive",
      "sortOrder",
      "updatedAt",
    ]);
  });
});

describe("isAdminRegistrationPathCodeTaken (T1 AC-2)", () => {
  it("is case-insensitive per event and excludes self on edit", async () => {
    seedPath("p-1", { code: "SPN-CC" });
    // Same code on ANOTHER event never collides.
    seedPath("p-other-event", { eventId: "evt-2", code: "SPN-CC" });

    await expect(
      isAdminRegistrationPathCodeTaken({ eventId: EVENT_ID, code: "spn-cc" }),
    ).resolves.toBe(true);

    await expect(
      isAdminRegistrationPathCodeTaken({
        eventId: EVENT_ID,
        code: "SPN-CC",
        excludeId: "p-1",
      }),
    ).resolves.toBe(false);

    await expect(
      isAdminRegistrationPathCodeTaken({ eventId: EVENT_ID, code: "FRESH" }),
    ).resolves.toBe(false);
  });
});

describe("getAdminRegistrationPathsReferencingRegistrationType (M1 delete-block extension, T1 AC-6)", () => {
  it("matches only paths pinning the type as audience, org-scoped; Any-audience never blocks", async () => {
    seedPath("p-pinned-1", { audienceRegistrationTypeId: "rt-1" });
    seedPath("p-pinned-2", { audienceRegistrationTypeId: "rt-1" });
    seedPath("p-any", { audienceRegistrationTypeId: null });
    seedPath("p-other-type", { audienceRegistrationTypeId: "rt-2" });
    seedPath("p-foreign", {
      organizationId: "org-other",
      audienceRegistrationTypeId: "rt-1",
    });

    const blocking = await getAdminRegistrationPathsReferencingRegistrationType({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      registrationTypeId: "rt-1",
    });

    expect(blocking.map((p) => p.id).sort()).toEqual([
      "p-pinned-1",
      "p-pinned-2",
    ]);
  });
});

describe("deleteAdminRegistrationPath", () => {
  it("hard-deletes the doc (reference 409s are the route's job)", async () => {
    seedPath("p-1");

    await deleteAdminRegistrationPath("p-1");

    expect(fake.store.has("RegistrationPath/p-1")).toBe(false);
  });
});
