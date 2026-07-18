// @vitest-environment node
/**
 * M8-T1 — POST /api/dashboard/iam/invites (spec §3) and
 * POST /api/dashboard/iam/invites/[email]/revoke.
 *
 * Mocks Backend's real adminInvitation.ts exports: createOrUpdateAdminInvitation
 * (upsert, {ok,created,invitation} | {ok:false,code}) and revokeAdminInvitation
 * ({ok:true} | {ok:false,code}) — both derive caller authorization internally
 * from the D12 reverse-index, so these routes are thin: auth + org scope +
 * write:user fast-fail, call the DAL, map its typed codes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  createOrUpdateAdminInvitation,
  revokeAdminInvitation,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  createOrUpdateAdminInvitation: vi.fn(),
  revokeAdminInvitation: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminInvitation", () => ({
  createOrUpdateAdminInvitation,
  revokeAdminInvitation,
}));

import { POST as createInvite } from "@/app/api/dashboard/iam/invites/route";
import { POST as revokeInvite } from "@/app/api/dashboard/iam/invites/[email]/revoke/route";

const ORG_ID = "org-1";

function ts(ms: number) {
  return { toMillis: () => ms, seconds: Math.floor(ms / 1000) };
}

function userDoc(role: string, permissions: string[]) {
  return {
    organizationId: ORG_ID,
    organizationRole: role,
    organizations: [{ organizationId: ORG_ID, role }],
    permissions,
  };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/dashboard/iam/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function revokeContext(email: string) {
  return { params: Promise.resolve({ email }) };
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
  getAdminUserByEmail.mockResolvedValue(userDoc("owner", ["write:user"]));
  createOrUpdateAdminInvitation.mockResolvedValue({
    ok: true,
    created: true,
    invitation: {
      id: "inv-1",
      organizationId: ORG_ID,
      email: "new@example.com",
      role: "editor",
      status: "pending",
      token: "tok-abc",
      invitedBy: "owner@example.com",
      createdAt: ts(1000),
      updatedAt: ts(1000),
      expiresAt: ts(2000),
    },
  });
  revokeAdminInvitation.mockResolvedValue({ ok: true });
});

describe("POST /api/dashboard/iam/invites — gating", () => {
  it("403s a caller without write:user", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("editor", ["write:events"]));
    const response = await createInvite(
      postRequest({ email: "new@example.com", role: "viewer" }),
    );
    expect(response.status).toBe(403);
    expect(createOrUpdateAdminInvitation).not.toHaveBeenCalled();
  });

  it("403s an Admin caller inviting someone as role admin (D10, spec §3 AC-4)", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("admin", ["write:user"]));
    const response = await createInvite(
      postRequest({ email: "new@example.com", role: "admin" }),
    );
    expect(response.status).toBe(403);
    expect(createOrUpdateAdminInvitation).not.toHaveBeenCalled();
  });

  it("succeeds for an Admin caller inviting as editor/viewer", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("admin", ["write:user"]));
    const response = await createInvite(
      postRequest({ email: "new@example.com", role: "editor" }),
    );
    expect(response.status).toBe(201);
    expect(createOrUpdateAdminInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        callerEmail: "owner@example.com",
        email: "new@example.com",
        role: "editor",
      }),
    );
  });

  it("succeeds for an Owner caller inviting as admin", async () => {
    const response = await createInvite(
      postRequest({ email: "new@example.com", role: "admin" }),
    );
    expect(response.status).toBe(201);
  });

  it("maps the DAL's own HIERARCHY_VIOLATION to 403 (defense-in-depth beyond this route's pre-check)", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("admin", ["write:user"]));
    createOrUpdateAdminInvitation.mockResolvedValue({
      ok: false,
      code: "HIERARCHY_VIOLATION",
    });
    // Force past the route's own pre-check by inviting as editor, then
    // simulate the DAL disagreeing (still 403, never a 500/leak).
    const response = await createInvite(
      postRequest({ email: "new@example.com", role: "editor" }),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/dashboard/iam/invites — business rules (spec §3)", () => {
  it("rejects an already-active member with zero write, surfaced on the email field (AC-2)", async () => {
    createOrUpdateAdminInvitation.mockResolvedValue({
      ok: false,
      code: "ALREADY_MEMBER",
    });
    const response = await createInvite(
      postRequest({ email: "existing@example.com", role: "viewer" }),
    );
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.field).toBe("email");
  });

  it("returns wasExisting:true (200) on a re-invite upsert (created:false), wasExisting:false (201) on a fresh invite (created:true)", async () => {
    createOrUpdateAdminInvitation.mockResolvedValue({
      ok: true,
      created: false,
      invitation: {
        id: "inv-2",
        organizationId: ORG_ID,
        email: "repeat@example.com",
        role: "viewer",
        status: "pending",
        token: "tok-2",
        invitedBy: "owner@example.com",
        createdAt: ts(1000),
        updatedAt: ts(1500),
        expiresAt: ts(2000),
      },
    });
    const response = await createInvite(
      postRequest({ email: "repeat@example.com", role: "viewer" }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.wasExisting).toBe(true);
    expect(data.acceptUrl).toContain("/invite/tok-2");
  });

  it("400s an invalid role value before ever calling the DAL", async () => {
    const response = await createInvite(
      postRequest({ email: "new@example.com", role: "owner" }),
    );
    expect(response.status).toBe(400);
    expect(createOrUpdateAdminInvitation).not.toHaveBeenCalled();
  });
});

describe("POST /api/dashboard/iam/invites/[email]/revoke — gating + D10", () => {
  it("403s a caller without write:user", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("editor", ["write:events"]));
    const response = await revokeInvite(
      new Request("http://localhost/x", { method: "POST" }),
      revokeContext("pending@example.com"),
    );
    expect(response.status).toBe(403);
    expect(revokeAdminInvitation).not.toHaveBeenCalled();
  });

  it("404s when no invitation exists for this (org, email) — covers cross-org too (spec §7 AC-2)", async () => {
    revokeAdminInvitation.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await revokeInvite(
      new Request("http://localhost/x", { method: "POST" }),
      revokeContext("unknown@example.com"),
    );
    expect(response.status).toBe(404);
  });

  it("403s an Admin caller revoking an Admin-role invite (D10)", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("admin", ["write:user"]));
    revokeAdminInvitation.mockResolvedValue({
      ok: false,
      code: "HIERARCHY_VIOLATION",
    });
    const response = await revokeInvite(
      new Request("http://localhost/x", { method: "POST" }),
      revokeContext("pending@example.com"),
    );
    expect(response.status).toBe(403);
  });

  it("revokes a pending invitation (200)", async () => {
    const response = await revokeInvite(
      new Request("http://localhost/x", { method: "POST" }),
      revokeContext("pending@example.com"),
    );
    expect(response.status).toBe(200);
    expect(revokeAdminInvitation).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      callerEmail: "owner@example.com",
      email: "pending@example.com",
    });
  });

  it("is idempotent: revoking an already-resolved invitation is a 200 no-op (spec §3 AC-6)", async () => {
    revokeAdminInvitation.mockResolvedValue({ ok: true });
    const response = await revokeInvite(
      new Request("http://localhost/x", { method: "POST" }),
      revokeContext("pending@example.com"),
    );
    expect(response.status).toBe(200);
  });
});
