import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResponsesTable } from "@/features/responses/components/responses-table";
import type { SerializedResponse } from "@/features/responses/utils";

const refresh = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

function row(overrides: Partial<SerializedResponse> = {}): SerializedResponse {
  return {
    id: "response-1",
    formId: "form-1",
    eventId: "event-1",
    organizationId: "org-1",
    submission: { email: "ada@example.com" },
    submittedAt: null,
    attendeeName: "Ada Lovelace",
    attendeeEmail: "ada@example.com",
    eventName: "GovTech",
    submissionPreview: [],
    status: "accepted",
    attendeeCreated: false,
    ticketLabel: null,
    orderId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function openRetryAction() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Actions for Ada Lovelace" }),
    { button: 0, ctrlKey: false },
  );
  return screen.findByText("Retry attendee creation");
}

describe("responses attendee-repair affordance", () => {
  it("shows the warning and retry action only for accepted incomplete rows", async () => {
    render(<ResponsesTable responses={[row()]} showEventColumn={false} />);

    expect(screen.getByText("Attendee not created")).toBeTruthy();
    const actions = screen.getByRole("button", {
      name: "Actions for Ada Lovelace",
    });
    fireEvent.pointerDown(actions, { button: 0, ctrlKey: false });
    expect(await screen.findByText("Retry attendee creation")).toBeTruthy();
  });

  it.each([
    ["accepted and complete", row({ attendeeCreated: true })],
    ["not accepted", row({ status: "reviewed", attendeeCreated: false })],
  ])("hides the warning and retry action for %s", async (_label, response) => {
    render(<ResponsesTable responses={[response]} showEventColumn={false} />);
    expect(screen.queryByText("Attendee not created")).toBeNull();
    const trigger = screen.queryByRole("button", {
      name: "Actions for Ada Lovelace",
    });
    if (trigger) fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.queryByText("Retry attendee creation")).toBeNull();
  });

  it("posts to the encoded retry URL with an empty object body and disables the row while pending", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ResponsesTable
        responses={[row({ id: "response/a b", eventId: "event/a b" })]}
        showEventColumn={false}
      />,
    );

    fireEvent.click(await openRetryAction());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/events/event%2Fa%20b/responses/response%2Fa%20b/retry-attendee-creation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(
      screen
        .getByRole("button", { name: "Actions for Ada Lovelace" })
        .hasAttribute("disabled"),
    ).toBe(true);
    resolveFetch(new Response(JSON.stringify({ outcome: "repaired" }), { status: 200 }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Attendee created"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("surfaces a structured 500 message without false success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Attendee service is unavailable." }), {
          status: 500,
        }),
      ),
    );
    render(<ResponsesTable responses={[row()]} showEventColumn={false} />);
    fireEvent.click(await openRetryAction());
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Attendee service is unavailable."),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows retry guidance for an unstructured 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );
    render(<ResponsesTable responses={[row()]} showEventColumn={false} />);
    fireEvent.click(await openRetryAction());
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Too many retries — wait a moment."),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
