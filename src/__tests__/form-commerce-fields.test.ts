// @vitest-environment node
/**
 * M3-T2 — form builder commerce fields (spec ACs 2/3/8/10):
 * - schema round-trip for ticket-selector / promo-code with normalized
 *   invariants (fixed keys, event origin, promo always optional);
 * - duplicate commerce fields rejected by formBuilderSchema;
 * - templateBuilderSchema rejects both types outright;
 * - buildFormSubmissionSchema excludes commerce types (backward compat);
 * - the template cascade (applyTemplateToLinkedForm) never inserts commerce
 *   fields from a template and never touches the form's own commerce fields.
 */
import { describe, expect, it } from "vitest";

import {
  COMMERCE_FIELD_KEYS,
  buildFormSubmissionSchema,
  formBuilderSchema,
  formFieldSchema,
  getNonCommerceFields,
  isCommerceFieldType,
  templateBuilderSchema,
  type FormFieldValues,
} from "@/features/form/schema";
import {
  applyTemplateToLinkedForm,
  createCustomFormField,
} from "@/features/form/utils";
import type { FormDoc, FormTemplateDoc, WithId } from "@/types/collection";

function makeField(overrides: Partial<FormFieldValues> & { key: string }) {
  return formFieldSchema.parse({
    id: overrides.id ?? overrides.key,
    label: overrides.label ?? overrides.key,
    type: "text",
    ...overrides,
  });
}

const mandatoryTrio = [
  makeField({ key: "first_name", label: "First name", required: true }),
  makeField({ key: "last_name", label: "Last name", required: true }),
  makeField({ key: "email", label: "Email", type: "email", required: true }),
];

describe("commerce field schema round-trip", () => {
  it("parses a ticket-selector and normalizes the fixed key + event origin", () => {
    const parsed = formFieldSchema.parse({
      id: "f-ticket",
      key: "whatever_the_client_sent",
      label: "Select your ticket",
      type: "ticket-selector",
      required: true,
      origin: "template",
      isMandatory: true,
      sourceTemplateFieldId: "smuggled",
    });

    expect(parsed.key).toBe("ticket");
    expect(parsed.origin).toBe("event");
    expect(parsed.isMandatory).toBe(false);
    expect(parsed.sourceTemplateFieldId).toBeUndefined();
    expect(parsed.required).toBe(true);
  });

  it("parses a promo-code, forces the fixed key and ALWAYS optional", () => {
    const parsed = formFieldSchema.parse({
      id: "f-promo",
      key: "not_the_real_key",
      label: "Promo code",
      type: "promo-code",
      required: true,
    });

    expect(parsed.key).toBe("promo_code");
    expect(parsed.required).toBe(false);
  });

  it("createCustomFormField mints fixed keys and sensible defaults", () => {
    const ticket = createCustomFormField("ticket-selector", 3);
    expect(ticket.key).toBe(COMMERCE_FIELD_KEYS["ticket-selector"]);
    expect(ticket.required).toBe(true);
    expect(ticket.origin).toBe("event");

    const promo = createCustomFormField("promo-code", 4);
    expect(promo.key).toBe(COMMERCE_FIELD_KEYS["promo-code"]);
    expect(promo.required).toBe(false);
  });
});

describe("cardinality: at most one of each commerce type (T2 AC-2)", () => {
  it("accepts one ticket-selector plus one promo-code", () => {
    const result = formBuilderSchema.safeParse({
      title: "Reg",
      status: "draft",
      fields: [
        ...mandatoryTrio,
        createCustomFormField("ticket-selector", 3),
        createCustomFormField("promo-code", 4),
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each(["ticket-selector", "promo-code"] as const)(
    "rejects a second %s on save",
    (type) => {
      const result = formBuilderSchema.safeParse({
        title: "Reg",
        status: "draft",
        fields: [
          ...mandatoryTrio,
          { ...createCustomFormField(type, 3), id: "dup-a" },
          { ...createCustomFormField(type, 4), id: "dup-b" },
        ],
      });
      expect(result.success).toBe(false);
    },
  );
});

describe("templates reject commerce types (T2 AC-3)", () => {
  it.each(["ticket-selector", "promo-code"] as const)(
    "templateBuilderSchema rejects %s",
    (type) => {
      const result = templateBuilderSchema.safeParse({
        title: "Template",
        description: "",
        status: "active",
        fields: [...mandatoryTrio, createCustomFormField(type, 3)],
      });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("event-only");
    },
  );
});

describe("buildFormSubmissionSchema excludes commerce types (T2 AC-8/10)", () => {
  const fields = [
    ...mandatoryTrio,
    createCustomFormField("ticket-selector", 3),
    createCustomFormField("promo-code", 4),
  ];

  it("does not validate or require commerce keys", () => {
    const schema = buildFormSubmissionSchema(fields);
    const result = schema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      // No ticket / promo_code keys — must still pass (required ticket
      // selector never blocks the flat submission record).
    });
    expect(result.success).toBe(true);
  });

  it("strips commerce keys sent by a stale client (unknown to the shape)", () => {
    const schema = buildFormSubmissionSchema(fields);
    const parsed = schema.parse({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      ticket: "VIP",
      promo_code: "SECRET",
    });
    expect(parsed).not.toHaveProperty("ticket");
    expect(parsed).not.toHaveProperty("promo_code");
  });

  it("existing forms without commerce fields parse exactly as before", () => {
    const schema = buildFormSubmissionSchema(mandatoryTrio);
    expect(
      schema.safeParse({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ first_name: "", last_name: "L", email: "a@b.co" })
        .success,
    ).toBe(false);
  });

  it("getNonCommerceFields filters exactly the two commerce types", () => {
    const question = getNonCommerceFields(fields);
    expect(question).toHaveLength(3);
    expect(question.every((field) => !isCommerceFieldType(field.type))).toBe(true);
  });
});

describe("template cascade never touches commerce fields (T2 AC-3 regression)", () => {
  const appliedAt = { seconds: 1, nanoseconds: 0 } as never;

  function makeForm(fields: FormFieldValues[]): WithId<FormDoc> {
    return {
      id: "form-1",
      eventId: "evt-1",
      organizationId: "org-1",
      title: "Reg",
      status: "draft",
      fields: fields as never,
      templateLink: {
        templateId: "tpl-1",
        templateVersion: 1,
        detached: false,
        appliedAt,
      },
      createdAt: appliedAt,
      updatedAt: appliedAt,
    };
  }

  function makeTemplate(fields: FormFieldValues[]): WithId<FormTemplateDoc> {
    return {
      id: "tpl-1",
      organizationId: "org-1",
      title: "Template",
      description: "",
      status: "active",
      version: 2,
      fields: fields as never,
      createdAt: appliedAt,
      updatedAt: appliedAt,
    };
  }

  it("preserves the form's own event-origin commerce fields through a cascade", () => {
    const ticketField = createCustomFormField("ticket-selector", 3);
    const form = makeForm([
      ...mandatoryTrio.map((field) => ({
        ...field,
        origin: "template" as const,
        sourceTemplateFieldId: field.id,
      })),
      ticketField,
    ]);
    const template = makeTemplate(mandatoryTrio);

    const next = applyTemplateToLinkedForm({ form, template, appliedAt });
    const commerce = next.fields.filter((field) => isCommerceFieldType(field.type));

    expect(commerce).toHaveLength(1);
    expect(commerce[0].id).toBe(ticketField.id);
    expect(commerce[0].origin).toBe("event");
    expect(commerce[0].label).toBe(ticketField.label);
  });

  it("never inserts commerce fields carried by a stale/tampered template doc", () => {
    const form = makeForm(
      mandatoryTrio.map((field) => ({
        ...field,
        origin: "template" as const,
        sourceTemplateFieldId: field.id,
      })),
    );
    // Bypass templateBuilderSchema on purpose: simulate a tampered stored doc.
    const template = makeTemplate([
      ...mandatoryTrio,
      { ...createCustomFormField("promo-code", 3), origin: "template" as const },
    ]);

    const next = applyTemplateToLinkedForm({ form, template, appliedAt });
    expect(
      next.fields.some((field) => isCommerceFieldType(field.type)),
    ).toBe(false);
  });
});
