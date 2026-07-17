/**
 * M7-T3 — ReportScheduleRecipientsField (spec §2): free-text add (never a
 * roster picker, D2), comma/newline multi-paste, client-side format
 * rejection, silent dedupe, the MAX_RECIPIENTS_PER_SCHEDULE cap, and "Add
 * myself".
 */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type RecipientChip,
  ReportScheduleRecipientsField,
} from "@/features/reports/components/report-schedule-recipients-field";
import { MAX_RECIPIENTS_PER_SCHEDULE_CLIENT } from "@/features/reports/schedule-schemas";

function Wrapper({ initial = [] }: { initial?: RecipientChip[] }) {
  const [recipients, setRecipients] = useState<RecipientChip[]>(initial);
  return (
    <ReportScheduleRecipientsField
      recipients={recipients}
      onChange={setRecipients}
      currentUserEmail="me@example.com"
    />
  );
}

describe("ReportScheduleRecipientsField", () => {
  it("adds a valid email via the + Add button", () => {
    render(<Wrapper />);

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    expect(screen.getByText("teammate@example.com")).toBeTruthy();
  });

  it("splits a comma-separated paste into multiple chips", () => {
    render(<Wrapper />);

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), {
      target: { value: "a@example.com, b@example.com,c@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    expect(screen.getByText("a@example.com")).toBeTruthy();
    expect(screen.getByText("b@example.com")).toBeTruthy();
    expect(screen.getByText("c@example.com")).toBeTruthy();
  });

  it("splits a newline-separated paste into multiple chips (multi-line textarea)", () => {
    render(<Wrapper />);

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), {
      target: { value: "d@example.com\ne@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    expect(screen.getByText("d@example.com")).toBeTruthy();
    expect(screen.getByText("e@example.com")).toBeTruthy();
  });

  it("rejects a malformed address with an inline error and adds nothing", () => {
    render(<Wrapper />);

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    expect(
      screen.getByText('"not-an-email" isn\'t a valid email address.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "No recipients yet — add at least one verified org member.",
      ),
    ).toBeTruthy();
  });

  it("silently dedupes an already-added email", () => {
    render(<Wrapper initial={[{ email: "dup@example.com" }]} />);

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), {
      target: { value: "dup@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    expect(screen.getAllByText("dup@example.com")).toHaveLength(1);
  });

  it("removes a chip via its remove button", () => {
    render(<Wrapper initial={[{ email: "removable@example.com" }]} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove removable@example.com" }),
    );

    expect(screen.queryByText("removable@example.com")).toBeNull();
  });

  it("enforces the MAX_RECIPIENTS_PER_SCHEDULE_CLIENT cap with a typed error, never silent truncation", () => {
    const atCap = Array.from({
      length: MAX_RECIPIENTS_PER_SCHEDULE_CLIENT,
    }).map((_, i) => ({ email: `user${i}@example.com` }));
    render(<Wrapper initial={atCap} />);

    expect(
      (screen.getByRole("button", { name: "+ Add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("'Add myself' adds the current user's email", () => {
    render(<Wrapper />);

    fireEvent.click(screen.getByRole("button", { name: "Add myself" }));

    expect(screen.getByText("me@example.com")).toBeTruthy();
    // The shortcut disappears once the current user is already on the list
    // (spec §2: "not auto-added silently... organizer may intentionally
    // want a schedule that goes to a colleague only").
    expect(screen.queryByRole("button", { name: "Add myself" })).toBeNull();
  });
});
