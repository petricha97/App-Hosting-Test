/**
 * M7-T1 — TicketTypeBarChart / TicketTypeBarChartCard (design §1):
 *  - zero-count rows render muted/non-bold value text (never omitted);
 *  - non-zero rows render bold foreground value text;
 *  - the empty state (zero ticket types) links to the Tickets screen;
 *  - the error state wires onRetry.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TicketTypeBarChart } from "@/features/reports/components/ticket-type-bar-chart";
import { TicketTypeBarChartCard } from "@/features/reports/components/ticket-type-bar-chart-card";

describe("TicketTypeBarChart — zero-count row treatment (spec §1 AC-2 / OQ-3)", () => {
  it("renders a zero-count row's value as muted + non-bold, distinct from a non-zero row", () => {
    render(
      <TicketTypeBarChart
        rows={[
          { label: "Sold out", count: 97 },
          { label: "GC super early bird", count: 0 },
        ]}
      />,
    );

    const nonZeroValue = screen.getByText("97");
    expect(nonZeroValue.className).toContain("text-foreground");
    expect(nonZeroValue.className).not.toContain("text-muted-foreground");

    const zeroValue = screen.getByText("0");
    expect(zeroValue.className).toContain("text-muted-foreground");
    expect(zeroValue.className).toContain("font-normal");

    // The label itself stays full-weight regardless of its row's count.
    const zeroLabel = screen.getByText("GC super early bird");
    expect(zeroLabel.className).toContain("text-foreground");
  });

  it("never omits a zero-count row — it still renders as a labeled row", () => {
    render(<TicketTypeBarChart rows={[{ label: "Never sold", count: 0 }]} />);
    expect(screen.getByText("Never sold")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("gives every non-zero row a monotonically larger progress value than a smaller one (AC-1)", () => {
    render(
      <TicketTypeBarChart
        rows={[
          { label: "Big", count: 97 },
          { label: "Small", count: 1 },
        ]}
      />,
    );

    const bars = screen.getAllByRole("progressbar");
    const bigValue = Number(bars[0].getAttribute("aria-valuenow"));
    const smallValue = Number(bars[1].getAttribute("aria-valuenow"));
    expect(bigValue).toBeGreaterThan(smallValue);
    expect(bigValue).toBe(100);
    // Math.max(4, ...) floor — a "1" row never collapses to 0%.
    expect(smallValue).toBeGreaterThanOrEqual(4);
  });
});

describe("TicketTypeBarChartCard — empty state (spec §5 AC-2)", () => {
  it("renders the zero-ticket-types empty state with a link to the Tickets screen", () => {
    render(
      <TicketTypeBarChartCard
        eventId="evt-1"
        rows={[]}
        loadError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("No ticket types yet")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Go to Tickets" });
    expect(link.getAttribute("href")).toBe("/dashboard/events/evt-1/tickets");
  });
});

describe("TicketTypeBarChartCard — error state", () => {
  it("renders the retryable error panel and wires onRetry", () => {
    const onRetry = vi.fn();
    render(
      <TicketTypeBarChartCard
        eventId="evt-1"
        rows={[]}
        loadError={true}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("Couldn't load ticket-type registrations"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
