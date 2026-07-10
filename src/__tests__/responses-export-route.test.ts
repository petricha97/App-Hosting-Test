// @vitest-environment node
/**
 * M3-T4 — CSV export routes (workspace + per-event).
 * Spec: agents/docs/specs/m3-registration-paths.md (T4 AC-6).
 *
 * Locks:
 *  - both variants are write:events-gated (401/403) — export leaks PII, so
 *    view-only members cannot pull it
 *  - the workspace variant 404s a foreign/unknown ?event= filter (IDOR-safe)
 *  - active filters are pushed into the Firestore query (status/event), the
 *    export cap is applied, and the response is a CSV attachment whose cells
 *    are formula-escaped end-to-end
 *
 * The DAL is mocked at the module boundary — no emulator required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminEventsForOrganization,
  listAdminFormDataForEvent,
  listAdminFormDataForOrganization,
  getAdminOrderForEvent,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminEventsForOrganization: vi.fn(),
  listAdminFormDataForEvent: vi.fn(),
  listAdminFormDataForOrganization: vi.fn(),
  getAdminOrderForEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventForOrganization,
  getAdminEventsForOrganization,
}));
vi.mock("@/lib/db/adminFormData", () => ({
  FORM_DATA_LIST_LIMIT: 50,
  listAdminFormDataForEvent,
  listAdminFormDataForOrganization,
}));
vi.mock("@/lib/db/adminOrder", () => ({ getAdminOrderForEvent }));

import { GET as workspaceExport } from "@/app/api/dashboard/responses/export/route";
import { GET as eventExport } from "@/app/api/dashboard/events/[eventId]/responses/export/route";

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

const formData = {
  id: "fd-1",
  formId: "form-1",
  eventId: EVENT_ID,
  organizationId: ORG_ID,
  submission: {
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    note: "=cmd|calc",
  },
  submittedAt: {
    seconds: 100,
    nanoseconds: 0,
    toDate: () => new Date(100_000),
  },
  status: "pending",
  orderId: "order-1",
  pathId: "path-1",
  ticketLabel: "GC Early Bird",
};

function eventContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
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
  getAdminEventsForOrganization.mockResolvedValue([
    { id: EVENT_ID, name: "GovTech Conference" },
  ]);
  listAdminFormDataForEvent.mockResolvedValue([formData]);
  listAdminFormDataForOrganization.mockResolvedValue([formData]);
  getAdminOrderForEvent.mockResolvedValue(null);
});

describe("GET /api/dashboard/responses/export (workspace)", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await workspaceExport(
      new Request("http://localhost/api/dashboard/responses/export"),
    );

    expect(response.status).toBe(401);
    expect(listAdminFormDataForOrganization).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await workspaceExport(
      new Request("http://localhost/api/dashboard/responses/export"),
    );

    expect(response.status).toBe(403);
    expect(listAdminFormDataForOrganization).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/unknown ?event= filter", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await workspaceExport(
      new Request(
        "http://localhost/api/dashboard/responses/export?event=evt-foreign",
      ),
    );

    expect(response.status).toBe(404);
    expect(listAdminFormDataForEvent).not.toHaveBeenCalled();
  });

  it("exports org-wide rows as an escaped CSV attachment honoring ?status=", async () => {
    const response = await workspaceExport(
      new Request(
        "http://localhost/api/dashboard/responses/export?status=pending",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(listAdminFormDataForOrganization).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      status: "pending",
      limit: 1000,
    });

    const csv = await response.text();
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("Name,Email,Event,Ticket,Status,Submitted,note");
    expect(row).toContain("Ada Lovelace");
    expect(row).toContain("GovTech Conference");
    expect(row).toContain("GC Early Bird");
    expect(row).toContain("pending");
    // Formula-injection escaping applied to the submission answer.
    expect(row).toContain("'=cmd|calc");
    expect(row).not.toContain(",=cmd");
  });

  it("routes an ?event= filter through the per-event list query", async () => {
    const response = await workspaceExport(
      new Request(
        `http://localhost/api/dashboard/responses/export?event=${EVENT_ID}&status=accepted`,
      ),
    );

    expect(response.status).toBe(200);
    expect(listAdminFormDataForEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      status: "accepted",
      limit: 1000,
    });
    expect(listAdminFormDataForOrganization).not.toHaveBeenCalled();
  });

  it("ignores an unknown ?status= (exports all rows)", async () => {
    await workspaceExport(
      new Request(
        "http://localhost/api/dashboard/responses/export?status=bogus",
      ),
    );

    expect(listAdminFormDataForOrganization).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      status: undefined,
      limit: 1000,
    });
  });
});

describe("GET /api/dashboard/events/[eventId]/responses/export (per-event)", () => {
  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await eventExport(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/responses/export`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(403);
    expect(listAdminFormDataForEvent).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-org event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await eventExport(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/responses/export`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(404);
    expect(listAdminFormDataForEvent).not.toHaveBeenCalled();
  });

  it("exports the event's rows with the status filter in the query", async () => {
    const response = await eventExport(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/responses/export?status=new`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(listAdminFormDataForEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      status: "new",
      limit: 1000,
    });

    const csv = await response.text();
    expect(csv).toContain("Ada Lovelace");
  });

  it("falls back to the order-snapshot label when ticketLabel is null (T4 AC-8)", async () => {
    listAdminFormDataForEvent.mockResolvedValue([
      { ...formData, ticketLabel: null },
    ]);
    getAdminOrderForEvent.mockResolvedValue({
      id: "order-1",
      snapshot: { feeName: "GC Standard USD" },
    });

    const response = await eventExport(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/responses/export`,
      ),
      eventContext(),
    );

    const csv = await response.text();
    expect(getAdminOrderForEvent).toHaveBeenCalledWith({
      orderId: "order-1",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(csv).toContain("GC Standard USD");
  });
});
