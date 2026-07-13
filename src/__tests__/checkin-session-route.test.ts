// @vitest-environment node
/**
 * M5-T5 AC-1/AC-2 — access-code -> scanner-session exchange:
 *   POST /api/events/[eventId]/checkin/session
 * - a valid code returns a verifiable 12h session token + memberName and
 *   bumps lastSeenAt;
 * - wrong, revoked and unknown codes (and unknown events) return the SAME
 *   generic 401 — no oracle;
 * - rate-limited 10/min/IP (429 + Retry-After);
 * - Zod-validated body (400), tokens only in the response body.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminPublishedEventById,
  getAdminActiveCheckinTeamMemberByAccessCodeHash,
  touchAdminCheckinTeamMemberLastSeen,
} = vi.hoisted(() => ({
  getAdminPublishedEventById: vi.fn(),
  getAdminActiveCheckinTeamMemberByAccessCodeHash: vi.fn(),
  touchAdminCheckinTeamMemberLastSeen: vi.fn(),
}));

vi.mock("@/lib/db/adminEvent", () => ({ getAdminPublishedEventById }));
vi.mock("@/lib/db/adminCheckinTeamMember", () => ({
  getAdminActiveCheckinTeamMemberByAccessCodeHash,
  touchAdminCheckinTeamMemberLastSeen,
}));

import { POST } from "@/app/api/events/[eventId]/checkin/session/route";
import {
  hashScannerAccessCode,
  verifyScannerSessionToken,
} from "@/lib/qr/scanner-session";
import { resetRateLimits } from "@/lib/rate-limit";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const ACCESS_CODE = "GC7Q-4KXN-P2MB-9RTD-AAAA-BBBB-CCCC";

const MEMBER = {
  id: "member-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "Maria Chen",
  deviceLabel: "Door A",
  accessCodeHash: hashScannerAccessCode(ACCESS_CODE),
  isActive: true,
  lastSeenAt: null,
};

function makeRequest(body: unknown, ip = "203.0.113.7") {
  return new Request(`http://localhost/api/events/${EVENT_ID}/checkin/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  getAdminPublishedEventById.mockResolvedValue({
    id: EVENT_ID,
    name: "Conf",
    organizationPath: `Organization/${ORG_ID}`,
  });
  getAdminActiveCheckinTeamMemberByAccessCodeHash.mockResolvedValue(MEMBER);
});

describe("POST checkin/session — exchange", () => {
  it("exchanges a valid code for a verifiable session token and touches lastSeenAt", async () => {
    const response = await POST(
      makeRequest({ accessCode: ACCESS_CODE }),
      makeContext(),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.memberName).toBe("Maria Chen");

    // The token verifies against THIS event and carries the member id.
    const verified = verifyScannerSessionToken({
      token: body.token,
      eventId: EVENT_ID,
    });
    expect(verified).toMatchObject({ valid: true, teamMemberId: "member-1" });

    // The lookup used the NORMALIZED hash; lastSeenAt was bumped.
    expect(
      getAdminActiveCheckinTeamMemberByAccessCodeHash,
    ).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      accessCodeHash: hashScannerAccessCode(ACCESS_CODE),
    });
    expect(touchAdminCheckinTeamMemberLastSeen).toHaveBeenCalledWith("member-1");
  });

  it("accepts sloppy entry formats (dashes/case stripped before hashing)", async () => {
    await POST(
      makeRequest({ accessCode: ACCESS_CODE.toLowerCase().replaceAll("-", " ") }),
      makeContext(),
    );
    expect(
      getAdminActiveCheckinTeamMemberByAccessCodeHash,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        accessCodeHash: hashScannerAccessCode(ACCESS_CODE),
      }),
    );
  });

  it("unknown and revoked codes return the IDENTICAL generic 401 (no oracle, AC-1)", async () => {
    // The DAL query filters isActive==true, so revoked === unknown === null.
    getAdminActiveCheckinTeamMemberByAccessCodeHash.mockResolvedValue(null);

    const unknown = await POST(
      makeRequest({ accessCode: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" }),
      makeContext(),
    );
    const revoked = await POST(
      makeRequest({ accessCode: ACCESS_CODE }),
      makeContext(),
    );

    expect(unknown.status).toBe(401);
    expect(revoked.status).toBe(401);
    expect(await unknown.json()).toEqual(await revoked.json());
    expect(touchAdminCheckinTeamMemberLastSeen).not.toHaveBeenCalled();
  });

  it("cross-org member docs and unknown events deny with the same generic shape", async () => {
    getAdminActiveCheckinTeamMemberByAccessCodeHash.mockResolvedValue({
      ...MEMBER,
      organizationId: "other-org",
    });
    const crossOrg = await POST(
      makeRequest({ accessCode: ACCESS_CODE }),
      makeContext(),
    );
    expect(crossOrg.status).toBe(401);

    getAdminPublishedEventById.mockResolvedValue(null);
    const noEvent = await POST(
      makeRequest({ accessCode: ACCESS_CODE }),
      makeContext(),
    );
    expect(noEvent.status).toBe(401);
    expect(await noEvent.json()).toEqual(await crossOrg.json());
  });

  it("is rate-limited 10/min/IP — the 11th attempt 429s with Retry-After (AC-1)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const ok = await POST(
        makeRequest({ accessCode: ACCESS_CODE }),
        makeContext(),
      );
      expect(ok.status).toBe(200);
    }

    const limited = await POST(
      makeRequest({ accessCode: ACCESS_CODE }),
      makeContext(),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();

    // A different IP still gets through (per-IP buckets).
    const otherIp = await POST(
      makeRequest({ accessCode: ACCESS_CODE }, "198.51.100.9"),
      makeContext(),
    );
    expect(otherIp.status).toBe(200);
  });

  it("400 on a malformed body — no DAL reads", async () => {
    const response = await POST(makeRequest({ nope: true }), makeContext());
    expect(response.status).toBe(400);
    expect(getAdminActiveCheckinTeamMemberByAccessCodeHash).not.toHaveBeenCalled();
  });
});
