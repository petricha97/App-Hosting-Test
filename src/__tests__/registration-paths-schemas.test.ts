/**
 * M3-T1 — registration-path schemas + display helpers
 * (src/features/registration-paths/{schemas,utils}.ts).
 *
 * Locks:
 *  - payload schema: name 1–120, code normalized uppercase, server-owned
 *    fields stripped, sortOrder integer >= 0, enums enforced
 *  - form -> payload builder: "Any" sentinel becomes null
 *  - flow steps: 5 for card/invoice, 4 (no Payment, renumbered) for
 *    comp/none (T1 AC-3)
 */
import { describe, expect, it } from "vitest";

import {
  ANY_AUDIENCE,
  buildRegistrationPathPayload,
  registrationPathPayloadSchema,
} from "@/features/registration-paths/schemas";
import {
  buildFlowSteps,
  isPaymentSkipped,
  paymentSkippedLabel,
} from "@/features/registration-paths/utils";

const validPayload = {
  name: "2. Sponsor — Card",
  code: "spn-cc",
  audienceRegistrationTypeId: "rt-1",
  paymentMethod: "card",
  currency: "USD",
  isActive: true,
  sortOrder: 2,
};

describe("registrationPathPayloadSchema", () => {
  it("normalizes the code to uppercase and keeps all fields", () => {
    const parsed = registrationPathPayloadSchema.parse(validPayload);
    expect(parsed.code).toBe("SPN-CC");
    expect(parsed.audienceRegistrationTypeId).toBe("rt-1");
  });

  it("strips server-owned/unknown fields (organizationId, timestamps)", () => {
    const parsed = registrationPathPayloadSchema.parse({
      ...validPayload,
      organizationId: "attacker-org",
      eventId: "evt-x",
      createdAt: "2020-01-01",
    });
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed).not.toHaveProperty("eventId");
    expect(parsed).not.toHaveProperty("createdAt");
  });

  it("accepts a missing sortOrder (DAL defaults to max+1)", () => {
    const { sortOrder: _sortOrder, ...withoutSortOrder } = validPayload;
    const parsed = registrationPathPayloadSchema.parse(withoutSortOrder);
    expect(parsed.sortOrder).toBeUndefined();
  });

  it("accepts an explicit null audience (Any)", () => {
    const parsed = registrationPathPayloadSchema.parse({
      ...validPayload,
      audienceRegistrationTypeId: null,
    });
    expect(parsed.audienceRegistrationTypeId).toBeNull();
  });

  it("rejects names over 120 characters and empty names", () => {
    expect(
      registrationPathPayloadSchema.safeParse({
        ...validPayload,
        name: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      registrationPathPayloadSchema.safeParse({ ...validPayload, name: "  " })
        .success,
    ).toBe(false);
  });

  it("accepts names of exactly 120 characters (organizers number them)", () => {
    expect(
      registrationPathPayloadSchema.safeParse({
        ...validPayload,
        name: "2.1 " + "x".repeat(116),
      }).success,
    ).toBe(true);
  });

  it("rejects negative, fractional and out-of-enum values", () => {
    expect(
      registrationPathPayloadSchema.safeParse({ ...validPayload, sortOrder: -1 })
        .success,
    ).toBe(false);
    expect(
      registrationPathPayloadSchema.safeParse({
        ...validPayload,
        sortOrder: 1.5,
      }).success,
    ).toBe(false);
    expect(
      registrationPathPayloadSchema.safeParse({
        ...validPayload,
        paymentMethod: "crypto",
      }).success,
    ).toBe(false);
    expect(
      registrationPathPayloadSchema.safeParse({
        ...validPayload,
        currency: "JPY",
      }).success,
    ).toBe(false);
  });
});

describe("buildRegistrationPathPayload", () => {
  it("maps the Any sentinel to null and coerces sortOrder", () => {
    const payload = buildRegistrationPathPayload({
      name: "  3. Comp — Speakers ",
      code: "comp",
      audienceRegistrationTypeId: ANY_AUDIENCE,
      paymentMethod: "none",
      currency: "SGD",
      sortOrder: "4",
      isActive: false,
    });

    expect(payload).toEqual({
      name: "3. Comp — Speakers",
      code: "COMP",
      audienceRegistrationTypeId: null,
      paymentMethod: "none",
      currency: "SGD",
      isActive: false,
      sortOrder: 4,
    });
  });
});

describe("flow steps (T1 AC-3)", () => {
  it("card and invoice paths render all 5 steps in order", () => {
    for (const method of ["card", "invoice"] as const) {
      const steps = buildFlowSteps(method);
      expect(steps.map((step) => step.title)).toEqual([
        "Personal Information",
        "Ticket & Options",
        "Registration Summary",
        "Payment",
        "Confirmation + QR",
      ]);
      expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5]);
      expect(isPaymentSkipped(method)).toBe(false);
      expect(paymentSkippedLabel(method)).toBeNull();
    }
  });

  it("comp and none paths render 4 steps — Payment omitted and renumbered", () => {
    for (const method of ["comp", "none"] as const) {
      const steps = buildFlowSteps(method);
      expect(steps.map((step) => step.title)).toEqual([
        "Personal Information",
        "Ticket & Options",
        "Registration Summary",
        "Confirmation + QR",
      ]);
      expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4]);
      expect(isPaymentSkipped(method)).toBe(true);
    }
    expect(paymentSkippedLabel("comp")).toBe("Payment skipped — Comp");
    expect(paymentSkippedLabel("none")).toBe("Payment skipped — Free");
  });
});
