import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("@measured/puck", () => ({
  Puck: () => <div data-testid="puck-editor" />,
}));

import { EmailEditorDialog } from "@/features/emails/components/email-editor-dialog";
import type {
  EmailComposerTokenSection,
  SerializedEmailDefinition,
} from "@/features/emails/types";

const SYSTEM_DEFINITION: SerializedEmailDefinition = {
  id: "def-invitation",
  kind: "invitation",
  name: "Invitation",
  group: "pre-event",
  trigger: { type: "manual" },
  audience: "all-invitees",
  enabled: true,
  subject: "You're invited - {event_title}",
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

const EMPTY_BLOCKS_DEFINITION: SerializedEmailDefinition = {
  ...CUSTOM_DEFINITION,
  kind: "custom-blocks-empty",
  bodyMode: "blocks",
  bodyBlocks: [],
};

const TOKEN_SECTIONS: EmailComposerTokenSection[] = [
  {
    id: "recipient",
    label: "Recipient",
    items: [
      {
        token: "{{RECIPIENT_NAME}}",
        label: "Recipient name",
        hint: "Full name for the recipient.",
        previewValue: "Sample Person",
      },
    ],
  },
];

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
        tokenSections={TOKEN_SECTIONS}
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
        unknownVariables: [],
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EmailEditorDialog", () => {
  it("renders locked rows for system definition metadata", () => {
    renderDialog(SYSTEM_DEFINITION);

    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Group")).toBeNull();
    expect(screen.queryByLabelText("Audience")).toBeNull();
    expect(screen.getAllByText("Invitation").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("All invitees")).toBeTruthy();
    expect(screen.getAllByText("Pre-event").length).toBeGreaterThanOrEqual(2);
  });

  it("renders editable metadata controls for custom definitions", () => {
    renderDialog(CUSTOM_DEFINITION);
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });

  it("blocks save and shows a field error when a custom name is cleared", async () => {
    const { onSaved } = renderDialog(CUSTOM_DEFINITION);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required.")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([url]) => String(url).includes("/emails/preview"))).toBe(
      true,
    );
  });

  it("submits a PATCH when an existing system definition is edited", async () => {
    const { onSaved } = renderDialog(SYSTEM_DEFINITION);

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "New subject line" },
    });
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

  it("inserts merge tags into the plain-text body", async () => {
    renderDialog(CUSTOM_DEFINITION);

    const textarea = screen.getByLabelText("Body") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Join us, {first_name}.");

    const trigger = screen.getByRole("button", { name: "Insert field" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);

    const item = await screen.findByRole("menuitem", {
      name: /Insert QR code/i,
    });
    fireEvent.pointerDown(item, { button: 0, pointerId: 1 });
    fireEvent.click(item);

    await waitFor(() => expect(textarea.value).toContain("{qr_code}"));
  });

  it("inserts recipient variables into the plain-text body", async () => {
    renderDialog(CUSTOM_DEFINITION);

    const textarea = screen.getByLabelText("Body") as HTMLTextAreaElement;
    const trigger = screen.getByRole("button", { name: "Insert field" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);

    const item = await screen.findByRole("menuitem", {
      name: /Insert Recipient name/i,
    });
    fireEvent.pointerDown(item, { button: 0, pointerId: 1 });
    fireEvent.click(item);

    await waitFor(() =>
      expect(textarea.value).toContain("{{RECIPIENT_NAME}}"),
    );
  });

  it("debounces preview fetches", async () => {
    vi.useFakeTimers();
    renderDialog(CUSTOM_DEFINITION);

    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Updated subject" },
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/emails/preview");
    expect(JSON.parse((init as RequestInit).body as string).subject).toBe(
      "Updated subject",
    );
  });

  it("shows the discard guard when Cancel is pressed on a dirty form", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "dirty edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard changes?")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("keeps the editor open when discard confirmation is cancelled", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "dirty edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes the editor when discard confirmation is accepted", async () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "dirty edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("closes immediately when the form is clean", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the form dirty when switching to Visual editor", () => {
    const { onOpenChange } = renderDialog(CUSTOM_DEFINITION);

    fireEvent.click(screen.getByRole("button", { name: "Visual editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard changes?")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("honors forceInitialMode without marking the form dirty", () => {
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
        .getByRole("button", { name: "Visual editor" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
  });

  it("disables test send for an empty visual canvas but keeps Save enabled", () => {
    renderDialog(EMPTY_BLOCKS_DEFINITION);

    const testSendButton = screen.getByRole("button", {
      name: "Send test",
    }) as HTMLButtonElement;
    const saveButton = screen.getByRole("button", {
      name: "Save",
    }) as HTMLButtonElement;

    expect(testSendButton.disabled).toBe(true);
    expect(saveButton.disabled).toBe(false);
  });

  it("shows the visual-editor canvas and empty-state message", () => {
    renderDialog(EMPTY_BLOCKS_DEFINITION);

    expect(
      screen.getByText(
        "This email has no content blocks yet. Drag a block from the panel to start building the message.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("puck-editor")).toBeTruthy();
  });
});
