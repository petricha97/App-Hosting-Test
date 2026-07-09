/**
 * M0-T4 characterization tests — behavior 3.
 *
 * Locks the public-surface gate of the admin Event repository:
 * getAdminPublishedEventById returns null for Draft events even when the
 * document exists, and returns the event only when status === "Published".
 *
 * Firestore is mocked at the DAL boundary (@/lib/db/adminBase).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import type { EventDoc, WithId } from "@/types/collection";

const { getById, findWhere } = vi.hoisted(() => ({
  getById: vi.fn(),
  findWhere: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/adminBase", () => ({
  createAdminCollectionApi: () => ({
    create: vi.fn(),
    set: vi.fn(),
    getById,
    getAll: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    findWhere,
    findMany: vi.fn(),
  }),
}));

import { getAdminPublishedEventById } from "@/lib/db/adminEvent";

function makeEvent(overrides: Partial<WithId<EventDoc>> = {}): WithId<EventDoc> {
  return {
    id: "evt-1",
    name: "Tech Meetup 2026",
    description: "Annual tech meetup",
    capacity: 100,
    expectedGuests: 50,
    formPath: "Form/form-1",
    invoicePath: "",
    organizationPath: "Organization/org-1",
    timezone: "Asia/Singapore",
    allowOverlap: false,
    status: "Draft",
    pageMode: "default",
    redirectUrl: "",
    periods: [],
    createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    ...overrides,
  } as WithId<EventDoc>;
}

beforeEach(() => {
  getById.mockReset();
});

describe("getAdminPublishedEventById", () => {
  it("returns null when the event does not exist", async () => {
    getById.mockResolvedValue(null);

    await expect(getAdminPublishedEventById("missing")).resolves.toBeNull();
  });

  it("returns null for a Draft event even though the document exists", async () => {
    getById.mockResolvedValue(makeEvent({ status: "Draft" }));

    await expect(getAdminPublishedEventById("evt-1")).resolves.toBeNull();
  });

  it("returns the event when it is Published", async () => {
    getById.mockResolvedValue(makeEvent({ status: "Published" }));

    const result = await getAdminPublishedEventById("evt-1");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("evt-1");
    expect(result?.status).toBe("Published");
  });
});
