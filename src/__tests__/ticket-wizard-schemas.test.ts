// Checks client-only scheduling rules, audience selection, and code suggestions.
import { describe, expect, it } from "vitest";
import { generateRegistrationCode } from "@/features/registration/generate-code";
import { isValidRegistrationCode } from "@/lib/db/registrationCode";
import {
  buildTicketWizardDetailsPayload,
  ticketWizardDetailsFormSchema,
  validateTicketWizardAudienceRows,
} from "@/features/ticket-wizard/schemas";

const details = {
  name: "Early Bird",
  code: "EARLY-BIRD",
  limitCapacity: false,
  capacity: "",
  scheduleSales: true,
  salesStart: "2026-10-01",
  salesEnd: "2026-10-15",
};

describe("Suggested codes", () => {
  it.each([
    "Early Bird",
    "Délegué",
    "東京",
    "A",
    "",
    "---",
    "An extraordinarily long ticket name",
  ])("returns a valid bounded identifier for %s", (name) => {
    const code = generateRegistrationCode(name);
    expect(isValidRegistrationCode(code)).toBe(true);
    expect(code.length).toBeLessThanOrEqual(12);
  });
  it("folds accents and uses a valid configurable fallback", () => {
    expect(generateRegistrationCode("Délegué")).toBe("DELEGUE");
    expect(generateRegistrationCode("東京", "GENERAL")).toBe("GENERAL");
    expect(generateRegistrationCode("", "?")).toBe("TICKET");
  });
});

describe("Wizard client validation", () => {
  it.each(["2026-02-30", "2026-13-01", "nonsense"])(
    "rejects impossible scheduled date %s",
    (salesStart) => {
      expect(
        ticketWizardDetailsFormSchema.safeParse({ ...details, salesStart })
          .success,
      ).toBe(false);
    },
  );
  it("ignores retained invalid dates when scheduling is disabled, and omits them from the payload", () => {
    const value = {
      ...details,
      scheduleSales: false,
      salesStart: "2026-02-30",
      salesEnd: "2025-01-01",
    };
    expect(ticketWizardDetailsFormSchema.safeParse(value).success).toBe(true);
    expect(buildTicketWizardDetailsPayload(value)).toMatchObject({
      salesStart: null,
      salesEnd: null,
      capacity: null,
      isOpen: true,
    });
  });
  it("allows valid leap days, single-day windows, and one-sided schedules", () => {
    expect(
      ticketWizardDetailsFormSchema.safeParse({
        ...details,
        salesStart: "2028-02-29",
        salesEnd: "2028-02-29",
      }).success,
    ).toBe(true);
    expect(
      ticketWizardDetailsFormSchema.safeParse({ ...details, salesStart: "" })
        .success,
    ).toBe(true);
  });
  it("requires an audience and enforces the API selection maximum before submission", () => {
    expect(validateTicketWizardAudienceRows([])).toHaveProperty("audience");
    const rows = Array.from({ length: 26 }, (_, i) => ({
      registrationTypeId: `${i}`,
      name: "Audience",
      code: "AUD",
      included: true,
      price: "0",
    }));
    expect(validateTicketWizardAudienceRows(rows)).toHaveProperty(
      "audience",
      "Select at most 25 registration types.",
    );
  });
});
