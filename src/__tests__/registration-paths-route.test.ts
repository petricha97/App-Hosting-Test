// @vitest-environment node
/**
 * M3-T1 — registration-path API route gates.
 * Spec: agents/docs/specs/m3-registration-paths.md (T1 AC-2/AC-4/AC-5/AC-7/AC-10).
 *
 * Locks the route-owned validations:
 *  - 401 unauthenticated, 403 view-only, 404 cross-org event, 404 IDOR on
 *    foreign path ids
 *  - Zod 400s (code format, name length); server-owned fields stripped
 *  - 409 duplicate code (create + edit-excluding-self) with field pointer
 *  - 400 when the audience registration type is not this event's
 *  - partial PATCH shapes: { isActive } toggle and { sortOrder } reorder
 *  - delete BLOCK (409 "Deactivate instead") when drafts or submissions
 *    reference the path; unreferenced paths hard-delete
 *
 * The DAL is mocked at the module boundary — no emulator required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  createAdminRegistrationPath,
  getAdminRegistrationPathForEvent,
  updateAdminRegistrationPath,
  deleteAdminRegistrationPath,
  isAdminRegistrationPathCodeTaken,
  getAdminRegistrationTypeForEvent,
  getAdminRegistrationDraftsReferencingPath,
  getAdminFormDataReferencingPath,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  createAdminRegistrationPath: vi.fn(),
  getAdminRegistrationPathForEvent: vi.fn(),
  updateAdminRegistrationPath: vi.fn(),
  deleteAdminRegistrationPath: vi.fn(),
  isAdminRegistrationPathCodeTaken: vi.fn(),
  getAdminRegistrationTypeForEvent: vi.fn(),
  getAdminRegistrationDraftsReferencingPath: vi.fn(),
  getAdminFormDataReferencingPath: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  createAdminRegistrationPath,
  getAdminRegistrationPathForEvent,
  updateAdminRegistrationPath,
  deleteAdminRegistrationPath,
  isAdminRegistrationPathCodeTaken,
}));
vi.mock("@/lib/db/adminRegistrationType", () => ({
  getAdminRegistrationTypeForEvent,
}));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  getAdminRegistrationDraftsReferencingPath,
}));
vi.mock("@/lib/db/adminFormData", () => ({
  getAdminFormDataReferencingPath,
}));

import { POST } from "@/app/api/dashboard/events/[eventId]/registration-paths/route";
import {
  DELETE,
  PATCH,
} from "@/app/api/dashboard/events/[eventId]/registration-paths/[pathId]/route";

const EVENT_ID = "evt-1";
const PATH_ID = "path-1";
const ORG_ID = "org-1";

const event = { id: EVENT_ID, name: "GovTech Conference" };

const existingPath = {
  id: PATH_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "2. Sponsor — Card",
  code: "SPN-CC",
  audienceRegistrationTypeId: "rt-1",
  paymentMethod: "card",
  currency: "USD",
  isActive: true,
  sortOrder: 0,
};

const validPayload = {
  name: "2. Sponsor — Card",
  code: "spn-cc",
  audienceRegistrationTypeId: "rt-1",
  paymentMethod: "card",
  currency: "USD",
  isActive: true,
  sortOrder: 0,
};

function makeRequest(body?: unknown, method = "POST") {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/registration-paths`,
    {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function collectionContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

function itemContext(eventId = EVENT_ID, pathId = PATH_ID) {
  return { params: Promise.resolve({ eventId, pathId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: "token" } : undefined),
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Owner",
    picture: "",
    email: "owner@example.com",
  });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "owner" }],
    permissions: ["write:events"],
  });
  getAdminEventForOrganization.mockResolvedValue(event);
  isAdminRegistrationPathCodeTaken.mockResolvedValue(false);
  getAdminRegistrationPathForEvent.mockResolvedValue(existingPath);
  getAdminRegistrationTypeForEvent.mockResolvedValue({
    id: "rt-1",
    name: "Sponsor",
  });
  getAdminRegistrationDraftsReferencingPath.mockResolvedValue([]);
  getAdminFormDataReferencingPath.mockResolvedValue([]);
});

describe("POST /registration-paths — auth and tenancy gates (T1 AC-7)", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await POST(makeRequest(validPayload), collectionContext());

    expect(response.status).toBe(401);
    expect(createAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await POST(makeRequest(validPayload), collectionContext());

    expect(response.status).toBe(403);
    expect(createAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 404 when the event belongs to another org (cross-org / missing)", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await POST(makeRequest(validPayload), collectionContext());

    expect(response.status).toBe(404);
    expect(createAdminRegistrationPath).not.toHaveBeenCalled();
  });
});

describe("POST /registration-paths — validation gates (T1 AC-2)", () => {
  it("returns 400 with a flattened Zod error for an invalid code", async () => {
    const response = await POST(
      makeRequest({ ...validPayload, code: "-BAD" }),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.code).toBeDefined();
    expect(createAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 400 for a name over 120 characters", async () => {
    const response = await POST(
      makeRequest({ ...validPayload, name: "x".repeat(121) }),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.name).toBeDefined();
    expect(createAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 400 when the audience type does not belong to this event (foreign id)", async () => {
    getAdminRegistrationTypeForEvent.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ ...validPayload, audienceRegistrationTypeId: "rt-foreign" }),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The selected registration type does not belong to this event",
      field: "audienceRegistrationTypeId",
    });
    expect(createAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("skips the audience check for Any-audience (null) paths", async () => {
    createAdminRegistrationPath.mockResolvedValue("path-new");

    const response = await POST(
      makeRequest({ ...validPayload, audienceRegistrationTypeId: null }),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    expect(getAdminRegistrationTypeForEvent).not.toHaveBeenCalled();
  });

  it("returns 409 with a field pointer when the code is already used in this event", async () => {
    isAdminRegistrationPathCodeTaken.mockResolvedValue(true);

    const response = await POST(makeRequest(validPayload), collectionContext());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This code is already used by another path.",
      field: "code",
    });
    // Uniqueness is checked against the normalized (uppercase) code.
    expect(isAdminRegistrationPathCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "SPN-CC",
    });
    expect(createAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("creates with the caller's org, normalized code, and NO client server-owned fields", async () => {
    createAdminRegistrationPath.mockResolvedValue("path-new");

    const response = await POST(
      makeRequest({
        ...validPayload,
        organizationId: "attacker-org",
        createdAt: "2020-01-01",
      }),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ pathId: "path-new" });
    expect(createAdminRegistrationPath).toHaveBeenCalledTimes(1);
    expect(createAdminRegistrationPath).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "2. Sponsor — Card",
      code: "SPN-CC",
      audienceRegistrationTypeId: "rt-1",
      paymentMethod: "card",
      currency: "USD",
      isActive: true,
      sortOrder: 0,
    });
  });
});

describe("PATCH /registration-paths/[id]", () => {
  it("returns 404 when the path belongs to another event/org (IDOR)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest(validPayload, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(404);
    expect(updateAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("applies the strict { isActive } toggle without touching other fields (T1 AC-4)", async () => {
    const response = await PATCH(
      makeRequest({ isActive: false }, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(updateAdminRegistrationPath).toHaveBeenCalledWith(PATH_ID, {
      isActive: false,
    });
  });

  it("applies the strict { sortOrder } reorder shape (T1 AC-10)", async () => {
    const response = await PATCH(
      makeRequest({ sortOrder: 3 }, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(updateAdminRegistrationPath).toHaveBeenCalledWith(PATH_ID, {
      sortOrder: 3,
    });
  });

  it("rejects a malformed toggle as a 400 (never misread as a full payload)", async () => {
    const response = await PATCH(
      makeRequest({ isActive: "yes" }, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(400);
    expect(updateAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("re-checks code uniqueness excluding self and updates the full payload", async () => {
    const response = await PATCH(
      makeRequest({ ...validPayload, code: "SPN-INV" }, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(isAdminRegistrationPathCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "SPN-INV",
      excludeId: PATH_ID,
    });
    expect(updateAdminRegistrationPath).toHaveBeenCalledWith(PATH_ID, {
      name: "2. Sponsor — Card",
      code: "SPN-INV",
      audienceRegistrationTypeId: "rt-1",
      paymentMethod: "card",
      currency: "USD",
      isActive: true,
      sortOrder: 0,
    });
  });

  it("returns 409 when the new code collides with another path", async () => {
    isAdminRegistrationPathCodeTaken.mockResolvedValue(true);

    const response = await PATCH(
      makeRequest(validPayload, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(409);
    expect(updateAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 400 for a foreign audience id on edit", async () => {
    getAdminRegistrationTypeForEvent.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest(validPayload, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(400);
    expect(updateAdminRegistrationPath).not.toHaveBeenCalled();
  });
});

describe("DELETE /registration-paths/[id] — BLOCK, never cascade (T1 AC-5)", () => {
  function deleteRequest() {
    return new Request(
      `http://localhost/api/dashboard/events/${EVENT_ID}/registration-paths/${PATH_ID}`,
      { method: "DELETE" },
    );
  }

  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(403);
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign path ids (IDOR)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(null);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(404);
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 409 'Deactivate instead' when in-progress drafts reference the path", async () => {
    getAdminRegistrationDraftsReferencingPath.mockResolvedValue([
      { id: "draft-1" },
      { id: "draft-2" },
    ]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("2 in-progress registrations");
    expect(payload.error).toContain("Deactivate it instead.");
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("returns 409 'Deactivate instead' when submissions reference the path (5+ renders a plus)", async () => {
    getAdminFormDataReferencingPath.mockResolvedValue([
      { id: "fd-1" },
      { id: "fd-2" },
      { id: "fd-3" },
      { id: "fd-4" },
      { id: "fd-5" },
    ]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("5+ submissions");
    expect(payload.error).toContain("Deactivate it instead.");
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("names both reference kinds when drafts AND submissions block", async () => {
    getAdminRegistrationDraftsReferencingPath.mockResolvedValue([
      { id: "draft-1" },
    ]);
    getAdminFormDataReferencingPath.mockResolvedValue([{ id: "fd-1" }]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("1 submission");
    expect(payload.error).toContain("1 in-progress registration");
    expect(deleteAdminRegistrationPath).not.toHaveBeenCalled();
  });

  it("hard-deletes when nothing references the path", async () => {
    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(deleteAdminRegistrationPath).toHaveBeenCalledWith(PATH_ID);
  });
});
