// @vitest-environment node
/**
 * M3-T3 AC-5 + T2 AC-6/7 — public quote endpoint:
 * - pins one worked money example per the M2 table (server math identical to
 *   finalize: discount rounds half-up, each tax line rounds independently);
 * - promo failures (unknown / inactive / expired / exhausted) all return the
 *   IDENTICAL generic response — no oracle;
 * - quote requires the draft token (404 otherwise) and a completed selection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashDraftToken, mintDraftToken } from "@/lib/draft-token";
import { resetRateLimits } from "@/lib/rate-limit";

const {
  getAdminPublishedEventById,
  getAdminPublishedFormForPublicEvent,
  getAdminRegistrationPathForEvent,
  getAdminRegistrationDraftByIdAndTokenHash,
  getAdminTicketTypesForEvent,
  getAdminTicketTypeForEvent,
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
  getAdminTicketTypesForEvent: vi.fn(),
  getAdminTicketTypeForEvent: vi.fn(),
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
}));
vi.mock("@/lib/db/adminTicketType", () => ({
  getAdminTicketTypesForEvent,
  getAdminTicketTypeForEvent,
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

import { POST } from "@/app/api/events/[eventId]/registration/quote/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const DRAFT_ID = "e".repeat(32);
const token = mintDraftToken({ draftId: DRAFT_ID, eventId: EVENT_ID });

const publishedEvent = {
  id: EVENT_ID,
  name: "Tech Meetup 2026",
  status: "Published",
  organizationPath: `Organization/${ORG_ID}`,
  formPath: "Form/form-1",
};

const path = {
  id: "path-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "Sponsor — Card",
  code: "SPN-CC",
  audienceRegistrationTypeId: "rt-1",
  paymentMethod: "card",
  currency: "USD",
  isActive: true,
  sortOrder: 0,
};

const draft = {
  id: DRAFT_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  pathId: "path-1",
  formId: "form-1",
  draftTokenHash: hashDraftToken(token),
  lastStepReached: "ticket_options",
  stepAnswers: {},
  ticketTypeId: "tick-1",
  registrationTypeId: "rt-1",
  promotionId: null,
  attempt: 1,
  firstName: "",
  lastName: "",
  email: "",
};

const ticket = {
  id: "tick-1",
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: "General Admission",
  code: "GA",
  capacity: null,
  registeredCount: 0,
  salesStart: null,
  salesEnd: null,
  isOpen: true,
  registrationTypeIds: ["rt-1"],
};

const fee = {
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

function activePromo(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/events/${EVENT_ID}/registration/quote`,
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

  getAdminPublishedEventById.mockResolvedValue(publishedEvent);
  getAdminPublishedFormForPublicEvent.mockResolvedValue({
    id: "form-1",
    organizationId: ORG_ID,
    status: "published",
    fields: [],
  });
  getAdminRegistrationPathForEvent.mockResolvedValue(path);
  getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue(draft);
  getAdminTicketTypeForEvent.mockResolvedValue(ticket);
  getAdminRegistrationTypesForEvent.mockResolvedValue([
    { id: "rt-1", name: "Sponsor" },
  ]);
  resolveAdminFeeForOrder.mockResolvedValue(fee);
  getAdminEventPromotionByCode.mockResolvedValue(activePromo());
  getAdminEventPromotionById.mockResolvedValue(activePromo());
  getAdminActiveTaxesForEvent.mockResolvedValue([
    {
      id: "tax-1",
      code: "TAX-NY",
      type: "percentage",
      rateMilliPercent: 8875,
      fixedAmountMinor: null,
      fixedCurrency: null,
      isActive: true,
    },
  ]);
});

describe("POST quote — worked example (M2 math parity, T3 AC-5)", () => {
  it("computes $50.00 − 10% promo + 8.875% tax = $48.99 exactly", async () => {
    const response = await POST(
      makeRequest({ token, promoCode: "SAVE10" }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const { quote } = await response.json();
    expect(quote).toEqual({
      currency: "USD",
      subtotalMinor: 5000,
      discountMinor: 500, // 10% of 5000
      taxLines: [{ code: "TAX-NY", amountMinor: 399 }], // 4500 × 8.875% = 399.375 → 399
      taxMinor: 399,
      totalMinor: 4899,
      promoApplied: true,
    });
  });

  it("quotes from the draft's stored state when no overrides are sent", async () => {
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue({
      ...draft,
      promotionId: "promo-1",
    });
    const response = await POST(makeRequest({ token }), makeContext());
    const { quote } = await response.json();
    expect(quote.discountMinor).toBe(500);
    expect(quote.totalMinor).toBe(4899);
  });
});

describe("POST quote — promo secrecy (T2 AC-6/7)", () => {
  it("returns the IDENTICAL generic response for every promo failure cause", async () => {
    const causes: Array<() => void> = [
      // Unknown code:
      () => getAdminEventPromotionByCode.mockResolvedValue(null),
      // Inactive:
      () =>
        getAdminEventPromotionByCode.mockResolvedValue(
          activePromo({ isActive: false }),
        ),
      // Expired:
      () =>
        getAdminEventPromotionByCode.mockResolvedValue(
          activePromo({ validityEnd: { toMillis: () => 1 } }),
        ),
      // Exhausted:
      () =>
        getAdminEventPromotionByCode.mockResolvedValue(
          activePromo({ usageCap: 1, usedCount: 1 }),
        ),
    ];

    const bodies: string[] = [];
    for (const arrange of causes) {
      arrange();
      const response = await POST(
        makeRequest({ token, promoCode: "WHATEVER" }),
        makeContext(),
      );
      expect(response.status).toBe(400);
      bodies.push(JSON.stringify(await response.json()));
    }

    // No oracle: all four causes produce byte-identical bodies.
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("This code isn't valid.");
    // And no promo metadata leaks:
    expect(bodies[0]).not.toContain("promo-1");
    expect(bodies[0]).not.toContain("SAVE10");
  });
});

describe("POST quote — gates", () => {
  it("404s forged tokens", async () => {
    const response = await POST(
      makeRequest({ token: `${DRAFT_ID}.${"B".repeat(43)}`, promoCode: "X" }),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(getAdminRegistrationDraftByIdAndTokenHash).not.toHaveBeenCalled();
  });

  it("409s when the draft has no ticket selection yet", async () => {
    getAdminRegistrationDraftByIdAndTokenHash.mockResolvedValue({
      ...draft,
      ticketTypeId: null,
      registrationTypeId: null,
    });
    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "OUT_OF_ORDER" });
  });

  it("rate-limits at 10/min/IP (promo validation limit)", async () => {
    for (let i = 0; i < 10; i += 1) {
      await POST(makeRequest({ token }), makeContext());
    }
    const response = await POST(makeRequest({ token }), makeContext());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });
});
