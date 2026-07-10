// @vitest-environment node
/**
 * M3-T3/T5 — public draft endpoints:
 * - POST creates the draft, returns the signed token once, hashes it for
 *   storage, denormalizes name/email, and strips commerce keys (T5 AC-2/4/5);
 * - forged tokens 404 BEFORE any DAL read; bare draft ids grant nothing;
 * - PATCH validates the ticket selection server-side, stores the resolved
 *   promotionId (never the code text), and stamps lastStepReached forward-only;
 * - out-of-order step writes are rejected (T3 AC-2);
 * - >32KB bodies 413; rate limiting 429s with Retry-After (T3 AC-12).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formFieldSchema } from "@/features/form/schema";
import {
  hashDraftToken,
  mintDraftToken,
  verifyDraftToken,
} from "@/lib/draft-token";
import { resetRateLimits } from "@/lib/rate-limit";

const {
  getAdminPublishedEventById,
  getAdminPublishedFormForPublicEvent,
  getAdminRegistrationPathForEvent,
  getAdminRegistrationDraftByIdAndTokenHash,
  createAdminRegistrationDraft,
  updateAdminRegistrationDraftStep,
  getAdminTicketTypeForEvent,
  getAdminTicketTypesForEvent,
  getAdminRegistrationTypesForEvent,
  resolveAdminFeeForOrder,
  getAdminEventPromotionByCode,
  getAdminEventPromotionById,
  getAdminActiveTaxesForEvent,
} = vi.hoisted(() => ({
  getAdminPublishedEventById: vi.fn(),
  getAdminPublishedFormForPublicEvent: vi.fn(),
  getAdminRegistrationPathForEvent: vi.fn(),
  getAdminRegistrationDraftByIdAndTokenHash: vi.fn(),
  createAdminRegistrationDraft: vi.fn(),
  updateAdminRegistrationDraftStep: vi.fn(),
  getAdminTicketTypeForEvent: vi.fn(),
  getAdminTicketTypesForEvent: vi.fn(),
  getAdminRegistrationTypesForEvent: vi.fn(),
  resolveAdminFeeForOrder: vi.fn(),
  getAdminEventPromotionByCode: vi.fn(),
  getAdminEventPromotionById: vi.fn(),
  getAdminActiveTaxesForEvent: vi.fn(),
}));

vi.mock("@/lib/db/adminEvent", () => ({ getAdminPublishedEventById }));
vi.mock("@/lib/db/adminForm", () => ({ getAdminPublishedFormForPublicEvent }));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathForEvent,
}));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  getAdminRegistrationDraftByIdAndTokenHash,
  createAdminRegistrationDraft,
  updateAdminRegistrationDraftStep,
}));
vi.mock("@/lib/db/adminTicketType", () => ({
  getAdminTicketTypeForEvent,
  getAdminTicketTypesForEvent,
}));
vi.mock("@/lib/db/adminRegistrationType", () => ({
  getAdminRegistrationTypesForEvent,
}));
vi.mock("@/lib/db/adminFee", () => ({ resolveAdminFeeForOrder }));
vi.mock("@/lib/db/adminEventPromotion", () => ({
  getAdminEventPromotionByCode,
  getAdminEventPromotionById,
}));
vi.mock("@/lib/db/adminTax", () => ({ getAdminActiveTaxesForEvent }));

import { GET, PATCH, POST } from "@/app/api/events/[eventId]/registration/draft/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const PATH_ID = "path-1";
const DRAFT_ID = "d".repeat(32);

const validToken = mintDraftToken({ draftId: DRAFT_ID, eventId: EVENT_ID });

const publishedEvent = {
  id: EVENT_ID,
  name: "Tech Meetup 2026",
  status: "Published",
  organizationPath: `Organization/${ORG_ID}`,
  formPath: "Form/form-1",
};

function makeField(overrides: Record<string, unknown>) {
  return formFieldSchema.parse({
    id: overrides.key,
    label: overrides.key,
    type: "text",
    ...overrides,
  });
}

const formFields = [
  makeField({ key: "first_name", label: "First name", required: true }),
  makeField({ key: "last_name", label: "Last name", required: true }),
  makeField({ key: "email", label: "Email", type: "email", required: true }),
  makeField({ key: "ticket", type: "ticket-selector", label: "Ticket" }),
  makeField({ key: "promo_code", type: "promo-code", label: "Promo" }),
];

const publishedForm = {
  id: "form-1",
  eventId: EVENT_ID,
  organizationId: ORG_ID,
  title: "Registration",
  status: "published",
  fields: formFields,
};

function makePath(overrides: Record<string, unknown> = {}) {
  return {
    id: PATH_ID,
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "2.1 Sponsor — Card",
    code: "SPN-CC",
    audienceRegistrationTypeId: "rt-1",
    paymentMethod: "card",
    currency: "USD",
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    pathId: PATH_ID,
    formId: "form-1",
    draftTokenHash: hashDraftToken(validToken),
    lastStepReached: "personal_info",
    stepAnswers: { first_name: "Ada", last_name: "Lovelace", email: "ada@x.co" },
    ticketTypeId: null,
    registrationTypeId: null,
    promotionId: null,
    attempt: 1,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@x.co",
    ...overrides,
  };
}

const openTicket = {
  id: "tick-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "General Admission",
  code: "GA",
  capacity: 100,
  registeredCount: 10,
  salesStart: null,
  salesEnd: null,
  isOpen: true,
  registrationTypeIds: ["rt-1"],
};

const activeFee = {
  id: "fee-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "GA Standard",
  ticketTypeId: "tick-1",
  registrationTypeId: "rt-1",
  currency: "USD",
  basePriceMinor: 5000,
  status: "active",
};

function makeContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

function jsonRequest(method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/events/${EVENT_ID}/registration/draft`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();

  getAdminPublishedEventById.mockResolvedValue(publishedEvent);
  getAdminPublishedFormForPublicEvent.mockResolvedValue(publishedForm);
  getAdminRegistrationPathForEvent.mockResolvedValue(makePath());
  getAdminRegistrationDraftByIdAndTokenHash.mockImplementation(
    async (input: { draftId: string; tokenHash: string }) => {
      const draft = makeDraft();
      return input.draftId === DRAFT_ID && input.tokenHash === draft.draftTokenHash
        ? draft
        : null;
    },
  );
  createAdminRegistrationDraft.mockResolvedValue(DRAFT_ID);
  updateAdminRegistrationDraftStep.mockResolvedValue(undefined);
  getAdminTicketTypeForEvent.mockResolvedValue(openTicket);
  getAdminTicketTypesForEvent.mockResolvedValue([openTicket]);
  getAdminRegistrationTypesForEvent.mockResolvedValue([
    { id: "rt-1", name: "Sponsor" },
  ]);
  resolveAdminFeeForOrder.mockResolvedValue(activeFee);
  getAdminEventPromotionByCode.mockResolvedValue(null);
  getAdminActiveTaxesForEvent.mockResolvedValue([]);
});

describe("POST draft (step-1 create)", () => {
  const submission = {
    first_name: "  Ada  ",
    last_name: "Lovelace",
    email: "ada@example.com",
    // Stale-client noise that must never reach stepAnswers:
    ticket: "VIP",
    promo_code: "SECRET",
  };

  it("creates the draft, hashes the token for storage, and returns the token once", async () => {
    const response = await POST(
      jsonRequest("POST", { pathId: PATH_ID, submission }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.draftId).toBeTruthy();
    expect(verifyDraftToken({ token: payload.draftToken, eventId: EVENT_ID })).toEqual({
      valid: true,
      draftId: payload.draftId,
    });

    expect(createAdminRegistrationDraft).toHaveBeenCalledTimes(1);
    const input = createAdminRegistrationDraft.mock.calls[0][0];
    expect(input.draftTokenHash).toBe(hashDraftToken(payload.draftToken));
    // Raw token never persisted:
    expect(JSON.stringify(input)).not.toContain(payload.draftToken);
    // Commerce keys stripped, answers trimmed, denorms populated:
    expect(input.stepAnswers).toEqual({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
    });
    expect(input.firstName).toBe("Ada");
    expect(input.lastName).toBe("Lovelace");
    expect(input.email).toBe("ada@example.com");
    // No promo text / payment fields anywhere in the create payload (T5 AC-4):
    expect(JSON.stringify(input)).not.toContain("SECRET");
  });

  it("rejects invalid step-1 answers with the flattened form error", async () => {
    const response = await POST(
      jsonRequest("POST", {
        pathId: PATH_ID,
        submission: { first_name: " ", last_name: "L", email: "nope" },
      }),
      makeContext(),
    );
    expect(response.status).toBe(400);
    expect(createAdminRegistrationDraft).not.toHaveBeenCalled();
  });

  it("404s for inactive paths (indistinguishable from missing)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ isActive: false }),
    );
    const response = await POST(
      jsonRequest("POST", { pathId: PATH_ID, submission }),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(createAdminRegistrationDraft).not.toHaveBeenCalled();
  });

  it("413s bodies over 32KB before parsing", async () => {
    const response = await POST(
      jsonRequest("POST", {
        pathId: PATH_ID,
        submission: { first_name: "x".repeat(40_000) },
      }),
      makeContext(),
    );
    expect(response.status).toBe(413);
  });

  it("rate-limits per IP with Retry-After (429)", async () => {
    for (let i = 0; i < 30; i += 1) {
      await POST(jsonRequest("POST", { pathId: PATH_ID, submission }), makeContext());
    }
    const response = await POST(
      jsonRequest("POST", { pathId: PATH_ID, submission }),
      makeContext(),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("PATCH draft — token gate (T3 AC-3, T5 AC-5)", () => {
  it("404s a forged token WITHOUT touching the draft store", async () => {
    const forged = `${DRAFT_ID}.${"A".repeat(43)}`;
    const response = await PATCH(
      jsonRequest("PATCH", { token: forged, step: "summary" }),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(getAdminRegistrationDraftByIdAndTokenHash).not.toHaveBeenCalled();
    expect(updateAdminRegistrationDraftStep).not.toHaveBeenCalled();
  });

  it("404s a validly-signed token whose draft does not exist", async () => {
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(null);
    const response = await PATCH(
      jsonRequest("PATCH", { token: validToken, step: "summary" }),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(updateAdminRegistrationDraftStep).not.toHaveBeenCalled();
  });
});

describe("PATCH draft — ticket_options", () => {
  it("persists the validated selection and stamps lastStepReached", async () => {
    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
        registrationTypeId: null,
        promoCode: null,
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(updateAdminRegistrationDraftStep).toHaveBeenCalledWith(DRAFT_ID, {
      lastStepReached: "ticket_options",
      ticketTypeId: "tick-1",
      // Audience-pinned path: the server derives the registration type.
      registrationTypeId: "rt-1",
      promotionId: null,
    });
  });

  it("stores the resolved promotionId — never the promo code text (T5 AC-4)", async () => {
    getAdminEventPromotionByCode.mockResolvedValue({
      id: "promo-1",
      organizationId: ORG_ID,
      isActive: true,
      validityStart: null,
      validityEnd: null,
      usageCap: null,
      usedCount: 0,
      enablePromoCode: true,
      promoCode: "SAVE10",
      discountType: "percentage",
      discountValue: 10,
    });

    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
        promoCode: "save10",
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const update = updateAdminRegistrationDraftStep.mock.calls[0][1];
    expect(update.promotionId).toBe("promo-1");
    expect(JSON.stringify(update)).not.toContain("SAVE10");
    expect(JSON.stringify(update)).not.toContain("save10");
  });

  it("returns the ONE generic promo error for unknown codes", async () => {
    getAdminEventPromotionByCode.mockResolvedValue(null);
    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
        promoCode: "NOPE",
      }),
      makeContext(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "This code isn't valid.",
      code: "PROMO_INVALID",
    });
    expect(updateAdminRegistrationDraftStep).not.toHaveBeenCalled();
  });

  it("rejects closed tickets even when the client claims otherwise", async () => {
    getAdminTicketTypeForEvent.mockResolvedValue({ ...openTicket, isOpen: false });
    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
      }),
      makeContext(),
    );
    expect(response.status).toBe(400);
    expect(updateAdminRegistrationDraftStep).not.toHaveBeenCalled();
  });

  it("rejects unpriced tickets (no active fee in the path currency)", async () => {
    resolveAdminFeeForOrder.mockResolvedValue(null);
    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
      }),
      makeContext(),
    );
    expect(response.status).toBe(400);
  });

  it("409s a sold-out selection", async () => {
    getAdminTicketTypeForEvent.mockResolvedValue({
      ...openTicket,
      capacity: 10,
      registeredCount: 10,
    });
    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
      }),
      makeContext(),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "SOLD_OUT" });
  });

  it("requires a registration-type choice for ambiguous Any-audience tickets", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ audienceRegistrationTypeId: null }),
    );
    getAdminTicketTypeForEvent.mockResolvedValue({
      ...openTicket,
      registrationTypeIds: [],
    });
    getAdminRegistrationTypesForEvent.mockResolvedValue([
      { id: "rt-1", name: "Sponsor" },
      { id: "rt-2", name: "Delegate" },
    ]);

    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
      }),
      makeContext(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHOICE_REQUIRED",
    });
  });
});

describe("PATCH draft — out-of-order guards (T3 AC-2)", () => {
  it("rejects a summary stamp before any ticket selection", async () => {
    const response = await PATCH(
      jsonRequest("PATCH", { token: validToken, step: "summary" }),
      makeContext(),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "OUT_OF_ORDER" });
  });

  it("rejects a payment stamp on comp/none paths (the step does not exist)", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ paymentMethod: "comp" }),
    );
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(
      makeDraft({
        ticketTypeId: "tick-1",
        registrationTypeId: "rt-1",
        lastStepReached: "summary",
      }),
    );
    const response = await PATCH(
      jsonRequest("PATCH", { token: validToken, step: "payment" }),
      makeContext(),
    );
    expect(response.status).toBe(409);
  });

  it("rejects a payment stamp before summary was reached", async () => {
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(
      makeDraft({
        ticketTypeId: "tick-1",
        registrationTypeId: "rt-1",
        lastStepReached: "ticket_options",
      }),
    );
    const response = await PATCH(
      jsonRequest("PATCH", { token: validToken, step: "payment" }),
      makeContext(),
    );
    expect(response.status).toBe(409);
  });

  it("never regresses lastStepReached when step 2 is revisited", async () => {
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(
      makeDraft({
        ticketTypeId: "tick-1",
        registrationTypeId: "rt-1",
        lastStepReached: "summary",
      }),
    );
    const response = await PATCH(
      jsonRequest("PATCH", {
        token: validToken,
        step: "ticket_options",
        ticketTypeId: "tick-1",
      }),
      makeContext(),
    );
    expect(response.status).toBe(200);
    expect(updateAdminRegistrationDraftStep).toHaveBeenCalledWith(
      DRAFT_ID,
      expect.objectContaining({ lastStepReached: "summary" }),
    );
  });
});

describe("GET draft — resume", () => {
  it("returns the resume projection for a valid header token", async () => {
    const request = new Request(
      `http://localhost/api/events/${EVENT_ID}/registration/draft`,
      { headers: { "x-draft-token": validToken } },
    );
    const response = await GET(request, makeContext());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      draftId: DRAFT_ID,
      pathId: PATH_ID,
      lastStepReached: "personal_info",
      stepAnswers: makeDraft().stepAnswers,
      ticketTypeId: null,
      registrationTypeId: null,
      promoApplied: false,
    });
    // Internals never leak on the resume payload:
    expect(payload).not.toHaveProperty("draftTokenHash");
    expect(payload).not.toHaveProperty("attempt");
    expect(payload).not.toHaveProperty("organizationId");
  });

  it("404s without a token header", async () => {
    const request = new Request(
      `http://localhost/api/events/${EVENT_ID}/registration/draft`,
    );
    const response = await GET(request, makeContext());
    expect(response.status).toBe(404);
  });
});
