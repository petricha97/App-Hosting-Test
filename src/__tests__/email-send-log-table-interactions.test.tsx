/**
 * QA (M6-T2 gate 3) — component-level interaction test for `SendLogTable`.
 * Spec refs: §5 AC-1 (empty state), AC-3 (mutually-exclusive status/kind
 * filters), AC-4 (retry — failed-only, 409 race), AC-7 (lastError plain
 * text), §8-4 (deleted/unknown kind renders the raw-kind badge, never a
 * crash or hidden row).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

// jsdom lacks these APIs; Radix's Select uses them when opening/scrolling
// its listbox via pointer interaction. Stubbing them (rather than mocking
// the whole Select primitive away) lets the REAL component be driven the
// same way a user would — click the trigger, click an option.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import { SendLogTable } from "@/features/emails/components/send-log-table";
import type { SerializedEmailMessage } from "@/features/emails/types";

function message(
  overrides: Partial<SerializedEmailMessage>,
): SerializedEmailMessage {
  return {
    id: "msg-1",
    kind: "test",
    definitionId: null,
    recipient: { name: "Jane Doe", email: "jane@example.com" },
    subject: "Hello",
    bodyHtml: "<p>Hi</p>",
    bodyText: "Hi",
    status: "sent",
    attemptCount: 1,
    lastError: null,
    providerMessageId: "dev-1",
    queuedAtMs: 1000,
    sentAtMs: 2000,
    failedAtMs: null,
    createdAtMs: 500,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QA — send log: empty + deleted/unknown-kind rows never crash (spec §5 AC-1, §8-4)", () => {
  it("renders the empty state when there are no messages", () => {
    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()}
        initialMessages={[]}
        initialCount={0}
        initialNextCursor={null}
      />,
    );
    expect(screen.getByText("No emails sent yet")).toBeTruthy();
  });

  it("renders a raw-kind badge (not a crash, not a hidden row) for a kind matching no known definition", () => {
    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()} // empty — "deleted-custom-kind" resolves to nothing
        initialMessages={[message({ kind: "deleted-custom-kind" })]}
        initialCount={1}
        initialNextCursor={null}
      />,
    );
    expect(screen.getByText("deleted-custom-kind")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy(); // row still rendered
  });
});

describe("QA — send log: retry (spec §5 AC-4)", () => {
  it("shows the Retry button only on failed rows", () => {
    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()}
        initialMessages={[
          message({ id: "sent-1", status: "sent" }),
          message({ id: "failed-1", status: "failed" }),
          message({ id: "queued-1", status: "queued" }),
        ]}
        initialCount={3}
        initialNextCursor={null}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("a successful retry updates the row status in place and toasts success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: message({
              id: "failed-1",
              status: "sent",
              attemptCount: 2,
            }),
          }),
          { status: 200 },
        ),
      ),
    );

    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()}
        initialMessages={[
          message({ id: "failed-1", status: "failed", attemptCount: 1 }),
        ]}
        initialCount={1}
        initialNextCursor={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/dashboard/events/evt-1/emails/messages/failed-1/retry",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Email resent"),
    );
    // Sent rows never show a Retry affordance.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("a raced 409 retry (already sent) toasts the calm error and refetches — no duplicate-send appearance", async () => {
    const fetchMock = vi
      .fn()
      // First call: the retry POST itself, races to 409.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "NOT_RETRYABLE" }), {
          status: 409,
        }),
      )
      // Second call: the in-place refetch after the 409.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [message({ id: "failed-1", status: "sent" })],
            count: 1,
            nextCursor: null,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()}
        initialMessages={[message({ id: "failed-1", status: "failed" })]}
        initialCount={1}
        initialNextCursor={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("This email was already sent"),
    );
    // The refetch landed the row as "sent" — Retry disappears, no duplicate row.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("QA — send log row detail: lastError renders as plain text (spec §5 AC-7)", () => {
  it("a lastError.message containing HTML-looking text renders as literal text, not interpreted markup", () => {
    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()}
        initialMessages={[
          message({
            id: "failed-1",
            status: "failed",
            lastError: {
              message: "<img src=x onerror=alert(1)>Delivery refused",
              atMs: 1000,
            },
          }),
        ]}
        initialCount={1}
        initialNextCursor={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand details" }));

    // The literal text (including the angle brackets) is visible as TEXT —
    // if this were interpreted as HTML, no <img> element or alert would ever
    // fire in a real browser either way (React always escapes text content),
    // but this assertion locks that no `dangerouslySetInnerHTML` sneaks in
    // later: the exact literal string, tags included, must be in the DOM as
    // text.
    expect(
      screen.getByText("<img src=x onerror=alert(1)>Delivery refused"),
    ).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("QA — send log filters: status/kind are mutually exclusive (spec §5 AC-3)", () => {
  it("selecting a status resets the kind filter to 'all' (onFilterChange reports status only)", async () => {
    const onFilterChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ messages: [], count: 0, nextCursor: null }),
          {
            status: 200,
          },
        ),
      ),
    );

    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()}
        initialMessages={[message({})]}
        initialCount={1}
        initialNextCursor={null}
        kindOptions={[{ value: "invitation", label: "Invitation" }]}
        onFilterChange={onFilterChange}
      />,
    );

    // First, select a kind (the second combobox).
    const [, kindTrigger] = screen.getAllByRole("combobox");
    fireEvent.click(kindTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Invitation" }));
    await waitFor(() =>
      expect(onFilterChange).toHaveBeenLastCalledWith({
        status: "all",
        kind: "invitation",
      }),
    );

    // Now select a status — the kind filter must reset to "all", never both
    // set simultaneously (mutually exclusive per spec §5 AC-3).
    const [statusTrigger] = screen.getAllByRole("combobox");
    fireEvent.click(statusTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Failed" }));

    await waitFor(() =>
      expect(onFilterChange).toHaveBeenLastCalledWith({
        status: "failed",
        kind: "all",
      }),
    );
  });

  it("the mutual-exclusion disclaimer copy renders when both filters are available", () => {
    render(
      <SendLogTable
        eventId="evt-1"
        definitionsByKind={new Map()}
        initialMessages={[message({})]}
        initialCount={1}
        initialNextCursor={null}
        kindOptions={[{ value: "invitation", label: "Invitation" }]}
      />,
    );
    expect(
      screen.getByText("Filter by status or by email — not both at once."),
    ).toBeTruthy();
  });
});
