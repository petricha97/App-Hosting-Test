/**
 * M7-T1 — EntityEmptyState's additive `href` prop (design §1): renders a
 * navigable Button asChild><Link> when `href` is present, and falls back to
 * the pre-existing `onAction` callback button when it isn't — every prior
 * caller (onAction-only, no-action) stays unaffected.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { Ticket } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { EntityEmptyState } from "@/features/registration/components/entity-table-states";

describe("EntityEmptyState — href mode (new, additive)", () => {
  it("renders the action as a link to href, not an onClick button", () => {
    render(
      <EntityEmptyState
        icon={Ticket}
        title="No ticket types yet"
        description="Create a ticket type to start tracking registrations by offer."
        actionLabel="Go to Tickets"
        href="/dashboard/events/evt-1/tickets"
      />,
    );

    const link = screen.getByRole("link", { name: "Go to Tickets" });
    expect(link.getAttribute("href")).toBe("/dashboard/events/evt-1/tickets");
  });

  it("prefers href over onAction when both are somehow passed", () => {
    const onAction = vi.fn();
    render(
      <EntityEmptyState
        icon={Ticket}
        title="Title"
        description="Description"
        actionLabel="Go"
        href="/somewhere"
        onAction={onAction}
      />,
    );

    expect(screen.getByRole("link", { name: "Go" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
  });
});

describe("EntityEmptyState — pre-existing onAction callers stay unaffected", () => {
  it("still renders an onClick button (no href passed)", () => {
    const onAction = vi.fn();
    render(
      <EntityEmptyState
        icon={Ticket}
        title="No registration types yet"
        description="Define who can attend before creating tickets and pricing."
        actionLabel="+ Create type"
        onAction={onAction}
      />,
    );

    const button = screen.getByRole("button", { name: "+ Create type" });
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("still renders no action at all when neither actionLabel/onAction nor href is passed", () => {
    render(
      <EntityEmptyState
        icon={Ticket}
        title="No service fees configured"
        description="Add a per-order processing fee if you pass card costs on to attendees."
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
