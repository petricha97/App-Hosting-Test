/**
 * M7-T2 — ReportTemplatesSection: single-open-panel (accordion) behavior,
 * unconditional Export CSV visibility (design §5), clean remount on
 * template switch (key={activeTemplate} — no stale data flash, design §3).
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const { downloadCsvExport } = vi.hoisted(() => ({
  downloadCsvExport: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/features/responses/download", () => ({ downloadCsvExport }));

import { ReportTemplatesSection } from "@/features/reports/components/report-templates-section";

const EVENT_ID = "evt-1";

function emptyPageResponse() {
  return new Response(
    JSON.stringify({ rows: [], nextCursorMs: null, hasMore: false }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadCsvExport.mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyPageResponse()));
});

describe("ReportTemplatesSection — templates table", () => {
  it("renders all 5 templates with an unconditional Export CSV button per row (design §5)", () => {
    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    const table = screen.getByRole("table", { name: /report templates/i });
    const rows = within(table).getAllByRole("row").slice(1); // drop header row
    expect(rows).toHaveLength(5);

    for (const row of rows) {
      expect(
        within(row).getByRole("button", { name: /export csv/i }),
      ).toBeTruthy();
    }
  });
});

describe("ReportTemplatesSection — single-open-panel behavior (design §0/§3)", () => {
  it("opening a second template's panel replaces the first (no two panels at once)", async () => {
    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);

    await waitFor(() =>
      expect(
        screen.getByRole("region", {
          name: /registration overview — report output/i,
        }),
      ).toBeTruthy(),
    );
    expect(fetch).toHaveBeenCalledWith(
      `/api/dashboard/events/${EVENT_ID}/reports/registration-overview`,
    );

    // Open the second template — this must replace, not add to, the panel.
    // (The first row's button is now labeled "Hide", so the remaining
    // "Run"-labeled buttons start at order-transactions, index 0.)
    const runButtons = screen.getAllByRole("button", { name: "Run" });
    fireEvent.click(runButtons[0]);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/dashboard/events/${EVENT_ID}/reports/order-transactions`,
      ),
    );

    // Only ONE panel is ever mounted — its heading matches the active
    // template only (Order & transaction details), not both.
    const panel = screen.getByRole("region", {
      name: /order & transaction details — report output/i,
    });
    expect(panel).toBeTruthy();
    expect(
      screen.queryByRole("region", {
        name: /registration overview — report output/i,
      }),
    ).toBeNull();
  });

  it("Run label toggles to Hide while its panel is open, and closes on click", async () => {
    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    const [firstRun] = screen.getAllByRole("button", { name: "Run" });
    fireEvent.click(firstRun);

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Hide" }).length,
      ).toBeGreaterThan(0),
    );

    // Clicking the SAME row's toggle (now "Hide") again closes the panel.
    fireEvent.click(screen.getAllByRole("button", { name: "Hide" })[0]);

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /report output/i }),
      ).toBeNull(),
    );
  });
});

describe("ReportTemplatesSection — export CSV (design §5)", () => {
  it("calls downloadCsvExport with the template's export URL and filename from the templates-table entry point", async () => {
    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    const [firstExport] = screen.getAllByRole("button", {
      name: /export csv/i,
    });
    fireEvent.click(firstExport);

    await waitFor(() =>
      expect(downloadCsvExport).toHaveBeenCalledWith(
        `/api/dashboard/events/${EVENT_ID}/reports/registration-overview/export`,
        `registration-overview-${EVENT_ID}.csv`,
      ),
    );
  });
});
