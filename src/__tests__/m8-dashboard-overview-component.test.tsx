import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OrganizationEventOverview } from "@/features/dashboard/components/organization-event-overview";
import type { WorkspaceSummary } from "@/features/dashboard/server/load-workspace-summary";
import type { SerializedEvent } from "@/features/event/utils";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function eventFixture(
  overrides: Partial<SerializedEvent> & { id: string; name: string },
): SerializedEvent {
  const { id, name, ...rest } = overrides;

  return {
    id,
    name,
    status: rest.status ?? "Draft",
    organizationPath: "Organization/org-1",
    timezone: "America/New_York",
    periods: rest.periods ?? [],
    registrationPeriod: null,
    publishedAt: null,
    page: null,
    createdAt: null,
    updatedAt: null,
    ...rest,
  } as SerializedEvent;
}

function summaryFixture(
  overrides: Partial<Omit<WorkspaceSummary, "quickActionEvent">> & {
    quickActionEvent?: SerializedEvent | null;
  } = {},
) {
  return {
    draftCount: 2,
    publishedCount: 1,
    registrations: { value: 40 },
    revenue: { kind: "single", currency: "USD", paidMinor: 50000 },
    quickActionEvent: eventFixture({
      id: "evt-new",
      name: "Design Breakfast",
      status: "Draft",
    }),
    ...overrides,
  } satisfies Omit<WorkspaceSummary, "quickActionEvent"> & {
    quickActionEvent: SerializedEvent | null;
  };
}

function renderOverview(
  summary: ReturnType<typeof summaryFixture> = summaryFixture(),
  events: SerializedEvent[] = [
    eventFixture({ id: "evt-new", name: "Design Breakfast" }),
    eventFixture({ id: "evt-old", name: "Older Summit", status: "Published" }),
  ],
) {
  refresh.mockClear();
  render(
    <OrganizationEventOverview
      initialEvents={events}
      summary={summary}
      workspaceName="Acme"
    />,
  );
}

describe("OrganizationEventOverview — stat cards", () => {
  it("renders the four prototype cards in order with real values", () => {
    renderOverview();

    const cards = screen.getAllByText(
      /Draft Events|Published Events|Registrations|Revenue \(paid\)/,
    );
    expect(cards.map((card) => card.textContent)).toEqual([
      "Draft Events",
      "Published Events",
      "Registrations",
      "Revenue (paid)",
    ]);
    expect(screen.getByText("02")).toBeTruthy();
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.getByText("$500.00")).toBeTruthy();
    expect(screen.queryByText("Total events")).toBeNull();
    expect(screen.queryByText("Active forms")).toBeNull();
    expect(screen.queryByText("TBD")).toBeNull();
  });

  it("renders zero-padded event counts but plain registrations and zero-currency revenue", () => {
    renderOverview(
      summaryFixture({
        draftCount: 0,
        publishedCount: 0,
        registrations: { value: 0 },
        revenue: { kind: "zero-currency" },
        quickActionEvent: null,
      }),
      [],
    );

    expect(screen.getAllByText("00")).toHaveLength(2);
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("$0")).toBeTruthy();
  });

  it("degrades registrations independently with retry", () => {
    renderOverview(
      summaryFixture({
        registrations: { loadError: true },
        revenue: { kind: "single", currency: "USD", paidMinor: 12345 },
      }),
    );

    const registrationsCard = screen.getByText("Registrations").closest("div");
    expect(screen.getByText("$123.45")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Couldn't load")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(registrationsCard).toBeTruthy();
  });

  it("renders all revenue shapes without blending currencies", () => {
    const { rerender } = render(
      <OrganizationEventOverview
        initialEvents={[]}
        summary={summaryFixture({
          revenue: { kind: "single", currency: "GBP", paidMinor: 842000 },
          quickActionEvent: null,
        })}
      />,
    );
    expect(screen.getByText("£8,420.00")).toBeTruthy();

    rerender(
      <OrganizationEventOverview
        initialEvents={[]}
        summary={summaryFixture({
          revenue: {
            kind: "multi",
            primaryCurrency: "USD",
            primaryPaidMinor: 10000,
            otherCurrencies: [{ currency: "GBP", paidMinor: 842000 }],
          },
          quickActionEvent: null,
        })}
      />,
    );
    expect(screen.getByText("$100.00")).toBeTruthy();
    expect(
      screen.getByText("+ GBP 8,420 paid in other currencies"),
    ).toBeTruthy();
    expect(screen.queryByText("$8,520.00")).toBeNull();

    rerender(
      <OrganizationEventOverview
        initialEvents={[]}
        summary={summaryFixture({
          revenue: {
            kind: "multi",
            primaryCurrency: "USD",
            primaryPaidMinor: 10000,
            otherCurrencies: [
              { currency: "EUR", paidMinor: 20000 },
              { currency: "GBP", paidMinor: 30000 },
            ],
          },
          quickActionEvent: null,
        })}
      />,
    );
    expect(screen.getByText("+ 2 other currencies")).toBeTruthy();

    rerender(
      <OrganizationEventOverview
        initialEvents={[]}
        summary={summaryFixture({
          revenue: { loadError: true },
          quickActionEvent: null,
        })}
      />,
    );
    expect(screen.getByText("Revenue (paid)")).toBeTruthy();
    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });
});

describe("OrganizationEventOverview — quick actions and setup notes", () => {
  it("renders event-scoped quick actions for the selected event", () => {
    renderOverview();

    expect(
      screen
        .getByRole("link", { name: /open "design breakfast"/i })
        .getAttribute("href"),
    ).toBe("/dashboard/events/evt-new");
    expect(
      screen
        .getByRole("link", { name: /add ticket types/i })
        .getAttribute("href"),
    ).toBe("/dashboard/events/evt-new/tickets");
    expect(
      screen
        .getByRole("link", { name: /set pricing & discounts/i })
        .getAttribute("href"),
    ).toBe("/dashboard/events/evt-new/pricing");
    expect(
      screen
        .getByRole("link", { name: /configure emails/i })
        .getAttribute("href"),
    ).toBe("/dashboard/events/evt-new/emails");
    expect(
      screen
        .getByRole("link", { name: /set up check-in/i })
        .getAttribute("href"),
    ).toBe("/dashboard/events/evt-new/checkin");
  });

  it("collapses quick actions to one create CTA when there are zero events", () => {
    renderOverview(
      summaryFixture({ quickActionEvent: null }),
      [],
    );

    const quickActions = screen
      .getByText("Quick actions")
      .closest('[data-slot="card"]');
    expect(quickActions).toBeTruthy();
    expect(
      within(quickActions as HTMLElement).getByRole("link", {
        name: "Create your first event",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /add ticket types/i })).toBeNull();
  });

  it("renders byte-identical static non-linked setup notes copy", () => {
    const { rerender } = render(
      <OrganizationEventOverview
        initialEvents={[]}
        summary={summaryFixture({
          draftCount: 0,
          publishedCount: 0,
          registrations: { value: 0 },
          revenue: { kind: "zero-currency" },
          quickActionEvent: null,
        })}
        workspaceName="Acme"
      />,
    );

    const zeroEventSetupCard = screen
      .getByText("Setup notes")
      .closest('[data-slot="card"]');
    expect(zeroEventSetupCard).toBeTruthy();
    const zeroEventCopy = zeroEventSetupCard?.textContent;

    rerender(
      <OrganizationEventOverview
        initialEvents={[eventFixture({ id: "evt-1", name: "Summit" })]}
        summary={summaryFixture({ registrations: { value: 40 } })}
        workspaceName="Acme"
      />,
    );

    const registeredSetupCard = screen
      .getByText("Setup notes")
      .closest('[data-slot="card"]');
    expect(registeredSetupCard).toBeTruthy();
    expect(registeredSetupCard?.textContent).toBe(zeroEventCopy);
    expect(
      within(registeredSetupCard as HTMLElement).queryByRole("link"),
    ).toBeNull();
    expect(screen.getByText("Ticket types")).toBeTruthy();
    expect(screen.getByText("Pricing & discount codes")).toBeTruthy();
    expect(screen.getByText("Registration types & paths")).toBeTruthy();
    expect(screen.getByText("Lifecycle emails")).toBeTruthy();
    expect(screen.getByText("On-site check-in / QR")).toBeTruthy();
    expect(screen.getByText("Reports")).toBeTruthy();
  });
});
