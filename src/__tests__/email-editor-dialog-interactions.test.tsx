/**
 * QA (M6-T2 gate 3) — component-level interaction test for
 * `EmailEditorDialog`. Closes the Full-Stack Developer's self-reported gap
 * ("no component-level interaction testing was done") for: RHF/Zod client
 * validation, the debounced live-preview fetch, merge-tag insertion at the
 * cursor, the unsaved-changes discard guard, and locked-field rendering on
 * system definitions. Spec refs: §3 AC-1..AC-7.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// jsdom has no ResizeObserver; Radix's Switch (via @radix-ui/react-use-size)
// requires one to mount. Minimal no-op stub, same shape every other
// jsdom-based Radix test suite in the ecosystem uses. (Also registered
// globally via vitest.config.mts's setupFiles for @dnd-kit/dom's
// module-top-level usage — this local stub stays too, for defense in depth
// and to match every other jsdom-based Radix suite in this app.)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// M6-T4: the real <Puck> canvas cannot mount in jsdom (iframe canvas / DnD) —
// same precedent as event-page-editor-discard.test.tsx. The Block-designer
// tests below exercise the SURROUNDING dialog chrome (mode toggle dirty
// tracking, empty-canvas Test-send gating), never the canvas's own
// drag-and-drop, so a placeholder is the correct-fidelity stub here.
vi.mock("@measured/puck", () => ({
  Puck: () => <div data-testid="puck-editor" />,
}));

import { EmailEditorDialog } from "@/features/emails/components/email-editor-dialog";
import type { SerializedEmailDefinition } from "@/features/emails/types";

const SYSTEM_DEFINITION: SerializedEmailDefinition = {
  id: "def-invitation",
  kind: "invitation",
  name: "Invitation",
  group: "pre-event",
  trigger: { type: "manual" },
  audience: "all-invitees",
  enabled: true,
  subject: "You're invited — {event_title}",
  body: "Join us, {first_name}.",
  isSystem: true,
  sortOrder: 0,
  materialized: false,
  createdAtMs: null,
  bodyMode: "text",
  bodyBlocks: [],
};

const CUSTOM_DEFINITION: SerializedEmailDefinition = {
  ...SYSTEM_DEFINITION,
  id: "def-custom",
  kind: "custom-abc",
  name: "VIP reminder",
  isSystem: false,
  materialized: true,
};

// M6-T4: a block-mode definition whose canvas has never had a block dragged
// in (design §5's "empty canvas" state).
const EMPTY_BLOCKS_DEFINITION: SerializedEmailDefinition = {
  ...CUSTOM_DEFINITION,
  kind: "custom-blocks-empty",
  bodyMode: "blocks",
  bodyBlocks: [],
};

function fetchOk(body: unknown = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function renderDialog(
  definition: SerializedEmailDefinition | null,
  onSaved = vi.fn(),
  onOpenChange = vi.fn(),
) {
  return {
    onSaved,
    onOpenChange,
    ...render(
      <EmailEditorDialog
        open
        onOpenChange={onOpenChange}
        eventId="evt-1"
        timeZone="America/New_York"
        definitionsByKind={new Map()}
        definition={definition}
        onSaved={onSaved}
      />,
    ),
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      fetchOk({
        subject: "rendered subject",
        bodyHtml: "<p>rendered body</p>",
        bodyText: "rendered body",
        missingTags: [],
        unknownTags: [],
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("QA — system-definition locked fields render as read-only display, not disabled inputs (spec §3 AC-5)", () => {
  it("Name/Group/Audience are LockedRow text, not editable controls, for isSystem:true", () => {
    renderDialog(SYSTEM_DEFINITION);

    // Locked rows render the value as plain text with no associated <input>.
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Group")).toBeNull();
    expect(screen.queryByLabelText("Audience")).toBeNull();
    // "Invitation" appears twice on purpose (dialog title + the locked Name
    // row) — asserting >=1 plain-text occurrence (not an <input>) is the
    // actual property under test.
    expect(screen.getAllByText("Invitation").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("All invitees")).toBeTruthy(); // locked Audience row value
    expect(screen.getAllByText("Pre-event").length).toBeGreaterThanOrEqual(2); // dialog description + locked Group row
  });

  it("custom definitions render live Name/Group/Audience controls", () => {
    renderDialog(CUSTOM_DEFINITION);
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });
});

describe("QA — RHF + Zod client validation (spec §3, custom create)", () => {
  it("blocks save and shows a field error when a custom definition's Name is cleared", async () => {
    const { onSaved } = renderDialog(CUSTOM_DEFINITION);

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required.")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    // Only the debounced preview POST should have fired — never a save PATCH/POST.
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.every(([url]) => String(url).includes("/emails/preview")),
    ).toBe(true);
  });

  it("submits a PATCH with the edited subject for an existing system definition", async () => {
    const { onSaved } = renderDialog(SYSTEM_DEFINITION);

    const subjectInput = screen.getByLabelText("Subject");
    fireEvent.change(subjectInput, { target: { value: "New subject line" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        (fetch as ReturnType<typeof vi.fn>).mock.calls.some(
          ([url, init]) =>
            String(url).includes("/emails/definitions/invitation") &&
            (init as RequestInit)?.method === "PATCH",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("QA — merge-tag insertion at cursor (spec §3 AC-2)", () => {
  it("inserts the selected tag into the body textarea", async () => {
    renderDialog(CUSTOM_DEFINITION);

    const textarea = screen.getByLabelText("Body") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Join us, {first_name}.");

    const trigger = screen.getByRole("button", { name: "Insert merge tag" });
    // Radix's DropdownMenuTrigger opens on pointerdown, not a bare click —
    // jsdom needs both events fired explicitly (same requirement as Radix
    // Select elsewhere in this app's test suite).
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    const item = await screen.findByRole("menuitem", {
      name: /Insert .*QR code.* merge tag/i,
    });
    fireEvent.pointerDown(item, { button: 0, pointerId: 1 });
    fireEvent.click(item);

    await waitFor(() => expect(textarea.value).toContain("{qr_code}"));
  });
});

describe("QA — debounced live preview (spec §3 AC-4, design 400ms debounce)", () => {
  it("does not fire the preview request before the debounce window elapses, then fires exactly once", async () => {
    vi.useFakeTimers();
    renderDialog(CUSTOM_DEFINITION);

    // The initial mount schedules one debounce timer; nothing has fired yet.
    expect(fetch).not.toHaveBeenCalled();

    const subjectInput = screen.getByLabelText("Subject");
    fireEvent.change(subjectInput, { target: { value: "Updated subject" } });

    // Still within the debounce window.
    await vi.advanceTimersByTimeAsync(300);
    expect(fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    // Exactly once: the mount-time debounce timer (scheduled with the
    // unedited defaults) is cancelled by the effect's cleanup when the
    // subject changes before it fires, so only the post-edit timer survives
    // to actually call fetch.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/emails/preview");
    expect(JSON.parse((init as RequestInit).body as string).subject).toBe(
      "Updated subject",
    );
  });
});

describe("QA — unsaved-changes guard (spec §3 AC-7, design 'attemptClose')", () => {
  // QA-D-1 (FIXED — see agents/docs/qa/m6-emails-admin.md): `attemptClose`
  // (email-editor-dialog.tsx) previously read `form.formState.isDirty` only
  // inside an event-handler callback, never during render, so React Hook
  // Form's formState Proxy never subscribed that field and `isDirty` stayed
  // permanently `false`. Fixed by destructuring `const { isDirty } =
  // form.formState;` during render (alongside the other `form.watch(...)`
  // calls) and referencing that local binding inside `attemptClose`.
  it("QA-D-1: dirty form + Cancel opens the discard-confirm dialog instead of closing", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "dirty edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard changes?")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("QA-D-1: 'Cancel' on the discard dialog keeps the editor open", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "dirty edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard changes?")).toBeTruthy();

    // Both the dialog's own "Cancel" button and the AlertDialog's "Cancel"
    // button are in the DOM at this point (the underlying editor dialog
    // stays mounted/open) — the AlertDialogCancel is the one rendered last.
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("QA-D-1: 'Discard' on the discard dialog actually closes the editor", async () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "dirty edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard changes?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("closes immediately with no guard when the form is clean (correct either way)", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("QA — M6-T4 mode toggle dirty-tracking (design §2, the exact QA-D-1 bug class)", () => {
  // QA-D-1's bug was "isDirty read only inside a callback, never during
  // render, so RHF's formState Proxy never subscribed the field." The mode
  // toggle writes through `form.setValue("bodyMode", next, { shouldDirty:
  // true })` on the SAME form instance (not a parallel useState) — this
  // test proves a MODE-ONLY switch, with no other field touched, is enough
  // to trip the existing guard.
  it("switching to Block designer with no other edits trips the unsaved-changes guard on Cancel", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);

    fireEvent.click(screen.getByRole("button", { name: "Block designer" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard changes?")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("opens already in Block-designer mode (aria-pressed) when forceInitialMode is set, without marking the form dirty", () => {
    const onOpenChangeSpy = vi.fn();
    render(
      <EmailEditorDialog
        open
        onOpenChange={onOpenChangeSpy}
        eventId="evt-1"
        timeZone="America/New_York"
        definitionsByKind={new Map()}
        definition={CUSTOM_DEFINITION}
        onSaved={vi.fn()}
        forceInitialMode="blocks"
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Block designer" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    // forceInitialMode only changes the INITIAL default value snapshot the
    // form resets to — it must not itself count as a user edit.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
  });
});

describe("QA — M6-T4 empty block canvas (design §5): blocks Test-send, never Save", () => {
  it("disables Test-send with a tooltip reason but leaves Save enabled", () => {
    renderDialog(EMPTY_BLOCKS_DEFINITION);

    const testSendButton = screen.getByRole("button", {
      name: "Send test",
    }) as HTMLButtonElement;
    expect(testSendButton.disabled).toBe(true);

    const saveButton = screen.getByRole("button", {
      name: "Save",
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it("shows the block-designer canvas region and the empty-canvas warning copy", () => {
    renderDialog(EMPTY_BLOCKS_DEFINITION);

    expect(
      screen.getByText(
        "This email has no content blocks yet — drag a block from the panel to add content.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("puck-editor")).toBeTruthy();
  });
});
