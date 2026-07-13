/**
 * M1 registration spine — shared Zod schemas.
 * Spec: agents/docs/specs/m1-registration-spine.md (code format/normalization,
 * capacity rules, sales-window ordering, server-owned field stripping).
 */
import { describe, expect, it } from "vitest";

import {
  buildRegistrationTypePayload,
  buildTicketTypePayload,
  registrationTypeFormSchema,
  registrationTypePayloadSchema,
  ticketTypeFormSchema,
  ticketTypePayloadSchema,
} from "@/features/registration/schemas";

function validTicketPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "GC Early Bird",
    code: "GC-EB",
    capacity: null,
    salesStart: null,
    salesEnd: null,
    isOpen: true,
    registrationTypeIds: [],
    ...overrides,
  };
}

describe("registrationTypePayloadSchema — code rules", () => {
  it("normalizes codes to uppercase (auto-uppercase, case-insensitive uniqueness base)", () => {
    const parsed = registrationTypePayloadSchema.parse({
      name: "Delegate",
      code: "gc-onl",
      capacity: null,
    });
    expect(parsed.code).toBe("GC-ONL");
  });

  it("trims surrounding whitespace before validating", () => {
    const parsed = registrationTypePayloadSchema.parse({
      name: "Press",
      code: "  press ",
      capacity: null,
    });
    expect(parsed.code).toBe("PRESS");
  });

  it("accepts slash comp variants like DEL/C", () => {
    const parsed = registrationTypePayloadSchema.parse({
      name: "Comp",
      code: "DEL/C",
      capacity: null,
    });
    expect(parsed.code).toBe("DEL/C");
  });

  it.each([
    ["", "empty"],
    ["A", "single char (min 2)"],
    ["-ABC", "leading hyphen"],
    ["/AB", "leading slash"],
    ["ABCDEFGHIJKLM", "13 chars (max 12)"],
    ["GC ONL", "space"],
    ["GC_ONL", "underscore"],
  ])("rejects invalid code %s (%s)", (code) => {
    const result = registrationTypePayloadSchema.safeParse({
      name: "Delegate",
      code,
      capacity: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts the 12-char maximum", () => {
    const result = registrationTypePayloadSchema.safeParse({
      name: "Delegate",
      code: "AB-CDEF/GH12",
      capacity: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("registrationTypePayloadSchema — name and capacity", () => {
  it("requires a non-empty name and caps it at 80 chars", () => {
    expect(
      registrationTypePayloadSchema.safeParse({
        name: "   ",
        code: "GC",
        capacity: null,
      }).success,
    ).toBe(false);
    expect(
      registrationTypePayloadSchema.safeParse({
        name: "x".repeat(81),
        code: "GC",
        capacity: null,
      }).success,
    ).toBe(false);
    expect(
      registrationTypePayloadSchema.safeParse({
        name: "x".repeat(80),
        code: "GC",
        capacity: null,
      }).success,
    ).toBe(true);
  });

  it("capacity: null = Unlimited is valid; integers >= 1 are valid", () => {
    expect(
      registrationTypePayloadSchema.safeParse({
        name: "Delegate",
        code: "GC",
        capacity: null,
      }).success,
    ).toBe(true);
    expect(
      registrationTypePayloadSchema.safeParse({
        name: "Delegate",
        code: "GC",
        capacity: 1,
      }).success,
    ).toBe(true);
  });

  it.each([[0], [-5], [1.5], [1_000_001]])(
    "capacity %s is invalid",
    (capacity) => {
      expect(
        registrationTypePayloadSchema.safeParse({
          name: "Delegate",
          code: "GC",
          capacity,
        }).success,
      ).toBe(false);
    },
  );

  it("caps capacity at 1,000,000 with a dedicated message", () => {
    expect(
      registrationTypePayloadSchema.safeParse({
        name: "Delegate",
        code: "GC",
        capacity: 1_000_000,
      }).success,
    ).toBe(true);

    const result = registrationTypePayloadSchema.safeParse({
      name: "Delegate",
      code: "GC",
      capacity: 1_000_001,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.capacity?.[0]).toBe(
        "Capacity cannot exceed 1,000,000.",
      );
    }
  });

  it("strips server-owned fields (registeredCount, organizationId, eventId)", () => {
    const parsed = registrationTypePayloadSchema.parse({
      name: "Delegate",
      code: "GC",
      capacity: null,
      registeredCount: 999,
      organizationId: "attacker-org",
      eventId: "other-event",
    });
    expect("registeredCount" in parsed).toBe(false);
    expect("organizationId" in parsed).toBe(false);
    expect("eventId" in parsed).toBe(false);
  });
});

describe("ticketTypePayloadSchema", () => {
  it("accepts a minimal unrestricted ticket and defaults registrationTypeIds to []", () => {
    const parsed = ticketTypePayloadSchema.parse({
      name: "GC Early Bird",
      code: "gc-eb",
      capacity: 150,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
    });
    expect(parsed.code).toBe("GC-EB");
    expect(parsed.registrationTypeIds).toEqual([]);
  });

  it("rejects salesEnd earlier than salesStart, flagged on salesEnd", () => {
    const result = ticketTypePayloadSchema.safeParse(
      validTicketPayload({ salesStart: "2026-08-01", salesEnd: "2026-07-31" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const flattened = result.error.flatten();
      expect(flattened.fieldErrors.salesEnd?.[0]).toBe(
        "Sales end must be on or after sales start.",
      );
    }
  });

  it("accepts equal start/end dates (single-day window)", () => {
    expect(
      ticketTypePayloadSchema.safeParse(
        validTicketPayload({
          salesStart: "2026-07-31",
          salesEnd: "2026-07-31",
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts one-sided windows", () => {
    expect(
      ticketTypePayloadSchema.safeParse(
        validTicketPayload({ salesEnd: "2026-07-31" }),
      ).success,
    ).toBe(true);
    expect(
      ticketTypePayloadSchema.safeParse(
        validTicketPayload({ salesStart: "2026-08-01" }),
      ).success,
    ).toBe(true);
  });

  it("rejects malformed date strings", () => {
    expect(
      ticketTypePayloadSchema.safeParse(
        validTicketPayload({ salesStart: "31/07/2026" }),
      ).success,
    ).toBe(false);
  });

  // Shape-valid but impossible dates would otherwise be silently rolled over
  // by Date.UTC (Feb 31 -> Mar 3, month 13 -> Jan next year) and persist a
  // different sales window than the client submitted.
  it.each([
    ["2026-02-31", "Feb 31 (rollover to Mar 3)"],
    ["2026-13-01", "month 13 (rollover to Jan next year)"],
    ["2026-02-29", "Feb 29 in a non-leap year"],
    ["2026-04-31", "Apr 31"],
    ["2026-00-10", "month 00"],
    ["2026-06-00", "day 00"],
  ])("rejects impossible calendar date %s (%s)", (date) => {
    const result = ticketTypePayloadSchema.safeParse(
      validTicketPayload({ salesStart: date }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.salesStart?.[0]).toBe(
        "Use a valid calendar date.",
      );
    }
    // Same refine on salesEnd.
    expect(
      ticketTypePayloadSchema.safeParse(validTicketPayload({ salesEnd: date }))
        .success,
    ).toBe(false);
  });

  it("accepts real boundary dates (leap day, month ends)", () => {
    for (const date of ["2024-02-29", "2026-01-31", "2026-12-31", "2026-04-30"]) {
      expect(
        ticketTypePayloadSchema.safeParse(
          validTicketPayload({ salesStart: date, salesEnd: date }),
        ).success,
      ).toBe(true);
    }
  });

  it("caps registrationTypeIds at 25 entries", () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => `rt-${i}`);

    expect(
      ticketTypePayloadSchema.safeParse(
        validTicketPayload({ registrationTypeIds: ids(25) }),
      ).success,
    ).toBe(true);

    const result = ticketTypePayloadSchema.safeParse(
      validTicketPayload({ registrationTypeIds: ids(26) }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.registrationTypeIds?.[0]).toBe(
        "Select at most 25 registration types.",
      );
    }
  });

  it("strips server-owned registeredCount", () => {
    const parsed = ticketTypePayloadSchema.parse(
      validTicketPayload({ registeredCount: 42 }),
    );
    expect("registeredCount" in parsed).toBe(false);
  });
});

describe("dialog form schemas — capacity switch pattern", () => {
  const base = { name: "Delegate", code: "GC-ONL" };

  it("unlimited (switch off) ignores the capacity text", () => {
    expect(
      registrationTypeFormSchema.safeParse({
        ...base,
        limitCapacity: false,
        capacity: "",
      }).success,
    ).toBe(true);
  });

  it.each([["", "empty"], ["0", "zero"], ["2.5", "fraction"], ["abc", "NaN"]])(
    "limited capacity rejects %s (%s)",
    (capacity) => {
      const result = registrationTypeFormSchema.safeParse({
        ...base,
        limitCapacity: true,
        capacity,
      });
      expect(result.success).toBe(false);
    },
  );

  it("limited capacity accepts whole numbers >= 1", () => {
    expect(
      registrationTypeFormSchema.safeParse({
        ...base,
        limitCapacity: true,
        capacity: "200",
      }).success,
    ).toBe(true);
  });

  it("mirrors the 1,000,000 capacity ceiling on the form input", () => {
    expect(
      registrationTypeFormSchema.safeParse({
        ...base,
        limitCapacity: true,
        capacity: "1000000",
      }).success,
    ).toBe(true);
    expect(
      registrationTypeFormSchema.safeParse({
        ...base,
        limitCapacity: true,
        capacity: "1000001",
      }).success,
    ).toBe(false);
  });

  it("ticket form mirrors the 25-registration-type cap", () => {
    const values = (count: number) => ({
      ...base,
      limitCapacity: false,
      capacity: "",
      salesStart: "",
      salesEnd: "",
      isOpen: true,
      registrationTypeIds: Array.from({ length: count }, (_, i) => `rt-${i}`),
    });

    expect(ticketTypeFormSchema.safeParse(values(25)).success).toBe(true);
    expect(ticketTypeFormSchema.safeParse(values(26)).success).toBe(false);
  });

  it("ticket form enforces salesEnd >= salesStart on date-input strings", () => {
    const result = ticketTypeFormSchema.safeParse({
      ...base,
      limitCapacity: false,
      capacity: "",
      salesStart: "2026-08-01",
      salesEnd: "2026-07-31",
      isOpen: true,
      registrationTypeIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("payload builders", () => {
  it("buildRegistrationTypePayload maps the switch pattern to capacity | null and normalizes the code", () => {
    expect(
      buildRegistrationTypePayload({
        name: "  Delegate ",
        code: "gc-onl",
        limitCapacity: true,
        capacity: "200",
      }),
    ).toEqual({ name: "Delegate", code: "GC-ONL", capacity: 200 });

    expect(
      buildRegistrationTypePayload({
        name: "Delegate",
        code: "GC-ONL",
        limitCapacity: false,
        capacity: "200",
      }).capacity,
    ).toBeNull();
  });

  it("buildTicketTypePayload converts empty date inputs to null", () => {
    const payload = buildTicketTypePayload({
      name: "GC Standard",
      code: "gc-st",
      limitCapacity: false,
      capacity: "",
      salesStart: "",
      salesEnd: "2026-07-31",
      isOpen: false,
      registrationTypeIds: ["rt-1"],
    });
    expect(payload).toEqual({
      name: "GC Standard",
      code: "GC-ST",
      capacity: null,
      salesStart: null,
      salesEnd: "2026-07-31",
      isOpen: false,
      registrationTypeIds: ["rt-1"],
    });
  });
});
