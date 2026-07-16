/**
 * M7-T1 — FinanceSummaryCard (design §2):
 *  - single-currency layout matches the prototype's flat 4-row shape;
 *  - multi-currency stacked sections render each currency independently,
 *    with the shared "Discount codes used" row appearing exactly once;
 *  - the zero-currency empty state links to Registration Paths;
 *  - the error state wires onRetry.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FinanceSummaryCard } from "@/features/reports/components/finance-summary-card";

describe("FinanceSummaryCard — single currency (spec §4 AC-1)", () => {
  it("renders the four rows flat, formatted via formatMoney", () => {
    render(
      <FinanceSummaryCard
        eventId="evt-1"
        data={{
          currencies: [
            {
              currency: "USD",
              paidMinor: 7425000,
              outstandingMinor: 500000,
              compedMinor: 12100000,
            },
          ],
          discountCodesUsed: 4,
        }}
        loadError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Paid (card)")).toBeTruthy();
    expect(screen.getByText("$74,250.00")).toBeTruthy();
    expect(screen.getByText("Outstanding (invoice)")).toBeTruthy();
    expect(screen.getByText("$5,000.00")).toBeTruthy();
    expect(screen.getByText("Comped value")).toBeTruthy();
    expect(screen.getByText("$121,000.00")).toBeTruthy();
    expect(screen.getByText("Discount codes used")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    // No currency eyebrow label in the single-currency case.
    expect(screen.queryByText("USD")).toBeNull();
  });

  it("renders a genuinely comped $0.00 as formatMoney, never 'Comp' text (design §2)", () => {
    render(
      <FinanceSummaryCard
        eventId="evt-1"
        data={{
          currencies: [
            {
              currency: "USD",
              paidMinor: 0,
              outstandingMinor: 0,
              compedMinor: 0,
            },
          ],
          discountCodesUsed: 0,
        }}
        loadError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("Comp")).toBeNull();
  });
});

describe("FinanceSummaryCard — multi-currency stacked sections (spec §4 AC-2, design §2)", () => {
  it("renders each currency's own scoped rows and the shared discount row exactly once", () => {
    render(
      <FinanceSummaryCard
        eventId="evt-1"
        data={{
          currencies: [
            {
              currency: "USD",
              paidMinor: 10000,
              outstandingMinor: 2000,
              compedMinor: 500,
            },
            {
              currency: "GBP",
              paidMinor: 30000,
              outstandingMinor: 0,
              compedMinor: 0,
            },
          ],
          discountCodesUsed: 3,
        }}
        loadError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("USD")).toBeTruthy();
    expect(screen.getByText("GBP")).toBeTruthy();
    expect(screen.getByText("$100.00")).toBeTruthy();
    expect(screen.getByText("£300.00")).toBeTruthy();

    // "Discount codes used" appears exactly ONCE, not per currency.
    expect(screen.getAllByText("Discount codes used")).toHaveLength(1);
    expect(screen.getAllByText("Paid (card)")).toHaveLength(2);
  });
});

describe("FinanceSummaryCard — zero-currency empty state (spec §4 AC-3)", () => {
  it("renders the empty state with a link to Registration Paths, not a crash", () => {
    render(
      <FinanceSummaryCard
        eventId="evt-1"
        data={null}
        loadError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("No pricing set up yet")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Go to Registration Paths" });
    expect(link.getAttribute("href")).toBe(
      "/dashboard/events/evt-1/registration-paths",
    );
  });
});

describe("FinanceSummaryCard — error state", () => {
  it("renders the retryable error panel and wires onRetry", () => {
    const onRetry = vi.fn();
    render(
      <FinanceSummaryCard
        eventId="evt-1"
        data={null}
        loadError={true}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Couldn't load finance data")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
