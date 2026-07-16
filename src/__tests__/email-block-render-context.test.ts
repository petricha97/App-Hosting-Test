// @vitest-environment node
/**
 * M6-T4 B-1 follow-up — src/features/emails/server/resolve-block-context.ts,
 * the shared function every real call site of deriveBodyForDefinition/
 * renderEmailDefinitionPreview now uses to build a real
 * EmailBlockRenderContext (pricing/registrationCta/countdown) instead of
 * always defaulting to empty. Review: agents/docs/reviews/m6-email-designer.md
 * B-1.
 *
 * Locks:
 *  - pricing: passes through listPublicTicketsForEvent's projection as-is;
 *    a lookup failure degrades to null, never throws;
 *  - registrationCta: mirrors the public event page's own resolution
 *    (hasPublishedForm + path counts -> resolveRegistrationCtaState) —
 *    "no_paths" collapses to null; "open"/"closed" carry through with an
 *    ABSOLUTE registerHref (never a relative path, which RegistrationEmbed's
 *    isEmailSafeUrl re-check would reject); an unresolvable base URL
 *    degrades the whole field to null rather than emit an unsafe href;
 *  - countdown: eventStartIso/timezone derived from the SAME
 *    resolveEventStartMs/resolveEventTimeZone helpers the web page/default
 *    definitions use, never forked;
 *  - EVERY sub-resolution is independently failure-isolated — a thrown
 *    error from any one DAL call degrades ONLY that field, never the whole
 *    context, and the function itself never throws under any combination
 *    of failures.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminEventForOrganization,
  getAdminPublishedFormForPublicEvent,
  getAdminRegistrationPathsForEvent,
  listPublicTicketsForEvent,
  resolveEmailBaseUrl,
} = vi.hoisted(() => ({
  getAdminEventForOrganization: vi.fn(),
  getAdminPublishedFormForPublicEvent: vi.fn(),
  getAdminRegistrationPathsForEvent: vi.fn(),
  listPublicTicketsForEvent: vi.fn(),
  resolveEmailBaseUrl: vi.fn(),
}));

vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminForm", () => ({
  getAdminPublishedFormForPublicEvent,
}));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathsForEvent,
}));
vi.mock("@/features/public-registration/server/tickets", () => ({
  listPublicTicketsForEvent,
}));
vi.mock("@/lib/email/base-url", () => ({ resolveEmailBaseUrl }));

import { resolveEmailBlockRenderContext } from "@/features/emails/server/resolve-block-context";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const EVENT = {
  id: EVENT_ID,
  organizationId: ORG_ID,
  name: "Innovation Summit",
  formPath: "forms/form-1",
  periods: [{ date: "2099-06-01", startTime: "09:00" }],
  timezone: "America/New_York",
};

const PRICING = {
  currencies: ["USD"],
  tickets: [
    {
      name: "General Admission",
      code: "GA",
      soldOut: false,
      audienceNames: [],
      prices: [{ currency: "USD", minPriceMinor: 5000, isFrom: false }],
    },
  ],
};

function path(overrides: Record<string, unknown> = {}) {
  return { id: "path-1", isActive: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminEventForOrganization.mockResolvedValue(EVENT);
  getAdminPublishedFormForPublicEvent.mockResolvedValue({ id: "form-1" });
  getAdminRegistrationPathsForEvent.mockResolvedValue([path()]);
  listPublicTicketsForEvent.mockResolvedValue(PRICING);
  resolveEmailBaseUrl.mockResolvedValue("https://app.example.com");
});

describe("pricing", () => {
  it("passes the pricing projection through unchanged", async () => {
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.pricing).toEqual(PRICING);
    expect(listPublicTicketsForEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
  });

  it("degrades to null when the pricing lookup throws — never blocks the rest of the context", async () => {
    listPublicTicketsForEvent.mockRejectedValue(new Error("firestore blip"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(context.pricing).toBeNull();
    expect(context.registrationCta).not.toBeNull();
    expect(context.countdown).not.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("registrationCta", () => {
  it("open: >=1 active path + a published form -> state 'open' with an ABSOLUTE registerHref", async () => {
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.registrationCta).toEqual({
      state: "open",
      registerHref: `https://app.example.com/events/${EVENT_ID}/register`,
    });
  });

  it("closed: paths exist but none active -> state 'closed'", async () => {
    getAdminRegistrationPathsForEvent.mockResolvedValue([
      path({ isActive: false }),
    ]);
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.registrationCta).toEqual({
      state: "closed",
      registerHref: `https://app.example.com/events/${EVENT_ID}/register`,
    });
  });

  it("closed: an active path but no published form -> state 'closed'", async () => {
    getAdminPublishedFormForPublicEvent.mockResolvedValue(null);
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.registrationCta?.state).toBe("closed");
  });

  it("zero paths ever configured -> null (RegistrationEmbed's own 'never configured' fallback)", async () => {
    getAdminRegistrationPathsForEvent.mockResolvedValue([]);
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.registrationCta).toBeNull();
  });

  it("no resolvable absolute base URL -> null, even when the state would otherwise be open (an unsafe href would fail isEmailSafeUrl anyway)", async () => {
    resolveEmailBaseUrl.mockResolvedValue(null);
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.registrationCta).toBeNull();
  });

  it("degrades to null when the paths/form lookup throws — never blocks pricing/countdown", async () => {
    getAdminRegistrationPathsForEvent.mockRejectedValue(
      new Error("firestore blip"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(context.registrationCta).toBeNull();
    expect(context.pricing).toEqual(PRICING);
    expect(context.countdown).not.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("countdown", () => {
  it("derives eventStartIso/timezone from the event's first period, same helpers the web page/default definitions use", async () => {
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.countdown).toEqual({
      eventStartIso: new Date(
        Date.UTC(2099, 5, 1, 13, 0, 0), // 09:00 America/New_York (EDT, UTC-4) in June
      ).toISOString(),
      timezone: "America/New_York",
    });
  });

  it("no usable period -> eventStartIso null (never crashes)", async () => {
    getAdminEventForOrganization.mockResolvedValue({
      ...EVENT,
      periods: [],
    });
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.countdown).toEqual({
      eventStartIso: null,
      timezone: "America/New_York",
    });
  });
});

describe("event lookup failure", () => {
  it("event not found -> registrationCta/countdown null, pricing still resolves independently", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(context.registrationCta).toBeNull();
    expect(context.countdown).toBeNull();
    expect(context.pricing).toEqual(PRICING);
  });

  it("event lookup throws -> degrades the same way as 'not found', never crashes", async () => {
    getAdminEventForOrganization.mockRejectedValue(new Error("firestore blip"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const context = await resolveEmailBlockRenderContext({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(context.registrationCta).toBeNull();
    expect(context.countdown).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("never throws", () => {
  it("every sub-resolution failing simultaneously still resolves to a degraded (never rejected) context", async () => {
    getAdminEventForOrganization.mockRejectedValue(new Error("a"));
    listPublicTicketsForEvent.mockRejectedValue(new Error("b"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      resolveEmailBlockRenderContext({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toEqual({
      pricing: null,
      registrationCta: null,
      countdown: null,
    });

    consoleError.mockRestore();
  });
});
