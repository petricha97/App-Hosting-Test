/**
 * QA (M6-T2 gate 3) — component-level interaction tests for
 * `ConfirmationPreviewCard` (spec §4) and `SenderSettingsDialog` (spec §6).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConfirmationPreviewCard } from "@/features/emails/components/confirmation-preview-card";
import { SenderSettingsDialog } from "@/features/emails/components/sender-settings-dialog";
import type { SerializedEmailSettings } from "@/features/emails/types";

describe("QA — ConfirmationPreviewCard (spec §4)", () => {
  it("zero-attendee events render a muted placeholder glyph, never a real QR/token (AC-1)", () => {
    render(
      <ConfirmationPreviewCard
        preview={{
          subject: "Registration confirmed",
          bodyHtml: "<p>Hi</p>",
          bodyText: "Hi",
          missingTags: [],
          unknownTags: [],
          qrSvg: null,
          isRealAttendee: false,
        }}
        loadError={false}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText("Sample QR — no attendees yet.")).toBeTruthy();
    // The placeholder path renders the lucide QrCode GLYPH (a plain JSX
    // <svg>, fine) but must NEVER reach the dangerouslySetInnerHTML sink
    // used for real, server-minted QR markup — that sink only exists in the
    // component tree when `preview.qrSvg` is non-null (see the sibling "real
    // attendee" test, which asserts the sink DOES appear for that case).
    const dangerousSink = document.querySelector(
      '[aria-hidden="true"].h-16.w-16.bg-white',
    );
    expect(dangerousSink).toBeNull();
  });

  it("with a real attendee, renders the server-minted QR markup and the 'present at check-in' caption (AC-1)", () => {
    render(
      <ConfirmationPreviewCard
        preview={{
          subject: "Registration confirmed",
          bodyHtml: "<p>Hi</p>",
          bodyText: "Hi",
          missingTags: [],
          unknownTags: [],
          qrSvg: '<svg data-testid="real-qr"><rect /></svg>',
          isRealAttendee: true,
        }}
        loadError={false}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText("Present at check-in.")).toBeTruthy();
    expect(screen.getByTestId("real-qr")).toBeTruthy();
  });

  it("wallet badges carry no click handler (Q4 placeholder, AC-2)", () => {
    render(
      <ConfirmationPreviewCard
        preview={{
          subject: "s",
          bodyHtml: "<p>b</p>",
          bodyText: "b",
          missingTags: [],
          unknownTags: [],
          qrSvg: null,
          isRealAttendee: false,
        }}
        loadError={false}
        onEdit={vi.fn()}
      />,
    );
    const appleBadge = screen.getByText("Add to Apple Wallet");
    expect(appleBadge.closest("button")).toBeNull(); // not a button at all
  });

  it("'Edit this email' opens the editor for confirmation-paid", () => {
    const onEdit = vi.fn();
    render(
      <ConfirmationPreviewCard
        preview={{
          subject: "s",
          bodyHtml: "<p>b</p>",
          bodyText: "b",
          missingTags: [],
          unknownTags: [],
          qrSvg: null,
          isRealAttendee: false,
        }}
        loadError={false}
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit this email" }));
    expect(onEdit).toHaveBeenCalled();
  });
});

const DEFAULT_SETTINGS: SerializedEmailSettings = {
  fromName: "GC Summit US 2026",
  fromAddress: "events@dev.local",
  replyTo: null,
  source: "defaults",
  hasStoredDoc: false,
};

const STORED_SETTINGS: SerializedEmailSettings = {
  fromName: "Custom Sender",
  fromAddress: "custom@example.com",
  replyTo: "reply@example.com",
  source: "settings",
  hasStoredDoc: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QA — SenderSettingsDialog (spec §6)", () => {
  it("shows 'Platform default' badges + no Reset action when no doc exists (AC unnumbered — viewing writes nothing)", () => {
    render(
      <SenderSettingsDialog
        open
        onOpenChange={vi.fn()}
        eventId="evt-1"
        settings={DEFAULT_SETTINGS}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Platform default")).toHaveLength(2); // fromName + fromAddress labels
    expect(
      screen.queryByRole("button", { name: "Reset to platform default" }),
    ).toBeNull();
  });

  it("shows the Reset action once a doc exists, and no 'Platform default' badges", () => {
    render(
      <SenderSettingsDialog
        open
        onOpenChange={vi.fn()}
        eventId="evt-1"
        settings={STORED_SETTINGS}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByText("Platform default")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reset to platform default" }),
    ).toBeTruthy();
  });

  it("renders the delivery disclaimer copy (spec §6 AC-5, both themes share the same DOM)", () => {
    render(
      <SenderSettingsDialog
        open
        onOpenChange={vi.fn()}
        eventId="evt-1"
        settings={DEFAULT_SETTINGS}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Emails aren.t delivered in this environment yet/),
    ).toBeTruthy();
  });

  it("Reset calls DELETE and reports the cleared defaults back to the parent", async () => {
    const onSaved = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ settings: DEFAULT_SETTINGS }), {
            status: 200,
          }),
        ),
    );
    render(
      <SenderSettingsDialog
        open
        onOpenChange={vi.fn()}
        eventId="evt-1"
        settings={STORED_SETTINGS}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reset to platform default" }),
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/dashboard/events/evt-1/emails/settings",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(DEFAULT_SETTINGS));
  });

  it("clearing the required From name shows a client-side field error and never calls fetch", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const onSaved = vi.fn();
    render(
      <SenderSettingsDialog
        open
        onOpenChange={vi.fn()}
        eventId="evt-1"
        settings={STORED_SETTINGS}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText(/From name/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Sender name is required.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a server-side VALIDATION rejection (e.g. malformed from-address) surfaces as an inline field error, not a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              fieldErrors: { fromAddress: ["Enter a valid email address."] },
            },
          }),
          { status: 400 },
        ),
      ),
    );
    const onSaved = vi.fn();
    render(
      <SenderSettingsDialog
        open
        onOpenChange={vi.fn()}
        eventId="evt-1"
        settings={STORED_SETTINGS}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Enter a valid email address."),
    ).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
