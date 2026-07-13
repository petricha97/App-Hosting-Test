// @vitest-environment node
/**
 * M3-T3 — pure stepper utilities and typed-error surface mapping:
 * - 5 steps for card/invoice, 4 for comp/none with Payment omitted and
 *   renumbered (T3 AC-2, design §3);
 * - navigation gating from lastStepReached (steps beyond +1 not navigable);
 * - finalize error surfaces per the spec error table (raw codes never used
 *   as display copy);
 * - the in-memory rate limiter's window behavior (spec Shared decisions).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { mapFinalizeErrorToSurface } from "@/features/public-registration/errors";
import {
  buildPublicFlowSteps,
  flowStepIndex,
  isPaymentSkipped,
  maxNavigableStepIndex,
  primaryActionLabel,
  resumeStepIndex,
} from "@/features/public-registration/steps";
import {
  registrationTypeOptionsHaveMixedPrices,
  ticketDisplayPrice,
} from "@/features/public-registration/ticket-price";
import type { PublicTicketOption } from "@/features/public-registration/types";
import {
  checkRateLimit,
  checkRequestRateLimit,
  getRequestIp,
  resetRateLimits,
} from "@/lib/rate-limit";

describe("buildPublicFlowSteps", () => {
  it("renders 5 numbered steps for card and invoice paths", () => {
    for (const method of ["card", "invoice"] as const) {
      const steps = buildPublicFlowSteps(method);
      expect(steps.map((step) => step.id)).toEqual([
        "personal_info",
        "ticket_options",
        "summary",
        "payment",
        "confirmation",
      ]);
      expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("omits Payment entirely and renumbers for comp/none paths", () => {
    for (const method of ["comp", "none"] as const) {
      const steps = buildPublicFlowSteps(method);
      expect(steps.map((step) => step.id)).toEqual([
        "personal_info",
        "ticket_options",
        "summary",
        "confirmation",
      ]);
      expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4]);
      expect(isPaymentSkipped(method)).toBe(true);
    }
  });
});

describe("navigation gating (T3 AC-2)", () => {
  const steps = buildPublicFlowSteps("card");

  it("allows only step 1 before any draft exists", () => {
    expect(maxNavigableStepIndex(steps, null)).toBe(0);
  });

  it("allows exactly lastStepReached + 1", () => {
    expect(maxNavigableStepIndex(steps, "personal_info")).toBe(
      flowStepIndex(steps, "ticket_options"),
    );
    expect(maxNavigableStepIndex(steps, "ticket_options")).toBe(
      flowStepIndex(steps, "summary"),
    );
    expect(maxNavigableStepIndex(steps, "summary")).toBe(
      flowStepIndex(steps, "payment"),
    );
  });

  it("resume lands on the step after the last completed one", () => {
    const compSteps = buildPublicFlowSteps("comp");
    expect(resumeStepIndex(compSteps, "ticket_options")).toBe(
      flowStepIndex(compSteps, "summary"),
    );
    // A payment marker on a flow that no longer has a payment step caps at
    // the summary follow-up, never out of range.
    expect(resumeStepIndex(compSteps, "payment")).toBeLessThan(compSteps.length);
  });
});

describe("primaryActionLabel", () => {
  it("labels the summary step per payment method", () => {
    const card = buildPublicFlowSteps("card");
    expect(primaryActionLabel(card, flowStepIndex(card, "summary"), "card")).toBe(
      "Confirm & pay",
    );

    const comp = buildPublicFlowSteps("comp");
    expect(primaryActionLabel(comp, flowStepIndex(comp, "summary"), "comp")).toBe(
      "Complete registration",
    );
  });
});

describe("mapFinalizeErrorToSurface (spec error table)", () => {
  it("SOLD_OUT / TYPE_FULL toast back to step 2 with refreshed availability", () => {
    for (const code of ["SOLD_OUT", "TYPE_FULL"]) {
      const surface = mapFinalizeErrorToSurface({ status: 409, code });
      expect(surface.kind).toBe("toast");
      expect(surface.goToStep).toBe("ticket_options");
      expect(surface.refreshTickets).toBe(true);
    }
  });

  it("PRICE_CHANGED re-quotes on the summary step", () => {
    const surface = mapFinalizeErrorToSurface({ status: 409, code: "PRICE_CHANGED" });
    expect(surface.goToStep).toBe("summary");
    expect(surface.requote).toBe(true);
  });

  it("PROMO_INVALID clears the code and returns to step 2 with the generic message", () => {
    const surface = mapFinalizeErrorToSurface({
      status: 409,
      code: "PROMO_INVALID",
      message: "This code isn't valid.",
    });
    expect(surface.clearPromo).toBe(true);
    expect(surface.goToStep).toBe("ticket_options");
    expect(surface.message).toBe("This code isn't valid.");
  });

  it("PAYMENT_FAILED stays on the payment step (no jump)", () => {
    const surface = mapFinalizeErrorToSurface({
      status: 402,
      code: "PAYMENT_FAILED",
      message: "simulated_decline",
    });
    expect(surface.goToStep).toBeUndefined();
    expect(surface.kind).toBe("banner");
  });

  it("429 renders the wait banner", () => {
    const surface = mapFinalizeErrorToSurface({ status: 429 });
    expect(surface.message).toContain("Too many attempts");
  });
});

describe("checkRateLimit (in-memory fixed window)", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit, then rejects with a Retry-After hint", () => {
    const nowMs = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit("k", { limit: 3, nowMs }).allowed).toBe(true);
    }
    const rejected = checkRateLimit("k", { limit: 3, nowMs: nowMs + 10_000 });
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("resets after the window elapses and isolates keys", () => {
    const nowMs = 2_000_000;
    checkRateLimit("a", { limit: 1, nowMs });
    expect(checkRateLimit("a", { limit: 1, nowMs }).allowed).toBe(false);
    expect(checkRateLimit("b", { limit: 1, nowMs }).allowed).toBe(true);
    expect(
      checkRateLimit("a", { limit: 1, nowMs: nowMs + 60_001 }).allowed,
    ).toBe(true);
  });
});

describe("ticketDisplayPrice — card price matches the quote for the pick (T2 AC-5, S1)", () => {
  function makeTicket(
    overrides: Partial<PublicTicketOption> = {},
  ): PublicTicketOption {
    return {
      id: "tick-1",
      name: "GA",
      code: "GA",
      priceMinor: 10000,
      currency: "USD",
      availability: "available",
      ...overrides,
    };
  }

  const mixed = makeTicket({
    priceMinor: 10000,
    registrationTypeOptions: [
      { id: "rt-1", name: "Sponsor", priceMinor: 20000 },
      { id: "rt-2", name: "Delegate", priceMinor: 10000 },
    ],
  });

  it("unambiguous tickets show their exact price", () => {
    expect(ticketDisplayPrice(makeTicket(), null, null)).toEqual({
      label: "$100.00",
      isFromPrice: false,
    });
  });

  it("ambiguous mixed-price tickets show 'From <min>' until the pick", () => {
    expect(ticketDisplayPrice(mixed, null, null)).toEqual({
      label: "From $100.00",
      isFromPrice: true,
    });
    // Selected but no "Register as" pick yet — still the lower bound.
    expect(ticketDisplayPrice(mixed, "tick-1", null).isFromPrice).toBe(true);
  });

  it("shows the picked option's EXACT price once ticket + type are selected", () => {
    expect(ticketDisplayPrice(mixed, "tick-1", "rt-1")).toEqual({
      label: "$200.00",
      isFromPrice: false,
    });
    expect(ticketDisplayPrice(mixed, "tick-1", "rt-2")).toEqual({
      label: "$100.00",
      isFromPrice: false,
    });
  });

  it("another ticket's selection never affects this card", () => {
    expect(ticketDisplayPrice(mixed, "tick-other", "rt-1").isFromPrice).toBe(
      true,
    );
  });

  it("uniform option prices render as the plain price (no 'From')", () => {
    const uniform = makeTicket({
      priceMinor: 10000,
      registrationTypeOptions: [
        { id: "rt-1", name: "Sponsor", priceMinor: 10000 },
        { id: "rt-2", name: "Delegate", priceMinor: 10000 },
      ],
    });
    expect(ticketDisplayPrice(uniform, null, null)).toEqual({
      label: "$100.00",
      isFromPrice: false,
    });
    expect(registrationTypeOptionsHaveMixedPrices(uniform)).toBe(false);
    expect(registrationTypeOptionsHaveMixedPrices(mixed)).toBe(true);
  });
});

describe("getRequestIp — rightmost non-private x-forwarded-for hop (S3/L-1)", () => {
  function requestWithHeaders(headers: Record<string, string>) {
    return new Request("http://localhost/api/x", { headers });
  }

  it("ignores client-supplied left hops and takes the proxy-appended real IP", () => {
    // GCLB appends the real client IP AFTER whatever the client sent.
    expect(
      getRequestIp(
        requestWithHeaders({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }),
      ),
    ).toBe("203.0.113.9");
  });

  it("skips trailing private/internal proxy hops", () => {
    expect(
      getRequestIp(
        requestWithHeaders({
          "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.2.3",
        }),
      ),
    ).toBe("203.0.113.9");
    expect(
      getRequestIp(
        requestWithHeaders({
          "x-forwarded-for": "198.51.100.7, 172.16.0.1, 192.168.1.1",
        }),
      ),
    ).toBe("198.51.100.7");
  });

  it("falls back to the rightmost hop when every hop is private (dev/local)", () => {
    expect(
      getRequestIp(
        requestWithHeaders({ "x-forwarded-for": "192.168.0.5, 10.0.0.1" }),
      ),
    ).toBe("10.0.0.1");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(
      getRequestIp(requestWithHeaders({ "x-real-ip": "203.0.113.4" })),
    ).toBe("203.0.113.4");
    expect(getRequestIp(requestWithHeaders({}))).toBe("unknown");
  });

  it("spoofed-XFF rotation cannot escape the bucket (promo brute-force guard, T2 AC-7)", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i += 1) {
      // Attacker rotates the FIRST hop per request; the proxy-appended real
      // IP stays the same — all requests must land in ONE bucket.
      const request = requestWithHeaders({
        "x-forwarded-for": `${i}.${i}.${i}.${i}, 203.0.113.9`,
      });
      const result = checkRequestRateLimit(request, "promo", 2);
      expect(result.allowed).toBe(i < 2);
    }
  });
});
