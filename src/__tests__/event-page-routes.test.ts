// @vitest-environment node
/**
 * M4-T2 — page save + publish route guards (review S2).
 * Routes: src/app/api/dashboard/events/[eventId]/page/route.ts and
 * .../page/publish/route.ts.
 * Locks:
 * - AC-25: a non-default pageKey must be a registration path of THIS event
 *   (org-scoped lookup) — foreign/unknown ids → 400, and no write happens.
 * - AC-24: publishing/saving a PATH page never flips event.pageMode or moves
 *   event.eventPagePath; the DEFAULT page keeps doing both.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  updateAdminEvent,
  saveAdminEventPageDraft,
  publishAdminEventPage,
  getAdminRegistrationPathForEvent,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  updateAdminEvent: vi.fn(),
  saveAdminEventPageDraft: vi.fn(),
  publishAdminEventPage: vi.fn(),
  getAdminRegistrationPathForEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventForOrganization,
  updateAdminEvent,
}));
vi.mock("@/lib/db/adminEventPage", () => ({
  DEFAULT_EVENT_PAGE_KEY: "default",
  saveAdminEventPageDraft,
  publishAdminEventPage,
}));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathForEvent,
}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
}));

import { POST as savePost } from "@/app/api/dashboard/events/[eventId]/page/route";
import { POST as publishPost } from "@/app/api/dashboard/events/[eventId]/page/publish/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const PATH_ID = "path-1";

const VALID_CONTENT = {
  content: [{ type: "Hero", props: { id: "hero-1", heading: "Hi" } }],
  root: {},
  zones: {},
};

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/dashboard/events/${EVENT_ID}/page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

function validBody(pageKey?: string) {
  return {
    title: "Summit page",
    draftContent: VALID_CONTENT,
    ...(pageKey ? { pageKey } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: "token" } : undefined),
  });
  decodeUser.mockResolvedValue({ email: "owner@example.com" });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    permissions: ["write:events"],
  });
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    eventPagePath: "EventPage/page-default",
    pageMode: "default",
  });
  getAdminRegistrationPathForEvent.mockResolvedValue({
    id: PATH_ID,
    eventId: EVENT_ID,
    organizationId: ORG_ID,
  });
  saveAdminEventPageDraft.mockResolvedValue({
    id: "page-1",
    path: "EventPage/page-1",
  });
  publishAdminEventPage.mockResolvedValue({
    id: "page-1",
    path: "EventPage/page-1",
  });
  updateAdminEvent.mockResolvedValue(undefined);
});

describe("POST /page (save draft) — pageKey validation (AC-25)", () => {
  it("rejects an unknown/foreign pageKey with 400 and never writes", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(null);

    const response = await savePost(
      makeRequest(validBody("foreign-path")),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(getAdminRegistrationPathForEvent).toHaveBeenCalledWith({
      pathId: "foreign-path",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(saveAdminEventPageDraft).not.toHaveBeenCalled();
    expect(updateAdminEvent).not.toHaveBeenCalled();
  });

  it("accepts a pageKey that is a registration path of this event", async () => {
    const response = await savePost(
      makeRequest(validBody(PATH_ID)),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(saveAdminEventPageDraft).toHaveBeenCalledWith(
      expect.objectContaining({ pageKey: PATH_ID, organizationId: ORG_ID }),
    );
    // AC-24: a PATH page save never moves event.eventPagePath.
    expect(updateAdminEvent).not.toHaveBeenCalled();
  });

  it("defaults an absent pageKey to the default page (no path lookup) and repoints eventPagePath", async () => {
    const response = await savePost(makeRequest(validBody()), makeContext());

    expect(response.status).toBe(200);
    expect(getAdminRegistrationPathForEvent).not.toHaveBeenCalled();
    expect(updateAdminEvent).toHaveBeenCalledWith(
      EVENT_ID,
      expect.objectContaining({ eventPagePath: "EventPage/page-1" }),
    );
  });
});

describe("POST /page/publish — pageKey validation (AC-25) + pageMode guard (AC-24)", () => {
  it("rejects an unknown/foreign pageKey with 400 and never publishes", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(null);

    const response = await publishPost(
      makeRequest(validBody("foreign-path")),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(publishAdminEventPage).not.toHaveBeenCalled();
    expect(updateAdminEvent).not.toHaveBeenCalled();
  });

  it("publishing a PATH page never flips event.pageMode or eventPagePath (AC-24)", async () => {
    const response = await publishPost(
      makeRequest(validBody(PATH_ID)),
      makeContext(),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(publishAdminEventPage).toHaveBeenCalledWith(
      expect.objectContaining({ pageKey: PATH_ID }),
    );
    expect(updateAdminEvent).not.toHaveBeenCalled();
    expect(payload.pageMode).toBe("default"); // unchanged event mode echoed
  });

  it("publishing the DEFAULT page flips pageMode to custom and repoints eventPagePath", async () => {
    const response = await publishPost(makeRequest(validBody()), makeContext());

    expect(response.status).toBe(200);
    expect(updateAdminEvent).toHaveBeenCalledWith(
      EVENT_ID,
      expect.objectContaining({
        pageMode: "custom",
        eventPagePath: "EventPage/page-1",
      }),
    );
  });

  it("404s cross-org events before any pageKey handling", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await publishPost(
      makeRequest(validBody(PATH_ID)),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(getAdminRegistrationPathForEvent).not.toHaveBeenCalled();
    expect(publishAdminEventPage).not.toHaveBeenCalled();
  });
});
