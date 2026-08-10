import { describe, expect, it } from "vitest";

import { normalizeVariableKey } from "@/features/variables/schema";
import {
  buildEventBuiltInVariables,
  buildOrganizationBuiltInVariables,
  resolveVariables,
  RESERVED_VARIABLE_KEYS,
} from "@/features/variables/utils";

describe("variables utilities", () => {
  it("normalizes keys into uppercase snake case", () => {
    expect(normalizeVariableKey("support email")).toBe("SUPPORT_EMAIL");
    expect(normalizeVariableKey("org-name")).toBe("ORG_NAME");
    expect(normalizeVariableKey(" Followup 2026 ")).toBe("FOLLOWUP_2026");
  });

  it("treats built-in keys as reserved", () => {
    expect(RESERVED_VARIABLE_KEYS.has("ORGANIZATION_NAME")).toBe(true);
    expect(RESERVED_VARIABLE_KEYS.has("EVENT_NAME")).toBe(true);
  });

  it("resolves event variables before organization variables", () => {
    const result = resolveVariables({
      text: "Contact {{SUPPORT_EMAIL}}",
      organizationVariables: [
        {
          key: "SUPPORT_EMAIL",
          value: "shared@example.com",
        },
      ],
      eventVariables: [
        {
          key: "SUPPORT_EMAIL",
          value: "event@example.com",
        },
      ],
    });

    expect(result.output).toBe("Contact event@example.com");
    expect(result.unknownKeys).toEqual([]);
  });

  it("keeps unknown tokens literal", () => {
    const result = resolveVariables({
      text: "Hello {{UNKNOWN_KEY}}",
    });

    expect(result.output).toBe("Hello {{UNKNOWN_KEY}}");
    expect(result.unknownKeys).toEqual(["UNKNOWN_KEY"]);
  });

  it("accepts mixed-case variable tokens and normalizes them before lookup", () => {
    const result = resolveVariables({
      text: "Hi {{Recipients_name}} from {{event-name}}",
      eventVariables: [{ key: "EVENT_NAME", value: "Launch Day" }],
      organizationVariables: [{ key: "RECIPIENTS_NAME", value: "Ada" }],
    });

    expect(result.output).toBe("Hi Ada from Launch Day");
    expect(result.unknownKeys).toEqual([]);
  });

  it("builds organization and event built-ins from live docs", () => {
    const orgBuiltIns = buildOrganizationBuiltInVariables({ name: "Eventa Org" });
    const eventBuiltIns = buildEventBuiltInVariables({
      name: "Gym2026",
      status: "Draft",
      timezone: "Asia/Singapore",
      periods: [
        {
          startDate: "2026-08-16",
          endDate: "2026-08-18",
        },
      ],
    });

    expect(orgBuiltIns[0]?.value).toBe("Eventa Org");
    expect(eventBuiltIns.find((entry) => entry.key === "EVENT_NAME")?.value).toBe(
      "Gym2026",
    );
    expect(
      eventBuiltIns.find((entry) => entry.key === "EVENT_START_DATE")?.value,
    ).toBe("2026-08-16");
  });
});
