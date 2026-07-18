// @vitest-environment node
/**
 * M8-T2 — workspace dashboard summary orchestration.
 * Spec: agents/docs/design/m8-dashboard-metrics.md §11.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Timestamp } from "firebase-admin/firestore";

import type { EventDoc, WithId } from "@/types/collection";

const countAdminAttendeesForOrganization = vi.fn();
const sumAdminOrderTotalsForOrganization = vi.fn();
const getAdminRegistrationPathsForOrganization = vi.fn();

vi.mock("@/lib/db/adminAttendee", () => ({
  countAdminAttendeesForOrganization: (...args: unknown[]) =>
    countAdminAttendeesForOrganization(...args),
}));
vi.mock("@/lib/db/adminOrder", () => ({
  sumAdminOrderTotalsForOrganization: (...args: unknown[]) =>
    sumAdminOrderTotalsForOrganization(...args),
}));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathsForOrganization: (...args: unknown[]) =>
    getAdminRegistrationPathsForOrganization(...args),
}));

const { loadWorkspaceSummary } = await import(
  "@/features/dashboard/server/load-workspace-summary"
);

const ORG_ID = "org-1";

function event(id: string, status: EventDoc["status"]): WithId<EventDoc> {
  return {
    id,
    allowOverlap: false,
    capacity: 100,
    createdAt: Timestamp.fromMillis(1_000),
    description: "",
    expectedGuests: 100,
    formPath: "",
    invoicePath: "",
    name: `Event ${id}`,
    organizationPath: `Organization/${ORG_ID}`,
    pageMode: "default",
    redirectUrl: "",
    periods: [],
    status,
    timezone: "UTC",
    updatedAt: Timestamp.fromMillis(2_000),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadWorkspaceSummary", () => {
  it("returns the exact single-currency UI contract shape", async () => {
    countAdminAttendeesForOrganization.mockResolvedValue(40);
    getAdminRegistrationPathsForOrganization.mockResolvedValue([
      { id: "p-1", currency: "USD" },
      { id: "p-2", currency: "USD" },
    ]);
    sumAdminOrderTotalsForOrganization.mockResolvedValue(7425000);

    const events = [
      event("evt-recent", "Published"),
      event("evt-draft", "Draft"),
      event("evt-draft-2", "Draft"),
    ];
    const summary = await loadWorkspaceSummary({
      organizationId: ORG_ID,
      events,
    });

    expect(summary).toEqual({
      draftCount: 2,
      publishedCount: 1,
      registrations: { value: 40 },
      revenue: { kind: "single", currency: "USD", paidMinor: 7425000 },
      quickActionEvent: events[0],
    });
    expect(countAdminAttendeesForOrganization).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      status: "accepted",
    });
    expect(sumAdminOrderTotalsForOrganization).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      paymentStatus: "paid",
      currency: "USD",
      field: "totalMinor",
    });
  });

  it("returns the primary currency headline and other currency totals for multi-currency orgs", async () => {
    countAdminAttendeesForOrganization.mockResolvedValue(7);
    getAdminRegistrationPathsForOrganization.mockResolvedValue([
      { id: "p-gbp-1", currency: "GBP" },
      { id: "p-usd-1", currency: "USD" },
      { id: "p-gbp-2", currency: "GBP" },
      { id: "p-eur-1", currency: "EUR" },
    ]);
    sumAdminOrderTotalsForOrganization.mockImplementation(
      async ({ currency }: { currency: string }) => {
        const totals: Record<string, number> = {
          EUR: 900,
          GBP: 2000,
          USD: 1000,
        };
        return totals[currency];
      },
    );

    const summary = await loadWorkspaceSummary({
      organizationId: ORG_ID,
      events: [event("evt-1", "Published")],
    });

    expect(summary.revenue).toEqual({
      kind: "multi",
      primaryCurrency: "GBP",
      primaryPaidMinor: 2000,
      otherCurrencies: [
        { currency: "EUR", paidMinor: 900 },
        { currency: "USD", paidMinor: 1000 },
      ],
    });
  });

  it("breaks primary-currency registration-path count ties alphabetically", async () => {
    countAdminAttendeesForOrganization.mockResolvedValue(7);
    getAdminRegistrationPathsForOrganization.mockResolvedValue([
      { id: "p-usd-1", currency: "USD" },
      { id: "p-gbp-1", currency: "GBP" },
    ]);
    sumAdminOrderTotalsForOrganization.mockImplementation(
      async ({ currency }: { currency: string }) =>
        currency === "GBP" ? 2000 : 1000,
    );

    const summary = await loadWorkspaceSummary({
      organizationId: ORG_ID,
      events: [event("evt-1", "Published")],
    });

    expect(summary.revenue).toMatchObject({
      kind: "multi",
      primaryCurrency: "GBP",
      primaryPaidMinor: 2000,
    });
  });

  it("returns zero-currency revenue and null quickActionEvent for an org with no paths or events", async () => {
    countAdminAttendeesForOrganization.mockResolvedValue(0);
    getAdminRegistrationPathsForOrganization.mockResolvedValue([]);

    const summary = await loadWorkspaceSummary({
      organizationId: ORG_ID,
      events: [],
    });

    expect(summary).toEqual({
      draftCount: 0,
      publishedCount: 0,
      registrations: { value: 0 },
      revenue: { kind: "zero-currency" },
      quickActionEvent: null,
    });
    expect(sumAdminOrderTotalsForOrganization).not.toHaveBeenCalled();
  });

  it("keeps revenue when the registrations aggregate fails", async () => {
    countAdminAttendeesForOrganization.mockRejectedValue(new Error("boom"));
    getAdminRegistrationPathsForOrganization.mockResolvedValue([
      { id: "p-1", currency: "USD" },
    ]);
    sumAdminOrderTotalsForOrganization.mockResolvedValue(1234);

    const summary = await loadWorkspaceSummary({
      organizationId: ORG_ID,
      events: [event("evt-1", "Draft")],
    });

    expect(summary.registrations).toEqual({ loadError: true });
    expect(summary.revenue).toEqual({
      kind: "single",
      currency: "USD",
      paidMinor: 1234,
    });
  });

  it("keeps registrations when the revenue aggregate path fails", async () => {
    countAdminAttendeesForOrganization.mockResolvedValue(12);
    getAdminRegistrationPathsForOrganization.mockResolvedValue([
      { id: "p-1", currency: "USD" },
    ]);
    sumAdminOrderTotalsForOrganization.mockRejectedValue(new Error("boom"));

    const summary = await loadWorkspaceSummary({
      organizationId: ORG_ID,
      events: [event("evt-1", "Draft")],
    });

    expect(summary.registrations).toEqual({ value: 12 });
    expect(summary.revenue).toEqual({ loadError: true });
  });
});
