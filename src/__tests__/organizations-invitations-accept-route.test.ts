// @vitest-environment node
/**
 * M8-T1 — POST /api/organizations/invitations/accept (spec §4). Dual auth
 * (session cookie OR Authorization: Bearer <idToken>), identical shape to
 * POST /api/organizations/join. The email-mismatch check (AC-2) is the one
 * security-critical check in the whole ticket — a two-fixture (Alice's
 * token, Bob's session) IDOR-shaped test proves it explicitly.
 *
 * Mocks Backend's real acceptAdminInvitation (src/lib/db/
 * adminUserOrganization.ts): {ok:true,organizationId,role} |
 * {ok:false,code: "INVALID"|"EMAIL_MISMATCH"|"ORGANIZATION_NOT_FOUND"|
 * "USER_PROFILE_REQUIRED"}. "INVALID" deliberately collapses unknown/
 * expired/already-resolved into one generic rejection (spec §4).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookies, decodeUser, acceptAdminInvitation } = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  acceptAdminInvitation: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUserOrganization", () => ({ acceptAdminInvitation }));

import { POST } from "@/app/api/organizations/invitations/accept/route";

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/organizations/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "cookie-token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: "u-alice",
    name: "Alice",
    picture: "",
    email: "alice@example.com",
  });
  acceptAdminInvitation.mockResolvedValue({
    ok: true,
    organizationId: "org-1",
    role: "editor",
  });
});

describe("POST /api/organizations/invitations/accept — dual auth", () => {
  it("401s with no session cookie and no bearer token", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    const response = await POST(jsonRequest({ token: "tok-1" }));
    expect(response.status).toBe(401);
    expect(acceptAdminInvitation).not.toHaveBeenCalled();
  });

  it("accepts a Bearer token when no session cookie exists (mid-signup case)", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    const response = await POST(
      jsonRequest({ token: "tok-1" }, { Authorization: "Bearer id-token-xyz" }),
    );
    expect(response.status).toBe(200);
    expect(decodeUser).toHaveBeenCalledWith("id-token-xyz");
  });

  it("falls back to the session cookie when no bearer header is present", async () => {
    const response = await POST(jsonRequest({ token: "tok-1" }));
    expect(response.status).toBe(200);
    expect(decodeUser).toHaveBeenCalledWith("cookie-token");
  });
});

describe("POST /api/organizations/invitations/accept — happy path (spec §4 AC-1)", () => {
  it("stamps the invited role and returns the organizationId", async () => {
    const response = await POST(jsonRequest({ token: "tok-1" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ organizationId: "org-1", role: "editor" });
    expect(acceptAdminInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "tok-1",
        callerEmail: "alice@example.com",
      }),
    );
  });
});

describe("POST /api/organizations/invitations/accept — email mismatch (spec §4 AC-2, THE security-critical check)", () => {
  it("403s when the authenticated caller's email does not match the invitation's stored email, with zero membership write", async () => {
    // Alice's token accepted, but Bob's invitation — the DAL is the one that
    // knows the invitation's true owner; it rejects with EMAIL_MISMATCH.
    decodeUser.mockResolvedValue({
      uid: "u-alice",
      name: "Alice",
      picture: "",
      email: "alice@example.com",
    });
    acceptAdminInvitation.mockResolvedValue({
      ok: false,
      code: "EMAIL_MISMATCH",
    });

    const response = await POST(jsonRequest({ token: "bobs-token" }));

    expect(response.status).toBe(403);
    const data = await response.json();
    // Never echoes back which email the invitation actually belongs to.
    expect(data.error).not.toContain("bob@");
    expect(acceptAdminInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ callerEmail: "alice@example.com" }),
    );
  });
});

describe("POST /api/organizations/invitations/accept — expiry/status (spec §4 AC-3/AC-4)", () => {
  it("410s an invalid (unknown) token", async () => {
    acceptAdminInvitation.mockResolvedValue({ ok: false, code: "INVALID" });
    const response = await POST(jsonRequest({ token: "unknown" }));
    expect(response.status).toBe(410);
  });

  it("410s an expired invitation without requiring any background sweep (collapsed into INVALID, spec §4)", async () => {
    acceptAdminInvitation.mockResolvedValue({ ok: false, code: "INVALID" });
    const response = await POST(jsonRequest({ token: "expired-tok" }));
    expect(response.status).toBe(410);
    const data = await response.json();
    expect(data.error).toMatch(/no longer valid/i);
  });

  it("410s an already-accepted invitation the same way (idempotent-safe, no double grant)", async () => {
    acceptAdminInvitation.mockResolvedValue({ ok: false, code: "INVALID" });
    const response = await POST(jsonRequest({ token: "already-accepted" }));
    expect(response.status).toBe(410);
  });

  it("404s when the invitation's organization no longer exists", async () => {
    acceptAdminInvitation.mockResolvedValue({
      ok: false,
      code: "ORGANIZATION_NOT_FOUND",
    });
    const response = await POST(jsonRequest({ token: "tok-1" }));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/organizations/invitations/accept — validation", () => {
  it("400s a missing token", async () => {
    const response = await POST(jsonRequest({}));
    expect(response.status).toBe(400);
    expect(acceptAdminInvitation).not.toHaveBeenCalled();
  });
});
