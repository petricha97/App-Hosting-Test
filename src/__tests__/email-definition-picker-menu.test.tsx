/**
 * M6-T4 — component-level test for `EmailDefinitionPickerMenu` (design §1).
 * Covers: grouped rendering (reusing EMAIL_GROUP_LABELS), the "Designed"
 * badge appearing only for bodyMode === "blocks", and selecting an item
 * calling back with the definition's kind — the caller (emails-workspace.tsx)
 * is responsible for turning that into `forceInitialMode="blocks"` on
 * EmailEditorDialog, asserted separately in
 * email-editor-dialog-interactions.test.tsx.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmailDefinitionPickerMenu } from "@/features/emails/components/email-definition-picker-menu";
import type { SerializedEmailDefinition } from "@/features/emails/types";

function def(
  overrides: Partial<SerializedEmailDefinition> & { kind: string },
): SerializedEmailDefinition {
  return {
    id: `def-${overrides.kind}`,
    name: overrides.kind,
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

const DEFINITIONS: SerializedEmailDefinition[] = [
  def({ kind: "invitation", name: "Invitation", group: "pre-event" }),
  def({
    kind: "confirmation-paid",
    name: "Registration confirmation",
    group: "post-registration",
    bodyMode: "blocks",
    bodyBlocks: [{ id: "hero-1", type: "Hero", props: {} }],
  }),
  def({
    kind: "payment-reminder",
    name: "Payment reminder",
    group: "debt-chase",
  }),
];

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Design existing email" });
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.click(trigger);
}

describe("EmailDefinitionPickerMenu (design §1)", () => {
  it("groups definitions under the same 3 group labels the lifecycle table uses", async () => {
    render(
      <EmailDefinitionPickerMenu
        definitions={DEFINITIONS}
        timeZone="America/New_York"
        onSelect={vi.fn()}
      />,
    );

    openMenu();

    expect(await screen.findByText("Pre-event")).toBeTruthy();
    expect(screen.getByText("Post-registration")).toBeTruthy();
    expect(screen.getByText("Debt chase & countdown")).toBeTruthy();
    expect(screen.getByText("Invitation")).toBeTruthy();
    expect(screen.getByText("Registration confirmation")).toBeTruthy();
    expect(screen.getByText("Payment reminder")).toBeTruthy();
  });

  it('shows a "Designed" badge only for definitions with bodyMode "blocks"', async () => {
    render(
      <EmailDefinitionPickerMenu
        definitions={DEFINITIONS}
        timeZone="America/New_York"
        onSelect={vi.fn()}
      />,
    );

    openMenu();

    await screen.findByText("Registration confirmation");
    expect(screen.getByText("Designed")).toBeTruthy();
    // Exactly one definition (confirmation-paid) is in block mode.
    expect(screen.getAllByText("Designed")).toHaveLength(1);
  });

  it("calls onSelect with the chosen definition's kind", async () => {
    const onSelect = vi.fn();
    render(
      <EmailDefinitionPickerMenu
        definitions={DEFINITIONS}
        timeZone="America/New_York"
        onSelect={onSelect}
      />,
    );

    openMenu();
    const item = await screen.findByText("Invitation");
    fireEvent.pointerDown(item, { button: 0, pointerId: 1 });
    fireEvent.click(item);

    expect(onSelect).toHaveBeenCalledWith("invitation");
  });
});
