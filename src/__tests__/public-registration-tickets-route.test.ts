// @vitest-environment node
/**
 * M3-T2 AC-4/5/7 — public tickets projection:
 * - lists exactly eligibility × derived-open × priced-in-path-currency;
 * - sold-out tickets are returned DISABLED (availability bucket), not hidden;
 * - projection safety: NO registrationTypeIds, capacity, registeredCount,
 *   sales timestamps, fee ids or org internals in the response;
 * - ambiguous Any-audience tickets carry the "Register as" choices;
 * - inactive path / draft event → 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
} = vi.hoisted(() => ({
  getAdminPublishedEventById: vi.fn(),
  getAdminPublishedFormForPublicEvent: vi.fn(),
  getAdminRegistrationPathForEvent: vi.fn(),
  getAdminRegistrationDraftByIdAndTokenHash: vi.fn(),
  getAdminTicketTypesForEvent: vi.fn(),
  getAdminTicketTypeForEvent: vi.fn(),
  getAdminRegistrationTypesForEvent: vi.fn(),
  resolveAdminFeeForOrder: vi.fn(),
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

import { GET } from "@/app/api/events/[eventId]/registration/tickets/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const PATH_ID = "path-1";

const publishedEvent = {
  id: EVENT_ID,
  name: "Tech Meetup 2026",
  status: "Published",
  organizationPath: `Organization/${ORG_ID}`,
  formPath: "Form/form-1",
};

const publishedForm = { id: "form-1", organizationId: ORG_ID, status: "published", fields: [] };

function makePath(overrides: Record<string, unknown> = {}) {
  return {
    id: PATH_ID,
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Sponsor — Card",
    code: "SPN-CC",
    audienceRegistrationTypeId: "rt-1",
    paymentMethod: "card",
    currency: "USD",
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

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

function makeRequest(pathId = PATH_ID) {
  return new Request(
    `http://localhost/api/events/${EVENT_ID}/registration/tickets?path=${pathId}`,
  );
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();

  getAdminPublishedEventById.mockResolvedValue(publishedEvent);
  getAdminPublishedFormForPublicEvent.mockResolvedValue(publishedForm);
  getAdminRegistrationPathForEvent.mockResolvedValue(makePath());
  getAdminTicketTypesForEvent.mockResolvedValue([makeTicket()]);
  getAdminRegistrationTypesForEvent.mockResolvedValue([
    { id: "rt-1", name: "Sponsor", organizationId: ORG_ID, eventId: EVENT_ID },
    { id: "rt-2", name: "Delegate", organizationId: ORG_ID, eventId: EVENT_ID },
  ]);
  resolveAdminFeeForOrder.mockResolvedValue(fee);
});

describe("GET tickets — projection safety (T2 AC-7)", () => {
  it("returns ONLY the public-safe fields — no internals leak", async () => {
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    const { tickets } = await response.json();

    expect(tickets).toHaveLength(1);
    // Exact key set — a new internal field leaking would fail this.
    expect(Object.keys(tickets[0]).sort()).toEqual([
      "availability",
      "code",
      "currency",
      "id",
      "name",
      "priceMinor",
    ]);
    expect(tickets[0]).toEqual({
      id: "tick-1",
      name: "General Admission",
      code: "GA",
      priceMinor: 5000,
      currency: "USD",
      availability: "available",
    });

    const raw = JSON.stringify(tickets);
    expect(raw).not.toContain("registrationTypeIds");
    expect(raw).not.toContain("registeredCount");
    expect(raw).not.toContain("capacity");
    expect(raw).not.toContain("organizationId");
    expect(raw).not.toContain("fee-1");
  });
});

describe("GET tickets — eligibility × open × priced (T2 AC-4)", () => {
  it("hides tickets whose eligibility excludes the path audience", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([
      makeTicket({ id: "tick-other", registrationTypeIds: ["rt-2"] }),
    ]);
    const response = await GET(makeRequest(), makeContext());
    const { tickets } = await response.json();
    expect(tickets).toHaveLength(0);
  });

  it("hides derived-closed tickets and unpriced tickets", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([
      makeTicket({ id: "closed", isOpen: false }),
      makeTicket({ id: "unpriced" }),
    ]);
    resolveAdminFeeForOrder.mockResolvedValue(null);
    const response = await GET(makeRequest(), makeContext());
    const { tickets } = await response.json();
    expect(tickets).toHaveLength(0);
  });

  it("returns sold-out tickets DISABLED (bucket), never hidden (T2 AC-4)", async () => {
    getAdminTicketTypesForEvent.mockResolvedValue([
      makeTicket({ capacity: 10, registeredCount: 10 }),
    ]);
    const response = await GET(makeRequest(), makeContext());
    const { tickets } = await response.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].availability).toBe("sold_out");
  });

  it("adds Register-as choices WITH per-type prices for ambiguous Any-audience tickets only", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ audienceRegistrationTypeId: null }),
    );
    getAdminTicketTypesForEvent.mockResolvedValue([
      makeTicket({ id: "unrestricted", registrationTypeIds: [] }),
      makeTicket({ id: "single", registrationTypeIds: ["rt-1"] }),
    ]);

    const response = await GET(makeRequest(), makeContext());
    const { tickets } = await response.json();

    const unrestricted = tickets.find((t: { id: string }) => t.id === "unrestricted");
    expect(unrestricted.registrationTypeOptions).toEqual([
      { id: "rt-1", name: "Sponsor", priceMinor: 5000 },
      { id: "rt-2", name: "Delegate", priceMinor: 5000 },
    ]);
    // Projection safety for the picker entries too: exact key set.
    for (const option of unrestricted.registrationTypeOptions) {
      expect(Object.keys(option).sort()).toEqual(["id", "name", "priceMinor"]);
    }

    const single = tickets.find((t: { id: string }) => t.id === "single");
    expect(single.registrationTypeOptions).toBeUndefined();
  });
});

describe("GET tickets — ambiguous mixed-fee pricing (T2 AC-5, review S1)", () => {
  beforeEach(() => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ audienceRegistrationTypeId: null }),
    );
    getAdminTicketTypesForEvent.mockResolvedValue([
      makeTicket({ id: "ambiguous", registrationTypeIds: [] }),
    ]);
  });

  it("prices each choosable type via specific-wins and returns min as the card 'from' price", async () => {
    // rt-1 has a SPECIFIC fee ($200); rt-2 falls back to the All-types fee
    // ($100) — the config the old ""-resolution mispriced (S1).
    resolveAdminFeeForOrder.mockImplementation(
      async ({ registrationTypeId }: { registrationTypeId: string }) =>
        registrationTypeId === "rt-1"
          ? { ...fee, id: "fee-specific", basePriceMinor: 20000 }
          : { ...fee, id: "fee-all", basePriceMinor: 10000 },
    );

    const response = await GET(makeRequest(), makeContext());
    const { tickets } = await response.json();

    expect(tickets).toHaveLength(1);
    expect(tickets[0].registrationTypeOptions).toEqual([
      { id: "rt-1", name: "Sponsor", priceMinor: 20000 },
      { id: "rt-2", name: "Delegate", priceMinor: 10000 },
    ]);
    // Card price = MIN across options ("from" price until the pick).
    expect(tickets[0].priceMinor).toBe(10000);
  });

  it("excludes fee-less types from the picker (they could never be quoted)", async () => {
    resolveAdminFeeForOrder.mockImplementation(
      async ({ registrationTypeId }: { registrationTypeId: string }) =>
        registrationTypeId === "rt-1"
          ? { ...fee, basePriceMinor: 20000 }
          : null,
    );

    const response = await GET(makeRequest(), makeContext());
    const { tickets } = await response.json();

    expect(tickets).toHaveLength(1);
    expect(tickets[0].registrationTypeOptions).toEqual([
      { id: "rt-1", name: "Sponsor", priceMinor: 20000 },
    ]);
    expect(tickets[0].priceMinor).toBe(20000);
  });

  it("hides an ambiguous ticket when NO choosable type is priced", async () => {
    resolveAdminFeeForOrder.mockResolvedValue(null);
    const response = await GET(makeRequest(), makeContext());
    const { tickets } = await response.json();
    expect(tickets).toHaveLength(0);
  });
});

describe("GET tickets — gates", () => {
  it("404s inactive paths forced via ?path=", async () => {
    getAdminRegistrationPathForEvent.mockResolvedValue(
      makePath({ isActive: false }),
    );
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(404);
  });

  it("404s when the event is missing/Draft", async () => {
    getAdminPublishedEventById.mockResolvedValue(null);
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(404);
  });

  it("404s without a path param", async () => {
    const request = new Request(
      `http://localhost/api/events/${EVENT_ID}/registration/tickets`,
    );
    const response = await GET(request, makeContext());
    expect(response.status).toBe(404);
  });
});
