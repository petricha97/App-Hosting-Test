// @vitest-environment node
/**
 * M5-T5 — scanner confirm routes:
 *   POST /api/events/[eventId]/checkin/confirm            (team session)
 *   POST /api/dashboard/events/[eventId]/checkin/confirm  (admin session)
 * - confirm resolves through the QR TOKEN (never a bare attendeeId, AC-12)
 *   and calls the idempotent DAL flip with the correct scanner identity:
 *   team-member (id + denormalized name) vs admin (userId, AC-8);
 * - a duplicate confirm surfaces ALREADY_CHECKED_IN with the ORIGINAL
 *   timestamp + scanner name — the DAL's zero-write replay (AC-6);
 * - non-OK resolutions never reach the DAL; session gates match resolve.
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
  checkInAdminAttendee,
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
  checkInAdminAttendee: vi.fn(),
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
  checkInAdminAttendee,
}));
vi.mock("@/lib/db/adminFormData", () => ({ getAdminFormDataForEvent }));

import { POST as publicConfirm } from "@/app/api/events/[eventId]/checkin/confirm/route";
import { POST as adminConfirm } from "@/app/api/dashboard/events/[eventId]/checkin/confirm/route";
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

const ORIGINAL_CHECKIN_MS = 1700000000000;

function sessionToken() {
  return mintScannerSessionToken({ teamMemberId: MEMBER.id, eventId: EVENT_ID });
}

function publicRequest(body: unknown) {
  return new Request(`http://localhost/api/events/${EVENT_ID}/checkin/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/checkin/confirm`,
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
  checkInAdminAttendee.mockResolvedValue({
    ok: true,
    alreadyCheckedIn: false,
    attendee: {
      ...ATTENDEE,
      checkInState: "checked-in",
      checkedInBy: {
        kind: "team-member",
        teamMemberId: MEMBER.id,
        name: MEMBER.name,
      },
    },
  });
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

describe("public confirm — team identity + idempotency (AC-5/AC-6/AC-8)", () => {
  it("first confirm flips through the DAL with the TEAM identity and returns CHECKED_IN", async () => {
    const response = await publicConfirm(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(response.status).toBe(200);

    expect(checkInAdminAttendee).toHaveBeenCalledWith({
      attendeeId: "att-1",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      checkedInBy: {
        kind: "team-member",
        teamMemberId: "member-1",
        name: "Maria Chen",
      },
    });

    const body = await response.json();
    expect(body.status).toBe("CHECKED_IN");
    expect(body.attendee.name).toBe("Ada Lovelace");
    expect(touchAdminCheckinTeamMemberLastSeen).toHaveBeenCalledWith("member-1");
  });

  it("duplicate confirm returns ALREADY_CHECKED_IN with the ORIGINAL timestamp + scanner name", async () => {
    checkInAdminAttendee.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: true,
      attendee: {
        ...ATTENDEE,
        checkInState: "checked-in",
        checkedInAt: { toDate: () => new Date(ORIGINAL_CHECKIN_MS) },
        checkedInBy: {
          kind: "team-member",
          teamMemberId: "member-9",
          name: "First Scanner",
        },
      },
      checkedInAt: { toDate: () => new Date(ORIGINAL_CHECKIN_MS) },
      checkedInBy: {
        kind: "team-member",
        teamMemberId: "member-9",
        name: "First Scanner",
      },
    });

    const response = await publicConfirm(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    const body = await response.json();
    expect(body.status).toBe("ALREADY_CHECKED_IN");
    // The FIRST scanner's record — never this scanner, never overwritten.
    expect(body.checkedInAtIso).toBe(new Date(ORIGINAL_CHECKIN_MS).toISOString());
    expect(body.checkedInByName).toBe("First Scanner");
  });

  it("non-OK resolutions (invalid/wrong-event/not-accepted) never reach the DAL flip", async () => {
    const invalid = await publicConfirm(
      publicRequest({ sessionToken: sessionToken(), qrToken: "garbage" }),
      makeContext(),
    );
    expect((await invalid.json()).status).toBe("INVALID");

    const foreign = mintQrToken({ eventId: "evt-2", formDataId: SUBMISSION_ID });
    const wrongEvent = await publicConfirm(
      publicRequest({ sessionToken: sessionToken(), qrToken: foreign }),
      makeContext(),
    );
    expect((await wrongEvent.json()).status).toBe("WRONG_EVENT");

    getAdminAttendeeBySubmissionId.mockResolvedValue(null);
    getAdminFormDataForEvent.mockResolvedValue({
      id: SUBMISSION_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      status: "new",
      submission: {},
    });
    const notAccepted = await publicConfirm(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect((await notAccepted.json()).status).toBe("NOT_ACCEPTED");

    expect(checkInAdminAttendee).not.toHaveBeenCalled();
  });

  it("maps the DAL's CANCELLED refusal to the cancelled variant", async () => {
    checkInAdminAttendee.mockResolvedValue({
      ok: false,
      code: "CANCELLED",
      message: "Registration cancelled.",
    });
    const response = await publicConfirm(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect((await response.json()).status).toBe("CANCELLED");
  });

  it("401 SESSION_EXPIRED on expired sessions and on revoked members (AC-9)", async () => {
    const expired = await publicConfirm(
      publicRequest({
        sessionToken: mintScannerSessionToken({
          teamMemberId: MEMBER.id,
          eventId: EVENT_ID,
          ttlMs: -1000,
        }),
        qrToken: QR_TOKEN,
      }),
      makeContext(),
    );
    expect(expired.status).toBe(401);

    getAdminCheckinTeamMemberForEvent.mockResolvedValue({
      ...MEMBER,
      isActive: false,
    });
    const revoked = await publicConfirm(
      publicRequest({ sessionToken: sessionToken(), qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(revoked.status).toBe(401);
    expect(checkInAdminAttendee).not.toHaveBeenCalled();
  });
});

describe("admin confirm — dashboard scanner identity (AC-8)", () => {
  it("records checkedInBy = { kind: 'admin', userId } with the lowercased email", async () => {
    checkInAdminAttendee.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: false,
      attendee: {
        ...ATTENDEE,
        checkInState: "checked-in",
        checkedInBy: { kind: "admin", userId: "owner@example.com" },
      },
    });

    const response = await adminConfirm(
      adminRequest({ qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(response.status).toBe(200);
    expect(checkInAdminAttendee).toHaveBeenCalledWith(
      expect.objectContaining({
        checkedInBy: { kind: "admin", userId: "owner@example.com" },
      }),
    );
  });

  it("403 without write:events — the DAL is unreachable", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    const response = await adminConfirm(
      adminRequest({ qrToken: QR_TOKEN }),
      makeContext(),
    );
    expect(response.status).toBe(403);
    expect(checkInAdminAttendee).not.toHaveBeenCalled();
  });
});
