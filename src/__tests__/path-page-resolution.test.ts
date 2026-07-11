// @vitest-environment node
/**
 * M4-T2 — public ?path= resolution
 * (src/features/public-events/server/path-page.ts).
 * Spec ACs: 21 (active path + published page → that page), 22 (draft-only →
 * fallback), 23 (inactive / foreign-event / unknown param → ignored, default
 * renders; inactive paths' pages never publicly reachable).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminRegistrationPathForEvent, getAdminPublishedEventPageForEvent } =
  vi.hoisted(() => ({
    getAdminRegistrationPathForEvent: vi.fn(),
    getAdminPublishedEventPageForEvent: vi.fn(),
  }));

vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathForEvent,
}));
vi.mock("@/lib/db/adminEventPage", () => ({
  getAdminPublishedEventPageForEvent,
}));

import { resolvePublicPathPage } from "@/features/public-events/server/path-page";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const activePath = { id: "path-1", isActive: true };
const publishedPage = {
  id: "page-1",
  eventId: EVENT_ID,
  organizationId: ORG_ID,
  pageKey: "path-1",
  status: "published",
  publishedContent: { content: [], root: {}, zones: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePublicPathPage", () => {
  it("returns the published page for an active path (AC-21) with the pageKey lookup", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(activePath);
    getAdminPublishedEventPageForEvent.mockResolvedValue(publishedPage);

    const resolved = await resolvePublicPathPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pathParam: "path-1",
    });

    expect(resolved).toEqual({ pathId: "path-1", page: publishedPage });
    expect(getAdminPublishedEventPageForEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
    });
  });

  it("ignores a missing param or missing org without any lookups", async () => {
    expect(
      await resolvePublicPathPage({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        pathParam: undefined,
      }),
    ).toBeNull();
    expect(
      await resolvePublicPathPage({
        eventId: EVENT_ID,
        organizationId: null,
        pathParam: "path-1",
      }),
    ).toBeNull();
    expect(getAdminRegistrationPathForEvent).not.toHaveBeenCalled();
  });

  it("ignores unknown / foreign-event path ids (AC-23 — scoped lookup returns null)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(null);

    const resolved = await resolvePublicPathPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pathParam: "someone-elses-path",
    });

    expect(resolved).toBeNull();
    expect(getAdminPublishedEventPageForEvent).not.toHaveBeenCalled();
  });

  it("never resolves an INACTIVE path's page (AC-23)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue({
      id: "path-1",
      isActive: false,
    });

    const resolved = await resolvePublicPathPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pathParam: "path-1",
    });

    expect(resolved).toBeNull();
    expect(getAdminPublishedEventPageForEvent).not.toHaveBeenCalled();
  });

  it("falls back when the path has no PUBLISHED page (AC-22 — draft-only or none)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(activePath);
    getAdminPublishedEventPageForEvent.mockResolvedValue(null);

    const resolved = await resolvePublicPathPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pathParam: "path-1",
    });

    expect(resolved).toBeNull();
  });
});
