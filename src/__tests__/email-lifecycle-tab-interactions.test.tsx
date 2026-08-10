/**
 * QA (M6-T2 gate 3) - component-level interaction test for
 * `LifecycleEmailsTab` / `EmailActiveSwitch`.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { LifecycleEmailsTab } from "@/features/emails/components/lifecycle-emails-tab";
import type { SerializedEmailDefinition } from "@/features/emails/types";

function def(
  overrides: Partial<SerializedEmailDefinition>,
): SerializedEmailDefinition {
  return {
    id: `def-${overrides.kind}`,
    kind: "invitation",
    name: "Invitation",
    group: "pre-event",
    trigger: { type: "manual" },
    audience: "all-invitees",
    enabled: true,
    subject: "Subject",
    body: "Body",
    isSystem: true,
    sortOrder: 0,
    materialized: false,
    createdAtMs: null,
    bodyMode: "text",
    bodyBlocks: [],
    ...overrides,
  };
}

const DEFAULT_DEFINITIONS: SerializedEmailDefinition[] = [
  def({ kind: "invitation", name: "Invitation", trigger: { type: "manual" } }),
  def({
    kind: "abandoned-reminder",
    name: "Abandoned registration reminder",
    trigger: { type: "abandoned-24h" },
  }),
  def({
    kind: "approval-pending",
    name: "Approval pending notification",
    group: "post-registration",
    trigger: { type: "on-submit" },
  }),
  def({
    kind: "confirmation-paid",
    name: "Registration confirmation - paid",
    group: "post-registration",
    trigger: { type: "on-accept" },
    audience: "accepted-paid",
  }),
  def({
    kind: "confirmation-payment-due",
    name: "Registration confirmation - payment due",
    group: "post-registration",
    trigger: { type: "on-accept" },
    audience: "accepted-invoice",
  }),
  def({
    kind: "payment-reminder",
    name: "Payment reminder 1-3",
    group: "debt-chase",
    trigger: { type: "unpaid-offsets", offsetsDays: [7, 14, 21] },
    audience: "accepted-invoice",
  }),
  def({
    kind: "one-week-to-go",
    name: "One week to go",
    group: "debt-chase",
    trigger: { type: "scheduled", atMs: null },
    audience: "accepted-all",
  }),
  def({
    kind: "qr-ready",
    name: "Have your QR code ready",
    group: "debt-chase",
    trigger: { type: "scheduled", atMs: null },
    audience: "accepted-all",
  }),
];

const CUSTOM_DEFINITION = def({
  kind: "custom-abc-123",
  name: "VIP reminder",
  group: "pre-event",
  trigger: { type: "manual" },
  isSystem: false,
  materialized: true,
});

function renderTab(
  definitions: SerializedEmailDefinition[] = DEFAULT_DEFINITIONS,
  onOpenEditor = vi.fn(),
) {
  return {
    onOpenEditor,
    ...render(
      <LifecycleEmailsTab
        eventId="evt-1"
        timeZone="America/New_York"
        definitions={definitions}
        confirmationPreview={null}
        loadError={false}
        onOpenEditor={onOpenEditor}
      />,
    ),
  };
}

function rowFor(kind: string) {
  const row = document.querySelector(`[data-email-row="${kind}"]`);
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LifecycleEmailsTab basics", () => {
  it("can show the full plan when All is selected", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    for (const definition of DEFAULT_DEFINITIONS) {
      expect(screen.getAllByText(definition.name).length).toBeGreaterThan(0);
    }
  });

  it("opens the editor from a row action", () => {
    const { onOpenEditor } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^Before registration/ }));
    fireEvent.click(
      within(rowFor("invitation")).getByRole("button", { name: "Edit" }),
    );
    expect(onOpenEditor).toHaveBeenCalledWith("invitation");
  });

  it("updates the detail panel when a different row is selected", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^Before registration/ }));
    fireEvent.click(
      within(rowFor("abandoned-reminder")).getByRole("button", { name: "View" }),
    );
    expect(within(rowFor("abandoned-reminder")).getByText("Viewing")).toBeTruthy();
    expect(within(rowFor("invitation")).queryByText("Viewing")).toBeNull();
  });

  it("starts focused on a single lifecycle phase", () => {
    renderTab();
    expect(screen.getAllByText("After registration").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-email-row="approval-pending"]')).not.toBeNull();
    expect(document.querySelector('[data-email-row="invitation"]')).toBeNull();
  });
});

describe("Trigger display", () => {
  it("does not render the retired not-built tooltip copy", () => {
    renderTab();
    expect(screen.queryByText("Automation not yet built")).toBeNull();
  });

  it("still renders canonical trigger labels for manual and automated rows", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(within(rowFor("invitation")).getAllByText(/Manual/i).length).toBeGreaterThan(0);
    expect(
      within(rowFor("approval-pending")).getAllByText(/on submit/i).length,
    ).toBeGreaterThan(0);
    expect(
      within(rowFor("abandoned-reminder")).getAllByText(/24h after drop-off/i)
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("Active switch", () => {
  it("flips the badge immediately on click before the fetch resolves", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    renderTab([def({ kind: "invitation", name: "Invitation" })]);

    expect(within(rowFor("invitation")).getByText("On")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("switch", { name: "Toggle Invitation active" }),
    );

    await waitFor(() =>
      expect(within(rowFor("invitation")).getAllByText("Off").length).toBeGreaterThan(0),
    );
    expect(within(rowFor("invitation")).queryByText("On")).toBeNull();

    resolveFetch(
      new Response(JSON.stringify({ definition: {} }), { status: 200 }),
    );
  });

  it("rolls back to the prior state and toasts an error when PATCH fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
        ),
    );

    renderTab([def({ kind: "invitation", name: "Invitation" })]);

    fireEvent.click(
      screen.getByRole("switch", { name: "Toggle Invitation active" }),
    );

    await waitFor(() =>
      expect(within(rowFor("invitation")).getByText("On")).toBeTruthy(),
    );
    expect(toastError).toHaveBeenCalledWith("Failed to update the email.");
  });

  it("rolls back on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    renderTab([def({ kind: "invitation", name: "Invitation" })]);
    fireEvent.click(
      screen.getByRole("switch", { name: "Toggle Invitation active" }),
    );

    await waitFor(() =>
      expect(within(rowFor("invitation")).getByText("On")).toBeTruthy(),
    );
    expect(toastError).toHaveBeenCalled();
  });
});

describe("Custom definition delete", () => {
  it("system rows render no delete affordance", () => {
    renderTab([def({ kind: "invitation", name: "Invitation", isSystem: true })]);
    expect(
      screen.queryByRole("button", { name: "Delete Invitation" }),
    ).toBeNull();
  });

  it("deleting a custom row opens a confirm dialog; cancelling makes no request", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderTab([CUSTOM_DEFINITION]);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete VIP reminder" })[0]!,
    );
    expect(screen.getByText("Delete VIP reminder?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("confirming delete calls DELETE and reports success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    renderTab([CUSTOM_DEFINITION]);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete VIP reminder" })[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/dashboard/events/evt-1/emails/definitions/custom-abc-123",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Email deleted"),
    );
  });
});

describe("Responsive layout", () => {
  it("uses a two-column xl master-detail grid", () => {
    const { container } = renderTab();
    const grid = container.querySelector(
      ".grid.gap-6.xl\\:grid-cols-\\[0\\.88fr_1\\.12fr\\]",
    );
    expect(grid).not.toBeNull();
  });

  it("shows phase filters and can reveal all lifecycle sections together", () => {
    renderTab();
    expect(screen.getByRole("button", { name: /^All/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Before registration/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getAllByText("Before registration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("After registration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reminders and follow-up").length).toBeGreaterThan(0);
    expect(screen.getByText("Selected email")).toBeTruthy();
  });
});
