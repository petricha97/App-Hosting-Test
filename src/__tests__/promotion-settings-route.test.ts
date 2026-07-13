// @vitest-environment node
/**
 * M2-T2 — discount-settings API route gates
 * (PATCH /promotions/[promotionId]/settings — the M2-new fields ONLY).
 * Spec: agents/docs/specs/m2-pricing-commerce.md.
 *
 * Locks:
 *  - 401 / 403 / 404 auth-tenancy gates (write:events, cross-org promotion)
 *  - 400 validityEnd before validityStart; usageCap < 1
 *  - 400 "Cap cannot be below times used" against the SERVER-owned usedCount
 *  - usedCount in the payload is ignored (schema strips it — AC-7)
 *  - validity dates stored as event-timezone day-bound UTC instants
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminEventPromotionById,
  updateAdminEventPromotion,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminEventPromotionById: vi.fn(),
  updateAdminEventPromotion: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminEventPromotion", () => ({
  getAdminEventPromotionById,
  updateAdminEventPromotion,
}));

import { PATCH } from "@/app/api/dashboard/events/[eventId]/promotions/[promotionId]/settings/route";

const EVENT_ID = "evt-1";
const PROMO_ID = "promo-1";
const ORG_ID = "org-1";

// Non-UTC event timezone so the boundary conversion is observable.
const event = {
  id: EVENT_ID,
  name: "GovTech Conference",
  timezone: "Asia/Singapore",
};

const existingPromotion = {
  id: PROMO_ID,
  organizationId: ORG_ID,
  name: "GCUS10",
  level: "event",
  validityStart: null,
  validityEnd: null,
  usageCap: null,
  usedCount: 2,
  isActive: true,
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    level: "partner",
    validityStart: "2026-08-01",
    validityEnd: "2026-08-31",
    usageCap: 3,
    isActive: true,
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/promotions/${PROMO_ID}/settings`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(eventId = EVENT_ID, promotionId = PROMO_ID) {
  return { params: Promise.resolve({ eventId, promotionId }) };
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
  getAdminEventPromotionById.mockResolvedValue(existingPromotion);
});

describe("PATCH /promotions/[id]/settings — auth and tenancy gates", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await PATCH(makeRequest(validBody()), context());

    expect(response.status).toBe(401);
    expect(updateAdminEventPromotion).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await PATCH(makeRequest(validBody()), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing write:events permission",
    });
    expect(updateAdminEventPromotion).not.toHaveBeenCalled();
  });

  it("returns 404 when the event belongs to another org", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await PATCH(makeRequest(validBody()), context());

    expect(response.status).toBe(404);
    expect(updateAdminEventPromotion).not.toHaveBeenCalled();
  });

  it("returns 404 when the promotion belongs to another org (IDOR)", async () => {
    getAdminEventPromotionById.mockResolvedValue({
      ...existingPromotion,
      organizationId: "org-other",
    });

    const response = await PATCH(makeRequest(validBody()), context());

    expect(response.status).toBe(404);
    expect(updateAdminEventPromotion).not.toHaveBeenCalled();
  });
});

describe("PATCH /promotions/[id]/settings — validation", () => {
  it("returns 400 when validityEnd is before validityStart", async () => {
    const response = await PATCH(
      makeRequest(
        validBody({ validityStart: "2026-08-31", validityEnd: "2026-08-01" }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.validityEnd?.[0]).toBe(
      "End date must be on or after the start date.",
    );
    expect(updateAdminEventPromotion).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-integer or below-1 usage cap", async () => {
    const response = await PATCH(
      makeRequest(validBody({ usageCap: 0 })),
      context(),
    );

    expect(response.status).toBe(400);
    expect(updateAdminEventPromotion).not.toHaveBeenCalled();
  });

  it("rejects a cap below the server-owned usedCount with a field pointer", async () => {
    // existingPromotion.usedCount is 2 — a cap of 1 must be refused.
    const response = await PATCH(
      makeRequest(validBody({ usageCap: 1 })),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Cap cannot be below times used",
      field: "usageCap",
    });
    expect(updateAdminEventPromotion).not.toHaveBeenCalled();
  });

  it("allows a cap equal to usedCount (boundary)", async () => {
    const response = await PATCH(
      makeRequest(validBody({ usageCap: 2 })),
      context(),
    );

    expect(response.status).toBe(200);
    expect(updateAdminEventPromotion).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /promotions/[id]/settings — persistence", () => {
  it("persists only the five settings fields; usedCount in the payload is ignored", async () => {
    const response = await PATCH(
      makeRequest(validBody({ usedCount: 999 })),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ promotionId: PROMO_ID });

    expect(updateAdminEventPromotion).toHaveBeenCalledTimes(1);
    const [eventId, promotionId, data] =
      updateAdminEventPromotion.mock.calls[0];
    expect(eventId).toBe(EVENT_ID);
    expect(promotionId).toBe(PROMO_ID);
    expect(data.level).toBe("partner");
    expect(data.usageCap).toBe(3);
    expect(data.isActive).toBe(true);
    // AC-7: the server-owned counter never appears in the update payload.
    expect("usedCount" in data).toBe(false);
    // Only the five settings fields reach the DAL — validity as plain epoch
    // millis, and NO updatedAt (the DAL stamps it itself; review S-2).
    expect(Object.keys(data).sort()).toEqual([
      "isActive",
      "level",
      "usageCap",
      "validityEndMs",
      "validityStartMs",
    ]);
  });

  it("passes validity dates as event-timezone day-bound epoch millis (S-2: no firebase-admin in the route)", async () => {
    const response = await PATCH(makeRequest(validBody()), context());

    expect(response.status).toBe(200);
    const data = updateAdminEventPromotion.mock.calls[0][2];
    // Aug 1 00:00 SGT == Jul 31 16:00 UTC; Aug 31 23:59:59.999 SGT ==
    // Aug 31 15:59:59.999 UTC.
    expect(data.validityStartMs).toBe(Date.UTC(2026, 6, 31, 16, 0, 0, 0));
    expect(data.validityEndMs).toBe(Date.UTC(2026, 7, 31, 15, 59, 59, 999));
  });

  it("passes null bounds and null cap when cleared", async () => {
    const response = await PATCH(
      makeRequest(
        validBody({ validityStart: null, validityEnd: null, usageCap: null }),
      ),
      context(),
    );

    expect(response.status).toBe(200);
    const data = updateAdminEventPromotion.mock.calls[0][2];
    expect(data.validityStartMs).toBeNull();
    expect(data.validityEndMs).toBeNull();
    expect(data.usageCap).toBeNull();
  });
});
