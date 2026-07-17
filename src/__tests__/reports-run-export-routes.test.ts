// @vitest-environment node
/**
 * M7-T2 — Report Run + Export API routes: the permission split itself
 * (spec D1) exercised end-to-end through the real route handlers, not just
 * the shared scope helper. Locks:
 *  - Run succeeds for an org member WITHOUT write:events (viewer tier)
 *  - Export 403s for that SAME member on the SAME event (the deliberate
 *    divergence, §7 AC-1)
 *  - both 404 on a cross-org/unknown event (§7 AC-2)
 *  - export filenames match the spec §7 table exactly (§7 AC-4)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  loadRegistrationOverviewPage,
  loadRegistrationOverviewExport,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  loadRegistrationOverviewPage: vi.fn(),
  loadRegistrationOverviewExport: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/features/reports/server/load-registration-overview", () => ({
  loadRegistrationOverviewPage,
  loadRegistrationOverviewExport,
}));

import { GET as runGET } from "@/app/api/dashboard/events/[eventId]/reports/registration-overview/route";
import { GET as exportGET } from "@/app/api/dashboard/events/[eventId]/reports/registration-overview/export/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

function eventContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

function memberUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "member" }],
    permissions: ["view:events"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Member",
    picture: "",
    email: "member@example.com",
  });
  getAdminUserByEmail.mockResolvedValue(memberUserDoc());
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    name: "Summit",
  });
  loadRegistrationOverviewPage.mockResolvedValue({
    rows: [{ name: "Ada Lovelace" }],
    nextCursorMs: null,
    hasMore: false,
  });
  loadRegistrationOverviewExport.mockResolvedValue([{ name: "Ada Lovelace" }]);
});

describe("GET .../reports/registration-overview (Run)", () => {
  it("succeeds for an org member WITHOUT write:events (D1)", async () => {
    const response = await runGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(200);
    expect(loadRegistrationOverviewPage).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      cursorMs: undefined,
    });
  });

  it("forwards a numeric ?cursor= as cursorMs", async () => {
    await runGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview?cursor=12345`,
      ),
      eventContext(),
    );

    expect(loadRegistrationOverviewPage).toHaveBeenCalledWith(
      expect.objectContaining({ cursorMs: 12345 }),
    );
  });

  it("400s on a non-numeric ?cursor=", async () => {
    const response = await runGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview?cursor=nope`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(400);
    expect(loadRegistrationOverviewPage).not.toHaveBeenCalled();
  });

  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await runGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 for a cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await runGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(404);
    expect(loadRegistrationOverviewPage).not.toHaveBeenCalled();
  });
});

describe("GET .../reports/registration-overview/export", () => {
  it("403s for the SAME viewer-permission member Run just succeeded for (D1's split, §7 AC-1)", async () => {
    const response = await exportGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview/export`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(403);
    expect(loadRegistrationOverviewExport).not.toHaveBeenCalled();
  });

  it("succeeds for a member WITH write:events and returns the exact filename (§7 AC-4)", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ permissions: ["write:events"] }),
    );

    const response = await exportGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview/export`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      `filename="registration-overview-${EVENT_ID}.csv"`,
    );
    const csv = await response.text();
    expect(csv).toContain("Ada Lovelace");
  });

  it("returns 404 for a cross-org/unknown event even WITH write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(
      memberUserDoc({ permissions: ["write:events"] }),
    );
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await exportGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/registration-overview/export`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(404);
    expect(loadRegistrationOverviewExport).not.toHaveBeenCalled();
  });
});
