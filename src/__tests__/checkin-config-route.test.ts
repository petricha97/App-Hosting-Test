// @vitest-environment node
/**
 * M5-T4 — check-in config routes:
 *   GET/PATCH /api/dashboard/events/[eventId]/checkin/config
 * - write:events-gated (403), 404 cross-org (T4 AC-8);
 * - GET returns the read-time settings (lazy defaults — DAL's job);
 * - PATCH is Zod-allow-listed: unknown keys are STRIPPED before the DAL,
 *   non-boolean values are rejected 400 (T4 AC-8);
 * - a cross-org upsert (DAL null) responds 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminCheckinConfigForEvent,
  upsertAdminCheckinConfig,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminCheckinConfigForEvent: vi.fn(),
  upsertAdminCheckinConfig: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminCheckinConfig", () => ({
  getAdminCheckinConfigForEvent,
  upsertAdminCheckinConfig,
}));

import { GET, PATCH } from "@/app/api/dashboard/events/[eventId]/checkin/config/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const SETTINGS = {
  signatureCollection: false,
  photoCapture: false,
  photoIdVerification: true,
  selfPrintBadges: true,
  walletPasses: true,
};

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

function getRequest() {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/checkin/config`,
  );
}

function patchRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/checkin/config`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
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
  getAdminEventForOrganization.mockResolvedValue({ id: EVENT_ID, name: "Conf" });
  getAdminCheckinConfigForEvent.mockResolvedValue({ ...SETTINGS });
  upsertAdminCheckinConfig.mockResolvedValue({
    ...SETTINGS,
    signatureCollection: true,
  });
});

describe("GET checkin/config — gates + payload", () => {
  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(403);
    expect(getAdminCheckinConfigForEvent).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(404);
  });

  it("returns the settings (read-time defaults when no doc — DAL contract)", async () => {
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings: SETTINGS });
    expect(getAdminCheckinConfigForEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
  });
});

describe("PATCH checkin/config — allow-list (T4 AC-8)", () => {
  it("persists a toggle flip through the DAL and returns the merged settings", async () => {
    const response = await PATCH(
      patchRequest({ signatureCollection: true }),
      makeContext(),
    );
    expect(response.status).toBe(200);
    expect(upsertAdminCheckinConfig).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: { signatureCollection: true },
    });
    const body = await response.json();
    expect(body.settings.signatureCollection).toBe(true);
  });

  it("STRIPS unknown keys — server-owned fields never reach the DAL patch", async () => {
    await PATCH(
      patchRequest({
        walletPasses: false,
        organizationId: "attacker-org",
        eventId: "other-event",
        createdAt: 0,
        bogus: "x",
      }),
      makeContext(),
    );

    expect(upsertAdminCheckinConfig).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { walletPasses: false } }),
    );
  });

  it("rejects non-boolean toggle values (400) without touching the DAL", async () => {
    const response = await PATCH(
      patchRequest({ photoCapture: "yes" }),
      makeContext(),
    );
    expect(response.status).toBe(400);
    expect(upsertAdminCheckinConfig).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body (400)", async () => {
    const response = await PATCH(patchRequest("not-json{"), makeContext());
    expect(response.status).toBe(400);
  });

  it("404 when the DAL refuses a cross-org doc (null)", async () => {
    upsertAdminCheckinConfig.mockResolvedValue(null);
    const response = await PATCH(
      patchRequest({ walletPasses: false }),
      makeContext(),
    );
    expect(response.status).toBe(404);
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await PATCH(
      patchRequest({ walletPasses: false }),
      makeContext(),
    );
    expect(response.status).toBe(403);
    expect(upsertAdminCheckinConfig).not.toHaveBeenCalled();
  });
});
