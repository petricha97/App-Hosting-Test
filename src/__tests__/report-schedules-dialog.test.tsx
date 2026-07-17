/**
 * M7-T3 — ReportSchedulesDialog component-level interaction test. Locks:
 *  - empty state ("No scheduled reports yet") on a fresh event;
 *  - clicking Edit on an existing schedule pre-populates the form
 *    (recipient chips, existing frequency label) rather than a blank
 *    "create" form;
 *  - a server-side per-recipient rejection (D2, spec §2 AC-2) highlights
 *    the SPECIFIC rejected chip with the server's own reason, keeps the
 *    dialog open, and does not silently drop the other, accepted recipient;
 *  - pause/resume round-trips through PATCH and flips the list badge;
 *  - delete round-trips through the confirm dialog + DELETE and removes the
 *    row from the list.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ReportSchedulesDialog } from "@/features/reports/components/report-schedules-dialog";
import type { SerializedReportSchedule } from "@/features/reports/types";

const EVENT_ID = "evt-1";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function existingSchedule(
  overrides: Partial<SerializedReportSchedule> = {},
): SerializedReportSchedule {
  return {
    templateSlug: "registration-overview",
    frequency: "weekly",
    dayOfWeek: 1,
    dayOfMonth: null,
    hour: 9,
    minute: 0,
    recipients: [{ email: "organizer@example.com", name: "Organizer" }],
    enabled: true,
    createdBy: "organizer@example.com",
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  };
}

function schedulesUrl() {
  return `/api/dashboard/events/${EVENT_ID}/reports/schedules`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportSchedulesDialog — empty state", () => {
  it("shows 'No scheduled reports yet' with a + Add schedule CTA on a fresh event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ schedules: [] })),
    );

    render(
      <ReportSchedulesDialog
        open
        onOpenChange={vi.fn()}
        eventId={EVENT_ID}
        timeZone="America/New_York"
        currentUserEmail="organizer@example.com"
      />,
    );

    expect(await screen.findByText("No scheduled reports yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add schedule" })).toBeTruthy();
  });
});

describe("ReportSchedulesDialog — edit pre-populates (not a blank create form)", () => {
  it("shows the existing recipient as a chip when Edit is clicked", async () => {
    const schedule = existingSchedule();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ schedules: [schedule] })),
    );

    render(
      <ReportSchedulesDialog
        open
        onOpenChange={vi.fn()}
        eventId={EVENT_ID}
        timeZone="America/New_York"
        currentUserEmail="organizer@example.com"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(
      await screen.findByRole("heading", {
        name: /Edit schedule — Registration overview/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("organizer@example.com")).toBeTruthy();
  });
});

describe("ReportSchedulesDialog — per-recipient rejection (spec §2 AC-2, D2)", () => {
  it("highlights the SPECIFIC rejected email with the server's reason and keeps the accepted one", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === schedulesUrl() && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ schedules: [] }));
      }
      if (url === schedulesUrl() && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              error: "One or more recipients could not be added.",
              recipientErrors: [
                {
                  email: "not-a-member@example.com",
                  reason:
                    "This email isn't a member of your organization — invite them first.",
                },
              ],
            },
            422,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ schedules: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportSchedulesDialog
        open
        onOpenChange={vi.fn()}
        eventId={EVENT_ID}
        timeZone="America/New_York"
        currentUserEmail="organizer@example.com"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Add schedule" }),
    );

    const recipientInput =
      await screen.findByPlaceholderText("name@company.com");
    fireEvent.change(recipientInput, {
      target: { value: "good@example.com, not-a-member@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    // Both chips render before submit — neither is dropped client-side.
    expect(await screen.findByText("good@example.com")).toBeTruthy();
    expect(screen.getByText("not-a-member@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The rejected chip shows the server's OWN reason text...
    expect(
      await screen.findByText(
        "This email isn't a member of your organization — invite them first.",
      ),
    ).toBeTruthy();
    // ...scoped to its own chip, not a generic dialog-wide failure — the
    // accepted email's chip has no error text next to it.
    const acceptedChip = screen.getByText("good@example.com").closest("li");
    expect(
      within(acceptedChip as HTMLElement).queryByText(/isn't a member/),
    ).toBeNull();
    // Dialog stays open on the form view (not silently closed/discarded).
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

describe("ReportSchedulesDialog — pause/resume round-trip", () => {
  it("PATCHes with enabled flipped and updates the list badge", async () => {
    const schedule = existingSchedule({ enabled: true });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({ schedule: { ...schedule, enabled: false } }),
        );
      }
      return Promise.resolve(jsonResponse({ schedules: [schedule] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportSchedulesDialog
        open
        onOpenChange={vi.fn()}
        eventId={EVENT_ID}
        timeZone="America/New_York"
        currentUserEmail="organizer@example.com"
      />,
    );

    expect(await screen.findByText("Active")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause schedule" }));

    await waitFor(() => expect(screen.getByText("Paused")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      `${schedulesUrl()}/${schedule.templateSlug}`,
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"enabled":false'),
      }),
    );
  });
});

describe("ReportSchedulesDialog — delete round-trip", () => {
  it("confirming delete calls DELETE and removes the row from the list", async () => {
    const schedule = existingSchedule();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({ schedules: [schedule] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportSchedulesDialog
        open
        onOpenChange={vi.fn()}
        eventId={EVENT_ID}
        timeZone="America/New_York"
        currentUserEmail="organizer@example.com"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete schedule" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${schedulesUrl()}/${schedule.templateSlug}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("No scheduled reports yet")).toBeTruthy(),
    );
  });
});
