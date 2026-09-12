// Tests simplified management forms and narrow sales actions without network or Firestore.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationTypeDialog } from "@/features/registration/components/registration-type-dialog";
import { TicketTypeDialog } from "@/features/registration/components/ticket-type-dialog";
import { TicketTypesWorkspace } from "@/features/registration/components/ticket-types-workspace";
import type { SerializedFee } from "@/features/pricing/types";
import type { SerializedTicketType } from "@/features/registration/types";

const { refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/features/ticket-wizard/components/create-ticket-wizard", () => ({
  CreateTicketWizard: () => null,
}));

const audience = {
  id: "audience",
  name: "Delegate",
  code: "DEL",
  capacity: null,
  registeredCount: 0,
};
const ticket: SerializedTicketType = {
  id: "ticket",
  name: "Early Bird",
  code: "EARLY-BIRD",
  capacity: null,
  registeredCount: 0,
  salesStartMs: null,
  salesEndMs: null,
  isOpen: true,
  registrationTypeIds: [audience.id],
};
const callbacks = { onOpenChange: vi.fn(), onSaved: vi.fn() };

// Opens the real registration type form with generated-code creation defaults.
function renderAudience(edit = false) {
  return render(
    <RegistrationTypeDialog
      open
      eventId="event"
      registrationType={edit ? audience : null}
      {...callbacks}
    />,
  );
}
// Opens the secondary ticket form with one eligible registration type.
function renderTicket(editTicket: SerializedTicketType | null = null) {
  return render(
    <TicketTypeDialog
      open
      eventId="event"
      ticketType={editTicket}
      registrationTypes={[audience]}
      timeZone="Asia/Singapore"
      {...callbacks}
    />,
  );
}
// Renders ticket inventory so tests exercise actual row actions and derived status labels.
function renderWorkspace(
  tickets = [ticket],
  fees: SerializedFee[] = tickets.map((entry) => ({
    id: `fee-${entry.id}`,
    name: "Admission",
    ticketTypeId: entry.id,
    registrationTypeId: audience.id,
    currency: "USD",
    basePriceMinor: 1000,
    status: "active",
  })),
) {
  return render(
    <TicketTypesWorkspace
      eventId="event"
      tickets={tickets}
      registrationTypes={[audience]}
      fees={fees}
      timeZone="UTC"
      loadError={false}
    />,
  );
}
// Builds the JSON response expected from management API routes.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Simplified registration type details", () => {
  it("generates codes until manually edited and keeps capacity in advanced settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "new" }));
    vi.stubGlobal("fetch", fetchMock);
    renderAudience();
    expect(screen.queryByLabelText("Code")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Student" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe(
      "STUDENT",
    );
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "CUSTOM" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Student member" },
    });
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe(
      "CUSTOM",
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Limit this audience across all tickets",
      }),
    );
    fireEvent.change(screen.getByLabelText("Audience limit"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "Student member",
      code: "CUSTOM",
      capacity: 30,
    });
  });

  it("keeps a saved audience code after renaming", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", fetchMock);
    renderAudience(true);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Member" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).code).toBe("DEL");
  });

  it("reveals a hidden code collision so the organiser can fix it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ error: "Code already exists.", field: "code" }, 409),
        ),
    );
    renderAudience();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Student" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    await screen.findByLabelText("Code");
    expect(await screen.findByText("Code already exists.")).toBeTruthy();
  });
});

describe("Simplified ticket details", () => {
  it("omits disabled scheduling dates and creates an enabled ticket", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", fetchMock);
    renderTicket();
    expect(screen.queryByLabelText("Available for registration")).toBeNull();
    fireEvent.change(screen.getByLabelText("Ticket name"), {
      target: { value: "Early Bird" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Schedule ticket sales" }),
    );
    fireEvent.change(screen.getByLabelText("Sales open"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Sales close"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Schedule ticket sales" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create ticket type" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      code: "EARLY-BIRD",
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      capacity: null,
    });
  });

  it("preserves a saved ticket's code, sales flag, and event-local dates after renaming", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", fetchMock);
    renderTicket({
      ...ticket,
      isOpen: false,
      salesStartMs: Date.parse("2026-09-30T16:00:00Z"),
      salesEndMs: Date.parse("2026-10-10T15:59:59Z"),
    });
    expect(
      (screen.getByLabelText("Sales open") as HTMLInputElement).value,
    ).toBe("2026-10-01");
    fireEvent.change(screen.getByLabelText("Ticket name"), {
      target: { value: "Full Pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      code: "EARLY-BIRD",
      salesStart: "2026-10-01",
      salesEnd: "2026-10-10",
      isOpen: false,
    });
  });
});

describe("Ticket sales management", () => {
  it("sends only the sales flag, disables pending actions, then displays Paused", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    const button = screen.getByRole("button", {
      name: "Pause sales for Early Bird",
    });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/events/event/tickets/ticket/sales",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: '{"isOpen":false}',
      },
    );
    resolve(json({ ticketTypeId: "ticket", isOpen: false }));
    await screen.findByText("Paused");
    expect(
      screen.getByRole("button", { name: "Resume sales for Early Bird" }),
    ).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows scheduled, ended, paused, sold-out, and selling states", () => {
    const now = Date.now();
    renderWorkspace([
      ticket,
      {
        ...ticket,
        id: "scheduled",
        name: "Future",
        salesStartMs: now + 86_400_000,
      },
      { ...ticket, id: "ended", name: "Past", salesEndMs: now - 86_400_000 },
      { ...ticket, id: "paused", name: "Paused pass", isOpen: false },
      { ...ticket, id: "sold", name: "Full", capacity: 5, registeredCount: 5 },
    ]);
    for (const label of ["On sale", "Scheduled", "Ended", "Paused", "Sold out"])
      expect(screen.getByText(label)).toBeTruthy();
  });

  it("resuming a sold-out ticket does not mark it on sale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ ticketTypeId: "ticket", isOpen: true })),
    );
    renderWorkspace([
      { ...ticket, isOpen: false, capacity: 1, registeredCount: 1 },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Resume sales for Early Bird" }),
    );
    await screen.findByText("Sold out");
    expect(screen.queryByText("On sale")).toBeNull();
  });

  it.each(["missing", "archived", "ineligible"])(
    "requires applicable active pricing when pricing is %s",
    (kind) => {
      const fee: SerializedFee = {
        id: "fee",
        name: "Admission",
        ticketTypeId: ticket.id,
        registrationTypeId:
          kind === "ineligible" ? "other-audience" : audience.id,
        currency: "USD",
        basePriceMinor: 1000,
        status: kind === "archived" ? "archived" : "active",
      };
      renderWorkspace([ticket], kind === "missing" ? [] : [fee]);
      expect(screen.getByText("Needs pricing")).toBeTruthy();
      expect(screen.queryByText("On sale")).toBeNull();
    },
  );

  it("allows active zero-priced tickets to be on sale", () => {
    renderWorkspace(
      [ticket],
      [
        {
          id: "free",
          name: "Free admission",
          ticketTypeId: ticket.id,
          registrationTypeId: audience.id,
          currency: "USD",
          basePriceMinor: 0,
          status: "active",
        },
      ],
    );
    expect(screen.getByText("On sale")).toBeTruthy();
    expect(screen.getByText("Comp")).toBeTruthy();
  });

  it("keeps the existing state and enables retry when pausing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: "Permission denied" }, 403)),
    );
    renderWorkspace();
    fireEvent.click(
      screen.getByRole("button", { name: "Pause sales for Early Bird" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Permission denied",
    );
    expect(screen.getByText("On sale")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Pause sales for Early Bird",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
