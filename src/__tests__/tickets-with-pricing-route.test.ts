// @vitest-environment node
/**
 * M9-T1 — POST /tickets/with-pricing route gates.
 * Spec: agents/docs/specs/m9-ticket-wizard.md.
 *
 * Route-level tests: the transactional DAL function
 * (createAdminTicketTypeWithPricing) is mocked at the module boundary, no
 * emulator required — mirrors ticket-types-route.test.ts's conventions
 * exactly. Covers auth/tenancy gates, payload validation, the optional
 * fast-fail pre-check, the sales-window UTC conversion, and the route's
 * mapping of the DAL's discriminated result onto HTTP responses (§8 AC-1
 * through AC-5, AC-8, AC-10, AC-13, AC-14).
 *
 * AC-6/AC-7/AC-9 (the actual Firestore WRITE SET — write counts, derived
 * registrationTypeIds, Fee doc shape) need the REAL transactional function
 * against a fake Firestore, which a route-level DAL mock can't see — those
 * live in src/__tests__/admin-ticket-type-with-pricing.test.ts instead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminRegistrationTypeForEvent,
  createAdminTicketTypeWithPricing,
  isAdminActiveFeeCombinationTaken,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminRegistrationTypeForEvent: vi.fn(),
  createAdminTicketTypeWithPricing: vi.fn(),
  isAdminActiveFeeCombinationTaken: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationType", () => ({
  getAdminRegistrationTypeForEvent,
}));
vi.mock("@/lib/db/adminTicketTypeWithPricing", () => ({
  createAdminTicketTypeWithPricing,
}));
// AC-10: the route must never reach for the Fee-uniqueness check at all —
// mocked here purely so an accidental future import would fail this
// suite's `not.toHaveBeenCalled()` assertion instead of passing silently.
vi.mock("@/lib/db/adminFee", () => ({ isAdminActiveFeeCombinationTaken }));

import { POST } from "@/app/api/dashboard/events/[eventId]/tickets/with-pricing/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const event = {
  id: EVENT_ID,
  name: "GovTech Conference",
  timezone: "Asia/Singapore",
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "GC Early Bird",
    code: "GC-EB",
    capacity: null,
    salesStart: null,
    salesEnd: null,
    isOpen: true,
    prices: [],
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/tickets/with-pricing`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
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
  createAdminTicketTypeWithPricing.mockResolvedValue({
    ok: true,
    ticketTypeId: "tt-new",
    feeIds: [],
  });
});

describe("POST /tickets/with-pricing — auth, tenancy gates (AC-3)", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await POST(makeRequest(validBody()), context());

    expect(response.status).toBe(401);
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await POST(makeRequest(validBody()), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("returns 404 when the event belongs to another org / is missing (IDOR, AC-3)", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await POST(makeRequest(validBody()), context());

    expect(response.status).toBe(404);
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });
});

describe("POST /tickets/with-pricing — payload validation (AC-2)", () => {
  it("returns 400 for a >25-row prices array before any DAL/membership call", async () => {
    const response = await POST(
      makeRequest(
        validBody({
          prices: Array.from({ length: 26 }, (_, i) => ({
            registrationTypeId: `rt-${i}`,
            basePriceMinor: 1000,
          })),
        }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.prices?.[0]).toBe(
      "Select at most 25 registration types.",
    );
    expect(getAdminRegistrationTypeForEvent).not.toHaveBeenCalled();
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("returns 400 for a negative basePriceMinor", async () => {
    const response = await POST(
      makeRequest(
        validBody({
          prices: [{ registrationTypeId: "rt-1", basePriceMinor: -1 }],
        }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("returns 400 for basePriceMinor above MAX_PRICE_MINOR", async () => {
    const response = await POST(
      makeRequest(
        validBody({
          prices: [
            {
              registrationTypeId: "rt-1",
              basePriceMinor: 1_000_000_000 * 100 + 1,
            },
          ],
        }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("returns 400 for duplicate registrationTypeId entries, including two nulls (AC-2)", async () => {
    const response = await POST(
      makeRequest(
        validBody({
          prices: [
            { registrationTypeId: null, basePriceMinor: 0 },
            { registrationTypeId: null, basePriceMinor: 500 },
          ],
        }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.prices?.[0]).toBe(
      "Each registration type can only be priced once",
    );
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("returns 400 when salesEnd is before salesStart, identical message to /tickets (AC-14)", async () => {
    const response = await POST(
      makeRequest(
        validBody({ salesStart: "2026-08-01", salesEnd: "2026-07-31" }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.salesEnd?.[0]).toBe(
      "Sales end must be on or after sales start.",
    );
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("returns 400 for impossible calendar dates instead of rolling them over", async () => {
    const response = await POST(
      makeRequest(
        validBody({ salesStart: "2026-02-31", salesEnd: "2026-13-01" }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.salesStart?.[0]).toBe(
      "Use a valid calendar date.",
    );
    expect(payload.error.fieldErrors.salesEnd?.[0]).toBe(
      "Use a valid calendar date.",
    );
  });

  it("strips a client-supplied registrationTypeIds array — never forwarded to the DAL (§3.1)", async () => {
    await POST(
      makeRequest(validBody({ registrationTypeIds: ["rt-1"] })),
      context(),
    );

    const input = createAdminTicketTypeWithPricing.mock.calls[0][0];
    expect("registrationTypeIds" in input).toBe(false);
  });

  it("strips server-owned fields (registeredCount, organizationId) from the payload", async () => {
    await POST(
      makeRequest(
        validBody({ registeredCount: 999, organizationId: "attacker-org" }),
      ),
      context(),
    );

    const input = createAdminTicketTypeWithPricing.mock.calls[0][0];
    expect(input.organizationId).toBe(ORG_ID);
    expect("registeredCount" in input).toBe(false);
  });
});

describe("POST /tickets/with-pricing — optional fast-fail pre-check (§3.3 step 3)", () => {
  it("returns 400 for a prices row referencing a foreign/unknown registration type", async () => {
    const response = await POST(
      makeRequest(
        validBody({
          prices: [{ registrationTypeId: "rt-foreign", basePriceMinor: 1000 }],
        }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "One or more selected registration types do not belong to this event",
      field: "prices",
    });
    expect(getAdminRegistrationTypeForEvent).toHaveBeenCalledWith({
      registrationTypeId: "rt-foreign",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(createAdminTicketTypeWithPricing).not.toHaveBeenCalled();
  });

  it("skips the pre-check entirely when prices is empty (AC-8)", async () => {
    const response = await POST(makeRequest(validBody()), context());

    expect(response.status).toBe(200);
    expect(getAdminRegistrationTypeForEvent).not.toHaveBeenCalled();
  });
});

describe("POST /tickets/with-pricing — success + sales-window conversion", () => {
  it("creates with event-timezone window instants and passes prices through unchanged (AC-13)", async () => {
    createAdminTicketTypeWithPricing.mockResolvedValue({
      ok: true,
      ticketTypeId: "tt-new",
      feeIds: ["fee-1", "fee-2"],
    });

    const response = await POST(
      makeRequest(
        validBody({
          code: "gc-eb",
          capacity: 150,
          salesStart: "2026-07-01",
          salesEnd: "2026-07-31",
          prices: [
            { registrationTypeId: "rt-1", basePriceMinor: 75000 },
            { registrationTypeId: "rt-2", basePriceMinor: 0 },
          ],
        }),
      ),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ticketTypeId: "tt-new",
      feeIds: ["fee-1", "fee-2"],
    });

    expect(createAdminTicketTypeWithPricing).toHaveBeenCalledTimes(1);
    const input = createAdminTicketTypeWithPricing.mock.calls[0][0];
    expect(input.organizationId).toBe(ORG_ID);
    expect(input.eventId).toBe(EVENT_ID);
    // registrationCodeSchema normalizes to uppercase in the Zod parse
    // itself, same as ticketTypePayloadSchema.
    expect(input.code).toBe("GC-EB");
    expect(input.capacity).toBe(150);
    expect(input.isOpen).toBe(true);
    expect(input.prices).toEqual([
      { registrationTypeId: "rt-1", basePriceMinor: 75000 },
      { registrationTypeId: "rt-2", basePriceMinor: 0 },
    ]);
    // Jul 1 00:00 SGT == Jun 30 16:00 UTC; Jul 31 23:59:59.999 SGT == Jul 31 15:59:59.999 UTC.
    expect(input.salesStart).toBeInstanceOf(Date);
    expect(input.salesStart.getTime()).toBe(Date.UTC(2026, 5, 30, 16, 0, 0, 0));
    expect(input.salesEnd).toBeInstanceOf(Date);
    expect(input.salesEnd.getTime()).toBe(
      Date.UTC(2026, 6, 31, 15, 59, 59, 999),
    );
  });

  it("allows an empty prices array — the free/TBD ticket case (AC-8)", async () => {
    const response = await POST(makeRequest(validBody()), context());

    expect(response.status).toBe(200);
    const input = createAdminTicketTypeWithPricing.mock.calls[0][0];
    expect(input.prices).toEqual([]);
  });

  it("allows a zero-priced (Comp) entry (AC-8)", async () => {
    const response = await POST(
      makeRequest(
        validBody({
          prices: [{ registrationTypeId: "rt-1", basePriceMinor: 0 }],
        }),
      ),
      context(),
    );

    expect(response.status).toBe(200);
    const input = createAdminTicketTypeWithPricing.mock.calls[0][0];
    expect(input.prices).toEqual([
      { registrationTypeId: "rt-1", basePriceMinor: 0 },
    ]);
  });

  it("returns feeIds order-matched to the request's prices array, same length (AC-13)", async () => {
    createAdminTicketTypeWithPricing.mockResolvedValue({
      ok: true,
      ticketTypeId: "tt-new",
      feeIds: ["fee-1", "fee-2"],
    });

    const response = await POST(
      makeRequest(
        validBody({
          prices: [
            { registrationTypeId: "rt-1", basePriceMinor: 100 },
            { registrationTypeId: "rt-2", basePriceMinor: 200 },
          ],
        }),
      ),
      context(),
    );

    const payload = await response.json();
    expect(payload.feeIds).toEqual(["fee-1", "fee-2"]);
    expect(payload.feeIds.length).toBe(2);
  });

  it("never calls the Fee-uniqueness check (AC-10)", async () => {
    await POST(
      makeRequest(
        validBody({
          prices: [{ registrationTypeId: "rt-1", basePriceMinor: 100 }],
        }),
      ),
      context(),
    );

    expect(isAdminActiveFeeCombinationTaken).not.toHaveBeenCalled();
  });
});

describe("POST /tickets/with-pricing — transactional DAL failure mapping", () => {
  it("returns 409 with a field pointer when the transaction reports CODE_TAKEN (AC-4)", async () => {
    createAdminTicketTypeWithPricing.mockResolvedValue({
      ok: false,
      code: "CODE_TAKEN",
    });

    const response = await POST(makeRequest(validBody()), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Code already in use",
      field: "code",
    });
  });

  it("returns 400 when the transaction reports UNKNOWN_REGISTRATION_TYPE (AC-5, TOCTOU close past the pre-check)", async () => {
    createAdminTicketTypeWithPricing.mockResolvedValue({
      ok: false,
      code: "UNKNOWN_REGISTRATION_TYPE",
      ids: ["rt-1"],
    });

    const response = await POST(
      makeRequest(
        validBody({
          prices: [{ registrationTypeId: "rt-1", basePriceMinor: 500 }],
        }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "One or more selected registration types do not belong to this event",
      field: "prices",
    });
  });

  it("returns 500 without leaking internals when the transaction throws", async () => {
    createAdminTicketTypeWithPricing.mockRejectedValue(new Error("boom"));

    const response = await POST(makeRequest(validBody()), context());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create the ticket",
    });
  });
});
