/**
 * M7-T1 — Reports server page (Promise.allSettled independence, spec §5 /
 * design §3): a failure in ONE card's data loader must never blank the
 * OTHER (unrelated) card's real content, and an unknown/cross-org event
 * must 404 via notFound() (spec §7 AC-2/AC-3).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const getDashboardScope = vi.fn();
const getAdminEventForOrganization = vi.fn();
const loadTicketTypeRegistrations = vi.fn();
const loadFinanceSummary = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/features/dashboard/server/get-dashboard-scope", () => ({
  getDashboardScope: () => getDashboardScope(),
}));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventForOrganization: (...args: unknown[]) =>
    getAdminEventForOrganization(...args),
}));
vi.mock("@/features/reports/server/load-ticket-type-registrations", () => ({
  loadTicketTypeRegistrations: (...args: unknown[]) =>
    loadTicketTypeRegistrations(...args),
}));
vi.mock("@/features/reports/server/load-finance-summary", () => ({
  loadFinanceSummary: (...args: unknown[]) => loadFinanceSummary(...args),
}));
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { default: EventReportsPage } =
  await import("@/app/dashboard/(event)/events/[eventId]/reports/page");

beforeEach(() => {
  vi.clearAllMocks();
  getDashboardScope.mockResolvedValue({
    organizationId: "org-1",
    userDoc: {
      email: "organizer@example.com",
      permissions: ["write:events"],
    },
  });
  getAdminEventForOrganization.mockResolvedValue({
    id: "evt-1",
    timezone: "America/New_York",
  });
});

function renderPage(searchParams: Record<string, string> = {}) {
  return EventReportsPage({
    params: Promise.resolve({ eventId: "evt-1" }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("EventReportsPage — per-card independent degradation", () => {
  it("renders the finance card's real content when the ticket-type loader throws", async () => {
    loadTicketTypeRegistrations.mockRejectedValue(new Error("boom"));
    loadFinanceSummary.mockResolvedValue({
      currencies: [
        {
          currency: "USD",
          paidMinor: 12345,
          outstandingMinor: 0,
          compedMinor: 0,
        },
      ],
      discountCodesUsed: 2,
    });

    const jsx = await renderPage();
    render(jsx);

    // Chart card degrades to its own error panel...
    expect(
      screen.getByText("Couldn't load ticket-type registrations"),
    ).toBeTruthy();
    // ...while the (unrelated) finance card renders its REAL numbers, not a
    // blank hole and not an error panel.
    expect(screen.queryByText("Couldn't load finance data")).toBeNull();
    expect(screen.getByText("$123.45")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("renders the ticket-type card's real content when the finance loader throws", async () => {
    loadTicketTypeRegistrations.mockResolvedValue([
      { label: "Standard", count: 42 },
    ]);
    loadFinanceSummary.mockRejectedValue(new Error("boom"));

    const jsx = await renderPage();
    render(jsx);

    expect(screen.getByText("Couldn't load finance data")).toBeTruthy();
    expect(
      screen.queryByText("Couldn't load ticket-type registrations"),
    ).toBeNull();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("renders both cards' real content when both loaders succeed", async () => {
    loadTicketTypeRegistrations.mockResolvedValue([
      { label: "Standard", count: 42 },
    ]);
    loadFinanceSummary.mockResolvedValue({
      currencies: [
        {
          currency: "USD",
          paidMinor: 100,
          outstandingMinor: 0,
          compedMinor: 0,
        },
      ],
      discountCodesUsed: 0,
    });

    const jsx = await renderPage();
    render(jsx);

    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("$1.00")).toBeTruthy();
  });
});

describe("EventReportsPage — tenancy (spec §7)", () => {
  it("404s via notFound() when the event does not resolve for this org", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadTicketTypeRegistrations).not.toHaveBeenCalled();
    expect(loadFinanceSummary).not.toHaveBeenCalled();
  });
});

describe("EventReportsPage — M7-T3 Schedule button permission gate (spec §1 AC-4)", () => {
  it("renders an enabled Schedule button for a write:events holder", async () => {
    const jsx = await renderPage();
    render(jsx);

    const button = screen.getByRole("button", { name: /schedule/i });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("renders a disabled Schedule button with a tooltip for a member WITHOUT write:events", async () => {
    getDashboardScope.mockResolvedValue({
      organizationId: "org-1",
      userDoc: {
        email: "viewer@example.com",
        permissions: ["view:events"], // no write:events
      },
    });

    const jsx = await renderPage();
    render(jsx);

    const button = screen.getByRole("button", { name: /schedule/i });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});

describe("EventReportsPage — M7-T3 ?template= deep link (spec §1 AC-3)", () => {
  beforeEach(() => {
    loadTicketTypeRegistrations.mockResolvedValue([]);
    loadFinanceSummary.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ rows: [], nextCursorMs: null, hasMore: false }),
            { status: 200 },
          ),
        ),
    );
  });

  it("opens the matching template's Run panel already expanded", async () => {
    const jsx = await renderPage({ template: "registration-overview" });
    render(jsx);

    expect(
      screen.getByRole("region", {
        name: /registration overview — report output/i,
      }),
    ).toBeTruthy();
  });

  it("ignores an unknown ?template= value (no panel opens, no crash)", async () => {
    const jsx = await renderPage({ template: "not-a-real-template" });
    render(jsx);

    expect(screen.queryByRole("region", { name: /report output/i })).toBeNull();
  });

  it("renders with no panel open when ?template= is absent", async () => {
    const jsx = await renderPage();
    render(jsx);

    expect(screen.queryByRole("region", { name: /report output/i })).toBeNull();
  });
});
