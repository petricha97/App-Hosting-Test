// @vitest-environment node
/**
 * M3-T3 finalize contract:
 * - CONTRACTUAL ORDER: placeOrder → createAdminFormDataForDraft →
 *   deleteAdminRegistrationDraft (call-order asserted);
 * - paymentMethod/currency come from the PATH DOC — client-supplied fields
 *   are stripped (T3 AC-6);
 * - idempotencyKey = "reg:" + draftId + ":" + attempt; replay returns the
 *   same refs (T3 AC-8);
 * - attempt++ happens ONLY on PAYMENT_FAILED (402); no FormData, no draft
 *   delete on any failure (T3 AC-9: draft intact for the losing racer);
 * - typed error statuses: SOLD_OUT/TYPE_FULL → 409 + refresh signal,
 *   PRICE_CHANGED → 409, PAYMENT_FAILED → 402, promo failures → generic 409;
 * - M5-T1 retrofit: the response carries qrSvg — an SVG encoding ONLY the
 *   deterministic QR token (no PII), identical across finalize replays
 *   (T1 AC-5/6/7).
 */
import QRCode from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formDataIdFromDraftId } from "@/lib/db/formDataId";
import { hashDraftToken, mintDraftToken } from "@/lib/draft-token";
import { mintQrToken } from "@/lib/qr/qr-token";
import { resetRateLimits } from "@/lib/rate-limit";

const {
  callOrder,
  getAdminPublishedEventById,
  getAdminPublishedFormForPublicEvent,
  getAdminRegistrationPathForEvent,
  getAdminRegistrationDraftByIdAndTokenHash,
  incrementAdminRegistrationDraftAttempt,
  deleteAdminRegistrationDraft,
  createAdminFormDataForDraft,
  getAdminTicketTypeForEvent,
  placeOrder,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  return {
    callOrder,
    getAdminPublishedEventById: vi.fn(),
    getAdminPublishedFormForPublicEvent: vi.fn(),
    getAdminRegistrationPathForEvent: vi.fn(),
    getAdminRegistrationDraftByIdAndTokenHash: vi.fn(),
    incrementAdminRegistrationDraftAttempt: vi.fn(async () => {
      callOrder.push("incrementAttempt");
    }),
    deleteAdminRegistrationDraft: vi.fn(async () => {
      callOrder.push("deleteDraft");
    }),
    createAdminFormDataForDraft: vi.fn(),
    getAdminTicketTypeForEvent: vi.fn(),
    placeOrder: vi.fn(),
  };
});

vi.mock("@/lib/db/adminEvent", () => ({ getAdminPublishedEventById }));
vi.mock("@/lib/db/adminForm", () => ({ getAdminPublishedFormForPublicEvent }));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathForEvent,
}));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  getAdminRegistrationDraftByIdAndTokenHash,
  incrementAdminRegistrationDraftAttempt,
  deleteAdminRegistrationDraft,
}));
vi.mock("@/lib/db/adminFormData", () => ({ createAdminFormDataForDraft }));
vi.mock("@/lib/db/adminTicketType", () => ({ getAdminTicketTypeForEvent }));
vi.mock("@/lib/orders/place-order", () => ({ placeOrder }));

import { POST } from "@/app/api/events/[eventId]/registration/finalize/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const DRAFT_ID = "f".repeat(32);
const token = mintDraftToken({ draftId: DRAFT_ID, eventId: EVENT_ID });

const FORM_DATA_ID = formDataIdFromDraftId({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  draftId: DRAFT_ID,
});

// The deterministic entry-pass token the route must encode — same inputs,
// same secret (dev fallback in tests), so the expected SVG is computable
// independently of the route (proves the QR payload is the token and
// NOTHING else — T1 AC-5).
const QR_TOKEN = mintQrToken({ eventId: EVENT_ID, formDataId: FORM_DATA_ID });

const publishedEvent = {
  id: EVENT_ID,
  name: "Tech Meetup 2026",
  status: "Published",
  organizationPath: `Organization/${ORG_ID}`,
  formPath: "Form/form-1",
};

function makePath(overrides: Record<string, unknown> = {}) {
  return {
    id: "path-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Sponsor — Invoice",
    code: "SPN-INV",
    audienceRegistrationTypeId: "rt-1",
    paymentMethod: "invoice",
    currency: "GBP",
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
    pathId: "path-1",
    formId: "form-1",
    draftTokenHash: hashDraftToken(token),
    lastStepReached: "summary",
    stepAnswers: { first_name: "Ada", last_name: "Lovelace", email: "ada@x.co" },
    ticketTypeId: "tick-1",
    registrationTypeId: "rt-1",
    promotionId: "promo-1",
    attempt: 1,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@x.co",
    ...overrides,
  };
}

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
    feeId: "fee-1",
    promotionId: "promo-1",
    taxIds: [],
    currency: "GBP",
    amounts: {
      subtotalMinor: 5000,
      discountMinor: 500,
      taxMinor: 0,
      totalMinor: 4500,
    },
    snapshot: {
      feeName: "GA",
      basePriceMinor: 5000,
      promoCode: "SAVE10",
      discountType: "percentage",
      discountValue: 10,
      taxLines: [],
    },
    paymentMethod: "invoice",
    paymentStatus: "outstanding",
    paymentProvider: "simulated",
    providerPaymentId: null,
    idempotencyKey: `reg:${DRAFT_ID}:1`,
  },
};

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/events/${EVENT_ID}/registration/finalize`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  callOrder.length = 0;

  getAdminPublishedEventById.mockResolvedValue(publishedEvent);
  getAdminPublishedFormForPublicEvent.mockResolvedValue({
    id: "form-1",
    organizationId: ORG_ID,
    status: "published",
    fields: [],
  });
  getAdminRegistrationPathForEvent.mockResolvedValue(makePath());
  getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(makeDraft());
  getAdminTicketTypeForEvent.mockResolvedValue({
    id: "tick-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
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
});

describe("POST finalize — happy path + contractual order", () => {
  it("runs placeOrder → createFormData → deleteDraft in exactly that order", async () => {
    const response = await POST(makeRequest({ token }), makeContext());

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(["placeOrder", "createFormData", "deleteDraft"]);

    const expectedSvg = await QRCode.toString(QR_TOKEN, {
      type: "svg",
      margin: 0,
    });
    await expect(response.json()).resolves.toEqual({
      registrationRef: FORM_DATA_ID,
      orderRef: "order-1",
      paymentStatus: "outstanding",
      amounts: successOrder.order.amounts,
      currency: "GBP",
      qrSvg: expectedSvg,
    });
  });

  it("qrSvg encodes ONLY the deterministic token — no PII — and replays identically (T1 AC-5/7)", async () => {
    const first = await POST(makeRequest({ token }), makeContext());
    const firstBody = (await first.json()) as { qrSvg: string };

    // Exactly the SVG of the token string: encoding anything else (name,
    // email, order refs) would change the matrix and fail this equality.
    const expectedSvg = await QRCode.toString(QR_TOKEN, {
      type: "svg",
      margin: 0,
    });
    expect(firstBody.qrSvg).toBe(expectedSvg);
    // The token itself is eventId.formDataId.signature — no PII material.
    expect(QR_TOKEN).not.toContain("Ada");
    expect(QR_TOKEN).not.toContain("ada@x.co");

    // Finalize replay (idempotent path) returns the identical SVG.
    placeOrder.mockImplementation(async () => {
      callOrder.push("placeOrder");
      return { ...successOrder, created: false };
    });
    const replay = await POST(makeRequest({ token }), makeContext());
    const replayBody = (await replay.json()) as { qrSvg: string };
    expect(replayBody.qrSvg).toBe(firstBody.qrSvg);
  });

  it("takes paymentMethod/currency from the PATH and strips client-supplied ones (T3 AC-6)", async () => {
    await POST(
      makeRequest({
        token,
        // Tampering attempts — all stripped by the schema:
        paymentMethod: "comp",
        currency: "USD",
        amounts: { totalMinor: 0 },
      }),
      makeContext(),
    );

    expect(placeOrder).toHaveBeenCalledTimes(1);
    const input = placeOrder.mock.calls[0][0];
    expect(input.paymentMethod).toBe("invoice"); // from the path doc
    expect(input.currency).toBe("GBP"); // from the path doc
    expect(input.idempotencyKey).toBe(`reg:${DRAFT_ID}:1`);
    expect(input.submissionId).toBe(FORM_DATA_ID);
    expect(input.ticketTypeId).toBe("tick-1");
    expect(input.registrationTypeId).toBe("rt-1");
    expect(input.promotionId).toBe("promo-1");
  });

  it("builds the idempotency key from the CURRENT attempt counter", async () => {
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(
      makeDraft({ attempt: 3 }),
    );
    await POST(makeRequest({ token }), makeContext());
    expect(placeOrder.mock.calls[0][0].idempotencyKey).toBe(
      `reg:${DRAFT_ID}:3`,
    );
  });

  it("denormalizes ticketLabel and the snapshot promo code into the submission", async () => {
    await POST(makeRequest({ token }), makeContext());

    expect(createAdminFormDataForDraft).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      draftId: DRAFT_ID,
      formId: "form-1",
      submission: {
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@x.co",
        ticket: "General Admission",
        promo_code: "SAVE10",
      },
      orderId: "order-1",
      pathId: "path-1",
      ticketLabel: "General Admission",
    });
  });

  it("crash-replay after a draft ticket edit records the ORDER's ticket, not the mutated draft's (S2)", async () => {
    // Window: placeOrder succeeded but the response never reached the client;
    // the registrant PATCHed the draft to a different ticket, then retried.
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(
      makeDraft({ ticketTypeId: "tick-2", registrationTypeId: "rt-1" }),
    );
    // The replayed order (same idempotency key) still carries the ticket the
    // money moved for.
    placeOrder.mockImplementation(async () => {
      callOrder.push("placeOrder");
      return { ...successOrder, created: false };
    });
    getAdminTicketTypeForEvent.mockImplementation(
      async ({ ticketTypeId }: { ticketTypeId: string }) =>
        ticketTypeId === "tick-1"
          ? { id: "tick-1", organizationId: ORG_ID, eventId: EVENT_ID, name: "General Admission" }
          : { id: "tick-2", organizationId: ORG_ID, eventId: EVENT_ID, name: "VIP" },
    );

    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(200);

    // The ticket lookup uses the ORDER's ticketTypeId ("tick-1"), never the
    // draft's mutated "tick-2".
    expect(getAdminTicketTypeForEvent).toHaveBeenCalledWith({
      ticketTypeId: "tick-1",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    const input = createAdminFormDataForDraft.mock.calls[0][0];
    expect(input.ticketLabel).toBe("General Admission");
    expect(input.submission.ticket).toBe("General Admission");
  });

  it("idempotent replay (double-submit) returns the same refs without a second order (T3 AC-8)", async () => {
    placeOrder.mockImplementation(async () => {
      callOrder.push("placeOrder");
      return { ...successOrder, created: false };
    });
    createAdminFormDataForDraft.mockImplementation(async () => {
      callOrder.push("createFormData");
      return {
        formDataId: FORM_DATA_ID,
        formData: { id: FORM_DATA_ID },
        created: false,
      };
    });

    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      registrationRef: FORM_DATA_ID,
      orderRef: "order-1",
    });
    // The replay still heals the tail of the sequence (delete is idempotent).
    expect(callOrder).toEqual(["placeOrder", "createFormData", "deleteDraft"]);
  });
});

describe("POST finalize — typed errors", () => {
  it("PAYMENT_FAILED → 402 and attempt++ (ONLY failure that bumps it)", async () => {
    placeOrder.mockImplementation(async () => {
      callOrder.push("placeOrder");
      return {
        ok: false as const,
        code: "PAYMENT_FAILED" as const,
        message: "simulated_decline",
      };
    });

    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: "PAYMENT_FAILED",
    });
    expect(incrementAdminRegistrationDraftAttempt).toHaveBeenCalledWith(DRAFT_ID);
    expect(createAdminFormDataForDraft).not.toHaveBeenCalled();
    expect(deleteAdminRegistrationDraft).not.toHaveBeenCalled();
  });

  it.each(["SOLD_OUT", "TYPE_FULL"] as const)(
    "%s → 409 with a refreshed-availability signal, draft intact, NO attempt bump (T3 AC-9)",
    async (code) => {
      placeOrder.mockResolvedValue({
        ok: false,
        code,
        message: "This ticket is sold out.",
      });

      const response = await POST(makeRequest({ token }), makeContext());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code,
        refresh: "tickets",
        error: "That ticket just sold out.",
      });
      expect(incrementAdminRegistrationDraftAttempt).not.toHaveBeenCalled();
      expect(createAdminFormDataForDraft).not.toHaveBeenCalled();
      expect(deleteAdminRegistrationDraft).not.toHaveBeenCalled();
    },
  );

  it("PRICE_CHANGED → 409 requote", async () => {
    placeOrder.mockResolvedValue({
      ok: false,
      code: "PRICE_CHANGED",
      message: "The fee is no longer available as quoted.",
    });
    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PRICE_CHANGED",
    });
    expect(incrementAdminRegistrationDraftAttempt).not.toHaveBeenCalled();
  });

  it.each(["PROMO_EXPIRED", "PROMO_EXHAUSTED"] as const)(
    "%s collapses to the generic promo error (no oracle)",
    async (code) => {
      placeOrder.mockResolvedValue({ ok: false, code, message: "internal" });
      const response = await POST(makeRequest({ token }), makeContext());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "This code isn't valid.",
        code: "PROMO_INVALID",
      });
    },
  );

  it("NO_FEE/INVALID_REFERENCE map to the generic selection-unavailable 409", async () => {
    placeOrder.mockResolvedValue({
      ok: false,
      code: "NO_FEE",
      message: "internal fee detail",
    });
    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe("SELECTION_UNAVAILABLE");
    // Internal message never echoed:
    expect(JSON.stringify(payload)).not.toContain("internal fee detail");
  });
});

describe("POST finalize — gates", () => {
  it("404s forged tokens without calling placeOrder", async () => {
    const response = await POST(
      makeRequest({ token: `${DRAFT_ID}.${"C".repeat(43)}` }),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("409s an incomplete draft (no ticket selection) before any money movement", async () => {
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(
      makeDraft({ ticketTypeId: null, registrationTypeId: null }),
    );
    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "OUT_OF_ORDER" });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("404s when the draft's path was deactivated mid-flow", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ isActive: false }),
    );
    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(404);
    expect(placeOrder).not.toHaveBeenCalled();
  });
});
