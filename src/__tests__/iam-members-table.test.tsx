/**
 * M8-T1 — MembersTable component. Locks:
 *  - row ordering (Owner > Admin > Editor > Viewer, members before
 *    invitations within a tier, spec §1 design row-order rule);
 *  - the Actions column is entirely omitted for a non-managing caller
 *    (Editor/Viewer) — genuinely 4-column, not disabled controls;
 *  - an Admin caller sees an em dash (not a disabled menu) on Owner/Admin
 *    rows — D10's "not applicable to you" terminal affordance;
 *  - "No pending invitations" renders inline only when invitations is empty.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MembersTable } from "@/features/iam/components/members-table";
import type { InvitationRow, MemberRow } from "@/features/iam/types";

function member(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    email: "person@example.com",
    name: "Person",
    role: "viewer",
    status: "active",
    isSelf: false,
    ...overrides,
  };
}

function invitation(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    email: "invited@example.com",
    role: "editor",
    status: "invited",
    invitedAt: 1000,
    expiresAt: 2000,
    invitedBy: "owner@example.com",
    ...overrides,
  };
}

describe("MembersTable — row order", () => {
  it("sorts Owner > Admin > Editor > Viewer, active members before invitations within a tier", () => {
    render(
      <MembersTable
        members={[
          member({
            email: "editor@example.com",
            name: "Ed Editor",
            role: "editor",
          }),
          member({
            email: "owner@example.com",
            name: "Petri Owner",
            role: "owner",
          }),
        ]}
        invitations={[
          invitation({ email: "invited-admin@example.com", role: "admin" }),
        ]}
        canManageMembers={false}
        callerRole="owner"
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    const names = rows.map(
      (row) => within(row).getAllByRole("cell")[0].textContent,
    );
    expect(names[0]).toContain("Petri Owner");
    expect(names[1]).toContain("Invited-admin"); // admin-tier invitation (title-cased local part)
    expect(names[2]).toContain("Ed Editor");
  });
});

describe("MembersTable — Actions column visibility", () => {
  it("omits the Actions column entirely for a non-managing caller", () => {
    render(
      <MembersTable
        members={[member()]}
        invitations={[]}
        canManageMembers={false}
        callerRole="viewer"
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.queryByText("Actions")).toBeNull();
    expect(screen.queryByRole("button", { name: /Actions for/i })).toBeNull();
  });

  it("renders the Actions column for a managing caller", () => {
    render(
      <MembersTable
        members={[member({ role: "editor" })]}
        invitations={[]}
        canManageMembers
        callerRole="owner"
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Actions for Person/i }),
    ).toBeTruthy();
  });
});

describe("MembersTable — D10 em-dash terminal affordance", () => {
  it("shows an em dash (not a disabled menu) for an Admin caller on an Owner row", () => {
    render(
      <MembersTable
        members={[
          member({
            email: "owner@example.com",
            name: "Owner Person",
            role: "owner",
          }),
        ]}
        invitations={[]}
        canManageMembers
        callerRole="admin"
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Actions for Owner Person/i }),
    ).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows a real menu for an Admin caller on an Editor row", () => {
    render(
      <MembersTable
        members={[
          member({
            email: "editor@example.com",
            name: "Editor Person",
            role: "editor",
          }),
        ]}
        invitations={[]}
        canManageMembers
        callerRole="admin"
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Actions for Editor Person/i }),
    ).toBeTruthy();
  });
});

describe("MembersTable — no pending invitations", () => {
  it("renders the inline 'No pending invitations' row when invitations is empty", () => {
    render(
      <MembersTable
        members={[member()]}
        invitations={[]}
        canManageMembers={false}
        callerRole="viewer"
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByText("No pending invitations")).toBeTruthy();
  });

  it("does not render the empty-invitations row when invitations exist", () => {
    render(
      <MembersTable
        members={[member()]}
        invitations={[invitation()]}
        canManageMembers={false}
        callerRole="viewer"
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.queryByText("No pending invitations")).toBeNull();
  });
});
