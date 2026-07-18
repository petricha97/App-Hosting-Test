// @vitest-environment node
/**
 * M8-T1 — PATCH+DELETE /api/dashboard/iam/members/[email] (spec §5).
 * Mocks Backend's real adminUserOrganization.ts exports: changeAdminMemberRole
 * / removeAdminMember, both of which take ONLY {organizationId, callerEmail,
 * targetEmail[, newRole]} — the caller's role is re-derived internally from
 * the roster on every call (D11 freshness), never passed by this route.
 * Typed rejection codes: CALLER_NOT_AUTHORIZED | TARGET_NOT_FOUND |
 * HIERARCHY_VIOLATION | LAST_OWNER.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  changeAdminMemberRole,
  removeAdminMember,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  changeAdminMemberRole: vi.fn(),
  removeAdminMember: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminUserOrganization", () => ({
  changeAdminMemberRole,
  removeAdminMember,
}));

import { DELETE, PATCH } from "@/app/api/dashboard/iam/members/[email]/route";

const ORG_ID = "org-1";

function userDoc(role: string, permissions: string[]) {
  return {
    organizationId: ORG_ID,
    organizationRole: role,
    organizations: [{ organizationId: ORG_ID, role }],
    permissions,
  };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function memberContext(email: string) {
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
  changeAdminMemberRole.mockResolvedValue({ ok: true, role: "admin" });
  removeAdminMember.mockResolvedValue({ ok: true });
});

describe("PATCH /api/dashboard/iam/members/[email] — gating", () => {
  it("403s a caller without write:user", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("editor", ["write:events"]));
    const response = await PATCH(
      patchRequest({ role: "viewer" }),
      memberContext("target@example.com"),
    );
    expect(response.status).toBe(403);
    expect(changeAdminMemberRole).not.toHaveBeenCalled();
  });

  it("400s an invalid role payload", async () => {
    const response = await PATCH(
      patchRequest({ role: "bogus" }),
      memberContext("target@example.com"),
    );
    expect(response.status).toBe(400);
    expect(changeAdminMemberRole).not.toHaveBeenCalled();
  });

  it("forwards organizationId/callerEmail/targetEmail/newRole to the DAL (no callerRole — D11 re-derives it fresh) and returns 200 on success (spec §5 AC-1)", async () => {
    const response = await PATCH(
      patchRequest({ role: "admin" }),
      memberContext("editor@example.com"),
    );
    expect(response.status).toBe(200);
    expect(changeAdminMemberRole).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      callerEmail: "owner@example.com",
      targetEmail: "editor@example.com",
      newRole: "admin",
    });
  });
});

describe("PATCH /api/dashboard/iam/members/[email] — typed rejections (spec §5 AC-2/AC-3)", () => {
  it("maps a HIERARCHY_VIOLATION rejection to 403 (an Admin touching an Owner/Admin row)", async () => {
    changeAdminMemberRole.mockResolvedValue({
      ok: false,
      code: "HIERARCHY_VIOLATION",
    });
    const response = await PATCH(
      patchRequest({ role: "editor" }),
      memberContext("admin@example.com"),
    );
    expect(response.status).toBe(403);
  });

  it("maps a LAST_OWNER rejection to a 409 with code:'last-owner' (design §4's specific guardrail copy)", async () => {
    changeAdminMemberRole.mockResolvedValue({ ok: false, code: "LAST_OWNER" });
    const response = await PATCH(
      patchRequest({ role: "editor" }),
      memberContext("sole-owner@example.com"),
    );
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.code).toBe("last-owner");
    expect(data.error).toMatch(/at least one Owner/i);
  });

  it("maps a TARGET_NOT_FOUND rejection to 404 (cross-org target, spec §7 AC-2)", async () => {
    changeAdminMemberRole.mockResolvedValue({
      ok: false,
      code: "TARGET_NOT_FOUND",
    });
    const response = await PATCH(
      patchRequest({ role: "editor" }),
      memberContext("foreign-org-member@example.com"),
    );
    expect(response.status).toBe(404);
  });

  it("maps a CALLER_NOT_AUTHORIZED rejection to 403 (stale client belief, D11 caveat)", async () => {
    changeAdminMemberRole.mockResolvedValue({
      ok: false,
      code: "CALLER_NOT_AUTHORIZED",
    });
    const response = await PATCH(
      patchRequest({ role: "editor" }),
      memberContext("someone@example.com"),
    );
    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/dashboard/iam/members/[email]", () => {
  it("403s a caller without write:user", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("editor", ["write:events"]));
    const response = await DELETE(
      new Request("http://localhost/x", { method: "DELETE" }),
      memberContext("target@example.com"),
    );
    expect(response.status).toBe(403);
    expect(removeAdminMember).not.toHaveBeenCalled();
  });

  it("removes a member and returns 200 (spec §5 AC-5)", async () => {
    const response = await DELETE(
      new Request("http://localhost/x", { method: "DELETE" }),
      memberContext("editor@example.com"),
    );
    expect(response.status).toBe(200);
    expect(removeAdminMember).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      callerEmail: "owner@example.com",
      targetEmail: "editor@example.com",
    });
  });

  it("maps a LAST_OWNER rejection to 409 with code:'last-owner' — an Owner cannot remove themselves as the last Owner (spec §5 AC-3)", async () => {
    removeAdminMember.mockResolvedValue({ ok: false, code: "LAST_OWNER" });
    const response = await DELETE(
      new Request("http://localhost/x", { method: "DELETE" }),
      memberContext("owner@example.com"),
    );
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.code).toBe("last-owner");
  });

  it("maps a HIERARCHY_VIOLATION rejection to 403 (an Admin removing an Owner/Admin row)", async () => {
    getAdminUserByEmail.mockResolvedValue(userDoc("admin", ["write:user"]));
    removeAdminMember.mockResolvedValue({
      ok: false,
      code: "HIERARCHY_VIOLATION",
    });
    const response = await DELETE(
      new Request("http://localhost/x", { method: "DELETE" }),
      memberContext("owner@example.com"),
    );
    expect(response.status).toBe(403);
  });
});
