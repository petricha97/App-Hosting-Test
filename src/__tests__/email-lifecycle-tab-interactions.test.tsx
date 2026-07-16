/**
 * QA (M6-T2 gate 3) — component-level interaction test for
 * `LifecycleEmailsTab` / `EmailGroupTable` / `EmailActiveSwitch`. Closes the
 * Full-Stack Developer's self-reported gap ("no component-level interaction
 * testing was done") for: the optimistic Active-switch toggle + rollback on
 * failure, the custom-definition delete confirm dialog, the M6-T3
 * not-built tooltip affordance on non-manual rows (absent on manual rows),
 * and the row-name click opening the editor. Spec refs: §1 AC-2, AC-4, AC-5.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    name: "Registration confirmation — paid",
    group: "post-registration",
    trigger: { type: "on-accept" },
    audience: "accepted-paid",
  }),
  def({
    kind: "confirmation-payment-due",
    name: "Registration confirmation — payment due",
    group: "post-registration",
    trigger: { type: "on-accept" },
    audience: "accepted-invoice",
  }),
  def({
    kind: "payment-reminder",
    name: "Payment reminder 1–3",
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QA — LifecycleEmailsTab: default rows + row-open (spec §1 AC-1, row click)", () => {
  it("renders exactly the 8 default rows across the three grouped tables", () => {
    renderTab();
    for (const d of DEFAULT_DEFINITIONS) {
      expect(screen.getByText(d.name)).toBeTruthy();
    }
  });

  it("clicking a row name opens the editor for that kind", () => {
    const { onOpenEditor } = renderTab();
    fireEvent.click(screen.getByText("Invitation"));
    expect(onOpenEditor).toHaveBeenCalledWith("invitation");
  });
});

describe("QA — TriggerCell M6-T3 tooltip retirement (spec: m6-lifecycle-triggers.md)", () => {
  it("no row renders the M6-T3-not-built affordance — every trigger type is live now", () => {
    renderTab();
    expect(screen.queryByText("Automation not yet built")).toBeNull();
  });

  it("still renders the canonical trigger label on both manual and automated rows", () => {
    renderTab();
    expect(screen.getByText("Manual")).toBeTruthy();
    expect(screen.getByText("Auto · on submit")).toBeTruthy();
    expect(screen.getByText("Auto · 24h after drop-off")).toBeTruthy();
  });
});

describe("QA — Active switch: optimistic toggle + rollback on failure (spec §1 AC-2)", () => {
  it("flips the badge immediately on click (optimistic), before the fetch resolves", async () => {
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

    expect(screen.getByText("On")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("switch", { name: "Toggle Invitation active" }),
    );

    // Optimistic flip happens synchronously, before the in-flight fetch settles.
    await waitFor(() => expect(screen.getByText("Off")).toBeTruthy());
    expect(screen.queryByText("On")).toBeNull();

    resolveFetch(
      new Response(JSON.stringify({ definition: {} }), { status: 200 }),
    );
  });

  it("rolls back to the prior state and toasts an error when the PATCH fails", async () => {
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

    // Rolls back to "On" once the failed response resolves.
    await waitFor(() => expect(screen.getByText("On")).toBeTruthy());
    expect(screen.queryByText("Off")).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Failed to update the email.");
  });

  it("rolls back on a network error (fetch throws), not just a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    renderTab([def({ kind: "invitation", name: "Invitation" })]);
    fireEvent.click(
      screen.getByRole("switch", { name: "Toggle Invitation active" }),
    );

    await waitFor(() => expect(screen.getByText("On")).toBeTruthy());
    expect(toastError).toHaveBeenCalled();
  });
});

describe("QA — custom definition delete (spec §1 AC-5)", () => {
  it("system rows render no delete affordance", () => {
    renderTab([
      def({ kind: "invitation", name: "Invitation", isSystem: true }),
    ]);
    expect(
      screen.queryByRole("button", { name: "Delete Invitation" }),
    ).toBeNull();
  });

  it("deleting a custom row opens a confirm dialog; cancelling makes no request", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderTab([CUSTOM_DEFINITION]);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete VIP reminder" }),
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
      screen.getByRole("button", { name: "Delete VIP reminder" }),
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

describe("QA — responsive grid (spec §1 AC-7, design §1)", () => {
  it("the debt-chase/preview region uses a grid that stacks below lg (grid + lg:grid-cols-2)", () => {
    const { container } = renderTab();
    const grid = container.querySelector(".grid.gap-6.lg\\:grid-cols-2");
    expect(grid).not.toBeNull();
  });

  it("each grouped table scrolls horizontally inside its own wrap (overflow-x-auto), never the page", () => {
    const { container } = renderTab();
    const scrollWraps = container.querySelectorAll(".overflow-x-auto");
    expect(scrollWraps.length).toBeGreaterThanOrEqual(3); // 3 grouped tables
  });
});
