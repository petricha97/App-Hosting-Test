// @vitest-environment node
/**
 * M8-T1 — GET /api/dashboard/iam (spec §2). Mocks Backend's real
 * listAdminOrganizationMembers (src/lib/db/adminOrganizationMember.ts, the
 * D12 reverse-index) and listAdminInvitationsForOrganization (src/lib/db/
 * adminInvitation.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  listAdminOrganizationMembers,
  listAdminInvitationsForOrganization,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  listAdminOrganizationMembers: vi.fn(),
  listAdminInvitationsForOrganization: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminOrganizationMember", () => ({
  listAdminOrganizationMembers,
}));
vi.mock("@/lib/db/adminInvitation", () => ({
  listAdminInvitationsForOrganization,
}));

import { GET } from "@/app/api/dashboard/iam/route";

const ORG_ID = "org-1";

function ts(ms: number) {
  return { toMillis: () => ms, seconds: Math.floor(ms / 1000) };
}

function ownerUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    organizationRole: "owner",
    organizations: [{ organizationId: ORG_ID, role: "owner" }],
    permissions: ["write:user"],
    ...overrides,
  };
}

function viewerUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    organizationRole: "viewer",
    organizations: [{ organizationId: ORG_ID, role: "viewer" }],
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
    name: "Owner",
    picture: "",
    email: "owner@example.com",
  });
  getAdminUserByEmail.mockResolvedValue(ownerUserDoc());
  listAdminOrganizationMembers.mockResolvedValue([
    { email: "owner@example.com", name: "Owner", role: "owner" },
    { email: "viewer@example.com", name: "Viewer Person", role: "viewer" },
  ]);
  listAdminInvitationsForOrganization.mockResolvedValue([
    {
      email: "pending@example.com",
      role: "editor",
      status: "pending",
      invitedBy: "owner@example.com",
      createdAt: ts(1000),
      expiresAt: ts(Date.now() + 1000 * 60 * 60 * 24 * 14),
      token: "tok-1",
    },
  ]);
});

describe("GET /api/dashboard/iam — gating (spec §2 AC-1/AC-2)", () => {
  it("401s without a session", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    const response = await GET(
      new Request("http://localhost/api/dashboard/iam"),
    );
    expect(response.status).toBe(401);
  });

  it("403s a spoofed/missing org scope", async () => {
    getAdminUserByEmail.mockResolvedValue(
      ownerUserDoc({ organizationId: "victim-org", organizations: [] }),
    );
    const response = await GET(
      new Request("http://localhost/api/dashboard/iam"),
    );
    expect(response.status).toBe(403);
  });

  it("200s a Viewer (view-tier — org membership only, no write:user needed)", async () => {
    getAdminUserByEmail.mockResolvedValue(viewerUserDoc());
    const response = await GET(
      new Request("http://localhost/api/dashboard/iam"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.canManageMembers).toBe(false);
  });
});

describe("GET /api/dashboard/iam — payload shape", () => {
  it("returns members + pending invitations, with canManageMembers derived from write:user", async () => {
    const response = await GET(
      new Request("http://localhost/api/dashboard/iam"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.canManageMembers).toBe(true);
    expect(data.currentUserEmail).toBe("owner@example.com");
    expect(data.currentUserRole).toBe("owner");
    expect(data.members).toEqual([
      {
        email: "owner@example.com",
        name: "Owner",
        role: "owner",
        status: "active",
        isSelf: true,
      },
      {
        email: "viewer@example.com",
        name: "Viewer Person",
        role: "viewer",
        status: "active",
        isSelf: false,
      },
    ]);
    expect(data.invitations).toEqual([
      {
        email: "pending@example.com",
        role: "editor",
        status: "invited",
        invitedAt: 1000,
        expiresAt: expect.any(Number),
        invitedBy: "owner@example.com",
      },
    ]);
  });

  it("excludes non-pending and expired invitations (derived at read time, spec §3)", async () => {
    listAdminInvitationsForOrganization.mockResolvedValue([
      {
        email: "accepted@example.com",
        role: "editor",
        status: "accepted",
        invitedBy: "owner@example.com",
        createdAt: ts(1000),
        expiresAt: ts(Date.now() + 100000),
        token: "tok-2",
      },
      {
        email: "expired@example.com",
        role: "viewer",
        status: "pending",
        invitedBy: "owner@example.com",
        createdAt: ts(1000),
        expiresAt: ts(Date.now() - 100000),
        token: "tok-3",
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/dashboard/iam"),
    );
    const data = await response.json();
    expect(data.invitations).toEqual([]);
  });

  it("aliases legacy 'member' role to 'viewer' for display (D2)", async () => {
    listAdminOrganizationMembers.mockResolvedValue([
      { email: "owner@example.com", name: "Owner", role: "owner" },
      { email: "legacy@example.com", name: "Legacy", role: "member" },
    ]);

    const response = await GET(
      new Request("http://localhost/api/dashboard/iam"),
    );
    const data = await response.json();
    const legacy = data.members.find(
      (m: { email: string }) => m.email === "legacy@example.com",
    );
    expect(legacy.role).toBe("viewer");
  });
});

describe("GET /api/dashboard/iam — cross-org isolation (spec §7 AC-1)", () => {
  it("derives org strictly from the roster-verified session, ignoring any client-supplied organizationId", async () => {
    const response = await GET(
      new Request("http://localhost/api/dashboard/iam?organizationId=org-B"),
    );
    expect(response.status).toBe(200);
    expect(listAdminOrganizationMembers).toHaveBeenCalledWith(ORG_ID);
    expect(listAdminInvitationsForOrganization).toHaveBeenCalledWith(ORG_ID);
  });
});
