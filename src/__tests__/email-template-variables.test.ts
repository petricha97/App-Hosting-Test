import { describe, expect, it } from "vitest";

import {
  attachEmailTemplateVariables,
  buildEmailTemplateVariableSource,
} from "@/features/emails/server/template-variables";

describe("email template variables", () => {
  it("merges organization/event variables and lets event scope override organization scope", () => {
    const source = buildEmailTemplateVariableSource({
      organization: { name: "Org One" },
      event: {
        id: "evt-1",
        name: "Event Alpha",
        status: "Published",
        timezone: "Asia/Singapore",
        periods: [{ startDate: "2026-08-16", endDate: "2026-08-16" }],
      },
      organizationVariables: [
        { key: "SUPPORT_EMAIL", value: "org@example.com" },
        { key: "SHARED_LABEL", value: "Organization default" },
      ],
      eventVariables: [
        { key: "SHARED_LABEL", value: "Event override" },
        { key: "ROOM_NAME", value: "Main Hall" },
      ],
    });

    expect(source.values).toMatchObject({
      ORGANIZATION_NAME: "Org One",
      EVENT_NAME: "Event Alpha",
      EVENT_STATUS: "Published",
      EVENT_START_DATE: "2026-08-16",
      EVENT_END_DATE: "2026-08-16",
      EVENT_TIMEZONE: "Asia/Singapore",
      SUPPORT_EMAIL: "org@example.com",
      SHARED_LABEL: "Event override",
      ROOM_NAME: "Main Hall",
    });
  });

  it("adds recipient dynamic aliases from the merge context", () => {
    const context = attachEmailTemplateVariables({
      context: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      },
      source: { values: { EVENT_NAME: "Summit 2026" } },
    });

    expect(context.variables).toMatchObject({
      EVENT_NAME: "Summit 2026",
      RECIPIENT_NAME: "Ada Lovelace",
      RECIPIENTS_NAME: "Ada Lovelace",
      RECIPIENT_FIRST_NAME: "Ada",
      RECIPIENTS_FIRST_NAME: "Ada",
      RECIPIENT_LAST_NAME: "Lovelace",
      RECIPIENTS_LAST_NAME: "Lovelace",
      RECIPIENT_EMAIL: "ada@example.com",
      RECIPIENTS_EMAIL: "ada@example.com",
    });
  });
});
