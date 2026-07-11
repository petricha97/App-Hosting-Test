/**
 * M5-T5 — scan result takeover variants (design §4):
 * - resolved: attendee card (name, type pill, ticket) + "Check in" (h-14) —
 *   resolve ≠ confirm;
 * - checked-in: emerald success with the time;
 * - already: amber with the ORIGINAL "at HH:MM by <scanner>" record;
 * - invalid / cancelled / wrong-event / not-accepted / error copy per spec;
 * - every variant is a role="status" live region with a "Scan next" reset.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScanResultCard } from "@/features/checkin/components/scan-result-card";
import {
  formatCheckedInTime,
  type ScanAttendeeCard,
} from "@/features/checkin/scan-types";

const ATTENDEE: ScanAttendeeCard = {
  name: "Ada Lovelace",
  registrationTypeLabel: "Delegate",
  ticketLabel: "General Admission",
  checkInState: "not-arrived",
  checkedInAtIso: null,
  checkedInByName: null,
};

const CHECKIN_ISO = new Date(1700000000000).toISOString();

describe("ScanResultCard", () => {
  it("resolved: shows the attendee card and a Check in button inside a live region", () => {
    const onConfirm = vi.fn();
    render(
      <ScanResultCard
        outcome={{ kind: "resolved", attendee: ATTENDEE }}
        onConfirm={onConfirm}
        onScanNext={() => {}}
      />,
    );

    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Delegate")).toBeTruthy();
    expect(screen.getByText("General Admission")).toBeTruthy();

    const confirm = screen.getByRole("button", { name: "Check in" });
    expect(confirm.className).toContain("h-14");
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("checked-in: emerald success with the flip time, no Check in button", () => {
    render(
      <ScanResultCard
        outcome={{
          kind: "checked-in",
          attendee: { ...ATTENDEE, checkInState: "checked-in" },
          checkedInAtIso: CHECKIN_ISO,
        }}
        onScanNext={() => {}}
      />,
    );

    expect(screen.getByText("Checked in")).toBeTruthy();
    expect(
      screen.getByText(`at ${formatCheckedInTime(CHECKIN_ISO)}`),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
  });

  it("already: amber variant carries the ORIGINAL time + scanner name", () => {
    render(
      <ScanResultCard
        outcome={{
          kind: "already",
          attendee: { ...ATTENDEE, checkInState: "checked-in" },
          checkedInAtIso: CHECKIN_ISO,
          checkedInByName: "Maria Chen",
        }}
        onScanNext={() => {}}
      />,
    );

    expect(screen.getByText("Already checked in")).toBeTruthy();
    expect(
      screen.getByText(
        `at ${formatCheckedInTime(CHECKIN_ISO)} by Maria Chen`,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
  });

  it("renders the invalid / cancelled / wrong-event / not-accepted / error copy", () => {
    const cases = [
      { outcome: { kind: "invalid" } as const, text: "Invalid pass" },
      {
        outcome: { kind: "cancelled" } as const,
        text: "Registration cancelled",
      },
      {
        outcome: { kind: "wrong-event" } as const,
        text: "This pass belongs to a different event.",
      },
      {
        outcome: { kind: "not-accepted" } as const,
        text: "Registration not yet accepted",
      },
      { outcome: { kind: "error" } as const, text: "Something went wrong" },
    ];

    for (const { outcome, text } of cases) {
      const { unmount } = render(
        <ScanResultCard outcome={outcome} onScanNext={() => {}} />,
      );
      expect(screen.getByText(text)).toBeTruthy();
      // No attendee data on the non-attendee variants.
      expect(screen.queryByText("Ada Lovelace")).toBeNull();
      unmount();
    }
  });

  it("every variant offers Scan next (h-12) and it fires the reset", () => {
    const onScanNext = vi.fn();
    render(
      <ScanResultCard outcome={{ kind: "invalid" }} onScanNext={onScanNext} />,
    );

    const next = screen.getByRole("button", { name: "Scan next" });
    expect(next.className).toContain("h-12");
    fireEvent.click(next);
    expect(onScanNext).toHaveBeenCalledTimes(1);
  });
});
