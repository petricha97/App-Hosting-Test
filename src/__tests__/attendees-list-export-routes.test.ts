// @vitest-environment node
/**
 * M5-T2 — merged roster list + CSV export routes:
 *   GET /api/dashboard/events/[eventId]/attendees          (load more)
 *   GET /api/dashboard/events/[eventId]/attendees/export   (CSV)
 * - both write:events-gated (T2 AC-9), 404 cross-org;
 * - merged rows: Attendee docs + non-accepted FormData, newest first;
 *   accepted FormData never duplicates its Attendee row;
 * - ?status= pushes the split to the source queries (accepted -> no FormData
 *   read; pending -> no Attendee read); cursors forward to the DAL;
 * - the CSV honors the filter and matches the on-screen serializer (AC-8).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  listAdminAttendeesForEvent,
  listAdminFormDataForEvent,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  listAdminAttendeesForEvent: vi.fn(),
  listAdminFormDataForEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminAttendee", () => ({
  ATTENDEE_LIST_LIMIT: 50,
  listAdminAttendeesForEvent,
}));
vi.mock("@/lib/db/adminFormData", () => ({ listAdminFormDataForEvent }));

import { GET as listGet } from "@/app/api/dashboard/events/[eventId]/attendees/route";
import { GET as exportGet } from "@/app/api/dashboard/events/[eventId]/attendees/export/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

function ts(ms: number) {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
  };
}

const attendee = {
  id: "att-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  submissionId: "sub-1",
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
  qrTokenHash: "hash",
  createdAt: ts(2000),
  updatedAt: ts(2000),
};

const pendingResponse = {
  id: "fd-1",
  formId: "form-1",
  eventId: EVENT_ID,
  organizationId: ORG_ID,
  submission: {
    first_name: "Grace",
    last_name: "Hopper",
    email: "grace@navy.mil",
  },
  submittedAt: ts(3000),
  status: "new",
  ticketLabel: "VIP",
};

const acceptedResponse = {
  ...pendingResponse,
  id: "fd-2",
  submittedAt: ts(1000),
  status: "accepted",
};

function listRequest(query = "") {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/attendees${query}`,
  );
}

function exportRequest(query = "") {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/attendees/export${query}`,
  );
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
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
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    name: "GovTech Conference",
  });
  listAdminAttendeesForEvent.mockResolvedValue([attendee]);
  listAdminFormDataForEvent.mockResolvedValue([
    pendingResponse,
    acceptedResponse,
  ]);
});

describe("GET attendees — gates", () => {
  it("403 without write:events (T2 AC-9)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    const response = await listGet(listRequest(), makeContext());
    expect(response.status).toBe(403);
    expect(listAdminAttendeesForEvent).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await listGet(listRequest(), makeContext());
    expect(response.status).toBe(404);
  });

  it("400 on a non-numeric cursor", async () => {
    const response = await listGet(
      listRequest("?attendeeCursor=abc"),
      makeContext(),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET attendees — merged rows", () => {
  it("merges Attendee + non-accepted FormData newest first; accepted FormData never duplicates", async () => {
    const response = await listGet(listRequest(), makeContext());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.rows.map((row: { id: string }) => row.id)).toEqual([
      "fd-1", // 3000 pending
      "att-1", // 2000 attendee
      // fd-2 (accepted) is EXCLUDED — its row is the attendee source's job.
    ]);
    expect(body.rows[0]).toMatchObject({
      kind: "pending",
      status: "pending",
      checkInState: null,
    });
    expect(body.rows[1]).toMatchObject({
      kind: "attendee",
      status: "accepted",
      checkInState: "not-arrived",
    });
    // Cursors come from the RAW page tails (the accepted response included).
    expect(body.attendeeCursorMs).toBe(2000);
    expect(body.pendingCursorMs).toBe(1000);
    expect(body.hasMoreAttendees).toBe(false);
    expect(body.hasMorePending).toBe(false);
  });

  it("?status=accepted reads only the Attendee source with the Firestore-side filter", async () => {
    await listGet(listRequest("?status=accepted"), makeContext());

    expect(listAdminFormDataForEvent).not.toHaveBeenCalled();
    expect(listAdminAttendeesForEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        status: "accepted",
      }),
    );
  });

  it("?status=pending reads only the FormData source", async () => {
    await listGet(listRequest("?status=pending"), makeContext());

    expect(listAdminAttendeesForEvent).not.toHaveBeenCalled();
    expect(listAdminFormDataForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_ID, organizationId: ORG_ID }),
    );
  });

  it("forwards the load-more cursors to the DAL", async () => {
    await listGet(
      listRequest("?attendeeCursor=2000&pendingCursor=3000"),
      makeContext(),
    );

    expect(listAdminAttendeesForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ startAfterCreatedAtMs: 2000 }),
    );
    expect(listAdminFormDataForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ startAfterSubmittedAtMs: 3000 }),
    );
  });
});

describe("GET attendees/export — CSV (T2 AC-8)", () => {
  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    const response = await exportGet(exportRequest(), makeContext());
    expect(response.status).toBe(403);
  });

  it("emits the merged rows as CSV with the spec columns", async () => {
    const response = await exportGet(exportRequest(), makeContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");

    const csv = await response.text();
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Name,Email,Company,Ticket,Registration type,Status,Check-in,Checked-in at",
    );
    expect(lines[1]).toContain("Grace Hopper"); // newest first
    expect(lines[1]).toContain("pending");
    expect(lines[2]).toContain("Ada Lovelace");
    expect(lines[2]).toContain("Delegate");
    expect(lines[2]).toContain("not-arrived");
    // The accepted FormData row is not exported twice.
    expect(csv.split("Grace Hopper").length - 1).toBe(1);
  });

  it("honors the active status filter (accepted -> attendee rows only)", async () => {
    const response = await exportGet(
      exportRequest("?status=accepted"),
      makeContext(),
    );
    const csv = await response.text();

    expect(listAdminFormDataForEvent).not.toHaveBeenCalled();
    expect(csv).toContain("Ada Lovelace");
    expect(csv).not.toContain("Grace Hopper");
  });

  it("escapes formula-leading cells (same rules as M3-T4 AC-6)", async () => {
    listAdminAttendeesForEvent.mockResolvedValue([
      { ...attendee, firstName: "=HYPERLINK(", lastName: "" },
    ]);
    listAdminFormDataForEvent.mockResolvedValue([]);

    const response = await exportGet(exportRequest(), makeContext());
    const csv = await response.text();
    expect(csv).toContain("'=HYPERLINK(");
  });
});
