import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const getDashboardScope = vi.fn();
const getAdminEventsForOrganization = vi.fn();
const loadWorkspaceSummary = vi.fn();

vi.mock("@/features/dashboard/server/get-dashboard-scope", () => ({
  getDashboardScope: () => getDashboardScope(),
}));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventsForOrganization: (...args: unknown[]) =>
    getAdminEventsForOrganization(...args),
}));
vi.mock("@/features/dashboard/server/load-workspace-summary", () => ({
  loadWorkspaceSummary: (...args: unknown[]) => loadWorkspaceSummary(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { default: DashboardOverviewPage } = await import(
  "@/app/dashboard/(workspace)/page"
);

function rawEvent(overrides: Record<string, unknown>) {
  return {
    id: "evt-1",
    name: "Design Breakfast",
    status: "Published",
    organizationPath: "Organization/org-1",
    timezone: "America/New_York",
    periods: [],
    registrationPeriod: null,
    publishedAt: null,
    page: null,
    createdAt: null,
    updatedAt: { seconds: 100, nanoseconds: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDashboardScope.mockResolvedValue({
    organizationId: "org-1",
    organization: { name: "Acme" },
  });
});

describe("DashboardOverviewPage — workspace summary wiring", () => {
  it("passes scoped events into loadWorkspaceSummary and renders the returned summary", async () => {
    const events = [
      rawEvent({ id: "evt-new", name: "Design Breakfast" }),
      rawEvent({ id: "evt-old", name: "Older Summit", status: "Draft" }),
    ];
    getAdminEventsForOrganization.mockResolvedValue(events);
    loadWorkspaceSummary.mockResolvedValue({
      draftCount: 1,
      publishedCount: 1,
      registrations: { value: 12 },
      revenue: { kind: "single", currency: "USD", paidMinor: 9999 },
      quickActionEvent: events[0],
    });

    const jsx = await DashboardOverviewPage();
    render(jsx);

    expect(getAdminEventsForOrganization).toHaveBeenCalledWith("org-1");
    expect(loadWorkspaceSummary).toHaveBeenCalledWith({
      organizationId: "org-1",
      events,
    });
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("$99.99")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open "design breakfast"/i }),
    ).toBeTruthy();
  });

  it("renders WorkspaceLoadError when the initial event list read fails", async () => {
    getAdminEventsForOrganization.mockRejectedValue(new Error("firestore"));

    const jsx = await DashboardOverviewPage();
    render(jsx);

    expect(screen.getByText("Couldn't load workspace overview")).toBeTruthy();
    expect(loadWorkspaceSummary).not.toHaveBeenCalled();
  });

  it("rethrows the original dashboard-scope redirect", async () => {
    const redirect = { digest: "NEXT_REDIRECT;replace;/login;307;" };
    getDashboardScope.mockRejectedValue(redirect);

    await expect(DashboardOverviewPage()).rejects.toBe(redirect);

    expect(getAdminEventsForOrganization).not.toHaveBeenCalled();
    expect(loadWorkspaceSummary).not.toHaveBeenCalled();
  });
});
