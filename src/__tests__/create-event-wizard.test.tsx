/**
 * CreateEventWizard — the create-only stepped flow (spec:
 * scratchpad/wizard-impl-spec.md). Locks the behaviors that make the wizard
 * trustworthy:
 *  - Step 1 (required Details) blocks Next until valid, then advances.
 *  - Steps 3 (Registration) & 4 (Public page) are optional and never block Next
 *    when left empty.
 *  - Step 4 DOES block Next when page mode is "redirect" and the redirect URL
 *    is empty, and unblocks once it is filled.
 *  - Review shows the entered values and each group's Edit link jumps back.
 *  - The Review primary button reads "Submit" for Draft and "Publish event"
 *    for Publish, and submitting reuses the existing create path.
 *
 * Firestore is never touched: @/lib/db/event (createEvent), @/lib/firebase,
 * next/navigation, sonner and AuthContext are all mocked.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
window.scrollTo = vi.fn();

const { routerPush, routerRefresh, toastSuccess, toastError, createEvent } =
  vi.hoisted(() => ({
    routerPush: vi.fn(),
    routerRefresh: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    createEvent: vi.fn().mockResolvedValue("evt-123"),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// Keep firebase client init out of jsdom entirely.
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {} }));

vi.mock("@/lib/db/event", () => ({
  createEvent: (...args: unknown[]) => createEvent(...args),
  serverTimestamp: () => ({ __ts: true }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    organization: { name: "Acme Events" },
    organizationId: "org-1",
    initializing: false,
  }),
}));

import { CreateEventWizard } from "@/features/event/create-event-wizard";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function setInput(label: RegExp | string, value: string) {
  const el = screen.getByLabelText(label) as
    HTMLInputElement | HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

function fillStep1() {
  setInput("Event name", "Product Summit 2026");
  setInput("Description", "A one-day conference for product teams.");
}

function fillStep2() {
  const day = today();
  setInput("Registration start date", day);
  setInput("Registration start time", "09:00");
  setInput("Registration end date", day);
  setInput("Registration end time", "17:00");
  setInput("Start date", day);
  setInput("Start time", "09:00");
  setInput("End date", day);
  setInput("End time", "17:00");
}

function clickNext() {
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
}

// The active step's heading — the stepper reuses some of the same words as the
// card titles ("Date & time", "Public page"), so read the card title slot.
function currentTitle() {
  return document.querySelector('[data-slot="card-title"]')?.textContent ?? "";
}

async function advanceToStep(title: string) {
  await waitFor(() => expect(currentTitle()).toBe(title));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateEventWizard", () => {
  it("blocks Next on step 1 until required details are valid, then advances", async () => {
    render(<CreateEventWizard />);

    // name + description are empty by default -> Next must not advance.
    clickNext();
    await waitFor(() =>
      expect(
        screen.getByLabelText("Event name").getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(currentTitle()).toBe("Event details");

    fillStep1();
    clickNext();
    await advanceToStep("Date & time");
  });

  it("lets optional steps 3 and 4 pass with nothing filled", async () => {
    render(<CreateEventWizard />);

    fillStep1();
    clickNext();
    await advanceToStep("Date & time");

    fillStep2();
    clickNext();
    await advanceToStep("Registration form");

    // Step 3 optional: advance with nothing entered.
    clickNext();
    await advanceToStep("Public page");

    // Step 4 optional (default page mode): advance with nothing entered.
    clickNext();
    await advanceToStep("Review & publish");
  });

  it("blocks Next on step 4 when redirect is chosen without a URL, and unblocks once filled", async () => {
    render(<CreateEventWizard />);

    fillStep1();
    clickNext();
    await advanceToStep("Date & time");
    fillStep2();
    clickNext();
    await advanceToStep("Registration form");
    clickNext();
    await advanceToStep("Public page");

    fireEvent.click(
      screen.getByRole("radio", { name: /redirect to my own page/i }),
    );
    // redirect URL is now required but empty -> Next blocked.
    clickNext();
    await waitFor(() =>
      expect(
        screen.getByLabelText("Redirect URL").getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(currentTitle()).toBe("Public page");

    setInput("Redirect URL", "https://example.com/my-event");
    clickNext();
    await advanceToStep("Review & publish");
  });

  it("shows entered values on review and jumps back via a group Edit link", async () => {
    render(<CreateEventWizard />);

    fillStep1();
    clickNext();
    await advanceToStep("Date & time");
    fillStep2();
    clickNext();
    await advanceToStep("Registration form");
    clickNext();
    await advanceToStep("Public page");
    clickNext();
    await advanceToStep("Review & publish");

    // Review reflects the entered values.
    expect(screen.getByText("Product Summit 2026")).toBeTruthy();
    expect(screen.getByText("Asia/Singapore")).toBeTruthy();

    // The Event details group's Edit link returns to step 1.
    const detailsGroup = screen
      .getByText("Event details")
      .closest("div") as HTMLElement;
    fireEvent.click(within(detailsGroup).getByRole("button", { name: "Edit" }));

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Event name") as HTMLInputElement).value,
      ).toBe("Product Summit 2026"),
    );
  });

  it("labels the review button Submit for Draft and Publish event for Publish, and submits via the create path", async () => {
    render(<CreateEventWizard />);

    fillStep1();
    clickNext();
    await advanceToStep("Date & time");
    fillStep2();
    clickNext();
    await advanceToStep("Registration form");
    clickNext();
    await advanceToStep("Public page");
    clickNext();
    await advanceToStep("Review & publish");

    // Draft is the default -> primary button reads "Submit".
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish event" })).toBeNull();

    // Choosing Publish flips the label.
    fireEvent.click(screen.getByRole("radio", { name: /publish now/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Publish event" }),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish event" }));
    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    const payload = createEvent.mock.calls[0][0] as {
      status: string;
      formPath: string;
      organizationPath: string;
      name: string;
    };
    expect(payload.status).toBe("Published");
    expect(payload.formPath).toBe("Form/pending");
    expect(payload.organizationPath).toBe("Organization/org-1");
    expect(payload.name).toBe("Product Summit 2026");
    expect(routerPush).toHaveBeenCalledWith("/dashboard/events/evt-123");
  });
});
