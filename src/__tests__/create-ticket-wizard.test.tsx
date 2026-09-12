// Exercises the approved creation flow, including retained drafts, API errors,
// generated identifiers, and default audiences. All writes use mocked fetch.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTicketWizard } from "@/features/ticket-wizard/components/create-ticket-wizard";
import type { SerializedRegistrationType } from "@/features/registration/types";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const audiences: SerializedRegistrationType[] = [
  {
    id: "rt-1",
    name: "Delegate",
    code: "DEL",
    capacity: null,
    registeredCount: 0,
  },
  {
    id: "rt-2",
    name: "Press",
    code: "PRESS",
    capacity: 20,
    registeredCount: 0,
  },
];

// Builds endpoint-shaped responses without involving real services.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// Opens a fresh wizard and returns its observable save/close callbacks.
function openWizard(registrationTypes = audiences) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const view = render(
    <CreateTicketWizard
      open
      onOpenChange={onOpenChange}
      eventId="evt-1"
      registrationTypes={registrationTypes}
      timeZone="Asia/Singapore"
      onSaved={onSaved}
    />,
  );
  return { ...view, onOpenChange, onSaved };
}

// Edits an accessible input using its label.
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

// Advances the active step through the same button an organiser uses.
function next() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

// Opens a disclosure and waits for its lazily rendered field to mount.
async function advanced(field = "Ticket code", label = "Advanced settings") {
  if (!screen.queryByLabelText(field)) fireEvent.click(screen.getByText(label));
  await screen.findByLabelText(field);
}

// Completes basic ticket details; the code is generated automatically.
async function toAudience() {
  change("Ticket name", "Early Bird");
  next();
  await screen.findByText("Step 2 of 3 · Audience & price");
}

// Selects and prices a real audience, then advances to the publication summary.
async function toReview() {
  await toAudience();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Delegate" }));
  change("Price for Delegate", "75.00");
  next();
  await screen.findByText("Step 3 of 3 · Review & publish");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Ticket details", () => {
  it("requires a name while keeping codes, dates, quantity, and availability out of the default form", async () => {
    openWizard();
    expect(screen.queryByLabelText("Ticket code")).toBeNull();
    expect(screen.queryByLabelText("Sales open")).toBeNull();
    expect(screen.queryByLabelText("Number of tickets")).toBeNull();
    expect(screen.queryByLabelText("Available for registration")).toBeNull();
    next();
    await screen.findByText("Name is required.");
    await toAudience();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tracks the name across navigation until a manual code edit, then preserves the override", async () => {
    openWizard();
    change("Ticket name", "Early Bird");
    await advanced();
    expect(screen.getByLabelText("Ticket code")).toHaveProperty(
      "value",
      "EARLY-BIRD",
    );
    next();
    await screen.findByText("Step 2 of 3 · Audience & price");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    change("Ticket name", "Full Pass");
    expect(screen.getByLabelText("Ticket code")).toHaveProperty(
      "value",
      "FULL-PASS",
    );
    change("Ticket code", "custom");
    next();
    await screen.findByText("Step 2 of 3 · Audience & price");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    change("Ticket name", "Renamed Pass");
    expect(screen.getByLabelText("Ticket code")).toHaveProperty(
      "value",
      "CUSTOM",
    );
  });

  it("reveals an invalid manually edited code after its advanced section is closed", async () => {
    openWizard();
    change("Ticket name", "Early Bird");
    await advanced();
    change("Ticket code", "?");
    fireEvent.click(screen.getByText("Advanced settings"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Ticket code")).toBeNull(),
    );
    next();
    await screen.findByLabelText("Ticket code");
    expect(screen.getByLabelText("Ticket code")).toHaveProperty("value", "?");
    expect(screen.getByText("Step 1 of 3 · Ticket details")).toBeTruthy();
  });

  it("validates date order and retains schedule and quantity choices across navigation", async () => {
    openWizard();
    change("Ticket name", "Early Bird");
    fireEvent.click(screen.getByRole("radio", { name: "Set quantity" }));
    change("Number of tickets", "100");
    fireEvent.click(
      screen.getByRole("switch", { name: "Schedule ticket sales" }),
    );
    change("Sales open", "2026-10-10");
    change("Sales close", "2026-10-01");
    next();
    await screen.findByText("Sales end must be on or after sales start.");
    change("Sales close", "2026-10-15");
    next();
    await screen.findByText("Step 2 of 3 · Audience & price");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Sales open")).toHaveProperty(
      "value",
      "2026-10-10",
    );
    expect(screen.getByLabelText("Number of tickets")).toHaveProperty(
      "value",
      "100",
    );
  });

  it("omits disabled dates from both review and published payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ ticketTypeId: "ticket" }));
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = openWizard();
    fireEvent.click(
      screen.getByRole("switch", { name: "Schedule ticket sales" }),
    );
    change("Sales open", "2026-10-10");
    change("Sales close", "2026-10-01");
    fireEvent.click(
      screen.getByRole("switch", { name: "Schedule ticket sales" }),
    );
    await toReview();
    expect(screen.getByText("Starts on publish · No end date")).toBeTruthy();
    expect(screen.queryByText(/2026-10-10/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish ticket" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      name: "Early Bird",
      code: "EARLY-BIRD",
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      capacity: null,
      prices: [{ registrationTypeId: "rt-1", basePriceMinor: 7500 }],
    });
  });
});

describe("Audience and price", () => {
  it("requires an audience and a valid price, accepts free tickets, and retains prices when unchecked", async () => {
    openWizard();
    await toAudience();
    next();
    await screen.findByText("Select at least one registration type.");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Delegate" }));
    next();
    await screen.findByText(
      "Enter a non-negative amount with at most 2 decimals, e.g. 750.00.",
    );
    change("Price for Delegate", "0");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Delegate" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Delegate" }));
    expect(screen.getByLabelText("Price for Delegate")).toHaveProperty(
      "value",
      "0",
    );
    next();
    await screen.findByText("Step 3 of 3 · Review & publish");
    expect(screen.getByText("Comp")).toBeTruthy();
  });

  it("saves an inline audience immediately with its entered price and never rolls it back on closing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ registrationTypeId: "new" }));
    vi.stubGlobal("fetch", fetchMock);
    const { onOpenChange } = openWizard();
    await toAudience();
    fireEvent.click(
      screen.getByRole("button", { name: "Add registration type" }),
    );
    change("Registration type name", "Student");
    change("Price for this ticket (USD)", "25.00");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Back" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add & include" }));
    await screen.findByLabelText("Price for Student");
    expect(screen.getByLabelText("Price for Student")).toHaveProperty(
      "value",
      "25.00",
    );
    expect(
      screen
        .getByRole("checkbox", { name: "Include Student" })
        .getAttribute("data-state"),
    ).toBe("checked");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "Student",
      code: "STUDENT",
      capacity: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a mini-form's manual code, reveals collision errors, and adds no failed row", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ error: "Code already in use", field: "code" }, 409),
        ),
    );
    openWizard();
    await toAudience();
    fireEvent.click(
      screen.getByRole("button", { name: "Add registration type" }),
    );
    change("Registration type name", "Student");
    change("Price for this ticket (USD)", "25");
    await advanced("Registration type code");
    change("Registration type code", "CUSTOM");
    change("Registration type name", "Student member");
    expect(screen.getByLabelText("Registration type code")).toHaveProperty(
      "value",
      "CUSTOM",
    );
    fireEvent.click(screen.getByText("Advanced settings"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Registration type code")).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add & include" }));
    await screen.findByText("Code already in use");
    expect(screen.getByLabelText("Registration type code")).toHaveProperty(
      "value",
      "CUSTOM",
    );
    expect(
      screen.queryByRole("checkbox", { name: "Include Student member" }),
    ).toBeNull();
  });

  it("blocks navigation and closing while inline creation is saving", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const { onOpenChange } = openWizard();
    await toAudience();
    fireEvent.click(
      screen.getByRole("button", { name: "Add registration type" }),
    );
    change("Registration type name", "Student");
    change("Price for this ticket (USD)", "25");
    fireEvent.click(screen.getByRole("button", { name: "Add & include" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => finish(json({ registrationTypeId: "student" })));
    await screen.findByLabelText("Price for Student");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("General attendee default", () => {
  it("makes no writes on open, then resolves once on Continue and publishes its real id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          registrationTypeId: "general",
          name: "General attendee",
          code: "GENERAL",
          capacity: null,
        }),
      )
      .mockResolvedValueOnce(json({ ticketTypeId: "ticket" }));
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = openWizard([]);
    await toAudience();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("checkbox", { name: "Include General attendee" })
        .getAttribute("data-state"),
    ).toBe("checked");
    next();
    await screen.findByText(
      "Enter a non-negative amount with at most 2 decimals, e.g. 750.00.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    change("Price for General attendee", "40");
    next();
    await screen.findByText("Step 3 of 3 · Review & publish");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/dashboard/events/evt-1/registration-types/default",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    next();
    await screen.findByText("Step 3 of 3 · Review & publish");
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Publish ticket" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).prices).toEqual([
      { registrationTypeId: "general", basePriceMinor: 4000 },
    ]);
  });

  it("retains the default price after failure, retries, and displays the actual reused capacity", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        json({
          registrationTypeId: "general",
          name: "Everyone",
          code: "GENERAL",
          capacity: 75,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    openWizard([]);
    await toAudience();
    change("Price for General attendee", "40");
    await advanced(
      "Limit General attendee across all tickets",
      "Advanced audience settings",
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Limit General attendee across all tickets",
      }),
    );
    change("Audience limit", "100");
    next();
    await screen.findByText(
      "Could not prepare General attendee. Check your connection and try again.",
    );
    expect(screen.getByLabelText("Price for General attendee")).toHaveProperty(
      "value",
      "40",
    );
    next();
    await screen.findByText("Step 3 of 3 · Review & publish");
    expect(screen.getByText("Everyone")).toBeTruthy();
    expect(
      screen.getByText("Audience limit: 75 across all tickets"),
    ).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      capacity: 100,
    });
  });

  it("does not create an excluded default when a custom audience is selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ registrationTypeId: "student" }));
    vi.stubGlobal("fetch", fetchMock);
    openWizard([]);
    await toAudience();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include General attendee" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add registration type" }),
    );
    change("Registration type name", "Student");
    change("Price for this ticket (USD)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Add & include" }));
    await screen.findByLabelText("Price for Student");
    next();
    await screen.findByText("Step 3 of 3 · Review & publish");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/dashboard/events/evt-1/registration-types",
    );
  });
});

describe("Publishing", () => {
  it("reveals a hidden code collision in step one without losing audience prices", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ error: "Code already in use", field: "code" }, 409),
        ),
    );
    const { onSaved } = openWizard();
    await toReview();
    fireEvent.click(screen.getByRole("button", { name: "Publish ticket" }));
    await screen.findByText("Code already in use");
    expect(screen.getByLabelText("Ticket code")).toHaveProperty(
      "value",
      "EARLY-BIRD",
    );
    change("Ticket code", "EB-2026");
    next();
    await screen.findByLabelText("Price for Delegate");
    expect(screen.getByLabelText("Price for Delegate")).toHaveProperty(
      "value",
      "75.00",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("routes removed-audience errors to step two with an actionable banner", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json(
            { error: "Selected audience was removed", field: "prices" },
            400,
          ),
        ),
    );
    openWizard();
    await toReview();
    fireEvent.click(screen.getByRole("button", { name: "Publish ticket" }));
    await screen.findByText("Selected audience was removed");
    expect(screen.getByText("Step 2 of 3 · Audience & price")).toBeTruthy();
  });
});

describe("Immediate-save continuity", () => {
  it("retains a newly created type on instant reopen while refreshed props are still stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ registrationTypeId: "student" })),
    );
    const { rerender, onOpenChange, onSaved } = openWizard();
    await toAudience();
    fireEvent.click(
      screen.getByRole("button", { name: "Add registration type" }),
    );
    change("Registration type name", "Student");
    change("Price for this ticket (USD)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Add & include" }));
    await screen.findByLabelText("Price for Student");
    expect(onSaved).toHaveBeenCalledOnce();
    const props = {
      onOpenChange,
      eventId: "evt-1",
      registrationTypes: audiences,
      timeZone: "UTC",
      onSaved,
    };
    rerender(<CreateTicketWizard {...props} open={false} />);
    rerender(<CreateTicketWizard {...props} open />);
    await toAudience();
    expect(
      screen.getByRole("checkbox", { name: "Include Student" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Price for Student")).toHaveProperty(
      "value",
      "",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses the persisted default on reopen without issuing another ensure request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          registrationTypeId: "general",
          name: "General attendee",
          code: "GENERAL",
          capacity: null,
        }),
      ),
    );
    const { rerender, onOpenChange, onSaved } = openWizard([]);
    await toAudience();
    change("Price for General attendee", "10");
    next();
    await screen.findByText("Step 3 of 3 · Review & publish");
    const props = {
      onOpenChange,
      eventId: "evt-1",
      registrationTypes: [],
      timeZone: "UTC",
      onSaved,
    };
    rerender(<CreateTicketWizard {...props} open={false} />);
    rerender(<CreateTicketWizard {...props} open />);
    await toAudience();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include General attendee" }),
    );
    change("Price for General attendee", "20");
    next();
    await screen.findByText("Step 3 of 3 · Review & publish");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("prevents duplicate publish requests and unlocks retry after a network failure", async () => {
    let reject!: (error: Error) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((_, fail) => {
          reject = fail;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onOpenChange } = openWizard();
    await toReview();
    const publish = screen.getByRole("button", { name: "Publish ticket" });
    fireEvent.click(publish);
    fireEvent.click(publish);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => reject(new Error("offline")));
    expect(publish).toHaveProperty("disabled", false);
    expect(toastError).toHaveBeenCalledWith(
      "Failed to create the ticket.",
      expect.any(Object),
    );
  });
});
