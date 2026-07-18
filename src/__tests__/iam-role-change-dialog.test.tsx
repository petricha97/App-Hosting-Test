/**
 * M8-T1 — RoleChangeDialog component. Locks (design §3/§4):
 *  - an Editor<->Viewer change submits directly from the lightweight Dialog
 *    ("Save"), no AlertDialog escalation;
 *  - a change touching Owner/Admin escalates to a genuine AlertDialog
 *    confirm ("Continue" -> role-specific title/description);
 *  - the last-Owner guardrail renders as an INLINE role="alert" block
 *    inside the AlertDialog, not a toast, and disables the confirm button.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { RoleChangeDialog } from "@/features/iam/components/role-change-dialog";
import type { MemberRow } from "@/features/iam/types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function member(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    email: "target@example.com",
    name: "Target Person",
    role: "editor",
    status: "active",
    isSelf: false,
    ...overrides,
  };
}

function selectRole(label: string) {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoleChangeDialog — Editor<->Viewer stays lightweight (no AlertDialog)", () => {
  it("submits directly via 'Save' with no Continue/confirm step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ role: "viewer" })),
    );
    const onChanged = vi.fn();

    render(
      <RoleChangeDialog
        open
        onOpenChange={vi.fn()}
        member={member({ role: "editor" })}
        callerRole="owner"
        onChanged={onChanged}
      />,
    );

    expect(screen.queryByText(/Continue/)).toBeNull();
    selectRole("Viewer");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith("target@example.com", "viewer");
    });
    expect(toastSuccess).toHaveBeenCalled();
  });
});

describe("RoleChangeDialog — Owner/Admin-tier escalates to AlertDialog", () => {
  it("promoting an Editor to Admin shows 'Continue' then a role-specific AlertDialog confirm", async () => {
    render(
      <RoleChangeDialog
        open
        onOpenChange={vi.fn()}
        member={member({ role: "editor" })}
        callerRole="owner"
        onChanged={vi.fn()}
      />,
    );

    selectRole("Admin");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Make Target Person an Admin?"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make Admin" })).toBeTruthy();
  });

  it("demoting an Owner shows the amber 'Remove Owner access' confirm button", async () => {
    render(
      <RoleChangeDialog
        open
        onOpenChange={vi.fn()}
        member={member({ role: "owner", name: "Solo Owner" })}
        callerRole="owner"
        onChanged={vi.fn()}
      />,
    );

    selectRole("Editor");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Remove Owner access from Solo Owner?"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove Owner access" }),
    ).toBeTruthy();
  });
});

describe("RoleChangeDialog — last-Owner guardrail (design §4, spec §5 AC-3)", () => {
  it("renders the guardrail INLINE (role='alert') inside the AlertDialog, not a toast, and disables the confirm button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error:
              "This organization must have at least one Owner. Promote another member to Owner first, then try this change again.",
            code: "last-owner",
          },
          409,
        ),
      ),
    );

    render(
      <RoleChangeDialog
        open
        onOpenChange={vi.fn()}
        member={member({ role: "owner", name: "Solo Owner" })}
        callerRole="owner"
        onChanged={vi.fn()}
      />,
    );

    selectRole("Editor");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Owner access" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/at least one Owner/i);
    expect(toastError).not.toHaveBeenCalled();

    // The confirm button is disabled once the guardrail fires — nothing
    // more this dialog can do without a different action first.
    const confirmButton = screen.getByRole("button", {
      name: "Remove Owner access",
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });
});

describe("RoleChangeDialog — self-targeting note (spec §5 AC-4)", () => {
  it("adds the D11 'won't affect your session' line when member.isSelf is true", async () => {
    render(
      <RoleChangeDialog
        open
        onOpenChange={vi.fn()}
        member={member({ role: "owner", isSelf: true, name: "Me" })}
        callerRole="owner"
        onChanged={vi.fn()}
      />,
    );

    selectRole("Admin");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText(/won't affect your current session/i),
    ).toBeTruthy();
  });
});
