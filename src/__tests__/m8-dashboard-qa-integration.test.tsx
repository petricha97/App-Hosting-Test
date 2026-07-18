import { render, screen, within } from "@testing-library/react";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
const getDashboardScope = vi.fn();
const getAdminEventsForOrganization = vi.fn();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
vi.mock("@/features/dashboard/server/get-dashboard-scope", () => ({
  getDashboardScope: () => getDashboardScope(),
}));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventsForOrganization: (...args: unknown[]) =>
    getAdminEventsForOrganization(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { default: DashboardOverviewPage } = await import(
  "@/app/dashboard/(workspace)/page"
);
const { loadWorkspaceSummary } = await import(
  "@/features/dashboard/server/load-workspace-summary"
);
const { OrganizationEventOverview } = await import(
  "@/features/dashboard/components/organization-event-overview"
);
const { serializeEvent, serializeEvents } = await import(
  "@/features/event/utils"
);

function event(id: string, name: string, status: "Draft" | "Published") {
  return {
    id,
    name,
    status,
    allowOverlap: false,
    capacity: 100,
    description: "QA event",
    expectedGuests: 50,
    formPath: "Form/form-qa",
    invoicePath: "Invoice/invoice-qa",
    organizationPath: "Organization/org-qa",
    pageMode: "default" as const,
    redirectUrl: "",
    timezone: "Asia/Singapore",
    periods: [],
    createdAt: Timestamp.fromMillis(1_000),
    updatedAt: Timestamp.fromMillis(2_000),
  };
}

function seedAttendee(id: string, eventId: string, status = "accepted") {
  fake.store.set(`Attendee/${id}`, {
    organizationId: "org-qa",
    eventId,
    status,
  });
}

function seedPath(id: string, eventId: string, currency = "USD") {
  fake.store.set(`RegistrationPath/${id}`, {
    organizationId: "org-qa",
    eventId,
    currency,
  });
}

function seedOrder(
  id: string,
  eventId: string,
  totalMinor: number,
  currency = "USD",
  paymentStatus = "paid",
) {
  fake.store.set(`Order/${id}`, {
    organizationId: "org-qa",
    eventId,
    currency,
    paymentStatus,
    amounts: { totalMinor },
  });
}

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  getDashboardScope.mockResolvedValue({
    organizationId: "org-qa",
    organization: { name: "QA Workspace" },
  });
});

describe("M8-T2 QA — real page/DAL/orchestrator integration", () => {
  it("renders hand-computed metrics from seeded two-event Firestore fixtures", async () => {
    const events = [
      event("evt-new", "New Draft", "Draft"),
      event("evt-live", "Live Summit", "Published"),
    ];
    getAdminEventsForOrganization.mockResolvedValue(events);
    seedAttendee("a-1", "evt-new");
    seedAttendee("a-2", "evt-live");
    seedAttendee("a-cancelled", "evt-live", "cancelled");
    seedPath("p-1", "evt-new");
    seedPath("p-2", "evt-live");
    seedOrder("o-1", "evt-new", 12345);
    seedOrder("o-2", "evt-live", 87655);
    seedOrder("o-pending", "evt-live", 999999, "USD", "pending");

    render(await DashboardOverviewPage());

    expect(getAdminEventsForOrganization).toHaveBeenCalledWith("org-qa");
    expect(screen.getAllByText("01")).toHaveLength(2);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("$1,000.00")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /open "new draft"/i })
        .getAttribute("href"),
    ).toBe("/dashboard/events/evt-new");
  });

  it("renders real non-zero event counts with zero registrations, paths, and orders", async () => {
    getAdminEventsForOrganization.mockResolvedValue([
      event("evt-draft", "Draft Only", "Draft"),
    ]);

    render(await DashboardOverviewPage());

    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("00")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("$0")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /open "draft only"/i })
        .getAttribute("href"),
    ).toBe("/dashboard/events/evt-draft");
  });

  it("excludes a paid order whose currency has no registration path", async () => {
    seedPath("p-usd", "evt-1", "USD");
    seedOrder("o-usd", "evt-1", 2500, "USD");
    seedOrder("o-orphan-gbp", "evt-1", 900000, "GBP");

    const summary = await loadWorkspaceSummary({
      organizationId: "org-qa",
      events: [event("evt-1", "Only Event", "Published")],
    });

    expect(summary.revenue).toEqual({
      kind: "single",
      currency: "USD",
      paidMinor: 2500,
    });
  });

  it("targets the sole event at one event and the first sorted result at multiple events", async () => {
    const only = event("evt-only", "Only Event", "Published");
    expect(
      (
        await loadWorkspaceSummary({
          organizationId: "org-qa",
          events: [only],
        })
      ).quickActionEvent,
    ).toBe(only);

    const recent = event("evt-recent", "Recently Updated", "Draft");
    const older = event("evt-older", "Older Published", "Published");
    expect(
      (
        await loadWorkspaceSummary({
          organizationId: "org-qa",
          events: [recent, older],
        })
      ).quickActionEvent,
    ).toBe(recent);
  });

  it("renders both aggregate failures locally while preserving unaffected content", () => {
    const events = [event("evt-draft", "Still Usable", "Draft")];
    render(
      <OrganizationEventOverview
        initialEvents={serializeEvents(events)}
        summary={{
          draftCount: 1,
          publishedCount: 0,
          registrations: { loadError: true },
          revenue: { loadError: true },
          quickActionEvent: serializeEvent(events[0]),
        }}
        workspaceName="QA Workspace"
      />,
    );

    expect(screen.getAllByText("Couldn't load")).toHaveLength(2);
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("00")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open "still usable"/i })).toBeTruthy();
    const setup = screen.getByText("Setup notes").closest('[data-slot="card"]');
    expect(setup).toBeTruthy();
    expect(within(setup as HTMLElement).getByText("Reports")).toBeTruthy();
  });
});
