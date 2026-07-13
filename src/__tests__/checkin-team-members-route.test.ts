// @vitest-environment node
/**
 * M5-T4 — team-member routes:
 *   POST   /api/dashboard/events/[eventId]/checkin/team-members
 *   DELETE /api/dashboard/events/[eventId]/checkin/team-members/[id]
 * - write:events-gated, 404 cross-org (T4 AC-8);
 * - the access code is minted by the ROUTE, returned exactly once, and only
 *   its hash reaches the DAL — no raw-code material in any DAL argument or
 *   in the serialized member (T4 AC-4/AC-5);
 * - codes carry >=128 bits (28 chars x 5 bits, dashed groups of 4);
 * - DELETE revokes (soft) and 404s on unknown/cross-org ids.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  createAdminCheckinTeamMember,
  revokeAdminCheckinTeamMember,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  createAdminCheckinTeamMember: vi.fn(),
  revokeAdminCheckinTeamMember: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminCheckinTeamMember", () => ({
  createAdminCheckinTeamMember,
  revokeAdminCheckinTeamMember,
}));

import { POST } from "@/app/api/dashboard/events/[eventId]/checkin/team-members/route";
import { DELETE } from "@/app/api/dashboard/events/[eventId]/checkin/team-members/[teamMemberId]/route";
import { hashScannerAccessCode } from "@/lib/qr/scanner-session";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const MEMBER_ID = "member-1";

function postRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/checkin/team-members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function deleteRequest() {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/checkin/team-members/${MEMBER_ID}`,
    { method: "DELETE" },
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
  createAdminCheckinTeamMember.mockImplementation(
    async (input: Record<string, unknown>) => ({
      id: MEMBER_ID,
      ...input,
      isActive: true,
      lastSeenAt: null,
      createdAt: null,
      updatedAt: null,
    }),
  );
  revokeAdminCheckinTeamMember.mockResolvedValue(true);
});

describe("POST team-members — one-time code semantics (T4 AC-4/AC-5)", () => {
  it("mints a >=128-bit dashed code, returns it ONCE, and hands the DAL only the hash", async () => {
    const response = await POST(
      postRequest({ name: "Maria Chen", deviceLabel: "Door A" }),
      { params: Promise.resolve({ eventId: EVENT_ID }) },
    );
    expect(response.status).toBe(201);

    const body = await response.json();
    // 28 chars from a 32-symbol alphabet = 140 bits, in 7 dashed groups of 4.
    expect(body.accessCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/);

    // The DAL saw the HASH of that code and nothing raw.
    const dalInput = createAdminCheckinTeamMember.mock.calls[0][0];
    expect(dalInput).toEqual({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Maria Chen",
      deviceLabel: "Door A",
      accessCodeHash: hashScannerAccessCode(body.accessCode),
    });
    expect(JSON.stringify(dalInput)).not.toContain(body.accessCode);

    // The serialized member exposes NO code material.
    expect(body.member).toEqual({
      id: MEMBER_ID,
      name: "Maria Chen",
      deviceLabel: "Door A",
      lastSeenAtIso: null,
    });
  });

  it("mints a fresh code per member (no reuse)", async () => {
    const first = await POST(postRequest({ name: "A" }), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const second = await POST(postRequest({ name: "B" }), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const [a, b] = [await first.json(), await second.json()];
    expect(a.accessCode).not.toBe(b.accessCode);
  });

  it("400 on a missing name; DAL untouched", async () => {
    const response = await POST(postRequest({ deviceLabel: "Door A" }), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(response.status).toBe(400);
    expect(createAdminCheckinTeamMember).not.toHaveBeenCalled();
  });

  it("403 without write:events, 404 cross-org", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const forbidden = await POST(postRequest({ name: "A" }), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(forbidden.status).toBe(403);

    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "owner" }],
      permissions: ["write:events"],
    });
    getAdminEventForOrganization.mockResolvedValue(null);
    const missing = await POST(postRequest({ name: "A" }), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(missing.status).toBe(404);
    expect(createAdminCheckinTeamMember).not.toHaveBeenCalled();
  });
});

describe("DELETE team-members/[id] — revoke (T4 AC-6)", () => {
  it("revokes through the DAL (org/event-scoped)", async () => {
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ eventId: EVENT_ID, teamMemberId: MEMBER_ID }),
    });
    expect(response.status).toBe(200);
    expect(revokeAdminCheckinTeamMember).toHaveBeenCalledWith({
      teamMemberId: MEMBER_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
  });

  it("404 when the DAL reports unknown/cross-org", async () => {
    revokeAdminCheckinTeamMember.mockResolvedValue(false);
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ eventId: EVENT_ID, teamMemberId: "nope" }),
    });
    expect(response.status).toBe(404);
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ eventId: EVENT_ID, teamMemberId: MEMBER_ID }),
    });
    expect(response.status).toBe(403);
    expect(revokeAdminCheckinTeamMember).not.toHaveBeenCalled();
  });
});
