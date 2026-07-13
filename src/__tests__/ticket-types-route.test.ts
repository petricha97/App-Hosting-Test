// @vitest-environment node
/**
 * M1-T2 — ticket-type API route gates.
 * Spec: agents/docs/specs/m1-registration-spine.md.
 *
 * Locks the route-owned validations:
 *  - 404 cross-org event / foreign ticket ids (IDOR)
 *  - 409 duplicate code within TicketType (create + edit excluding self)
 *  - 400 registrationTypeIds not belonging to this event
 *  - 400 salesEnd before salesStart (equal dates valid)
 *  - sales dates converted to UTC instants in the EVENT timezone
 *    (start 00:00:00.000 / end 23:59:59.999 event-local)
 *  - registeredCount is server-owned; delete BLOCKED when > 0
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminRegistrationTypeForEvent,
  createAdminTicketType,
  getAdminTicketTypeForEvent,
  updateAdminTicketType,
  deleteAdminTicketType,
  isAdminTicketTypeCodeTaken,
  getAdminFeesReferencingTicketType,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminRegistrationTypeForEvent: vi.fn(),
  createAdminTicketType: vi.fn(),
  getAdminTicketTypeForEvent: vi.fn(),
  updateAdminTicketType: vi.fn(),
  deleteAdminTicketType: vi.fn(),
  isAdminTicketTypeCodeTaken: vi.fn(),
  getAdminFeesReferencingTicketType: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationType", () => ({
  getAdminRegistrationTypeForEvent,
}));
vi.mock("@/lib/db/adminTicketType", () => ({
  createAdminTicketType,
  getAdminTicketTypeForEvent,
  updateAdminTicketType,
  deleteAdminTicketType,
  isAdminTicketTypeCodeTaken,
}));
vi.mock("@/lib/db/adminFee", () => ({ getAdminFeesReferencingTicketType }));

import { POST } from "@/app/api/dashboard/events/[eventId]/tickets/route";
import {
  DELETE,
  PATCH,
} from "@/app/api/dashboard/events/[eventId]/tickets/[ticketTypeId]/route";

const EVENT_ID = "evt-1";
const TICKET_ID = "tt-1";
const ORG_ID = "org-1";

// Non-UTC event timezone so the boundary conversion is observable.
const event = {
  id: EVENT_ID,
  name: "GovTech Conference",
  timezone: "Asia/Singapore",
};

const existingTicket = {
  id: TICKET_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "GC Early Bird",
  code: "GC-EB",
  capacity: null,
  registeredCount: 0,
  salesStart: null,
  salesEnd: null,
  isOpen: true,
  registrationTypeIds: [],
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "GC Early Bird",
    code: "GC-EB",
    capacity: null,
    salesStart: null,
    salesEnd: null,
    isOpen: true,
    registrationTypeIds: [],
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/tickets`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function collectionContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

function itemContext(eventId = EVENT_ID, ticketTypeId = TICKET_ID) {
  return { params: Promise.resolve({ eventId, ticketTypeId }) };
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
  // Per-id scoped membership gets: rt-1 / rt-2 belong to this event+org;
  // anything else resolves to null (missing OR foreign — indistinguishable).
  getAdminRegistrationTypeForEvent.mockImplementation(
    async ({ registrationTypeId }: { registrationTypeId: string }) =>
      ["rt-1", "rt-2"].includes(registrationTypeId)
        ? {
            id: registrationTypeId,
            eventId: EVENT_ID,
            organizationId: ORG_ID,
            name: registrationTypeId === "rt-1" ? "Delegate" : "Press",
          }
        : null,
  );
  isAdminTicketTypeCodeTaken.mockResolvedValue(false);
  getAdminTicketTypeForEvent.mockResolvedValue(existingTicket);
  getAdminFeesReferencingTicketType.mockResolvedValue([]);
});

describe("POST /tickets — auth, tenancy, and validation gates", () => {
  it("returns 404 when the event belongs to another org", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(404);
    expect(createAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 400 when registrationTypeIds contain foreign/unknown ids", async () => {
    const response = await POST(
      makeRequest(validBody({ registrationTypeIds: ["rt-1", "rt-foreign"] })),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "One or more selected registration types do not belong to this event",
      field: "registrationTypeIds",
    });
    // Membership uses direct per-id doc gets scoped to event + org — never a
    // truncated list read, so validity holds at any per-event type count.
    expect(getAdminRegistrationTypeForEvent).toHaveBeenCalledWith({
      registrationTypeId: "rt-1",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(getAdminRegistrationTypeForEvent).toHaveBeenCalledWith({
      registrationTypeId: "rt-foreign",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(createAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 400 when registrationTypeIds exceed the 25-id cap", async () => {
    const response = await POST(
      makeRequest(
        validBody({
          registrationTypeIds: Array.from({ length: 26 }, (_, i) => `rt-${i}`),
        }),
      ),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.registrationTypeIds?.[0]).toBe(
      "Select at most 25 registration types.",
    );
    // Rejected by the schema before any membership reads happen.
    expect(getAdminRegistrationTypeForEvent).not.toHaveBeenCalled();
    expect(createAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 400 for impossible calendar dates instead of rolling them over", async () => {
    const response = await POST(
      makeRequest(
        validBody({ salesStart: "2026-02-31", salesEnd: "2026-13-01" }),
      ),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.salesStart?.[0]).toBe(
      "Use a valid calendar date.",
    );
    expect(payload.error.fieldErrors.salesEnd?.[0]).toBe(
      "Use a valid calendar date.",
    );
    expect(createAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 400 when salesEnd is before salesStart", async () => {
    const response = await POST(
      makeRequest(
        validBody({ salesStart: "2026-08-01", salesEnd: "2026-07-31" }),
      ),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.salesEnd?.[0]).toBe(
      "Sales end must be on or after sales start.",
    );
    expect(createAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 409 with a field pointer for a duplicate code (case-insensitive)", async () => {
    isAdminTicketTypeCodeTaken.mockResolvedValue(true);

    const response = await POST(
      makeRequest(validBody({ code: "gc-eb" })),
      collectionContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Code already in use",
      field: "code",
    });
    expect(isAdminTicketTypeCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "GC-EB",
    });
    expect(createAdminTicketType).not.toHaveBeenCalled();
  });

  it("creates with event-timezone window instants and no client registeredCount", async () => {
    createAdminTicketType.mockResolvedValue("tt-new");

    const response = await POST(
      makeRequest(
        validBody({
          code: "gc-eb",
          capacity: 150,
          salesStart: "2026-07-01",
          salesEnd: "2026-07-31",
          registrationTypeIds: ["rt-1"],
          registeredCount: 999,
        }),
      ),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ticketTypeId: "tt-new" });

    expect(createAdminTicketType).toHaveBeenCalledTimes(1);
    const input = createAdminTicketType.mock.calls[0][0];
    expect(input.organizationId).toBe(ORG_ID);
    expect(input.eventId).toBe(EVENT_ID);
    expect(input.code).toBe("GC-EB");
    expect(input.capacity).toBe(150);
    expect(input.isOpen).toBe(true);
    expect(input.registrationTypeIds).toEqual(["rt-1"]);
    expect("registeredCount" in input).toBe(false);
    // Jul 1 00:00 SGT == Jun 30 16:00 UTC; Jul 31 23:59:59.999 SGT == Jul 31 15:59:59.999 UTC.
    expect(input.salesStart).toBeInstanceOf(Date);
    expect(input.salesStart.getTime()).toBe(Date.UTC(2026, 5, 30, 16, 0, 0, 0));
    expect(input.salesEnd).toBeInstanceOf(Date);
    expect(input.salesEnd.getTime()).toBe(
      Date.UTC(2026, 6, 31, 15, 59, 59, 999),
    );
  });

  it("skips the registration-type lookup for unrestricted tickets", async () => {
    createAdminTicketType.mockResolvedValue("tt-new");

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(200);
    expect(getAdminRegistrationTypeForEvent).not.toHaveBeenCalled();
  });
});

describe("write:events permission gate (H-1)", () => {
  beforeEach(() => {
    // Default "member" role is view-only: view:events without write:events.
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
  });

  it("returns 403 on POST for a viewer-permission member", async () => {
    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(createAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 403 on PATCH for a viewer-permission member", async () => {
    const response = await PATCH(makeRequest(validBody()), itemContext());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(updateAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 403 on DELETE for a viewer-permission member", async () => {
    const response = await DELETE(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/tickets/${TICKET_ID}`,
        { method: "DELETE" },
      ),
      itemContext(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(deleteAdminTicketType).not.toHaveBeenCalled();
  });
});

describe("PATCH /tickets/[id]", () => {
  it("returns 404 when the ticket belongs to another event/org (IDOR)", async () => {
    getAdminTicketTypeForEvent.mockResolvedValue(null);

    const response = await PATCH(makeRequest(validBody()), itemContext());

    expect(response.status).toBe(404);
    expect(updateAdminTicketType).not.toHaveBeenCalled();
  });

  it("re-checks code uniqueness excluding self and null sales bounds pass through", async () => {
    const response = await PATCH(makeRequest(validBody()), itemContext());

    expect(response.status).toBe(200);
    expect(isAdminTicketTypeCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "GC-EB",
      excludeId: TICKET_ID,
    });
    expect(updateAdminTicketType).toHaveBeenCalledWith(TICKET_ID, {
      name: "GC Early Bird",
      code: "GC-EB",
      capacity: null,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      registrationTypeIds: [],
    });
  });

  it("rejects reducing capacity below the current registeredCount", async () => {
    getAdminTicketTypeForEvent.mockResolvedValue({
      ...existingTicket,
      registeredCount: 10,
    });

    const response = await PATCH(
      makeRequest(validBody({ capacity: 5 })),
      itemContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Capacity cannot be below registered count",
      field: "capacity",
    });
    expect(updateAdminTicketType).not.toHaveBeenCalled();
  });

  it("validates registrationTypeIds membership on edit too", async () => {
    const response = await PATCH(
      makeRequest(validBody({ registrationTypeIds: ["rt-foreign"] })),
      itemContext(),
    );

    expect(response.status).toBe(400);
    expect(updateAdminTicketType).not.toHaveBeenCalled();
  });
});

describe("DELETE /tickets/[id] — BLOCK when registered", () => {
  function deleteRequest() {
    return new Request(
      `http://localhost/api/dashboard/events/${EVENT_ID}/tickets/${TICKET_ID}`,
      { method: "DELETE" },
    );
  }

  it("returns 409 when registeredCount > 0", async () => {
    getAdminTicketTypeForEvent.mockResolvedValue({
      ...existingTicket,
      registeredCount: 3,
    });

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("3 people are registered");
    expect(deleteAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign ticket ids (IDOR)", async () => {
    getAdminTicketTypeForEvent.mockResolvedValue(null);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(404);
    expect(deleteAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 409 naming the blocking fees when fees price the ticket (M2-T1 AC-6)", async () => {
    getAdminFeesReferencingTicketType.mockResolvedValue([
      { id: "fee-1", name: "GC-EB Delegate USD" },
      { id: "fee-2", name: "GC-EB Delegate GBP" },
    ]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toBe(
      '"GC Early Bird" is priced by 2 fees: GC-EB Delegate USD, GC-EB Delegate GBP. Delete or archive those fees first.',
    );
    expect(payload.blockingFeeNames).toEqual([
      "GC-EB Delegate USD",
      "GC-EB Delegate GBP",
    ]);
    expect(getAdminFeesReferencingTicketType).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      ticketTypeId: TICKET_ID,
    });
    expect(deleteAdminTicketType).not.toHaveBeenCalled();
  });

  it("hard-deletes when nothing blocks", async () => {
    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(deleteAdminTicketType).toHaveBeenCalledWith(TICKET_ID);
  });
});
