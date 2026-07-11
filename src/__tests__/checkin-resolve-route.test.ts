// @vitest-environment node
/**
 * M5-T5 — scanner resolve routes:
 *   POST /api/events/[eventId]/checkin/resolve            (team session)
 *   POST /api/dashboard/events/[eventId]/checkin/resolve  (admin session)
 * - all five result states: OK / WRONG_EVENT / INVALID / NOT_ACCEPTED /
 *   CANCELLED (AC-7), manual entry === camera path (one endpoint, AC-4);
 * - resolve NEVER writes the attendee (AC-3) and leaks no data beyond the
 *   attendee card;
 * - expired/forged session tokens 401 back to the gate (AC-2); a REVOKED
 *   member's live session 401s on its next resolve (AC-9 — isActive
 *   re-check);
 * - per-session rate limit 60/min (AC-10); admin route write:events (AC-8).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminPublishedEventById,
  getAdminCheckinTeamMemberForEvent,
  touchAdminCheckinTeamMemberLastSeen,
  getAdminAttendeeBySubmissionId,
  getAdminFormDataForEvent,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminPublishedEventById: vi.fn(),
  getAdminCheckinTeamMemberForEvent: vi.fn(),
  touchAdminCheckinTeamMemberLastSeen: vi.fn(),
  getAdminAttendeeBySubmissionId: vi.fn(),
  getAdminFormDataForEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventForOrganization,
  getAdminPublishedEventById,
}));
vi.mock("@/lib/db/adminCheckinTeamMember", () => ({
  getAdminCheckinTeamMemberForEvent,
  touchAdminCheckinTeamMemberLastSeen,
}));
vi.mock("@/lib/db/adminAttendee", () => ({
  getAdminAttendeeBySubmissionId,
}));
vi.mock("@/lib/db/adminFormData", () => ({ getAdminFormDataForEvent }));

import { POST as publicResolve } from "@/app/api/events/[eventId]/checkin/resolve/route";
import { POST as adminResolve } from "@/app/api/dashboard/events/[eventId]/checkin/resolve/route";
import { hashQrToken, mintQrToken } from "@/lib/qr/qr-token";
import { mintScannerSessionToken } from "@/lib/qr/scanner-session";
import { resetRateLimits } from "@/lib/rate-limit";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const SUBMISSION_ID = "sub-1";

const QR_TOKEN = mintQrToken({ eventId: EVENT_ID, formDataId: SUBMISSION_ID });

const MEMBER = {
  id: "member-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "Maria Chen",
  deviceLabel: "Door A",
  accessCodeHash: "hash",
  isActive: true,
  lastSeenAt: null,
};

const ATTENDEE = {
  id: "att-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  submissionId: SUBMISSION_ID,
  orderId: "order-1",
  pathId: "path-1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@dentsu.com",
  company: "Dentsu",
  jobTitle: "Engineer",
  registrationTypeId: "rt-1",
  registrationTypeLabel: "Delegate",
  ticketTypeId: "tick-1",
  ticketLabel: "General Admission",
  status: "accepted",
  checkInState: "not-arrived",
  checkedInAt: null,
  checkedInBy: null,
  qrTokenHash: hashQrToken(QR_TOKEN),
};

function sessionToken(overrides: { ttlMs?: number } = {}) {
  return mintScannerSessionToken({
    teamMemberId: MEMBER.id,
    eventId: EVENT_ID,
    ...overrides,
  });
}

function publicRequest(body: unknown) {
  return new Request(`http://localhost/api/events/${EVENT_ID}/checkin/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/checkin/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
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
  getAdminCheckinTeamMemberForEvent.mockResolvedValue(MEMBER);
  getAdminAttendeeBySubmissionId.mockResolvedValue(ATTENDEE);
  getAdminFormDataForEvent.mockResolvedValue(null);
  // Admin-session fixtures.
  cookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: "token" } : undefined),
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Owner",
    picture: "",
    email: "Owner@Example.com",
  });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "owner" }],
    permissions: ["write:events"],
  });
  getAdminEventForOrganization.mockResolvedValue({ id: EVENT_ID, name: "Conf" });
});

describe("public resolve — result states (AC-3/AC-4/AC-7)", () => {
  it("resolves a valid pass to the attendee card WITHOUT checking in (resolve ≠ confirm)", async () => {
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      status: "OK",
      attendee: {
        name: "Ada Lovelace",
        registrationTypeLabel: "Delegate",
        ticketLabel: "General Admission",
        checkInState: "not-arrived",
        checkedInAtIso: null,
        checkedInByName: null,
      },
    });
    // No email/company on the door surface (AC-11), no attendee id (AC-12).
    expect(JSON.stringify(body)).not.toContain("ada@dentsu.com");
    expect(JSON.stringify(body)).not.toContain("att-1");
    expect(touchAdminCheckinTeamMemberLastSeen).toHaveBeenCalledWith("member-1");
  });

  it("WRONG_EVENT for a genuine token of another event — zero data leaked", async () => {
    const foreign = mintQrToken({ eventId: "evt-2", formDataId: SUBMISSION_ID });
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: foreign }),
      makeContext(),
    );
    expect(await response.json()).toEqual({ status: "WRONG_EVENT" });
    expect(getAdminAttendeeBySubmissionId).not.toHaveBeenCalled();
  });

  it("INVALID for garbage and for tampered signatures", async () => {
    const garbage = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: "not-a-token" }),
      makeContext(),
    );
    expect(await garbage.json()).toEqual({ status: "INVALID" });

    const tampered = `${QR_TOKEN.slice(0, -4)}AAAA`;
    const forged = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: tampered }),
      makeContext(),
    );
    expect(await forged.json()).toEqual({ status: "INVALID" });
  });

  it("NOT_ACCEPTED when the pass is valid but the submission is pre-accept", async () => {
    getAdminAttendeeBySubmissionId.mockResolvedValue(null);
    getAdminFormDataForEvent.mockResolvedValue({
      id: SUBMISSION_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      status: "pending",
      submission: {},
    });

    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(await response.json()).toEqual({ status: "NOT_ACCEPTED" });
  });

  it("INVALID when neither attendee nor submission exists", async () => {
    getAdminAttendeeBySubmissionId.mockResolvedValue(null);
    getAdminFormDataForEvent.mockResolvedValue(null);

    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(await response.json()).toEqual({ status: "INVALID" });
  });

  it("INVALID on a stored-hash mismatch (revocation seam)", async () => {
    getAdminAttendeeBySubmissionId.mockResolvedValue({
      ...ATTENDEE,
      qrTokenHash: "rotated-away",
    });
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(await response.json()).toEqual({ status: "INVALID" });
  });

  it("CANCELLED for a cancelled attendee", async () => {
    getAdminAttendeeBySubmissionId.mockResolvedValue({
      ...ATTENDEE,
      status: "cancelled",
    });
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(await response.json()).toEqual({ status: "CANCELLED" });
  });

  it("an ALREADY checked-in attendee resolves with the original record on the card", async () => {
    getAdminAttendeeBySubmissionId.mockResolvedValue({
      ...ATTENDEE,
      checkInState: "checked-in",
      checkedInAt: { toDate: () => new Date(1700000000000) },
      checkedInBy: {
        kind: "team-member",
        teamMemberId: "member-9",
        name: "Door B",
      },
    });
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    const body = await response.json();
    expect(body.attendee.checkInState).toBe("checked-in");
    expect(body.attendee.checkedInAtIso).toBe(
      new Date(1700000000000).toISOString(),
    );
    expect(body.attendee.checkedInByName).toBe("Door B");
  });
});

describe("public resolve — session gates (AC-2/AC-9/AC-10)", () => {
  it("401 SESSION_EXPIRED for expired and forged session tokens; no Firestore reads", async () => {
    const expired = await publicResolve(
      publicRequest({
        sessionToken: sessionToken({ ttlMs: -1000 }),
        qrToken: QR_TOKEN,
      }),
      makeContext(),
    );
    expect(expired.status).toBe(401);
    expect((await expired.json()).code).toBe("SESSION_EXPIRED");

    const valid = sessionToken();
    const forged = await publicResolve(
      publicRequest({
        sessionToken: `${valid.slice(0, -4)}AAAA`,
        qrToken: QR_TOKEN,
      }),
      makeContext(),
    );
    expect(forged.status).toBe(401);
    expect(getAdminCheckinTeamMemberForEvent).not.toHaveBeenCalled();
    expect(getAdminAttendeeBySubmissionId).not.toHaveBeenCalled();
  });

  it("401 when the member was REVOKED after the session was minted (isActive re-check)", async () => {
    getAdminCheckinTeamMemberForEvent.mockResolvedValue({
      ...MEMBER,
      isActive: false,
    });
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("SESSION_EXPIRED");
    expect(getAdminAttendeeBySubmissionId).not.toHaveBeenCalled();
  });

  it("401 when the member vanished (cross-tenant session replay)", async () => {
    getAdminCheckinTeamMemberForEvent.mockResolvedValue(null);
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(response.status).toBe(401);
  });

  it("rate-limits per session: the 61st resolve in a minute 429s", async () => {
    const token = sessionToken();
    for (let i = 0; i < 60; i += 1) {
      const ok = await publicResolve(
        publicRequest({ sessionToken: token, qrToken: QR_TOKEN }),
        makeContext(),
      );
      expect(ok.status).toBe(200);
    }
    const limited = await publicResolve(
      publicRequest({ sessionToken: token, qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("400 on a malformed body", async () => {
    const response = await publicResolve(
      publicRequest({ sessionToken: sessionToken() }),
      makeContext(),
    );
    expect(response.status).toBe(400);
  });
});

describe("admin resolve — dashboard scanner (AC-8)", () => {
  it("resolves under the admin session with the same result shape", async () => {
    const response = await adminResolve(
      adminRequest({ qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("OK");
    expect(body.attendee.name).toBe("Ada Lovelace");
  });

  it("403 without write:events; 404 cross-org", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const forbidden = await adminResolve(
      adminRequest({ qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(forbidden.status).toBe(403);

    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "owner" }],
      permissions: ["write:events"],
    });
    getAdminEventForOrganization.mockResolvedValue(null);
    const missing = await adminResolve(
      adminRequest({ qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(missing.status).toBe(404);
  });
});
