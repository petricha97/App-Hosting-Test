/**
 * M8-T1 — InviteMemberDialog component. Locks:
 *  - an Admin caller never sees "Admin" as a role option, plus the static
 *    "Only an Owner can invite someone as Admin" description (design §2's
 *    "hide, don't disable" call for the Select-inside-a-popover case);
 *  - an Owner caller sees Admin/Editor/Viewer;
 *  - the "sent" view distinguishes "Invite sent" vs "Invite updated" from
 *    the API's wasExisting boolean, and Done patches the table via onInvited.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom lacks scrollIntoView; Radix Select's mount effect calls it when
// opened. Same shim as reports-page.test.tsx / qa-report-run-panel-states.test.tsx.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { InviteMemberDialog } from "@/features/iam/components/invite-member-dialog";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("InviteMemberDialog — role option gating (design §2)", () => {
  it("hides the Admin option for an Admin caller and shows the static explanation", async () => {
    render(
      <InviteMemberDialog
        open
        onOpenChange={vi.fn()}
        callerRole="admin"
        onInvited={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Only an Owner can invite someone as Admin."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("option", { name: "Admin" })).toBeNull();
    expect(screen.getByRole("option", { name: "Editor" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Viewer" })).toBeTruthy();
  });

  it("shows Admin/Editor/Viewer for an Owner caller with no extra copy", async () => {
    render(
      <InviteMemberDialog
        open
        onOpenChange={vi.fn()}
        callerRole="owner"
        onInvited={vi.fn()}
      />,
    );

    expect(
      screen.queryByText("Only an Owner can invite someone as Admin."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "Admin" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Editor" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Viewer" })).toBeTruthy();
  });
});

describe("InviteMemberDialog — sent view (D8 copy-link UX)", () => {
  it("shows 'Invite sent' for a fresh invite and patches the table via onInvited on Done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          invitation: {
            email: "new@example.com",
            role: "viewer",
            status: "invited",
            invitedAt: 1,
            expiresAt: 2,
            invitedBy: "owner@example.com",
          },
          acceptUrl: "https://app.example.com/invite/tok-abc",
          wasExisting: false,
        }),
      ),
    );
    const onInvited = vi.fn();

    render(
      <InviteMemberDialog
        open
        onOpenChange={vi.fn()}
        callerRole="owner"
        onInvited={onInvited}
      />,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("Invite sent")).toBeTruthy();
    expect(
      screen.getByDisplayValue("https://app.example.com/invite/tok-abc"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onInvited).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com", role: "viewer" }),
    );
  });

  it("shows 'Invite updated' when the API reports wasExisting:true (re-invite upsert)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          invitation: {
            email: "repeat@example.com",
            role: "editor",
            status: "invited",
            invitedAt: 1,
            expiresAt: 2,
            invitedBy: "owner@example.com",
          },
          acceptUrl: "https://app.example.com/invite/tok-2",
          wasExisting: true,
        }),
      ),
    );

    render(
      <InviteMemberDialog
        open
        onOpenChange={vi.fn()}
        callerRole="owner"
        onInvited={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "repeat@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("Invite updated")).toBeTruthy();
  });

  it("copies the accept link to the clipboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          invitation: {
            email: "new@example.com",
            role: "viewer",
            status: "invited",
            invitedAt: 1,
            expiresAt: 2,
            invitedBy: "owner@example.com",
          },
          acceptUrl: "https://app.example.com/invite/tok-abc",
          wasExisting: false,
        }),
      ),
    );

    render(
      <InviteMemberDialog
        open
        onOpenChange={vi.fn()}
        callerRole="owner"
        onInvited={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await screen.findByText("Invite sent");

    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://app.example.com/invite/tok-abc",
      );
    });
  });
});

describe("InviteMemberDialog — already-a-member rejection (spec §3 AC-2)", () => {
  it("renders the server's error inline under the Email field, not a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "This person is already a member of this workspace.",
            field: "email",
          },
          409,
        ),
      ),
    );

    render(
      <InviteMemberDialog
        open
        onOpenChange={vi.fn()}
        callerRole="owner"
        onInvited={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "existing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(
      await screen.findByText(
        "This person is already a member of this workspace.",
      ),
    ).toBeTruthy();
  });
});
