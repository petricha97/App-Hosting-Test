// @vitest-environment node
/**
 * SEC M2 Finding 1 — resolveRegistrationRouteScope must refuse a spoofed
 * active organizationId: the org switcher may rewrite
 * userDoc.organizationId client-side, so the scope helper only trusts it
 * when the server-locked organizations[] roster contains it. Also locks the
 * existing 401 / permission-403 / cross-org-404 ladder around the new check.
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

import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const event = { id: EVENT_ID, name: "Summit", timezone: "UTC" };

function memberUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    organizations: [
      { organizationId: ORG_ID, role: "owner", joinMethod: "created" },
    ],
    permissions: ["write:events"],
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
    name: "Owner",
    picture: "",
    email: "owner@example.com",
  });
  getAdminUserByEmail.mockResolvedValue(memberUserDoc());
  getAdminEventForOrganization.mockResolvedValue(event);
});

describe("resolveRegistrationRouteScope", () => {
  it("resolves the org scope for a roster-confirmed member", async () => {
    const scope = await resolveRegistrationRouteScope(EVENT_ID);

    // userId (M5): the User doc id — the lowercased session email — recorded
    // as the dashboard scanner's checkedInBy identity.
    expect(scope).toEqual({
      ok: true,
      organizationId: ORG_ID,
      event,
      userId: "owner@example.com",
    });
    expect(getAdminEventForOrganization).toHaveBeenCalledWith(EVENT_ID, ORG_ID);
  });

  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const scope = await resolveRegistrationRouteScope(EVENT_ID);

    expect(scope).toMatchObject({ ok: false, status: 401 });
    expect(getAdminEventForOrganization).not.toHaveBeenCalled();
  });

  it("returns 403 when the active organizationId is NOT in the membership roster (spoofed switcher)", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({
        organizationId: "victim-org",
        organizations: [{ organizationId: "attacker-org", role: "member" }],
      }),
    );

    const scope = await resolveRegistrationRouteScope(EVENT_ID);

    expect(scope).toEqual({
      ok: false,
      error: "Missing organization scope",
      status: 403,
    });
    // The victim org id must never even reach the event lookup.
    expect(getAdminEventForOrganization).not.toHaveBeenCalled();
  });

  it("returns 403 for a legacy user doc with no roster at all (fail closed)", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ organizations: undefined }),
    );

    const scope = await resolveRegistrationRouteScope(EVENT_ID);

    expect(scope).toMatchObject({ ok: false, status: 403 });
    expect(getAdminEventForOrganization).not.toHaveBeenCalled();
  });

  it("returns 403 for a member without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ permissions: ["view:events"] }),
    );

    const scope = await resolveRegistrationRouteScope(EVENT_ID);

    expect(scope).toEqual({
      ok: false,
      error: "Missing write:events permission",
      status: 403,
    });
  });

  it("returns 404 when the event does not belong to the member's org", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const scope = await resolveRegistrationRouteScope(EVENT_ID);

    expect(scope).toMatchObject({ ok: false, status: 404 });
  });
});

describe("resolveRegistrationRouteScope — { requireWriteEvents: false } (M8-T1 spec D6)", () => {
  it("succeeds for a member WITHOUT write:events when the caller opts out", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ permissions: ["view:events"] }),
    );

    const scope = await resolveRegistrationRouteScope(EVENT_ID, {
      requireWriteEvents: false,
    });

    expect(scope).toEqual({
      ok: true,
      organizationId: ORG_ID,
      event,
      userId: "owner@example.com",
    });
  });

  it("still 401s without a session cookie even when opted out", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const scope = await resolveRegistrationRouteScope(EVENT_ID, {
      requireWriteEvents: false,
    });

    expect(scope).toMatchObject({ ok: false, status: 401 });
  });

  it("still 403s a spoofed/missing org scope even when opted out", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ organizationId: "victim-org", organizations: [] }),
    );

    const scope = await resolveRegistrationRouteScope(EVENT_ID, {
      requireWriteEvents: false,
    });

    expect(scope).toMatchObject({ ok: false, status: 403 });
  });

  it("still 404s a cross-org/unknown event even when opted out", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const scope = await resolveRegistrationRouteScope(EVENT_ID, {
      requireWriteEvents: false,
    });

    expect(scope).toMatchObject({ ok: false, status: 404 });
  });

  it("defaults to requiring write:events when options are omitted (every pre-existing call site is unaffected)", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ permissions: ["view:events"] }),
    );

    const scope = await resolveRegistrationRouteScope(EVENT_ID);

    expect(scope).toEqual({
      ok: false,
      error: "Missing write:events permission",
      status: 403,
    });
  });
});
