/**
 * M0-T4 characterization tests — behaviors 4, 5, 6.
 *
 * Locks the form schema invariants:
 *  4. formBuilderSchema / formDocumentSchema reject fields arrays with fewer
 *     than 3 entries (mandatory first/last/email floor).
 *  5. buildFormSubmissionSchema — required text rejects empty/whitespace with
 *     "{label} is required"; optional fields default to "" when absent.
 *  6. buildFormSubmissionSchema — required email rejects malformed values;
 *     optional email accepts empty string but rejects malformed non-empty.
 */
import { describe, expect, it } from "vitest";

import {
  buildFormSubmissionSchema,
  formBuilderSchema,
  formDocumentSchema,
  formFieldSchema,
  type FormFieldValues,
} from "@/features/form/schema";

let fieldCounter = 0;

function makeField(
  overrides: Partial<Parameters<typeof formFieldSchema.parse>[0]> = {},
): FormFieldValues {
  fieldCounter += 1;

  return formFieldSchema.parse({
    id: `field-${fieldCounter}`,
    key: `key${fieldCounter}`,
    label: `Field ${fieldCounter}`,
    type: "text",
    ...overrides,
  });
}

const timestamp = { seconds: 1_700_000_000, nanoseconds: 0 };

describe("form schemas enforce the 3-field mandatory floor", () => {
  it("formBuilderSchema rejects fewer than 3 fields", () => {
    const result = formBuilderSchema.safeParse({
      title: "Registration",
      status: "draft",
      fields: [makeField(), makeField()],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "The registration form must include the mandatory fields.",
    );
  });

  it("formBuilderSchema accepts exactly 3 fields", () => {
    const result = formBuilderSchema.safeParse({
      title: "Registration",
      status: "draft",
      fields: [makeField(), makeField(), makeField()],
    });

    expect(result.success).toBe(true);
  });

  it("formDocumentSchema rejects fewer than 3 fields", () => {
    const result = formDocumentSchema.safeParse({
      eventId: "evt-1",
      organizationId: "org-1",
      title: "Registration",
      status: "published",
      fields: [makeField(), makeField()],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "The registration form must include the mandatory fields.",
    );
  });

  it("formDocumentSchema accepts 3 fields with the required metadata", () => {
    const result = formDocumentSchema.safeParse({
      eventId: "evt-1",
      organizationId: "org-1",
      title: "Registration",
      status: "published",
      fields: [makeField(), makeField(), makeField()],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(result.success).toBe(true);
  });
});

describe("buildFormSubmissionSchema — required and optional text", () => {
  const fullName = makeField({
    key: "fullName",
    label: "Full name",
    required: true,
  });
  const company = makeField({ key: "company", label: "Company" });

  it("rejects an empty string for a required field with '{label} is required'", () => {
    const schema = buildFormSubmissionSchema([fullName]);
    const result = schema.safeParse({ fullName: "" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Full name is required");
  });

  it("rejects a whitespace-only string for a required field", () => {
    const schema = buildFormSubmissionSchema([fullName]);
    const result = schema.safeParse({ fullName: "   " });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Full name is required");
  });

  it("accepts a non-empty required value and trims it", () => {
    const schema = buildFormSubmissionSchema([fullName]);
    const result = schema.safeParse({ fullName: "  Ada Lovelace  " });

    expect(result.success).toBe(true);
    expect(result.data?.fullName).toBe("Ada Lovelace");
  });

  it("defaults an optional field to an empty string when absent", () => {
    const schema = buildFormSubmissionSchema([company]);
    const result = schema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data?.company).toBe("");
  });
});

describe("buildFormSubmissionSchema — email semantics", () => {
  const requiredEmail = makeField({
    key: "email",
    label: "Email",
    type: "email",
    required: true,
  });
  const optionalEmail = makeField({
    key: "altEmail",
    label: "Alternate email",
    type: "email",
  });

  it("rejects a malformed required email", () => {
    const schema = buildFormSubmissionSchema([requiredEmail]);
    const result = schema.safeParse({ email: "not-an-email" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Enter a valid email address",
    );
  });

  it("rejects an empty required email with '{label} is required'", () => {
    const schema = buildFormSubmissionSchema([requiredEmail]);
    const result = schema.safeParse({ email: "" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Email is required");
  });

  it("accepts a valid required email", () => {
    const schema = buildFormSubmissionSchema([requiredEmail]);
    const result = schema.safeParse({ email: "ada@example.com" });

    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("ada@example.com");
  });

  it("accepts an empty string for an optional email", () => {
    const schema = buildFormSubmissionSchema([optionalEmail]);

    expect(schema.safeParse({ altEmail: "" }).success).toBe(true);
    // Absent → defaults to "".
    const absent = schema.safeParse({});
    expect(absent.success).toBe(true);
    expect(absent.data?.altEmail).toBe("");
  });

  it("rejects a malformed non-empty optional email (refine branch)", () => {
    const schema = buildFormSubmissionSchema([optionalEmail]);
    const result = schema.safeParse({ altEmail: "bogus" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Enter a valid email address",
    );
  });
});
