// @vitest-environment node
/**
 * M2-T3 — tax API route gates.
 * Spec: agents/docs/specs/m2-pricing-commerce.md.
 *
 * Locks the route-owned validations:
 *  - 401 / 403 / 404 auth-tenancy gates (write:events, cross-org, IDOR)
 *  - 400 for malformed discriminated-union payloads (missing rate, bad type)
 *  - 409 duplicate code within Tax (create + edit excluding self)
 *  - PATCH accepts the lightweight inline { isActive } toggle (AC-3)
 *  - DELETE blocked (409 -> deactivate) when Orders applied the tax
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  createAdminTax,
  getAdminTaxForEvent,
  updateAdminTax,
  deleteAdminTax,
  isAdminTaxCodeTaken,
  getAdminOrdersReferencingTax,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  createAdminTax: vi.fn(),
  getAdminTaxForEvent: vi.fn(),
  updateAdminTax: vi.fn(),
  deleteAdminTax: vi.fn(),
  isAdminTaxCodeTaken: vi.fn(),
  getAdminOrdersReferencingTax: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminTax", () => ({
  createAdminTax,
  getAdminTaxForEvent,
  updateAdminTax,
  deleteAdminTax,
  isAdminTaxCodeTaken,
}));
vi.mock("@/lib/db/adminOrder", () => ({ getAdminOrdersReferencingTax }));

import { POST } from "@/app/api/dashboard/events/[eventId]/pricing/taxes/route";
import {
  DELETE,
  PATCH,
} from "@/app/api/dashboard/events/[eventId]/pricing/taxes/[taxId]/route";

const EVENT_ID = "evt-1";
const TAX_ID = "tax-1";
const ORG_ID = "org-1";

const event = { id: EVENT_ID, name: "GovTech Conference", timezone: "UTC" };

const existingTax = {
  id: TAX_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "New York Sales Tax",
  code: "TAX-NY",
  type: "percentage",
  rateMilliPercent: 8875,
  fixedAmountMinor: null,
  fixedCurrency: null,
  isActive: true,
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "New York Sales Tax",
    code: "TAX-NY",
    type: "percentage",
    rateMilliPercent: 8875,
    isActive: true,
    ...overrides,
  };
}

function makeRequest(body: unknown, method = "POST") {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/pricing/taxes`,
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

function itemContext(eventId = EVENT_ID, taxId = TAX_ID) {
  return { params: Promise.resolve({ eventId, taxId }) };
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
  isAdminTaxCodeTaken.mockResolvedValue(false);
  getAdminTaxForEvent.mockResolvedValue(existingTax);
  getAdminOrdersReferencingTax.mockResolvedValue([]);
});

describe("POST /pricing/taxes — auth, tenancy, and validation gates", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(401);
    expect(createAdminTax).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(403);
    expect(createAdminTax).not.toHaveBeenCalled();
  });

  it("returns 404 when the event belongs to another org", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(404);
    expect(createAdminTax).not.toHaveBeenCalled();
  });

  it("returns 400 for a percentage tax without a rate", async () => {
    const response = await POST(
      makeRequest(validBody({ rateMilliPercent: undefined })),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    expect(createAdminTax).not.toHaveBeenCalled();
  });

  it("returns 400 for a rate above 100% (100000 milli-percent)", async () => {
    const response = await POST(
      makeRequest(validBody({ rateMilliPercent: 100001 })),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    expect(createAdminTax).not.toHaveBeenCalled();
  });

  it("returns 400 for a fixed tax without amount + currency", async () => {
    const response = await POST(
      makeRequest({ name: "Levy", code: "LEVY", type: "fixed", isActive: true }),
      collectionContext(),
    );

    expect(response.status).toBe(400);
    expect(createAdminTax).not.toHaveBeenCalled();
  });

  it("returns 409 with a field pointer for a duplicate code (case-insensitive)", async () => {
    isAdminTaxCodeTaken.mockResolvedValue(true);

    const response = await POST(
      makeRequest(validBody({ code: "tax-ny" })),
      collectionContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Code already in use",
      field: "code",
    });
    expect(isAdminTaxCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "TAX-NY",
    });
    expect(createAdminTax).not.toHaveBeenCalled();
  });

  it("creates a percentage tax with the unused fixed group nulled", async () => {
    createAdminTax.mockResolvedValue("tax-new");

    const response = await POST(makeRequest(validBody()), collectionContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ taxId: "tax-new" });
    expect(createAdminTax).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "New York Sales Tax",
      code: "TAX-NY",
      type: "percentage",
      rateMilliPercent: 8875,
      fixedAmountMinor: null,
      fixedCurrency: null,
      isActive: true,
    });
  });

  it("creates a fixed tax with the unused percentage group nulled", async () => {
    createAdminTax.mockResolvedValue("tax-new");

    const response = await POST(
      makeRequest({
        name: "Card levy",
        code: "LEVY-GB",
        type: "fixed",
        fixedAmountMinor: 250,
        fixedCurrency: "GBP",
        isActive: true,
      }),
      collectionContext(),
    );

    expect(response.status).toBe(200);
    expect(createAdminTax).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fixed",
        rateMilliPercent: null,
        fixedAmountMinor: 250,
        fixedCurrency: "GBP",
      }),
    );
  });
});

describe("PATCH /pricing/taxes/[taxId]", () => {
  it("returns 404 when the tax belongs to another event/org (IDOR)", async () => {
    getAdminTaxForEvent.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest(validBody(), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(404);
    expect(updateAdminTax).not.toHaveBeenCalled();
  });

  it("accepts the lightweight inline isActive toggle (AC-3)", async () => {
    const response = await PATCH(
      makeRequest({ isActive: false }, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(updateAdminTax).toHaveBeenCalledWith(TAX_ID, { isActive: false });
    // A pure toggle never touches code uniqueness.
    expect(isAdminTaxCodeTaken).not.toHaveBeenCalled();
  });

  it("re-checks code uniqueness excluding self on full edits", async () => {
    const response = await PATCH(
      makeRequest(validBody(), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(200);
    expect(isAdminTaxCodeTaken).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      code: "TAX-NY",
      excludeId: TAX_ID,
    });
    expect(updateAdminTax).toHaveBeenCalledWith(TAX_ID, {
      name: "New York Sales Tax",
      code: "TAX-NY",
      type: "percentage",
      rateMilliPercent: 8875,
      fixedAmountMinor: null,
      fixedCurrency: null,
      isActive: true,
    });
  });

  it("returns 409 for a duplicate code on edit", async () => {
    isAdminTaxCodeTaken.mockResolvedValue(true);

    const response = await PATCH(
      makeRequest(validBody(), "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(409);
    expect(updateAdminTax).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await PATCH(
      makeRequest({ isActive: false }, "PATCH"),
      itemContext(),
    );

    expect(response.status).toBe(403);
    expect(updateAdminTax).not.toHaveBeenCalled();
  });
});

describe("DELETE /pricing/taxes/[taxId] — BLOCK when orders applied it", () => {
  function deleteRequest() {
    return new Request(
      `http://localhost/api/dashboard/events/${EVENT_ID}/pricing/taxes/${TAX_ID}`,
      { method: "DELETE" },
    );
  }

  it("returns 409 directing to deactivate when orders applied the tax", async () => {
    getAdminOrdersReferencingTax.mockResolvedValue([{ id: "ord-1" }]);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toBe("1 order applied this tax. Deactivate it instead.");
    expect(deleteAdminTax).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign tax ids (IDOR)", async () => {
    getAdminTaxForEvent.mockResolvedValue(null);

    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(404);
    expect(deleteAdminTax).not.toHaveBeenCalled();
  });

  it("hard-deletes when nothing blocks", async () => {
    const response = await DELETE(deleteRequest(), itemContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(deleteAdminTax).toHaveBeenCalledWith(TAX_ID);
  });
});
