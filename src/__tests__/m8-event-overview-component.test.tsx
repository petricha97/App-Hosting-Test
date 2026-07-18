import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventOverviewStats } from "@/features/event/overview/event-overview-stats";
import { EventIdentity } from "@/features/event/overview/event-identity";
import { PublicReadiness } from "@/features/event/overview/public-readiness";
import type { EventOverviewData, EventOverviewReadinessEntry } from "@/features/event/overview/event-overview-types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function data(overrides: Partial<EventOverviewData> = {}): EventOverviewData {
  return {
    event: { id: "evt-1" } as EventOverviewData["event"],
    registered: { value: 12 },
    invited: { value: 9 },
    revenue: { kind: "currencies", amounts: [{ currency: "USD", paidMinor: 12345 }] },
    abandoned: { value: 3 },
    identity: { category: "Not set", timezone: "Asia/Singapore", visibility: "Public", paths: { active: 2, total: 3, methods: ["card", "invoice"] } },
    readiness: [],
    ...overrides,
  };
}

const readinessIds = ["event-published", "custom-page-published", "registration-form-published", "ticket-types-pricing-set", "confirmation-email-active", "checkin-configured"] as const;
function readiness(state: "done" | "pending" | "unknown"): EventOverviewReadinessEntry[] {
  return readinessIds.map((id, index) => ({ id, state, label: state === "pending" ? [`Event not published`, `Custom page not published`, `Registration form not published`, `Ticket types & pricing not set`, `Confirmation email not active`, `Check-in not configured`][index] : [`Event published`, `Custom page published`, `Registration form published`, `Ticket types & pricing set`, `Confirmation email active`, `Check-in configured`][index], detail: state === "unknown" ? "Unable to verify. Retry or open settings." : "Detail", ...(state === "done" ? {} : { href: `/dashboard/events/evt-1/${["edit", "page-builder", "form", "tickets", "emails", "checkin"][index]}` }) }));
}

describe("M8 event overview components", () => {
  it("renders four stat values in order with ordinary zero and stacked alphabetical currencies", () => {
    render(<EventOverviewStats eventId="evt-1" data={data({ registered: { value: 0 }, revenue: { kind: "currencies", amounts: [{ currency: "USD", paidMinor: 38000 }, { currency: "SGD", paidMinor: 124000 }] } })} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual(["Registered", "Invited", "Revenue", "Abandoned"]);
    expect(screen.getByText("0")).toBeTruthy();
    const revenue = screen.getByRole("heading", { name: "Revenue" }).closest("div")?.parentElement;
    expect(revenue?.textContent?.indexOf("SGD")).toBeLessThan(revenue?.textContent?.indexOf("USD") ?? 0);
    expect(screen.getByText(/SGD.*1,240\.00/)).toBeTruthy();
    expect(screen.getByText("$380.00")).toBeTruthy();
  });

  it("renders revenue unconfigured and every stat-card error independently", () => {
    const { rerender } = render(<EventOverviewStats eventId="evt-1" data={data({ revenue: { kind: "unconfigured" } })} />);
    expect(screen.getByText("No payment currency configured")).toBeTruthy();
    rerender(<EventOverviewStats eventId="evt-1" data={data({ registered: { loadError: true }, invited: { loadError: true }, revenue: { loadError: true }, abandoned: { loadError: true } })} />);
    expect(screen.getAllByText("Couldn't load")).toHaveLength(4);
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    expect(refresh).toHaveBeenCalled();
  });

  it("renders all five real identity rows and path degradation", () => {
    const { rerender } = render(<EventIdentity data={data()} />);
    expect(screen.getAllByRole("term").map((node) => node.textContent)).toEqual(["Category", "Timezone", "Visibility", "Registration", "Payment"]);
    expect(screen.getByText("Open · 2 active / 3 paths")).toBeTruthy();
    expect(screen.getByText("Simulated · Card + Invoice")).toBeTruthy();
    rerender(<EventIdentity data={data({ identity: { category: "Not set", timezone: "Asia/Singapore", visibility: "Private (draft)", paths: { loadError: true } } })} />);
    expect(screen.getAllByText("Unable to load")).toHaveLength(2);
  });

  it("renders exactly six done and six explicit pending checklist states with deep links", () => {
    const { rerender } = render(<PublicReadiness readiness={readiness("done")} />);
    expect(screen.getByText("6 / 6 ready")).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    rerender(<PublicReadiness readiness={readiness("pending")} />);
    expect(screen.getByText("0 / 6 ready")).toBeTruthy();
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(within(list).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/dashboard/events/evt-1/edit", "/dashboard/events/evt-1/page-builder", "/dashboard/events/evt-1/form", "/dashboard/events/evt-1/tickets", "/dashboard/events/evt-1/emails", "/dashboard/events/evt-1/checkin"]);
    expect(screen.getByText("Check-in not configured")).toBeTruthy();
  });
});
