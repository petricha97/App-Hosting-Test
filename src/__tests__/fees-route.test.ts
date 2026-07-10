// @vitest-environment node
/**
 * M2-T1 — fee API route gates.
 * Spec: agents/docs/specs/m2-pricing-commerce.md.
 *
 * Locks the route-owned validations:
 *  - 401 unauthenticated / 403 without write:events / 404 cross-org event
 *  - 404 IDOR on foreign fee ids
 *  - 400 ticket / registration type not belonging to this event
 *  - 409 duplicate ACTIVE (ticket, regType-or-null, currency) combination
 *    with a field pointer (create + edit excluding self; archived skips it)
 *  - DELETE blocked (409 -> Archive) when Orders reference the fee
 *
 * The DAL is mocked at the module boundary — no emulator required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  createAdminFee,
  getAdminFeeForEvent,
  updateAdminFee,
  deleteAdminFee,
  isAdminActiveFeeCombinationTaken,
  getAdminTicketTypeForEvent,
  getAdminRegistrationTypeForEvent,
  getAdminOrdersReferencingFee,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  createAdminFee: vi.fn(),
  getAdminFeeForEvent: vi.fn(),
  updateAdminFee: vi.fn(),
  deleteAdminFee: vi.fn(),
  isAdminActiveFeeCombinationTaken: vi.fn(),
  getAdminTicketTypeForEvent: vi.fn(),
  getAdminRegistrationTypeForEvent: vi.fn(),
  getAdminOrdersReferencingFee: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminFee", () => ({
  createAdminFee,
  getAdminFeeForEvent,
  updateAdminFee,
  deleteAdminFee,
  isAdminActiveFeeCombinationTaken,
}));
vi.mock("@/lib/db/adminTicketType", () => ({ getAdminTicketTypeForEvent }));
vi.mock("@/lib/db/adminRegistrationType", () => ({
  getAdminRegistrationTypeForEvent,
}));
vi.mock("@/lib/db/adminOrder", () => ({ getAdminOrdersReferencingFee }));

import { POST } from "@/app/api/dashboard/events/[eventId]/pricing/fees/route";
import {
  DELETE,
  PATCH,
} from "@/app/api/dashboard/events/[eventId]/pricing/fees/[feeId]/route";
import { FEE_DUPLICATE_MESSAGE } from "@/features/pricing/schemas";

const EVENT_ID = "evt-1";
const FEE_ID = "fee-1";
const ORG_ID = "org-1";

const event = { id: EVENT_ID, name: "GovTech Conference", timezone: "UTC" };

const existingFee = {
  id: FEE_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "GC-EB Delegate USD",
  ticketTypeId: "tt-1",
  registrationTypeId: "rt-1",
  currency: "USD",
  basePriceMinor: 95000,
  status: "active",
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "GC-EB Delegate USD",
    ticketTypeId: "tt-1",
    registrationTypeId: "rt-1",
    currency: "USD",
    basePriceMinor: 95000,
    status: "active",
    ...overrides,
  };
}

function makeRequest(body: unknown, method = "POST") {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/pricing/fees`,
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function collectionContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

function itemContext(eventId = EVENT_ID, feeId = FEE_ID) {
  return { params: Promise.resolve({ eventId, feeId }) };
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
  getAdminTicketTypeForEvent.mockImplementation(
    async ({ ticketTypeId }: { ticketTypeId: string }) =>
      ticketTypeId === "tt-1"
        ? { id: "tt-1", eventId: EVENT_ID, organizationId: ORG_ID, code: "GC-EB" }
        : null,
  );
  getAdminRegistrationTypeForEvent.mockImplementation(
    async ({ registrationTypeId }: { registrationTypeId: string }) =>
      registrationTypeId === "rt-1"
        ? { id: "rt-1", eventId: EVENT_ID, organizationId: ORG_ID, name: "Delegate" }
        : null,
  );
  isAdminActiveFeeCombinationTaken.mockResolvedValue(false);
  getAdminFeeForEvent.mockResolvedValue(existingFee);
  getAdminOrdersReferencingFee.mockResolvedValue([]);
});

describe("POST /pricing/fees — auth, tenancy, and validation gates", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(401);
    expect(createAdminFee).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member (H-1 gate)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(createAdminFee).not.toHaveBeenCalled();
  });

  it("returns 404 when the event belongs to another org", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(404);
    expect(createAdminFee).not.toHaveBeenCalled();
  });

  it("returns 400 for a foreign ticketTypeId", async () => {
    const response = await POST(
      makeRequest(validBody({ ticketTypeId: "tt-foreign" })),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The selected ticket does not belong to this event",
      field: "ticketTypeId",
    });
    expect(createAdminFee).not.toHaveBeenCalled();
  });

  it("returns 400 for a foreign registrationTypeId", async () => {
    const response = await POST(
      makeRequest(validBody({ registrationTypeId: "rt-foreign" })),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The selected registration type does not belong to this event",
      field: "registrationTypeId",
    });
    expect(createAdminFee).not.toHaveBeenCalled();
  });

  it("skips the registration-type lookup for an all-types (null) fee", async () => {
    createAdminFee.mockResolvedValue("fee-new");

    const response = await POST(
      makeRequest(validBody({ registrationTypeId: null })),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    expect(getAdminRegistrationTypeForEvent).not.toHaveBeenCalled();
    // null is passed through explicitly so the stored doc keeps the field.
    expect(createAdminFee.mock.calls[0][0].registrationTypeId).toBeNull();
  });

  it("returns 400 for a fractional basePriceMinor (integers only)", async () => {
    const response = await POST(
      makeRequest(validBody({ basePriceMinor: 950.5 })),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    expect(createAdminFee).not.toHaveBeenCalled();
  });

  it("returns 409 with the ticket-field pointer on a duplicate active combination", async () => {
    isAdminActiveFeeCombinationTaken.mockResolvedValue(true);

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: FEE_DUPLICATE_MESSAGE,
      field: "ticketTypeId",
    });
    expect(createAdminFee).not.toHaveBeenCalled();
  });

  it("skips the uniqueness check when creating an ARCHIVED fee", async () => {
    createAdminFee.mockResolvedValue("fee-new");

    const response = await POST(
      makeRequest(validBody({ status: "archived" })),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    expect(isAdminActiveFeeCombinationTaken).not.toHaveBeenCalled();
  });

  it("creates with server-stamped org/event and ignores client-supplied ones", async () => {
    createAdminFee.mockResolvedValue("fee-new");

    const response = await POST(
      makeRequest(
        validBody({ organizationId: "org-evil", eventId: "evt-evil" }),
      ),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ feeId: "fee-new" });
    const input = createAdminFee.mock.calls[0][0];
    expect(input.organizationId).toBe(ORG_ID);
    expect(input.eventId).toBe(EVENT_ID);
    expect(input.basePriceMinor).toBe(95000);
  });
});

describe("PATCH /pricing/fees/[feeId]", () => {
  it("returns 404 when the fee belongs to another event/org (IDOR)", async () => {
    getAdminFeeForEvent.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest(validBody(), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(404);
    expect(updateAdminFee).not.toHaveBeenCalled();
  });

  it("re-checks uniqueness excluding self and updates", async () => {
    const response = await PATCH(
      makeRequest(validBody(), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(isAdminActiveFeeCombinationTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      ticketTypeId: "tt-1",
      registrationTypeId: "rt-1",
      currency: "USD",
      excludeId: FEE_ID,
    });
    expect(updateAdminFee).toHaveBeenCalledWith(FEE_ID, {
      name: "GC-EB Delegate USD",
      ticketTypeId: "tt-1",
      registrationTypeId: "rt-1",
      currency: "USD",
      basePriceMinor: 95000,
      status: "active",
    });
  });

  it("returns 409 on edit into a duplicate active combination", async () => {
    isAdminActiveFeeCombinationTaken.mockResolvedValue(true);

    const response = await PATCH(
      makeRequest(validBody(), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: FEE_DUPLICATE_MESSAGE,
      field: "ticketTypeId",
    });
    expect(updateAdminFee).not.toHaveBeenCalled();
  });

  it("archiving skips uniqueness entirely (archived never blocks)", async () => {
    const response = await PATCH(
      makeRequest(validBody({ status: "archived" }), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(isAdminActiveFeeCombinationTaken).not.toHaveBeenCalled();
    expect(updateAdminFee).toHaveBeenCalledWith(
      FEE_ID,
      expect.objectContaining({ status: "archived" }),
    );
  });

  it("returns 403 for a viewer-permission member", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await PATCH(
      makeRequest(validBody(), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(403);
    expect(updateAdminFee).not.toHaveBeenCalled();
  });
});

describe("DELETE /pricing/fees/[feeId] — BLOCK when orders reference", () => {
  function deleteRequest() {
    return new Request(
      `http://localhost/api/dashboard/events/${EVENT_ID}/pricing/fees/${FEE_ID}`,
      { method: "DELETE" },
    );
  }

  it("returns 409 directing to Archive when orders reference the fee", async () => {
    getAdminOrdersReferencingFee.mockResolvedValue([
      { id: "ord-1" },
      { id: "ord-2" },
    ]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toBe("2 orders reference this fee. Archive it instead.");
    expect(deleteAdminFee).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign fee ids (IDOR)", async () => {
    getAdminFeeForEvent.mockResolvedValue(null);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(404);
    expect(deleteAdminFee).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(403);
    expect(deleteAdminFee).not.toHaveBeenCalled();
  });

  it("hard-deletes when nothing blocks (trivially passes pre-T4)", async () => {
    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(deleteAdminFee).toHaveBeenCalledWith(FEE_ID);
  });
});
