import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { EventStatusActions } = await import("@/features/dashboard/components/event-status-actions");

describe("EventStatusActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders the Draft/Published label pair without a duplicate public-page link", () => {
    const draft = render(<EventStatusActions eventId="evt-1" status="Draft" />);
    expect(screen.getByRole("button", { name: "Publish event" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /public page/i })).toBeNull();
    draft.unmount();

    render(<EventStatusActions eventId="evt-1" status="Published" />);
    expect(screen.getByRole("button", { name: "Move to draft" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /public page/i })).toBeNull();
  });

  it("posts the exact inverse-status payload, disables while saving, then refreshes and toasts on success", async () => {
    let resolveFetch!: (response: unknown) => void;
    const pending = new Promise((resolve) => { resolveFetch = resolve; });
    vi.mocked(fetch).mockReturnValue(pending as Promise<Response>);
    render(<EventStatusActions eventId="event / one" status="Draft" />);

    fireEvent.click(screen.getByRole("button", { name: "Publish event" }));
    expect(fetch).toHaveBeenCalledWith("/api/dashboard/events/event / one/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Published" }),
    });
    const saving = screen.getByRole("button", { name: "Updating status" });
    expect((saving as HTMLButtonElement).disabled).toBe(true);

    resolveFetch({ ok: true, json: async () => ({ status: "Published" }) });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith("Event published", {
      description: "The event can now appear in the public events list.",
    });
    expect(screen.getByRole("button", { name: "Publish event" })).toBeTruthy();
  });

  it("retains the original state and shows the server failure toast", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: "Permission denied" }) } as Response);
    render(<EventStatusActions eventId="evt-1" status="Published" />);

    fireEvent.click(screen.getByRole("button", { name: "Move to draft" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Unable to update event status", { description: "Permission denied" }));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Move to draft" })).toBeTruthy();
  });
});
