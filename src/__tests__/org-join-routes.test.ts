// @vitest-environment node
/**
 * SEC M2 Findings 1-3 — server-side org join surface.
 *
 * POST /api/organizations/lookup — sanitized invite-code lookup:
 *  - 400 malformed payload, uniform 404 for unknown/too-short codes
 *  - code normalized before the Admin-SDK query
 *  - response is the OrganizationPreview ALLOW-LIST only — inviteCode /
 *    inviteLinkToken / domain / ownerId must never appear
 *
 * POST /api/organizations/join — entitlement-validated membership write:
 *  - 401 without session cookie or bearer token; bearer token accepted
 *    (signup flow has no cookie yet)
 *  - invite_code: valid code -> addAdminUserToOrganization with profile from
 *    the VERIFIED TOKEN (never the body); wrong code -> 404, no join call
 *  - domain_auto_join: entitlement derived from the token email's domain;
 *    personal email -> 403; org mismatch -> 404
 *  - idempotent re-join -> 200 "already-member" (counter not re-incremented
 *    is the DAL transaction's contract, asserted via single call args)
 *
 * The DAL is mocked at the module boundary — no emulator required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminOrganizationByInviteCode,
  getAdminOrganizationByDomain,
  addAdminUserToOrganization,
  setAdminUserActiveOrganization,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminOrganizationByInviteCode: vi.fn(),
  getAdminOrganizationByDomain: vi.fn(),
  addAdminUserToOrganization: vi.fn(),
  setAdminUserActiveOrganization: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminOrganization", () => ({
  getAdminOrganizationByInviteCode,
  getAdminOrganizationByDomain,
}));
vi.mock("@/lib/db/adminUserOrganization", () => ({
  addAdminUserToOrganization,
  setAdminUserActiveOrganization,
}));

import { POST as LOOKUP } from "@/app/api/organizations/lookup/route";
import { POST as JOIN } from "@/app/api/organizations/join/route";
import { POST as SWITCH } from "@/app/api/organizations/switch/route";

const ORG_ID = "org-1";

// Deliberately includes every secret the projection must strip.
const orgDoc = {
  id: ORG_ID,
  name: "Acme Inc",
  type: "organization",
  status: "verified",
  memberCount: 4,
  logoUrl: "https://cdn.example/acme.png",
  domain: "acme.com",
  domainVerified: true,
  inviteCode: "ABCD1234",
  inviteCodeEnabled: true,
  inviteLinkToken: "secret-link-token-000000000000000",
  inviteLinkEnabled: true,
  allowDomainAutoJoin: true,
  ownerId: "owner@acme.com",
  slug: "acme-inc",
};

const sanitizedPreview = {
  id: ORG_ID,
  name: "Acme Inc",
  type: "organization",
  memberCount: 4,
  logoUrl: "https://cdn.example/acme.png",
};

function lookupRequest(body: unknown) {
  return new Request("http://localhost/api/organizations/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function joinRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/organizations/join", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: "token" } : undefined),
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Jane Doe",
    picture: "https://cdn.example/jane.png",
    email: "jane@acme.com",
  });
  getAdminOrganizationByInviteCode.mockResolvedValue(orgDoc);
  getAdminOrganizationByDomain.mockResolvedValue(orgDoc);
  addAdminUserToOrganization.mockResolvedValue({ ok: true, status: "joined" });
  setAdminUserActiveOrganization.mockResolvedValue({ ok: true, role: "member" });
});

describe("POST /api/organizations/lookup", () => {
  it("returns 400 for a malformed payload", async () => {
    const response = await LOOKUP(lookupRequest({ nope: true }));

    expect(response.status).toBe(400);
    expect(getAdminOrganizationByInviteCode).not.toHaveBeenCalled();
  });

  it("returns a uniform 404 for an unknown code", async () => {
    getAdminOrganizationByInviteCode.mockResolvedValue(null);

    const response = await LOOKUP(lookupRequest({ code: "ZZZZ9999" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid invite code",
    });
  });

  it("refuses too-short codes without touching Firestore", async () => {
    const response = await LOOKUP(lookupRequest({ code: "AB-12" }));

    expect(response.status).toBe(404);
    expect(getAdminOrganizationByInviteCode).not.toHaveBeenCalled();
  });

  it("normalizes the code before the Admin lookup and returns ONLY the sanitized preview", async () => {
    const response = await LOOKUP(lookupRequest({ code: "abcd-1234" }));

    expect(response.status).toBe(200);
    expect(getAdminOrganizationByInviteCode).toHaveBeenCalledWith("ABCD1234");

    const payload = await response.json();
    // Exact allow-list: nothing beyond the preview may leak (SEC Finding 3).
    expect(payload).toEqual({ organization: sanitizedPreview });
    expect(JSON.stringify(payload)).not.toContain("inviteCode");
    expect(JSON.stringify(payload)).not.toContain("secret-link-token");
    expect(JSON.stringify(payload)).not.toContain("owner@acme.com");
  });
});

describe("POST /api/organizations/join — auth", () => {
  it("returns 401 with neither session cookie nor bearer token", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await JOIN(
      joinRequest({ joinMethod: "invite_code", code: "ABCD1234" }),
    );

    expect(response.status).toBe(401);
    expect(addAdminUserToOrganization).not.toHaveBeenCalled();
  });

  it("accepts an Authorization: Bearer token when no cookie exists (signup flow)", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await JOIN(
      joinRequest(
        { joinMethod: "invite_code", code: "ABCD1234" },
        { authorization: "Bearer fresh-id-token" },
      ),
    );

    expect(response.status).toBe(200);
    expect(decodeUser).toHaveBeenCalledWith("fresh-id-token");
  });

  it("returns 401 for an invalid/expired token", async () => {
    decodeUser.mockResolvedValue({ error: "TOKEN_EXPIRED" });

    const response = await JOIN(
      joinRequest({ joinMethod: "invite_code", code: "ABCD1234" }),
    );

    expect(response.status).toBe(401);
    expect(addAdminUserToOrganization).not.toHaveBeenCalled();
  });
});

describe("POST /api/organizations/join — invite code", () => {
  it("joins with a valid code: entitlement checked server-side, profile from the token", async () => {
    const response = await JOIN(
      joinRequest({
        joinMethod: "invite_code",
        code: "abcd-1234",
        displayName: "Jane D.",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "joined",
      organization: sanitizedPreview,
    });
    expect(getAdminOrganizationByInviteCode).toHaveBeenCalledWith("ABCD1234");
    expect(addAdminUserToOrganization).toHaveBeenCalledWith({
      userEmail: "jane@acme.com",
      organizationId: ORG_ID,
      joinMethod: "invite_code",
      profile: {
        uid: "u1",
        name: "Jane D.",
        avatarUrl: "https://cdn.example/jane.png",
      },
    });
  });

  it("returns 404 for a wrong code and never writes a membership", async () => {
    getAdminOrganizationByInviteCode.mockResolvedValue(null);

    const response = await JOIN(
      joinRequest({ joinMethod: "invite_code", code: "WRONG999" }),
    );

    expect(response.status).toBe(404);
    expect(addAdminUserToOrganization).not.toHaveBeenCalled();
  });

  it("re-join is idempotent: already-member is a 200 no-op status", async () => {
    addAdminUserToOrganization.mockResolvedValue({
      ok: true,
      status: "already-member",
    });

    const response = await JOIN(
      joinRequest({ joinMethod: "invite_code", code: "ABCD1234" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "already-member",
    });
    // Exactly one DAL call — the no-op lives inside its transaction.
    expect(addAdminUserToOrganization).toHaveBeenCalledTimes(1);
  });

  it("falls back to the token name when no displayName is sent, and strips decodeUser placeholders", async () => {
    decodeUser.mockResolvedValue({
      uid: "u1",
      name: "No name",
      picture: "No picture",
      email: "jane@acme.com",
    });

    const response = await JOIN(
      joinRequest({ joinMethod: "invite_code", code: "ABCD1234" }),
    );

    expect(response.status).toBe(200);
    expect(addAdminUserToOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: { uid: "u1", name: "", avatarUrl: null },
      }),
    );
  });
});

describe("POST /api/organizations/join — domain auto-join", () => {
  it("joins when the TOKEN email domain matches the org (client domain input impossible)", async () => {
    const response = await JOIN(
      joinRequest({ joinMethod: "domain_auto_join", organizationId: ORG_ID }),
    );

    expect(response.status).toBe(200);
    expect(getAdminOrganizationByDomain).toHaveBeenCalledWith("acme.com");
    expect(addAdminUserToOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        joinMethod: "domain_auto_join",
      }),
    );
  });

  it("returns 403 for personal email domains", async () => {
    decodeUser.mockResolvedValue({
      uid: "u1",
      name: "Jane",
      picture: "",
      email: "jane@gmail.com",
    });

    const response = await JOIN(joinRequest({ joinMethod: "domain_auto_join" }));

    expect(response.status).toBe(403);
    expect(getAdminOrganizationByDomain).not.toHaveBeenCalled();
    expect(addAdminUserToOrganization).not.toHaveBeenCalled();
  });

  it("returns 404 when the requested org does not match the domain's org", async () => {
    const response = await JOIN(
      joinRequest({
        joinMethod: "domain_auto_join",
        organizationId: "org-other",
      }),
    );

    expect(response.status).toBe(404);
    expect(addAdminUserToOrganization).not.toHaveBeenCalled();
  });

  it("returns 404 when no org allows auto-join for the domain", async () => {
    getAdminOrganizationByDomain.mockResolvedValue(null);

    const response = await JOIN(joinRequest({ joinMethod: "domain_auto_join" }));

    expect(response.status).toBe(404);
    expect(addAdminUserToOrganization).not.toHaveBeenCalled();
  });
});

describe("POST /api/organizations/switch", () => {
  function switchRequest(body: unknown, headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/organizations/switch", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 without a session", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await SWITCH(switchRequest({ organizationId: ORG_ID }));

    expect(response.status).toBe(401);
    expect(setAdminUserActiveOrganization).not.toHaveBeenCalled();
  });

  it("switches through the roster-validated DAL and returns the re-stamped role", async () => {
    setAdminUserActiveOrganization.mockResolvedValue({ ok: true, role: "owner" });

    const response = await SWITCH(switchRequest({ organizationId: ORG_ID }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: ORG_ID,
      role: "owner",
    });
    expect(setAdminUserActiveOrganization).toHaveBeenCalledWith(
      "jane@acme.com",
      ORG_ID,
    );
  });

  it("returns 403 when the roster does not confirm membership", async () => {
    setAdminUserActiveOrganization.mockResolvedValue({
      ok: false,
      reason: "not-a-member",
    });

    const response = await SWITCH(
      switchRequest({ organizationId: "org-foreign" }),
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 for a malformed payload", async () => {
    const response = await SWITCH(switchRequest({}));

    expect(response.status).toBe(400);
    expect(setAdminUserActiveOrganization).not.toHaveBeenCalled();
  });
});
