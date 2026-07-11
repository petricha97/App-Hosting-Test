// @vitest-environment node
/**
 * M5-T2 — manual registration route contract
 * (POST /api/dashboard/events/[eventId]/attendees/register):
 * - 401/403/404 gates (write:events, cross-org IDOR-safe);
 * - card paths rejected with the public-flow message; offline paths only;
 * - personal fields validate against the event form's question schema —
 *   missing email -> 400 (T2 AC-7) — before any money movement;
 * - PIPELINE = the public finalize pipeline: placeOrder ("manual:" +
 *   requestId idempotency, method/currency from the PATH doc) →
 *   createAdminFormDataForDraft (synthetic "manual:" draft id) →
 *   transitionAdminFormDataStatus(to: "accepted") which fires the T1 hook;
 * - SOLD_OUT surfaces as a 409 dialog error; a replayed request (terminal
 *   "accepted" -> INVALID_TRANSITION) still returns the same refs (AC-6).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formDataIdFromDraftId } from "@/lib/db/formDataId";

const {
  callOrder,
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminRegistrationPathForEvent,
  getAdminFormForEvent,
  getAdminTicketTypeForEvent,
  validateTicketSelection,
  placeOrder,
  createAdminFormDataForDraft,
  transitionAdminFormDataStatus,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  return {
    callOrder,
    cookies: vi.fn(),
    decodeUser: vi.fn(),
    getAdminUserByEmail: vi.fn(),
    getAdminEventForOrganization: vi.fn(),
    getAdminRegistrationPathForEvent: vi.fn(),
    getAdminFormForEvent: vi.fn(),
    getAdminTicketTypeForEvent: vi.fn(),
    validateTicketSelection: vi.fn(),
    placeOrder: vi.fn(),
    createAdminFormDataForDraft: vi.fn(),
    transitionAdminFormDataStatus: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathForEvent,
}));
vi.mock("@/lib/db/adminForm", () => ({ getAdminFormForEvent }));
vi.mock("@/lib/db/adminTicketType", () => ({ getAdminTicketTypeForEvent }));
vi.mock("@/features/public-registration/server/tickets", () => ({
  validateTicketSelection,
}));
vi.mock("@/lib/orders/place-order", () => ({ placeOrder }));
vi.mock("@/lib/db/adminFormData", () => ({
  createAdminFormDataForDraft,
  transitionAdminFormDataStatus,
}));

import { POST } from "@/app/api/dashboard/events/[eventId]/attendees/register/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const REQUEST_ID = "req-12345678";

const FORM_DATA_ID = formDataIdFromDraftId({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  draftId: `manual:${REQUEST_ID}`,
});

function makePath(overrides: Record<string, unknown> = {}) {
  return {
    id: "path-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Sponsor — Comp",
    code: "SPN-CMP",
    audienceRegistrationTypeId: "rt-1",
    paymentMethod: "comp",
    currency: "USD",
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

const FORM_FIELDS = [
  {
    id: "f1",
    key: "first_name",
    label: "First name",
    type: "text",
    placeholder: "",
    helpText: "",
    required: true,
    isMandatory: true,
    order: 0,
    origin: "mandatory",
  },
  {
    id: "f2",
    key: "last_name",
    label: "Last name",
    type: "text",
    placeholder: "",
    helpText: "",
    required: true,
    isMandatory: true,
    order: 1,
    origin: "mandatory",
  },
  {
    id: "f3",
    key: "email",
    label: "Email",
    type: "email",
    placeholder: "",
    helpText: "",
    required: true,
    isMandatory: true,
    order: 2,
    origin: "mandatory",
  },
];

const SUBMISSION = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@dentsu.com",
};

const successOrder = {
  ok: true as const,
  orderId: "order-1",
  created: true,
  order: {
    id: "order-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: FORM_DATA_ID,
    ticketTypeId: "tick-1",
    registrationTypeId: "rt-1",
    currency: "USD",
    amounts: { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 },
    snapshot: { promoCode: null },
    paymentMethod: "comp",
    paymentStatus: "comped",
  },
};

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/attendees/register`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    pathId: "path-1",
    ticketTypeId: "tick-1",
    registrationTypeId: null,
    submission: SUBMISSION,
    ...overrides,
  };
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;

  cookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: "token" } : undefined),
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Owner",
    picture: "",
    email: "owner@example.com",
  });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "owner" }],
    permissions: ["write:events"],
  });
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    name: "GovTech Conference",
    formPath: "Form/form-1",
  });
  getAdminRegistrationPathForEvent.mockResolvedValue(makePath());
  getAdminFormForEvent.mockResolvedValue({ id: "form-1", fields: FORM_FIELDS });
  validateTicketSelection.mockResolvedValue({
    ok: true,
    ticket: { id: "tick-1" },
    registrationTypeId: "rt-1",
    soldOut: false,
  });
  getAdminTicketTypeForEvent.mockResolvedValue({
    id: "tick-1",
    name: "General Admission",
  });
  placeOrder.mockImplementation(async () => {
    callOrder.push("placeOrder");
    return successOrder;
  });
  createAdminFormDataForDraft.mockImplementation(async () => {
    callOrder.push("createFormData");
    return {
      formDataId: FORM_DATA_ID,
      formData: { id: FORM_DATA_ID },
      created: true,
    };
  });
  transitionAdminFormDataStatus.mockImplementation(async () => {
    callOrder.push("transition");
    return { ok: true, response: { id: FORM_DATA_ID, status: "accepted" } };
  });
});

describe("POST register — gates (T2 AC-9)", () => {
  it("401 without a session cookie; nothing runs", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(401);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("403 for a viewer-permission member (write:events required)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(403);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("404 for a cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(404);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("404 for a cross-org/unknown path", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(null);
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(404);
    expect(placeOrder).not.toHaveBeenCalled();
  });
});

describe("POST register — path + validation rules", () => {
  it("rejects card paths (offline payments only, spec decision)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ paymentMethod: "card" }),
    );
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CARD_PATH",
      error: "Card payments go through the public flow.",
    });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("400s a submission missing the required email BEFORE any money movement (T2 AC-7)", async () => {
    const response = await POST(
      makeRequest(
        makeBody({ submission: { first_name: "Ada", last_name: "L" } }),
      ),
      makeContext(),
    );
    expect(response.status).toBe(400);
    expect(placeOrder).not.toHaveBeenCalled();
    expect(createAdminFormDataForDraft).not.toHaveBeenCalled();
  });

  it("409s when the event has no registration form", async () => {
    getAdminFormForEvent.mockResolvedValue(null);
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "NO_FORM" });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("400s an ineligible/closed/unpriced selection via the M3 rules", async () => {
    validateTicketSelection.mockResolvedValue({
      ok: false,
      code: "INVALID_TICKET",
    });
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "SELECTION_UNAVAILABLE",
    });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("400s an ambiguous ticket without a registration-type choice", async () => {
    validateTicketSelection.mockResolvedValue({
      ok: false,
      code: "CHOICE_REQUIRED",
    });
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHOICE_REQUIRED",
    });
  });

  it("409s a sold-out selection before placing the order", async () => {
    validateTicketSelection.mockResolvedValue({
      ok: true,
      ticket: { id: "tick-1" },
      registrationTypeId: "rt-1",
      soldOut: true,
    });
    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "SOLD_OUT" });
    expect(placeOrder).not.toHaveBeenCalled();
  });
});

describe("POST register — pipeline (public-finalize parity)", () => {
  it("runs placeOrder → createFormData → transition(accepted) in exactly that order", async () => {
    const response = await POST(makeRequest(makeBody()), makeContext());

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(["placeOrder", "createFormData", "transition"]);
    await expect(response.json()).resolves.toEqual({
      registrationRef: FORM_DATA_ID,
      orderRef: "order-1",
      paymentStatus: "comped",
    });

    // The auto-accept transition is what fires the T1 attendee hook.
    expect(transitionAdminFormDataStatus).toHaveBeenCalledWith({
      responseId: FORM_DATA_ID,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      to: "accepted",
    });
  });

  it("uses the 'manual:' idempotency key, the derived submissionId, and the PATH's method/currency (tampering stripped)", async () => {
    await POST(
      makeRequest(
        makeBody({
          // Tampering attempts — all stripped by the schema:
          paymentMethod: "card",
          currency: "GBP",
          amounts: { totalMinor: 0 },
        }),
      ),
      makeContext(),
    );

    expect(placeOrder).toHaveBeenCalledTimes(1);
    const input = placeOrder.mock.calls[0][0];
    expect(input.idempotencyKey).toBe(`manual:${REQUEST_ID}`);
    expect(input.submissionId).toBe(FORM_DATA_ID);
    expect(input.paymentMethod).toBe("comp"); // from the path doc
    expect(input.currency).toBe("USD"); // from the path doc
    expect(input.ticketTypeId).toBe("tick-1");
    expect(input.registrationTypeId).toBe("rt-1");
    expect(input.promotionId).toBeNull();

    // FormData create lands on the synthetic manual draft id with the
    // order-derived ticket label denorm.
    expect(createAdminFormDataForDraft).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      draftId: `manual:${REQUEST_ID}`,
      formId: "form-1",
      submission: { ...SUBMISSION, ticket: "General Admission" },
      orderId: "order-1",
      pathId: "path-1",
      ticketLabel: "General Admission",
    });
  });

  it("invoice paths flow through with the order landing outstanding (T2 AC-4)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ paymentMethod: "invoice", currency: "GBP" }),
    );
    placeOrder.mockResolvedValue({
      ...successOrder,
      order: {
        ...successOrder.order,
        paymentMethod: "invoice",
        paymentStatus: "outstanding",
      },
    });

    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      paymentStatus: "outstanding",
    });
    expect(placeOrder.mock.calls[0][0].paymentMethod).toBe("invoice");
  });

  it("SOLD_OUT from placeOrder → 409 dialog error, no FormData, no transition (T2 AC-5)", async () => {
    placeOrder.mockResolvedValue({
      ok: false,
      code: "SOLD_OUT",
      message: "This ticket is sold out.",
    });

    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SOLD_OUT",
      error: "That ticket just sold out.",
    });
    expect(createAdminFormDataForDraft).not.toHaveBeenCalled();
    expect(transitionAdminFormDataStatus).not.toHaveBeenCalled();
  });

  it("double-submit replay (already accepted → INVALID_TRANSITION) still returns the same refs (T2 AC-6)", async () => {
    placeOrder.mockResolvedValue({ ...successOrder, created: false });
    createAdminFormDataForDraft.mockResolvedValue({
      formDataId: FORM_DATA_ID,
      formData: { id: FORM_DATA_ID },
      created: false,
    });
    transitionAdminFormDataStatus.mockResolvedValue({
      ok: false,
      code: "INVALID_TRANSITION",
      message: 'Cannot move a response from "accepted" to "accepted".',
    });

    const response = await POST(makeRequest(makeBody()), makeContext());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      registrationRef: FORM_DATA_ID,
      orderRef: "order-1",
    });
  });
});
