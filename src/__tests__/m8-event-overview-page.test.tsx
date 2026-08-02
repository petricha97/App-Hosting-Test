import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardScope = vi.fn();
const getEvent = vi.fn();
const loadOverview = vi.fn();
const statusProps = vi.fn();

vi.mock("@/features/dashboard/server/get-dashboard-scope", () => ({ getDashboardScope: () => getDashboardScope() }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization: (...args: unknown[]) => getEvent(...args) }));
vi.mock("@/features/event/overview/event-overview-loader", () => ({ loadEventOverview: (...args: unknown[]) => loadOverview(...args) }));
vi.mock("@/features/event/utils", () => ({ serializeEvent: (value: unknown) => value, getEventBarDateLabel: () => "July 19" }));
vi.mock("@/features/dashboard/components/event-status-actions", () => ({
  EventStatusActions: (props: { eventId: string; status: string }) => { statusProps(props); return <button>Publish event</button>; },
}));
vi.mock("@/features/event/components/event-shell", () => ({
  EventShell: ({ children, statusAction }: { children?: React.ReactNode; statusAction?: React.ReactNode }) => <div>{statusAction}{children}</div>,
}));

const { default: Page } = await import("@/app/dashboard/(event)/events/[eventId]/page");
const { default: Layout } = await import("@/app/dashboard/(event)/events/[eventId]/layout");

const event = { id: "evt-1", name: "Summit", status: "Draft", organizationPath: "Organization/org-1", timezone: "Asia/Singapore", periods: [], registrationPeriod: null, publishedAt: null, page: null, pageMode: "default", eventPagePath: "", formPath: "form/path", description: "", allowOverlap: false, expectedGuests: 0, capacity: 0, redirectUrl: "", createdAt: null, updatedAt: null };
const overview = { event, registered: { value: 1 }, invited: { value: 2 }, revenue: { kind: "unconfigured" }, abandoned: { value: 0 }, identity: { category: "Not set", timezone: "Asia/Singapore", visibility: "Private (draft)", paths: { active: 0, total: 0, methods: [] } }, readiness: [] };

beforeEach(() => {
  vi.clearAllMocks();
  getDashboardScope.mockResolvedValue({ organizationId: "org-1", userDoc: { permissions: ["write:events"] } });
  getEvent.mockResolvedValue(event);
  loadOverview.mockResolvedValue(overview);
});

async function renderPage() {
  render(await Page({ params: Promise.resolve({ eventId: "evt-1" }) }));
}

async function renderResolvedLayout() {
  const layout = await Layout({ params: Promise.resolve({ eventId: "evt-1" }), children: <div>Body</div> });
  const content = layout.props.children as React.ReactElement;
  const resolveContent = content.type as (props: typeof content.props) => Promise<React.ReactElement>;
  render(await resolveContent(content.props));
}

describe("Dashboard event overview page wiring", () => {
  it("passes exact overview inputs", async () => {
    await renderPage();
    expect(getEvent).toHaveBeenCalledWith("evt-1", "org-1");
    expect(loadOverview).toHaveBeenCalledWith({ event, eventId: "evt-1", organizationId: "org-1" });
  });

  it("retains all diagnostics values and every page-mode description", async () => {
    await renderPage();
    expect(screen.getByText("Organization/org-1")).toBeTruthy();
    expect(screen.getByText("Default public event page is enabled.")).toBeTruthy();
    expect(screen.getByText("Scheduling overlap is blocked.")).toBeTruthy();

    for (const [pageMode, redirectUrl, expected] of [
      ["redirect", "https://example.com/register", "Redirect to https://example.com/register"],
      ["redirect", "", "Redirect to missing URL"],
      ["custom", "", "Custom event page builder is enabled."],
    ] as const) {
      getEvent.mockResolvedValueOnce({ ...event, pageMode, redirectUrl });
      loadOverview.mockResolvedValueOnce(overview);
      const view = render(await Page({ params: Promise.resolve({ eventId: "evt-1" }) }));
      expect(screen.getByText(expected)).toBeTruthy();
      view.unmount();
    }
  });

  it("retains the five Quick-action hrefs", async () => {
    await renderPage();
    const actions = within(screen.getByRole("region", { name: "Quick actions" }));
    for (const [name, route] of [["Open Page Builder", "page-builder"], ["Edit Registration Form", "form"], ["Manage Ticket Types", "tickets"], ["View Attendees", "attendees"], ["Set up Check-in", "checkin"]]) {
      expect(actions.getByRole("link", { name }).getAttribute("href")).toBe(`/dashboard/events/evt-1/${route}`);
    }
  });

  it("shows the status action for writers with exact event/status props", async () => {
    await renderResolvedLayout();
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish event" })).toBeTruthy());
    expect(statusProps).toHaveBeenCalledWith({ eventId: "evt-1", status: "Draft" });
  });

  it("omits the status action for viewers", async () => {
    getDashboardScope.mockResolvedValue({ organizationId: "org-1", userDoc: { permissions: ["read:events"] } });
    await renderResolvedLayout();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish event" })).toBeNull();
    expect(statusProps).not.toHaveBeenCalled();
  });
});
