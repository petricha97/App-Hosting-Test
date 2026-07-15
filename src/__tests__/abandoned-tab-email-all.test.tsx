/**
 * M6-T3 — AbandonedTab "Email all" wiring (spec m6-lifecycle-triggers.md
 * §7): the M5-T3 disabled button is now live — clicking POSTs the new
 * route, surfaces a result toast, and guards against a double-click while
 * a request is in flight.
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

import { AbandonedTab } from "@/features/attendees/components/abandoned-tab";
import type { SerializedAbandonedDraft } from "@/features/attendees/abandoned";

const DRAFT: SerializedAbandonedDraft = {
  id: "draft-1",
  name: "Ada Lovelace",
  maskedEmail: "@example.com",
  lastStepReached: "summary",
  updatedAtIso: null,
};

function renderTab(drafts: SerializedAbandonedDraft[] = [DRAFT]) {
  return render(
    <AbandonedTab
      eventId="evt-1"
      drafts={drafts}
      onDraftsChange={vi.fn()}
      loadError={false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AbandonedTab — Email all button (spec §7)", () => {
  it("is enabled (no longer the M6 disabled tooltip) when there are abandoned drafts", () => {
    renderTab();
    const button = screen.getByRole("button", { name: /email all/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Email campaigns arrive/i)).toBeNull();
  });

  it("is disabled when there are zero abandoned drafts", () => {
    renderTab([]);
    const button = screen.getByRole("button", { name: /email all/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("POSTs the email-all route and toasts 'N sent, M already emailed'", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ok: true, sent: 2, alreadyEmailed: 1 }),
            { status: 200 },
          ),
        ),
    );

    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /email all/i }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("2 sent, 1 already emailed"),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/dashboard/events/evt-1/drafts/email-all",
      { method: "POST" },
    );
    vi.unstubAllGlobals();
  });

  it("toasts the typed refusal message when the definition is disabled (409)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: "This email is off — turn it on before emailing everyone.",
            }),
            { status: 409 },
          ),
        ),
    );

    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /email all/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "This email is off — turn it on before emailing everyone.",
      ),
    );
    vi.unstubAllGlobals();
  });

  it("client-side in-flight guard: a rapid second click while the first is pending fires only one fetch", async () => {
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

    renderTab();
    const button = screen.getByRole("button", { name: /email all/i });
    fireEvent.click(button);
    fireEvent.click(button); // rapid re-click while in flight
    fireEvent.click(button);

    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify({ ok: true, sent: 1, alreadyEmailed: 0 }), {
        status: 200,
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it("rolls back to enabled and toasts on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /email all/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to email abandoned registrants.",
        expect.objectContaining({ description: expect.any(String) }),
      ),
    );
    expect(
      (screen.getByRole("button", { name: /email all/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    vi.unstubAllGlobals();
  });
});
