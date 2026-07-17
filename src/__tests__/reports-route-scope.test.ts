// @vitest-environment node
/**
 * M7-T2 — resolveReportsRouteScope (spec D1): Run gates on org membership
 * ONLY; export opts in to the write:events check via
 * { requireWriteEvents: true }. Locks the 401 / 403 / 404 ladder + the
 * central permission split itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));

import { resolveReportsRouteScope } from "@/features/reports/server/reports-route-scope";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const event = { id: EVENT_ID, name: "Summit" };

function memberUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    organizations: [
      { organizationId: ORG_ID, role: "member", joinMethod: "invited" },
    ],
    permissions: ["view:events"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Member",
    picture: "",
    email: "member@example.com",
  });
  getAdminUserByEmail.mockResolvedValue(memberUserDoc());
  getAdminEventForOrganization.mockResolvedValue(event);
});

describe("resolveReportsRouteScope — Run (default, no write:events required)", () => {
  it("succeeds for an org member WITHOUT write:events (D1's central posture)", async () => {
    const scope = await resolveReportsRouteScope(EVENT_ID);

    expect(scope).toEqual({ ok: true, organizationId: ORG_ID, event });
  });

  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const scope = await resolveReportsRouteScope(EVENT_ID);

    expect(scope).toMatchObject({ ok: false, status: 401 });
    expect(getAdminEventForOrganization).not.toHaveBeenCalled();
  });

  it("returns 403 when the active organizationId is not roster-confirmed (spoofed switcher)", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({
        organizationId: "victim-org",
        organizations: [{ organizationId: "attacker-org", role: "member" }],
      }),
    );

    const scope = await resolveReportsRouteScope(EVENT_ID);

    expect(scope).toEqual({
      ok: false,
      error: "Missing organization scope",
      status: 403,
    });
    expect(getAdminEventForOrganization).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const scope = await resolveReportsRouteScope(EVENT_ID);

    expect(scope).toMatchObject({ ok: false, status: 404 });
  });
});

describe("resolveReportsRouteScope — export ({ requireWriteEvents: true })", () => {
  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    const scope = await resolveReportsRouteScope(EVENT_ID, {
      requireWriteEvents: true,
    });

    expect(scope).toEqual({
      ok: false,
      error: "Missing write:events permission",
      status: 403,
    });
    expect(getAdminEventForOrganization).not.toHaveBeenCalled();
  });

  it("succeeds for a member WITH write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ permissions: ["write:events"] }),
    );

    const scope = await resolveReportsRouteScope(EVENT_ID, {
      requireWriteEvents: true,
    });

    expect(scope).toEqual({ ok: true, organizationId: ORG_ID, event });
  });
});
