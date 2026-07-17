// @vitest-environment node
/**
 * QA regression — M7-T2 D1 permission split, exercised end-to-end through
 * the REAL route.ts handlers for ALL 5 templates, not just
 * registration-overview (Code Review's own N-3 nit: the existing
 * `reports-run-export-routes.test.ts` only drives one of the 5 pairs through
 * the real handlers; the other 4 are verified by source reading only).
 *
 * For every one of the 5 templates:
 *  - a session with org membership but WITHOUT write:events can Run (200)
 *  - that SAME session gets 403 on Export
 *  - a session WITH write:events gets 200 on both
 *  - a cross-org/unknown event 404s on both, regardless of permission
 *
 * Spec: agents/docs/specs/m7-report-templates.md D1, §7 AC-1/AC-2.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  loadRegistrationOverviewPage,
  loadRegistrationOverviewExport,
  loadOrderTransactionsPage,
  loadOrderTransactionsExport,
  loadAbandonedRegistrationsPage,
  loadAbandonedRegistrationsExport,
  loadCheckinHistoryPage,
  loadCheckinHistoryExport,
  loadEmailOverviewPage,
  loadEmailOverviewExport,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  loadRegistrationOverviewPage: vi.fn(),
  loadRegistrationOverviewExport: vi.fn(),
  loadOrderTransactionsPage: vi.fn(),
  loadOrderTransactionsExport: vi.fn(),
  loadAbandonedRegistrationsPage: vi.fn(),
  loadAbandonedRegistrationsExport: vi.fn(),
  loadCheckinHistoryPage: vi.fn(),
  loadCheckinHistoryExport: vi.fn(),
  loadEmailOverviewPage: vi.fn(),
  loadEmailOverviewExport: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/features/reports/server/load-registration-overview", () => ({
  loadRegistrationOverviewPage,
  loadRegistrationOverviewExport,
}));
vi.mock("@/features/reports/server/load-order-transactions", () => ({
  loadOrderTransactionsPage,
  loadOrderTransactionsExport,
}));
vi.mock("@/features/reports/server/load-abandoned-registrations", () => ({
  loadAbandonedRegistrationsPage,
  loadAbandonedRegistrationsExport,
}));
vi.mock("@/features/reports/server/load-checkin-history", () => ({
  loadCheckinHistoryPage,
  loadCheckinHistoryExport,
}));
vi.mock("@/features/reports/server/load-email-overview", () => ({
  loadEmailOverviewPage,
  loadEmailOverviewExport,
}));

import { GET as registrationOverviewRunGET } from "@/app/api/dashboard/events/[eventId]/reports/registration-overview/route";
import { GET as registrationOverviewExportGET } from "@/app/api/dashboard/events/[eventId]/reports/registration-overview/export/route";
import { GET as orderTransactionsRunGET } from "@/app/api/dashboard/events/[eventId]/reports/order-transactions/route";
import { GET as orderTransactionsExportGET } from "@/app/api/dashboard/events/[eventId]/reports/order-transactions/export/route";
import { GET as abandonedRegistrationsRunGET } from "@/app/api/dashboard/events/[eventId]/reports/abandoned-registrations/route";
import { GET as abandonedRegistrationsExportGET } from "@/app/api/dashboard/events/[eventId]/reports/abandoned-registrations/export/route";
import { GET as checkinHistoryRunGET } from "@/app/api/dashboard/events/[eventId]/reports/checkin-history/route";
import { GET as checkinHistoryExportGET } from "@/app/api/dashboard/events/[eventId]/reports/checkin-history/export/route";
import { GET as emailOverviewRunGET } from "@/app/api/dashboard/events/[eventId]/reports/email-overview/route";
import { GET as emailOverviewExportGET } from "@/app/api/dashboard/events/[eventId]/reports/email-overview/export/route";

const EVENT_ID = "evt-qa-d1";
const ORG_ID = "org-qa-d1";

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

const TEMPLATES = [
  {
    slug: "registration-overview",
    runGET: registrationOverviewRunGET,
    exportGET: registrationOverviewExportGET,
    loadPage: loadRegistrationOverviewPage,
    loadExport: loadRegistrationOverviewExport,
  },
  {
    slug: "order-transactions",
    runGET: orderTransactionsRunGET,
    exportGET: orderTransactionsExportGET,
    loadPage: loadOrderTransactionsPage,
    loadExport: loadOrderTransactionsExport,
  },
  {
    slug: "abandoned-registrations",
    runGET: abandonedRegistrationsRunGET,
    exportGET: abandonedRegistrationsExportGET,
    loadPage: loadAbandonedRegistrationsPage,
    loadExport: loadAbandonedRegistrationsExport,
  },
  {
    slug: "checkin-history",
    runGET: checkinHistoryRunGET,
    exportGET: checkinHistoryExportGET,
    loadPage: loadCheckinHistoryPage,
    loadExport: loadCheckinHistoryExport,
  },
  {
    slug: "email-overview",
    runGET: emailOverviewRunGET,
    exportGET: emailOverviewExportGET,
    loadPage: loadEmailOverviewPage,
    loadExport: loadEmailOverviewExport,
  },
] as const;

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
    name: "QA Summit",
  });

  for (const t of TEMPLATES) {
    t.loadPage.mockResolvedValue({ rows: [], nextCursorMs: null, hasMore: false });
    t.loadExport.mockResolvedValue([]);
  }
});

describe.each(TEMPLATES)(
  "QA — D1 permission split end-to-end: $slug",
  ({ slug, runGET, exportGET, loadExport }) => {
    it("Run succeeds (200) for a viewer-permission org member (no write:events)", async () => {
      const response = await runGET(
        new Request(
          `http://localhost/api/dashboard/events/${EVENT_ID}/reports/${slug}`,
        ),
        eventContext(),
      );
      expect(response.status).toBe(200);
    });

    it("Export 403s for that SAME viewer-permission member", async () => {
      const response = await exportGET(
        new Request(
          `http://localhost/api/dashboard/events/${EVENT_ID}/reports/${slug}/export`,
        ),
        eventContext(),
      );
      expect(response.status).toBe(403);
      expect(loadExport).not.toHaveBeenCalled();
    });

    it("Export succeeds (200) for a member WITH write:events", async () => {
      getAdminUserByEmail.mockResolvedValue(
        memberUserDoc({ permissions: ["write:events"] }),
      );

      const response = await exportGET(
        new Request(
          `http://localhost/api/dashboard/events/${EVENT_ID}/reports/${slug}/export`,
        ),
        eventContext(),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(
        `filename="${slug}-${EVENT_ID}.csv"`,
      );
    });

    it("Run 404s for a cross-org/unknown event", async () => {
      getAdminEventForOrganization.mockResolvedValue(null);

      const response = await runGET(
        new Request(
          `http://localhost/api/dashboard/events/${EVENT_ID}/reports/${slug}`,
        ),
        eventContext(),
      );
      expect(response.status).toBe(404);
    });

    it("Export 404s for a cross-org/unknown event even WITH write:events", async () => {
      getAdminUserByEmail.mockResolvedValue(
        memberUserDoc({ permissions: ["write:events"] }),
      );
      getAdminEventForOrganization.mockResolvedValue(null);

      const response = await exportGET(
        new Request(
          `http://localhost/api/dashboard/events/${EVENT_ID}/reports/${slug}/export`,
        ),
        eventContext(),
      );
      expect(response.status).toBe(404);
      expect(loadExport).not.toHaveBeenCalled();
    });
  },
);
