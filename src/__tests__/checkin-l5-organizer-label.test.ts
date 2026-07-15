// @vitest-environment node
/**
 * L-5 (M6-T2 polish, carried from M5 backlog) —
 * src/features/checkin/server/resolve-scan.ts / the check-in confirm+resolve
 * responses must stop disclosing the admin email to TEAM-MEMBER scanners on
 * ALREADY_CHECKED_IN: when `checkedInBy.kind === "admin"` and the caller is
 * a team session, the response carries a generic "Organizer" label — never
 * the email/userId. The dashboard admin surface (an admin viewing their own
 * tenant) is UNCHANGED — it still sees the real userId.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_CHECKED_IN_BY_TEAM_VIEWER_LABEL,
  checkedInByName,
  serializeScanAttendeeCard,
} from "@/features/checkin/server/resolve-scan";
import type { AttendeeDoc, WithId } from "@/types/collection";

describe("checkedInByName — viewer-scoped admin identity masking (L-5)", () => {
  it("masks an admin identity as 'Organizer' for a team-session viewer", () => {
    const name = checkedInByName(
      { kind: "admin", userId: "owner@example.com" },
      true,
    );
    expect(name).toBe(ADMIN_CHECKED_IN_BY_TEAM_VIEWER_LABEL);
    expect(name).not.toContain("@");
  });

  it("shows the real userId for the dashboard admin viewer (default, unmasked)", () => {
    expect(
      checkedInByName({ kind: "admin", userId: "owner@example.com" }),
    ).toBe("owner@example.com");
    expect(
      checkedInByName({ kind: "admin", userId: "owner@example.com" }, false),
    ).toBe("owner@example.com");
  });

  it("never masks a team-member identity (nothing to hide from a peer scanner)", () => {
    expect(
      checkedInByName(
        { kind: "team-member", teamMemberId: "m1", name: "Maria" },
        true,
      ),
    ).toBe("Maria");
  });

  it("null checkedInBy stays null regardless of viewer", () => {
    expect(checkedInByName(null, true)).toBeNull();
    expect(checkedInByName(null, false)).toBeNull();
  });
});

describe("serializeScanAttendeeCard — propagates the viewer flag", () => {
  const ATTENDEE = {
    id: "att-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    registrationTypeLabel: "Delegate",
    ticketLabel: "General Admission",
    checkInState: "checked-in",
    checkedInAt: null,
    checkedInBy: { kind: "admin", userId: "owner@example.com" },
  } as unknown as WithId<AttendeeDoc>;

  it("masks the admin identity when viewerIsTeamSession is true", () => {
    const card = serializeScanAttendeeCard(ATTENDEE, true);
    expect(card.checkedInByName).toBe(ADMIN_CHECKED_IN_BY_TEAM_VIEWER_LABEL);
  });

  it("leaves the admin identity unmasked by default (dashboard admin viewer)", () => {
    const card = serializeScanAttendeeCard(ATTENDEE);
    expect(card.checkedInByName).toBe("owner@example.com");
  });
});

// -----------------------------------------------------------------------
// Route-level: the PUBLIC team-session confirm/resolve routes must mask;
// the DASHBOARD admin routes must not.
// -----------------------------------------------------------------------

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
import { POST as publicResolve } from "@/app/api/events/[eventId]/checkin/resolve/route";
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

const ATTENDEE_CHECKED_IN_BY_ADMIN = {
  id: "att-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  submissionId: SUBMISSION_ID,
  orderId: "order-1",
  pathId: "path-1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  company: "Acme",
  jobTitle: "Engineer",
  registrationTypeId: "rt-1",
  registrationTypeLabel: "Delegate",
  ticketTypeId: "tick-1",
  ticketLabel: "General Admission",
  status: "accepted",
  checkInState: "checked-in",
  checkedInAt: { toDate: () => new Date(1700000000000) },
  checkedInBy: { kind: "admin", userId: "organizer@example.com" },
  qrTokenHash: hashQrToken(QR_TOKEN),
};

function sessionToken() {
  return mintScannerSessionToken({
    teamMemberId: MEMBER.id,
    eventId: EVENT_ID,
  });
}

function publicRequest(path: string, body: unknown) {
  return new Request(
    `http://localhost/api/events/${EVENT_ID}/checkin/${path}`,
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
  getAdminAttendeeBySubmissionId.mockResolvedValue(
    ATTENDEE_CHECKED_IN_BY_ADMIN,
  );
  getAdminFormDataForEvent.mockResolvedValue(null);
  touchAdminCheckinTeamMemberLastSeen.mockResolvedValue(undefined);
});

describe("Public (team-session) confirm route never discloses the admin email", () => {
  it("ALREADY_CHECKED_IN shows 'Organizer', never the admin's email/userId", async () => {
    checkInAdminAttendee.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: true,
      attendee: ATTENDEE_CHECKED_IN_BY_ADMIN,
      checkedInAt: ATTENDEE_CHECKED_IN_BY_ADMIN.checkedInAt,
      checkedInBy: ATTENDEE_CHECKED_IN_BY_ADMIN.checkedInBy,
    });

    const response = await publicConfirm(
      publicRequest("confirm", {
        sessionToken: sessionToken(),
        qrToken: QR_TOKEN,
      }),
      makeContext(),
    );
    const body = await response.json();

    expect(body.status).toBe("ALREADY_CHECKED_IN");
    expect(body.checkedInByName).toBe(ADMIN_CHECKED_IN_BY_TEAM_VIEWER_LABEL);
    expect(JSON.stringify(body)).not.toContain("organizer@example.com");
  });
});

describe("Public (team-session) resolve route never discloses the admin email", () => {
  it("resolving an already-checked-in attendee shows 'Organizer', never the email", async () => {
    const response = await publicResolve(
      publicRequest("resolve", {
        sessionToken: sessionToken(),
        qrToken: QR_TOKEN,
      }),
      makeContext(),
    );
    const body = await response.json();

    expect(body.status).toBe("OK");
    expect(body.attendee.checkedInByName).toBe(
      ADMIN_CHECKED_IN_BY_TEAM_VIEWER_LABEL,
    );
    expect(JSON.stringify(body)).not.toContain("organizer@example.com");
  });
});
