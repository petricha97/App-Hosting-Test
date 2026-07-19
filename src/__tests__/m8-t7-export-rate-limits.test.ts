// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registrationScope: vi.fn(),
  reportsScope: vi.fn(),
  responsesOrgScope: vi.fn(),
  loadRosterPage: vi.fn(),
  listAdminFormDataForEvent: vi.fn(),
  listAdminFormDataForOrganization: vi.fn(),
  resolveResponseTicketLabels: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminEventsForOrganization: vi.fn(),
  loadRegistrationOverviewExport: vi.fn(),
  loadOrderTransactionsExport: vi.fn(),
  loadAbandonedRegistrationsExport: vi.fn(),
  loadCheckinHistoryExport: vi.fn(),
  loadEmailOverviewExport: vi.fn(),
}));

vi.mock("@/features/registration/server/route-scope", () => ({
  resolveRegistrationRouteScope: mocks.registrationScope,
}));
vi.mock("@/features/reports/server/reports-route-scope", () => ({
  resolveReportsRouteScope: mocks.reportsScope,
}));
vi.mock("@/features/responses/server/route-scope", () => ({
  resolveResponsesOrgWriteScope: mocks.responsesOrgScope,
}));
vi.mock("@/features/attendees/server/load-roster", () => ({
  loadRosterPage: mocks.loadRosterPage,
}));
vi.mock("@/lib/db/adminFormData", () => ({
  listAdminFormDataForEvent: mocks.listAdminFormDataForEvent,
  listAdminFormDataForOrganization: mocks.listAdminFormDataForOrganization,
}));
vi.mock("@/features/responses/server/ticket-labels", () => ({
  resolveResponseTicketLabels: mocks.resolveResponseTicketLabels,
}));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventForOrganization: mocks.getAdminEventForOrganization,
  getAdminEventsForOrganization: mocks.getAdminEventsForOrganization,
}));
vi.mock("@/features/reports/server/load-registration-overview", () => ({
  loadRegistrationOverviewExport: mocks.loadRegistrationOverviewExport,
}));
vi.mock("@/features/reports/server/load-order-transactions", () => ({
  loadOrderTransactionsExport: mocks.loadOrderTransactionsExport,
}));
vi.mock("@/features/reports/server/load-abandoned-registrations", () => ({
  loadAbandonedRegistrationsExport: mocks.loadAbandonedRegistrationsExport,
}));
vi.mock("@/features/reports/server/load-checkin-history", () => ({
  loadCheckinHistoryExport: mocks.loadCheckinHistoryExport,
}));
vi.mock("@/features/reports/server/load-email-overview", () => ({
  loadEmailOverviewExport: mocks.loadEmailOverviewExport,
}));

import { GET as attendeesExport } from "@/app/api/dashboard/events/[eventId]/attendees/export/route";
import { GET as eventResponsesExport } from "@/app/api/dashboard/events/[eventId]/responses/export/route";
import { GET as workspaceResponsesExport } from "@/app/api/dashboard/responses/export/route";
import { GET as registrationOverviewExport } from "@/app/api/dashboard/events/[eventId]/reports/registration-overview/export/route";
import { GET as orderTransactionsExport } from "@/app/api/dashboard/events/[eventId]/reports/order-transactions/export/route";
import { GET as abandonedRegistrationsExport } from "@/app/api/dashboard/events/[eventId]/reports/abandoned-registrations/export/route";
import { GET as checkinHistoryExport } from "@/app/api/dashboard/events/[eventId]/reports/checkin-history/export/route";
import { GET as emailOverviewExport } from "@/app/api/dashboard/events/[eventId]/reports/email-overview/export/route";
import { resetRateLimits } from "@/lib/rate-limit";

const EVENT_ID = "evt-1";
const request = new Request("http://localhost/export");
const context = () => ({ params: Promise.resolve({ eventId: EVENT_ID }) });

const routes = [
  ["attendees", () => attendeesExport(request, context())],
  ["event responses", () => eventResponsesExport(request, context())],
  ["workspace responses", () => workspaceResponsesExport(request)],
  ["registration overview", () => registrationOverviewExport(request, context())],
  ["order transactions", () => orderTransactionsExport(request, context())],
  ["abandoned registrations", () => abandonedRegistrationsExport(request, context())],
  ["check-in history", () => checkinHistoryExport(request, context())],
  ["email overview", () => emailOverviewExport(request, context())],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  const eventScope = {
    ok: true,
    organizationId: "org-1",
    userId: "owner@example.com",
    event: { id: EVENT_ID, name: "Summit" },
  };
  mocks.registrationScope.mockResolvedValue(eventScope);
  mocks.reportsScope.mockResolvedValue(eventScope);
  mocks.responsesOrgScope.mockResolvedValue({
    ok: true,
    organizationId: "org-1",
    userId: "owner@example.com",
  });
  mocks.loadRosterPage.mockResolvedValue({ rows: [] });
  mocks.listAdminFormDataForEvent.mockResolvedValue([]);
  mocks.listAdminFormDataForOrganization.mockResolvedValue([]);
  mocks.resolveResponseTicketLabels.mockResolvedValue(new Map());
  mocks.getAdminEventsForOrganization.mockResolvedValue([]);
  mocks.getAdminEventForOrganization.mockResolvedValue({ id: EVENT_ID, name: "Summit" });
  mocks.loadRegistrationOverviewExport.mockResolvedValue([]);
  mocks.loadOrderTransactionsExport.mockResolvedValue([]);
  mocks.loadAbandonedRegistrationsExport.mockResolvedValue([]);
  mocks.loadCheckinHistoryExport.mockResolvedValue([]);
  mocks.loadEmailOverviewExport.mockResolvedValue([]);
});

describe.each(routes)("%s export rate limit", (_name, callRoute) => {
  it("allows ten CSV exports, then returns the standard 429 before loading", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await callRoute();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
    }

    const response = await callRoute();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    await expect(response.json()).resolves.toEqual({
      error: "Too many exports — wait a moment.",
    });
  });
});

it("does not share a budget between export routes", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) await attendeesExport(request, context());
  expect((await attendeesExport(request, context())).status).toBe(429);
  expect((await eventResponsesExport(request, context())).status).toBe(200);
});

it("does not share an event-export budget between organizations", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) await attendeesExport(request, context());
  expect((await attendeesExport(request, context())).status).toBe(429);

  mocks.registrationScope.mockResolvedValue({
    ok: true,
    organizationId: "org-2",
    userId: "owner@example.com",
    event: { id: EVENT_ID, name: "Summit" },
  });
  expect((await attendeesExport(request, context())).status).toBe(200);
});

it("does not share an event-export budget between users", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1)
    await attendeesExport(request, context());
  expect((await attendeesExport(request, context())).status).toBe(429);

  mocks.registrationScope.mockResolvedValue({
    ok: true,
    organizationId: "org-1",
    userId: "another-owner@example.com",
    event: { id: EVENT_ID, name: "Summit" },
  });
  expect((await attendeesExport(request, context())).status).toBe(200);
});

it("does not share a workspace responses export budget between users", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1)
    await workspaceResponsesExport(request);
  expect((await workspaceResponsesExport(request)).status).toBe(429);

  mocks.responsesOrgScope.mockResolvedValue({
    ok: true,
    organizationId: "org-1",
    userId: "another-owner@example.com",
  });
  expect((await workspaceResponsesExport(request)).status).toBe(200);
});
