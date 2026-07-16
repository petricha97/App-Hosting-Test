/**
 * M7-T1 — Reports server page (Promise.allSettled independence, spec §5 /
 * design §3): a failure in ONE card's data loader must never blank the
 * OTHER (unrelated) card's real content, and an unknown/cross-org event
 * must 404 via notFound() (spec §7 AC-2/AC-3).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getDashboardScope.mockResolvedValue({ organizationId: "org-1" });
  getAdminEventForOrganization.mockResolvedValue({ id: "evt-1" });
});

function renderPage() {
  return EventReportsPage({
    params: Promise.resolve({ eventId: "evt-1" }),
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
