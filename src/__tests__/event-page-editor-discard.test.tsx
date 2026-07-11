/**
 * QA-M4-D1 (Minor, M4-T2 builder switcher) — FIXED. "Discard and switch"
 * previously only navigated: the workspace persists every edit to the
 * per-page localStorage cache (`event-page-editor-cache:{eventId}:{pageKey}`),
 * so the "discarded" edits silently restored on the next visit. The confirm
 * action now clears the old page's cache entry before navigating (design
 * spec §5: "Discard unsaved changes to this page?").
 *
 * These tests lock the switcher guard end to end: dialog gating, cancel,
 * confirm navigation, and the discard-actually-discards regression.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The Puck editor cannot mount in jsdom (iframe canvas / DnD); the workspace
// logic under test does not depend on it.
vi.mock("@measured/puck", () => ({
  Puck: () => <div data-testid="puck-editor" />,
  Render: () => <div data-testid="puck-render" />,
}));

// Radix Select needs pointer-capture APIs jsdom lacks; replace it with a
// functional stub that exposes one button per option value so the test can
// drive onValueChange exactly like a user picking "Sponsors" in the switcher.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    onValueChange,
    children,
  }: {
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <div>
      <button
        type="button"
        data-testid="switch-to-path-1"
        onClick={() => onValueChange("path-1")}
      >
        switch to path-1
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { EventPageEditorWorkspace } from "@/features/event-pages/components/event-page-editor-workspace";
import type { SerializedEventPage } from "@/features/event-pages/utils";

const EVENT_ID = "evt-1";
const DEFAULT_CACHE_KEY = `event-page-editor-cache:${EVENT_ID}:default`;

const DEFAULT_PAGE: SerializedEventPage = {
  id: "page-default",
  eventId: EVENT_ID,
  organizationId: "org-1",
  pageKey: "default",
  title: "Summit page",
  status: "draft",
  storagePrefix: "organizations/org-1/events/evt-1/event-pages",
  draftContent: {
    content: [
      { type: "Hero", props: { id: "hero-1", heading: "Saved heading" } },
    ],
    root: {},
    zones: {},
  },
  publishedContent: null,
  createdAtSeconds: null,
  updatedAtSeconds: null,
};

function renderWorkspace() {
  return render(
    <EventPageEditorWorkspace
      eventId={EVENT_ID}
      eventName="Summit"
      pageMode="custom"
      redirectUrl=""
      initialEventPage={DEFAULT_PAGE}
      defaultEventPage={DEFAULT_PAGE}
      form={null}
      paths={[{ id: "path-1", name: "Sponsors", isActive: true }]}
      editingPathId={null}
      pricingTickets={null}
      countdown={{ eventStartIso: null, timezone: "UTC" }}
      registrationState="no_paths"
    />,
  );
}

async function makeDirtyAndRequestSwitch() {
  const titleInput = await screen.findByLabelText("Page title");
  fireEvent.change(titleInput, { target: { value: "UNSAVED edited title" } });
  fireEvent.click(screen.getByTestId("switch-to-path-1"));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assets: [] }),
    }),
  );
});

describe("page switcher unsaved-edits guard (M4-T2, review S3 flow)", () => {
  it("switches immediately without a dialog when there are no unsaved edits", async () => {
    renderWorkspace();
    await screen.findByLabelText("Page title");

    fireEvent.click(screen.getByTestId("switch-to-path-1"));

    expect(routerPush).toHaveBeenCalledWith(
      `/dashboard/events/${EVENT_ID}/page-builder?path=path-1`,
    );
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  it("gates a dirty switch behind the confirm dialog; cancel stays put", async () => {
    renderWorkspace();
    await makeDirtyAndRequestSwitch();

    // No navigation yet — the dialog decides.
    expect(routerPush).not.toHaveBeenCalled();
    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("navigates to the requested page after confirming the discard", async () => {
    renderWorkspace();
    await makeDirtyAndRequestSwitch();

    fireEvent.click(
      await screen.findByRole("button", { name: "Discard and switch" }),
    );

    expect(routerPush).toHaveBeenCalledWith(
      `/dashboard/events/${EVENT_ID}/page-builder?path=path-1`,
    );
  });

  // QA-M4-D1 — FIXED: confirming "Discard and switch" clears the old page's
  // localStorage cache entry before navigating, so the "discarded" edits can
  // no longer resurrect on the next visit (dialog copy + design §5 honored).
  it("confirmed discard clears the old page's cached unsaved edits (QA-M4-D1)", async () => {
    renderWorkspace();
    await makeDirtyAndRequestSwitch();

    fireEvent.click(
      await screen.findByRole("button", { name: "Discard and switch" }),
    );

    const cached = window.localStorage.getItem(DEFAULT_CACHE_KEY);
    expect(cached ?? "").not.toContain("UNSAVED edited title");
  });
});
