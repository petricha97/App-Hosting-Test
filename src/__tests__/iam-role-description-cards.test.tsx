/**
 * QA regression (M8-T1 QA pass, Priority 7) — RoleDescriptionCards had ZERO
 * test coverage in the shipped diff. Design §6's central, deliberate call is
 * that Owner and Admin share ONE card (not 4 separate cards, not a silently
 * merged card with no acknowledgment) with a one-line footnote surfacing
 * D5's nuance exactly once. Locks:
 *   - exactly 3 cards render (Owner+Admin combined, Editor, Viewer) — never
 *     4, never an unlabeled/silent merge;
 *   - the combined card's title and footnote copy are exactly as specified;
 *   - Editor/Viewer cards carry their own copy, no footnote (the nuance is
 *     Owner/Admin-specific, per D5).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoleDescriptionCards } from "@/features/iam/components/role-description-cards";

describe("RoleDescriptionCards (design §6 — Owner & Admin combined card)", () => {
  it("renders exactly 3 cards: 'Owner & Admin', 'Editor', 'Viewer' — never a separate Admin card", () => {
    const { container } = render(<RoleDescriptionCards />);

    expect(screen.getByText("Owner & Admin")).toBeTruthy();
    expect(screen.getByText("Editor")).toBeTruthy();
    expect(screen.getByText("Viewer")).toBeTruthy();
    // No standalone "Admin" or "Owner" title exists as its own card — only
    // the combined "Owner & Admin" title.
    expect(screen.queryByText(/^Admin$/)).toBeNull();
    expect(screen.queryByText(/^Owner$/)).toBeNull();

    // Exactly 3 card titles total (no 4th role-specific card slipped in).
    const titles = container.querySelectorAll('[data-slot="card-title"]');
    expect(titles).toHaveLength(3);
  });

  it("surfaces D5's nuance exactly once, in the combined card's footnote", () => {
    render(<RoleDescriptionCards />);

    expect(
      screen.getByText(
        "Only an Owner can manage other Owners and Admins, or invite someone as Admin.",
      ),
    ).toBeTruthy();
    // The footnote text appears exactly once app-wide on this screen — not
    // repeated per-row or duplicated across cards.
    expect(
      screen.getAllByText(
        "Only an Owner can manage other Owners and Admins, or invite someone as Admin.",
      ),
    ).toHaveLength(1);
  });

  it("Editor and Viewer cards carry their own descriptive copy with no footnote", () => {
    render(<RoleDescriptionCards />);

    expect(
      screen.getByText(
        "Build events, forms, and emails. Can't manage members.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Read-only: reports, attendees, and responses."),
    ).toBeTruthy();
  });
});
