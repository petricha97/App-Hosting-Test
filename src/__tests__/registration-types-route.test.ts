// @vitest-environment node
/**
 * M1-T1 — registration-type API route gates.
 * Spec: agents/docs/specs/m1-registration-spine.md.
 *
 * Locks the route-owned validations:
 *  - 401 unauthenticated, 404 cross-org event, 404 IDOR on foreign type ids
 *  - 409 duplicate code (create + edit-excluding-self), field-level pointer
 *  - server-owned registeredCount stripped from create payloads
 *  - capacity cannot drop below registeredCount on edit
 *  - delete BLOCK rules: referenced by tickets (naming them) or registered > 0
 *
 * The DAL is mocked at the module boundary — no emulator required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  createAdminRegistrationType,
  getAdminRegistrationTypeForEvent,
  updateAdminRegistrationType,
  deleteAdminRegistrationType,
  isAdminRegistrationTypeCodeTaken,
  getAdminRegistrationTypesForEvent,
  getAdminTicketTypesReferencingRegistrationType,
  getAdminFeesReferencingRegistrationType,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  createAdminRegistrationType: vi.fn(),
  getAdminRegistrationTypeForEvent: vi.fn(),
  updateAdminRegistrationType: vi.fn(),
  deleteAdminRegistrationType: vi.fn(),
  isAdminRegistrationTypeCodeTaken: vi.fn(),
  getAdminRegistrationTypesForEvent: vi.fn(),
  getAdminTicketTypesReferencingRegistrationType: vi.fn(),
  getAdminFeesReferencingRegistrationType: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationType", () => ({
  createAdminRegistrationType,
  getAdminRegistrationTypeForEvent,
  updateAdminRegistrationType,
  deleteAdminRegistrationType,
  isAdminRegistrationTypeCodeTaken,
  getAdminRegistrationTypesForEvent,
}));
vi.mock("@/lib/db/adminTicketType", () => ({
  getAdminTicketTypesReferencingRegistrationType,
}));
vi.mock("@/lib/db/adminFee", () => ({
  getAdminFeesReferencingRegistrationType,
}));

import { POST } from "@/app/api/dashboard/events/[eventId]/registration-types/route";
import {
  DELETE,
  PATCH,
} from "@/app/api/dashboard/events/[eventId]/registration-types/[registrationTypeId]/route";

const EVENT_ID = "evt-1";
const TYPE_ID = "rt-1";
const ORG_ID = "org-1";

const event = { id: EVENT_ID, name: "GovTech Conference", timezone: "Asia/Singapore" };

const existingType = {
  id: TYPE_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "Delegate",
  code: "DEL",
  capacity: null,
  registeredCount: 0,
};

function makeRequest(body?: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/registration-types`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function collectionContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

function itemContext(eventId = EVENT_ID, registrationTypeId = TYPE_ID) {
  return { params: Promise.resolve({ eventId, registrationTypeId }) };
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
  isAdminRegistrationTypeCodeTaken.mockResolvedValue(false);
  getAdminRegistrationTypeForEvent.mockResolvedValue(existingType);
  getAdminTicketTypesReferencingRegistrationType.mockResolvedValue([]);
  getAdminFeesReferencingRegistrationType.mockResolvedValue([]);
});

describe("POST /registration-types — auth and tenancy gates", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await POST(
      makeRequest({ name: "Delegate", code: "DEL", capacity: null }),
      collectionContext(),
    );

    expect(response.status).toBe(401);
    expect(createAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 403 on POST for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await POST(
      makeRequest({ name: "Delegate", code: "DEL", capacity: null }),
      collectionContext(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(createAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 404 when the event belongs to another org (cross-org / missing)", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ name: "Delegate", code: "DEL", capacity: null }),
      collectionContext(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Event not found",
    });
    expect(createAdminRegistrationType).not.toHaveBeenCalled();
  });
});

describe("POST /registration-types — validation gates", () => {
  it("returns 400 with a flattened Zod error for an invalid code", async () => {
    const response = await POST(
      makeRequest({ name: "Delegate", code: "-BAD", capacity: null }),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.code).toBeDefined();
    expect(createAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 409 with a field pointer when the code is already used in this event", async () => {
    isAdminRegistrationTypeCodeTaken.mockResolvedValue(true);

    const response = await POST(
      makeRequest({ name: "Delegate", code: "del", capacity: null }),
      collectionContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Code already in use",
      field: "code",
    });
    // Uniqueness is checked against the normalized (uppercase) code.
    expect(isAdminRegistrationTypeCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "DEL",
    });
    expect(createAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("creates with the caller's org, normalized code, and NO client registeredCount", async () => {
    createAdminRegistrationType.mockResolvedValue("rt-new");

    const response = await POST(
      makeRequest({
        name: "Delegate",
        code: "gc-onl",
        capacity: 200,
        registeredCount: 999,
        organizationId: "attacker-org",
      }),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      registrationTypeId: "rt-new",
    });
    expect(createAdminRegistrationType).toHaveBeenCalledTimes(1);
    expect(createAdminRegistrationType).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Delegate",
      code: "GC-ONL",
      capacity: 200,
    });
  });
});

describe("PATCH /registration-types/[id]", () => {
  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await PATCH(
      makeRequest({ name: "Delegate", code: "DEL", capacity: null }),
      itemContext(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(updateAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 404 when the type belongs to another event/org (IDOR)", async () => {
    getAdminRegistrationTypeForEvent.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ name: "Delegate", code: "DEL", capacity: null }),
      itemContext(),
    );

    expect(response.status).toBe(404);
    expect(updateAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("re-checks code uniqueness excluding self", async () => {
    const response = await PATCH(
      makeRequest({ name: "Delegate", code: "DEL", capacity: null }),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(isAdminRegistrationTypeCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "DEL",
      excludeId: TYPE_ID,
    });
    expect(updateAdminRegistrationType).toHaveBeenCalledWith(TYPE_ID, {
      name: "Delegate",
      code: "DEL",
      capacity: null,
    });
  });

  it("returns 409 when the new code collides with another type", async () => {
    isAdminRegistrationTypeCodeTaken.mockResolvedValue(true);

    const response = await PATCH(
      makeRequest({ name: "Delegate", code: "PRESS", capacity: null }),
      itemContext(),
    );

    expect(response.status).toBe(409);
    expect(updateAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("rejects reducing capacity below the current registeredCount", async () => {
    getAdminRegistrationTypeForEvent.mockResolvedValue({
      ...existingType,
      registeredCount: 5,
    });

    const response = await PATCH(
      makeRequest({ name: "Delegate", code: "DEL", capacity: 3 }),
      itemContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Capacity cannot be below registered count",
      field: "capacity",
    });
    expect(updateAdminRegistrationType).not.toHaveBeenCalled();
  });
});

describe("DELETE /registration-types/[id] — BLOCK, never cascade", () => {
  function deleteRequest() {
    return new Request(
      `http://localhost/api/dashboard/events/${EVENT_ID}/registration-types/${TYPE_ID}`,
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
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(deleteAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 409 naming the blocking tickets when tickets reference the type", async () => {
    getAdminTicketTypesReferencingRegistrationType.mockResolvedValue([
      { id: "tt-1", name: "GC Early Bird" },
      { id: "tt-2", name: "GC Standard" },
    ]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("GC Early Bird");
    expect(payload.error).toContain("GC Standard");
    expect(payload.error).toContain('"Delegate" is used by 2 ticket types');
    expect(payload.blockingTicketNames).toEqual([
      "GC Early Bird",
      "GC Standard",
    ]);
    expect(deleteAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 409 naming the blocking fees when fees pin this type (M2-T1 AC-6)", async () => {
    getAdminFeesReferencingRegistrationType.mockResolvedValue([
      { id: "fee-1", name: "GC-EB Delegate USD" },
    ]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toBe(
      '"Delegate" is priced by 1 fee: GC-EB Delegate USD. Delete or archive those fees first.',
    );
    expect(payload.blockingFeeNames).toEqual(["GC-EB Delegate USD"]);
    expect(getAdminFeesReferencingRegistrationType).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      registrationTypeId: TYPE_ID,
    });
    expect(deleteAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 409 when registeredCount > 0", async () => {
    getAdminRegistrationTypeForEvent.mockResolvedValue({
      ...existingType,
      registeredCount: 12,
    });

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("12 people are registered");
    expect(deleteAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign type ids (IDOR)", async () => {
    getAdminRegistrationTypeForEvent.mockResolvedValue(null);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(404);
    expect(deleteAdminRegistrationType).not.toHaveBeenCalled();
  });

  it("hard-deletes when nothing blocks", async () => {
    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(deleteAdminRegistrationType).toHaveBeenCalledWith(TYPE_ID);
  });
});
