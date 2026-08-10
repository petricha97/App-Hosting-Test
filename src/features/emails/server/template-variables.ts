import "server-only";

import {
  buildEventBuiltInVariables,
  buildOrganizationBuiltInVariables,
} from "@/features/variables/utils";
import type { EmailComposerTokenSection } from "@/features/emails/types";
import { getAdminOrganizationById } from "@/lib/db/adminOrganization";
import {
  getAdminVariablesForEvent,
  getAdminVariablesForOrganization,
} from "@/lib/db/adminVariable";
import type { EmailMergeContext } from "@/lib/email/merge-tags";
import type { EventDoc, VariableDoc, WithId } from "@/types/collection";

type VariableEntry = Pick<VariableDoc, "key" | "value" | "description">;

type EmailTemplateEvent = WithId<
  Pick<EventDoc, "name" | "timezone" | "periods"> & Partial<Pick<EventDoc, "status">>
>;

export interface EmailTemplateVariableSource {
  values: Record<string, string>;
  organizationEntries: VariableEntry[];
  eventEntries: VariableEntry[];
}

function buildVariableMap(entries: Array<{ key: string; value: string }>) {
  const values = new Map<string, string>();

  for (const entry of entries) {
    values.set(entry.key, entry.value);
  }

  return Object.fromEntries(values);
}

function trimValue(value: string | undefined): string {
  return (value ?? "").trim();
}

function buildRecipientVariableEntries(
  context: Pick<EmailMergeContext, "firstName" | "lastName" | "email">,
) {
  const firstName = trimValue(context.firstName);
  const lastName = trimValue(context.lastName);
  const fullName = [firstName, lastName].filter((part) => part.length > 0).join(" ");
  const email = trimValue(context.email);

  return [
    { key: "RECIPIENT_NAME", value: fullName },
    { key: "RECIPIENTS_NAME", value: fullName },
    { key: "RECIPIENT_FIRST_NAME", value: firstName },
    { key: "RECIPIENTS_FIRST_NAME", value: firstName },
    { key: "RECIPIENT_LAST_NAME", value: lastName },
    { key: "RECIPIENTS_LAST_NAME", value: lastName },
    { key: "RECIPIENT_EMAIL", value: email },
    { key: "RECIPIENTS_EMAIL", value: email },
  ];
}

function humanizeVariableKey(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildEmailTemplateVariableSource(input: {
  organization?: { name: string } | null;
  event?: EmailTemplateEvent | null;
  organizationVariables?: VariableEntry[];
  eventVariables?: VariableEntry[];
}): EmailTemplateVariableSource {
  const organizationEntries = [
    ...buildOrganizationBuiltInVariables(input.organization),
    ...(input.organizationVariables ?? []),
  ];
  const eventEntries = [
    ...buildEventBuiltInVariables(input.event),
    ...(input.eventVariables ?? []),
  ];

  return {
    values: buildVariableMap([...organizationEntries, ...eventEntries]),
    organizationEntries,
    eventEntries,
  };
}

export async function loadEmailTemplateVariableSource(input: {
  organizationId: string;
  event: EmailTemplateEvent;
}): Promise<EmailTemplateVariableSource> {
  const [organization, organizationVariables, eventVariables] = await Promise.all([
    getAdminOrganizationById(input.organizationId),
    getAdminVariablesForOrganization(input.organizationId),
    getAdminVariablesForEvent({
      organizationId: input.organizationId,
      eventId: input.event.id,
    }),
  ]);

  return buildEmailTemplateVariableSource({
    organization,
    event: input.event,
    organizationVariables,
    eventVariables,
  });
}

export function attachEmailTemplateVariables(input: {
  context: EmailMergeContext;
  source: EmailTemplateVariableSource;
}): EmailMergeContext {
  return {
    ...input.context,
    variables: buildVariableMap([
      ...Object.entries(input.source.values).map(([key, value]) => ({ key, value })),
      ...Object.entries(input.context.variables ?? {}).map(([key, value]) => ({
        key,
        value,
      })),
      ...buildRecipientVariableEntries(input.context),
    ]),
  };
}

export function buildEmailComposerTokenSections(input: {
  source: EmailTemplateVariableSource;
  previewContext: EmailMergeContext;
}): EmailComposerTokenSection[] {
  const recipientEntries = buildRecipientVariableEntries(input.previewContext);

  return [
    {
      id: "recipient",
      label: "Recipient",
      items: [
        {
          token: "{{RECIPIENT_NAME}}",
          label: "Recipient name",
          hint: "Full name for each person receiving this email.",
          previewValue: recipientEntries.find((entry) => entry.key === "RECIPIENT_NAME")?.value ?? "",
          aliases: ["{{RECIPIENTS_NAME}}", "{{Recipients_name}}"],
        },
        {
          token: "{{RECIPIENT_FIRST_NAME}}",
          label: "Recipient first name",
          hint: "First name only.",
          previewValue:
            recipientEntries.find((entry) => entry.key === "RECIPIENT_FIRST_NAME")?.value ?? "",
          aliases: ["{{RECIPIENTS_FIRST_NAME}}"],
        },
        {
          token: "{{RECIPIENT_LAST_NAME}}",
          label: "Recipient last name",
          hint: "Last name only.",
          previewValue:
            recipientEntries.find((entry) => entry.key === "RECIPIENT_LAST_NAME")?.value ?? "",
          aliases: ["{{RECIPIENTS_LAST_NAME}}"],
        },
        {
          token: "{{RECIPIENT_EMAIL}}",
          label: "Recipient email",
          hint: "Email address of the current recipient.",
          previewValue: recipientEntries.find((entry) => entry.key === "RECIPIENT_EMAIL")?.value ?? "",
          aliases: ["{{RECIPIENTS_EMAIL}}"],
        },
      ],
    },
    {
      id: "event",
      label: "Event",
      items: input.source.eventEntries.map((entry) => ({
        token: `{{${entry.key}}}`,
        label: humanizeVariableKey(entry.key),
        hint: entry.description?.trim() || "Event-level value.",
        previewValue: input.source.values[entry.key] ?? "",
      })),
    },
    {
      id: "organization",
      label: "Organization",
      items: input.source.organizationEntries.map((entry) => ({
        token: `{{${entry.key}}}`,
        label: humanizeVariableKey(entry.key),
        hint: entry.description?.trim() || "Organization-level value.",
        previewValue: input.source.values[entry.key] ?? "",
      })),
    },
  ];
}
