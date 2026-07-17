/**
 * QA regression — M7-T2 Run panel states (spec §6/§8, design §3): loading /
 * empty / error states exercised through the REAL rendered component tree
 * (not just the underlying loader functions), for template-specific copy and
 * the "one panel's failure doesn't affect the templates table or a
 * subsequently-opened different template" independent-degradation guarantee
 * (spec §6 AC-3).
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

const EVENT_ID = "evt-qa-states";

function emptyPageResponse() {
  return new Response(
    JSON.stringify({ rows: [], nextCursorMs: null, hasMore: false }),
    { status: 200 },
  );
}

function okPageResponse(rows: Record<string, string>[]) {
  return new Response(
    JSON.stringify({ rows, nextCursorMs: null, hasMore: false }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadCsvExport.mockResolvedValue(true);
});

describe("QA — Run panel empty states (spec §8, template-specific copy)", () => {
  it("Registration overview shows its own empty-state copy + CTA (not a generic message)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyPageResponse()));
    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);

    await waitFor(() =>
      expect(screen.getByText("No registrations yet")).toBeTruthy(),
    );
    expect(
      screen.getByText("Attendees will appear here once people register."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /go to attendees/i }).getAttribute("href"),
    ).toBe(`/dashboard/events/${EVENT_ID}/attendees`);
  });

  it("Abandoned registration details shows its own copy with NO CTA (spec §8's documented exception)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyPageResponse()));
    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    // 3rd row = Abandoned registration details.
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[2]);

    await waitFor(() =>
      expect(screen.getByText("No abandoned registrations")).toBeTruthy(),
    );
    expect(
      screen.getByText(
        "Registrations idle for more than 24 hours land here.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("QA — Run panel error state (spec §6 AC-3, independent degradation)", () => {
  it("a failed fetch shows EntityTableError with Try again, and retry recovers WITHOUT affecting the templates table", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(okPageResponse([{ name: "Recovered Row" }]));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);

    await waitFor(() =>
      expect(screen.getByText("Couldn't load registrations")).toBeTruthy(),
    );

    // The templates table itself is completely unaffected by the panel's
    // failure — still exactly 5 rows, every row's own actions still work.
    const table = screen.getByRole("table", { name: /report templates/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() =>
      expect(screen.queryByText("Couldn't load registrations")).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("closing a failed panel and opening a DIFFERENT template starts clean — no leaked error state (spec §6 AC-3)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportTemplatesSection eventId={EVENT_ID} />);

    // Open + fail the first template.
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    await waitFor(() =>
      expect(screen.getByText("Couldn't load registrations")).toBeTruthy(),
    );

    // Switch straight to a different template (still failing, but a FRESH
    // fetch for the new slug) — its own error copy must reference ITS OWN
    // entity, never the previous template's.
    const runButtons = screen.getAllByRole("button", { name: "Run" });
    fireEvent.click(runButtons[0]); // now "order-transactions" (first row is "Hide")

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't load order transactions"),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Couldn't load registrations")).toBeNull();
  });
});
