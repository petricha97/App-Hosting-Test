// @vitest-environment node
/**
 * M4-T2 AC-26 — deleting a registration path cascades its EventPage doc in
 * the same operation (route:
 * src/app/api/dashboard/events/[eventId]/registration-paths/[pathId]/route.ts).
 * Locks: cascade fires with pageKey=pathId on success; NEVER fires when the
 * delete is blocked (409 referencing drafts/submissions) or the path 404s.
 * Failure safety (review S1): the page cascade runs BEFORE the path delete,
 * so a cascade failure leaves the path intact and the delete retryable —
 * never a permanently orphaned page doc.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveRegistrationRouteScope,
  getAdminRegistrationPathForEvent,
  deleteAdminRegistrationPath,
  isAdminRegistrationPathCodeTaken,
  updateAdminRegistrationPath,
  getAdminRegistrationTypeForEvent,
  getAdminFormDataReferencingPath,
  getAdminRegistrationDraftsReferencingPath,
  deleteAdminEventPagesForPageKey,
} = vi.hoisted(() => ({
  resolveRegistrationRouteScope: vi.fn(),
  getAdminRegistrationPathForEvent: vi.fn(),
  deleteAdminRegistrationPath: vi.fn(),
  isAdminRegistrationPathCodeTaken: vi.fn(),
  updateAdminRegistrationPath: vi.fn(),
  getAdminRegistrationTypeForEvent: vi.fn(),
  getAdminFormDataReferencingPath: vi.fn(),
  getAdminRegistrationDraftsReferencingPath: vi.fn(),
  deleteAdminEventPagesForPageKey: vi.fn(),
}));

vi.mock("@/features/registration/server/route-scope", () => ({
  resolveRegistrationRouteScope,
}));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathForEvent,
  deleteAdminRegistrationPath,
  isAdminRegistrationPathCodeTaken,
  updateAdminRegistrationPath,
}));
vi.mock("@/lib/db/adminRegistrationType", () => ({
  getAdminRegistrationTypeForEvent,
}));
vi.mock("@/lib/db/adminFormData", () => ({ getAdminFormDataReferencingPath }));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  getAdminRegistrationDraftsReferencingPath,
}));
vi.mock("@/lib/db/adminEventPage", () => ({ deleteAdminEventPagesForPageKey }));

import { DELETE } from "@/app/api/dashboard/events/[eventId]/registration-paths/[pathId]/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const PATH_ID = "path-1";

function makeContext(pathId = PATH_ID) {
  return { params: Promise.resolve({ eventId: EVENT_ID, pathId }) };
}

const request = new Request(
  `http://localhost/api/dashboard/events/${EVENT_ID}/registration-paths/${PATH_ID}`,
  { method: "DELETE" },
);

beforeEach(() => {
  vi.clearAllMocks();
  resolveRegistrationRouteScope.mockResolvedValue({
    ok: true,
    organizationId: ORG_ID,
  });
  getAdminRegistrationPathForEvent.mockResolvedValue({
    id: PATH_ID,
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    isActive: true,
  });
  getAdminFormDataReferencingPath.mockResolvedValue([]);
  getAdminRegistrationDraftsReferencingPath.mockResolvedValue([]);
  deleteAdminRegistrationPath.mockResolvedValue(undefined);
  deleteAdminEventPagesForPageKey.mockResolvedValue(1);
});

describe("DELETE registration path — page cascade (AC-26)", () => {
  it("deletes the path AND cascades its page doc under pageKey=pathId", async () => {
    const response = await DELETE(request, makeContext());

    expect(response.status).toBe(200);
    expect(deleteAdminRegistrationPath).toHaveBeenCalledWith(PATH_ID);
    expect(deleteAdminEventPagesForPageKey).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: PATH_ID,
    });
  });

  it("cascades the page doc BEFORE deleting the path (S1: retryable on partial failure)", async () => {
    await DELETE(request, makeContext());

    const cascadeOrder =
      deleteAdminEventPagesForPageKey.mock.invocationCallOrder[0];
    const pathDeleteOrder =
      deleteAdminRegistrationPath.mock.invocationCallOrder[0];
    expect(cascadeOrder).toBeLessThan(pathDeleteOrder);
  });

  it("keeps the path intact when the page cascade fails — no permanent orphan", async () => {
    deleteAdminEventPagesForPageKey.mockRejectedValue(
      new Error("firestore unavailable"),
    );

    await expect(DELETE(request, makeContext())).rejects.toThrow(
      "firestore unavailable",
    );
    // Path doc untouched → a client retry re-runs the full delete+cascade.
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("does NOT cascade when the delete is blocked by references (409)", async () => {
    getAdminRegistrationDraftsReferencingPath.mockResolvedValue([
      { id: "draft-1" },
    ]);

    const response = await DELETE(request, makeContext());

    expect(response.status).toBe(409);
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
    expect(deleteAdminEventPagesForPageKey).not.toHaveBeenCalled();
  });

  it("does NOT cascade on unknown/foreign path ids (404)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(null);

    const response = await DELETE(request, makeContext());

    expect(response.status).toBe(404);
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
    expect(deleteAdminEventPagesForPageKey).not.toHaveBeenCalled();
  });
});
