/**
 * M0-T4 characterization tests — behaviors 1 & 2.
 *
 * Locks the org-scoping contract of the client Event repository:
 *  1. getEventForOrganization returns null for missing events and events whose
 *     organizationPath matches none of the 5 legacy path candidates, and
 *     returns the event for every legacy variant.
 *  2. getEventsForOrganization dedupes duplicate ids across path-candidate
 *     queries, sorts by updatedAt.seconds desc, and silently drops documents
 *     failing eventDocumentSchema.
 *
 * Firestore is mocked at the DAL boundary (@/lib/db/base), so no emulator or
 * live project is required.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import type { EventDoc, WithId } from "@/types/collection";

const { getById, findWhere } = vi.hoisted(() => ({
  getById: vi.fn(),
  findWhere: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  serverTimestamp: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })),
}));

vi.mock("@/lib/db/base", () => ({
  createCollectionApi: () => ({
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

import {
  getEventForOrganization,
  getEventsForOrganization,
} from "@/lib/db/event";

const ORG_ID = "org-1";

function makeEvent(overrides: Partial<WithId<EventDoc>> = {}): WithId<EventDoc> {
  return {
    id: "evt-1",
    name: "Tech Meetup 2026",
    description: "Annual tech meetup",
    capacity: 100,
    expectedGuests: 50,
    formPath: "Form/form-1",
    invoicePath: "",
    organizationPath: `Organization/${ORG_ID}`,
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
  findWhere.mockReset();
  findWhere.mockResolvedValue([]);
});

describe("getEventForOrganization", () => {
  it("returns null when the event does not exist", async () => {
    getById.mockResolvedValue(null);

    await expect(getEventForOrganization("missing", ORG_ID)).resolves.toBeNull();
  });

  it("returns null when the event belongs to another organization", async () => {
    getById.mockResolvedValue(
      makeEvent({ organizationPath: "Organization/other-org" }),
    );

    await expect(getEventForOrganization("evt-1", ORG_ID)).resolves.toBeNull();
  });

  it("returns null when the document fails the event schema", async () => {
    getById.mockResolvedValue(makeEvent({ name: "" }));

    await expect(getEventForOrganization("evt-1", ORG_ID)).resolves.toBeNull();
  });

  it.each([
    [`Organization/${ORG_ID}`],
    [`organization/${ORG_ID}`],
    [`/organization/${ORG_ID}`],
    [`organizations/${ORG_ID}`],
    [`/organizations/${ORG_ID}`],
  ])("returns the event for legacy path variant %s", async (path) => {
    getById.mockResolvedValue(makeEvent({ organizationPath: path }));

    const result = await getEventForOrganization("evt-1", ORG_ID);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("evt-1");
    expect(result?.organizationPath).toBe(path);
  });
});

describe("getEventsForOrganization", () => {
  it("queries every legacy organizationPath candidate", async () => {
    await getEventsForOrganization(ORG_ID);

    const queriedPaths = findWhere.mock.calls.map(([field, value]) => {
      expect(field).toBe("organizationPath");
      return value;
    });

    expect(queriedPaths).toEqual([
      `Organization/${ORG_ID}`,
      `organization/${ORG_ID}`,
      `/organization/${ORG_ID}`,
      `organizations/${ORG_ID}`,
      `/organizations/${ORG_ID}`,
    ]);
  });

  it("collapses duplicate event ids returned by multiple path queries", async () => {
    const duplicate = makeEvent({ id: "evt-dup" });

    findWhere.mockImplementation(async (_field: string, value: string) =>
      value === `Organization/${ORG_ID}` || value === `organizations/${ORG_ID}`
        ? [duplicate]
        : [],
    );

    const results = await getEventsForOrganization(ORG_ID);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("evt-dup");
  });

  it("sorts events by updatedAt.seconds descending", async () => {
    findWhere.mockImplementation(async (_field: string, value: string) =>
      value === `Organization/${ORG_ID}`
        ? [
            makeEvent({ id: "old", updatedAt: { seconds: 100, nanoseconds: 0 } }),
            makeEvent({ id: "new", updatedAt: { seconds: 300, nanoseconds: 0 } }),
            makeEvent({ id: "mid", updatedAt: { seconds: 200, nanoseconds: 0 } }),
          ]
        : [],
    );

    const results = await getEventsForOrganization(ORG_ID);

    expect(results.map((event) => event.id)).toEqual(["new", "mid", "old"]);
  });

  it("silently drops documents that fail the event schema", async () => {
    findWhere.mockImplementation(async (_field: string, value: string) =>
      value === `Organization/${ORG_ID}`
        ? [
            makeEvent({ id: "valid" }),
            makeEvent({ id: "invalid", name: "" }),
          ]
        : [],
    );

    const results = await getEventsForOrganization(ORG_ID);

    expect(results.map((event) => event.id)).toEqual(["valid"]);
  });
});
