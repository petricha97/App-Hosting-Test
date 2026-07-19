// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";
import type { FormDoc, FormTemplateDoc } from "@/types/collection";

const fake = createFakeAdminDb();
const auth = vi.hoisted(() => ({ organizationId: "org-a" }));

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session-token" }) }),
}));
vi.mock("@/lib/auth-utils", () => ({
  default: async () => ({ email: "owner@example.com" }),
}));
vi.mock("@/lib/db/adminUser", () => ({
  getAdminUserByEmail: async () => ({
    organizationId: auth.organizationId,
    permissions: ["write:form"],
  }),
}));
vi.mock("@/lib/db/adminFormTemplate", () => ({
  getAdminFormTemplateForOrganization: async (id: string, organizationId: string) => {
    const row = fake.store.get(`FormTemplate/${id}`);
    return row?.organizationId === organizationId ? { id, ...row } : null;
  },
}));

const { applyAdminTemplateToForms } = await import("@/lib/db/adminForm");
const applyRoute = await import(
  "@/app/api/dashboard/forms/templates/[templateId]/apply/route"
);

const now = { seconds: 1, nanoseconds: 0 };
const oldField = {
  id: "company-linked",
  key: "company",
  label: "Old company",
  type: "text" as const,
  placeholder: "",
  helpText: "",
  required: false,
  isMandatory: false,
  order: 0,
  origin: "template" as const,
  sourceTemplateFieldId: "company",
};
const templateField = {
  ...oldField,
  id: "company",
  label: "New company",
  sourceTemplateFieldId: "company",
};

function template(): FormTemplateDoc & { id: string } {
  return {
    id: "template-a",
    organizationId: "org-a",
    title: "Registration",
    description: "Reusable",
    status: "active",
    version: 4,
    fields: [templateField],
    createdAt: now,
    updatedAt: now,
  } as unknown as FormTemplateDoc & { id: string };
}

function eventDoc(organizationId = "org-a") {
  return {
    name: "Event",
    description: "Description",
    capacity: 10,
    expectedGuests: 1,
    formPath: "Form/registration",
    invoicePath: "",
    organizationPath: `Organization/${organizationId}`,
    timezone: "UTC",
    allowOverlap: false,
    status: "Draft",
    pageMode: "default",
    redirectUrl: "",
    periods: [],
    createdAt: now,
    updatedAt: now,
  };
}

function seedForm(
  id: string,
  overrides: Record<string, unknown> = {},
): FormDoc & { id: string } {
  const form = {
    id,
    eventId: `event-${id}`,
    organizationId: "org-a",
    title: id,
    status: "draft",
    fields: [oldField],
    templateLink: {
      templateId: "template-a",
      templateVersion: 3,
      detached: false,
      appliedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as FormDoc & { id: string };
  // The shared fake indexes fields as flat keys; mirror the nested Firestore
  // query field alongside the real nested document value used by the DAL.
  fake.store.set(`Form/${id}`, {
    ...(form as unknown as Record<string, unknown>),
    "templateLink.templateId": form.templateLink?.templateId,
  });
  fake.store.set(`Event/${form.eventId}`, eventDoc(form.organizationId));
  return form;
}

const request = (body: unknown) =>
  new Request("http://test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({ templateId: "template-a" }) };

beforeEach(() => {
  fake.reset();
  auth.organizationId = "org-a";
  const { id: _id, ...storedTemplate } = template();
  fake.store.set("FormTemplate/template-a", storedTemplate as unknown as Record<string, unknown>);
});

describe("M8-T9 QA: form-template apply operational atomicity", () => {
  it("ATOMICITY: a failure in a real multi-form fake batch commits no form", async () => {
    const forms = [seedForm("one"), seedForm("two"), seedForm("three")];
    const before = new Map(
      forms.map(({ id }) => [`Form/${id}`, structuredClone(fake.store.get(`Form/${id}`))]),
    );
    fake.setBatchFailureAt(1);

    await expect(
      applyAdminTemplateToForms({ template: template(), forms }),
    ).rejects.toThrow("fake batch write 1");

    for (const [path, snapshot] of before) expect(fake.store.get(path)).toEqual(snapshot);
    expect(fake.writes).toHaveLength(0);
  });

  it("BOUND: mode all over 500 and selected formIds over 500 return 422 with no writes", async () => {
    for (let index = 0; index < 501; index += 1) seedForm(`bound-${index}`);

    const allResponse = await applyRoute.POST(
      request({ mode: "all", formIds: [] }),
      context,
    );
    const selectedResponse = await applyRoute.POST(
      request({
        mode: "selected",
        formIds: Array.from({ length: 501 }, (_, index) => `bound-${index}`),
      }),
      context,
    );

    expect(allResponse.status).toBe(422);
    expect(selectedResponse.status).toBe(422);
    expect(await allResponse.json()).toMatchObject({
      error: { code: "TEMPLATE_APPLY_LIMIT_EXCEEDED", maxForms: 500 },
    });
    expect(await selectedResponse.json()).toMatchObject({
      error: { code: "TEMPLATE_APPLY_LIMIT_EXCEEDED", maxForms: 500 },
    });
    expect(fake.writes).toHaveLength(0);
  });

  it("NO SILENT SKIP: selected form beyond the former 501-row scan is actually updated", async () => {
    for (let index = 0; index < 502; index += 1) seedForm(`scan-${index}`);

    const response = await applyRoute.POST(
      request({ mode: "selected", formIds: ["scan-501"] }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updatedCount: 1, updatedIds: ["scan-501"] });
    expect(fake.store.get("Form/scan-501")).toMatchObject({
      fields: [expect.objectContaining({ label: "New company" })],
      templateLink: { templateVersion: 4 },
    });
    expect(fake.store.get("Form/scan-500")).toMatchObject({
      fields: [expect.objectContaining({ label: "Old company" })],
      templateLink: { templateVersion: 3 },
    });
    expect(fake.writes.map((write) => write.path)).toEqual(["Form/scan-501"]);
  });

  it("EXISTENCE ORACLE: detached, unlinked, missing, and cross-org IDs share one generic 422 and write nothing", async () => {
    seedForm("detached", { templateLink: { templateId: "template-a", templateVersion: 3, detached: true, appliedAt: now } });
    seedForm("unlinked", { templateLink: { templateId: "other", templateVersion: 1, detached: false, appliedAt: now } });
    seedForm("foreign", { organizationId: "org-b" });
    const before = new Map(
      ["detached", "unlinked", "foreign"].map((id) => [
        `Form/${id}`,
        structuredClone(fake.store.get(`Form/${id}`)),
      ]),
    );
    const bodies: unknown[] = [];

    for (const id of ["detached", "unlinked", "missing", "foreign"]) {
      const response = await applyRoute.POST(
        request({ mode: "selected", formIds: [id] }),
        context,
      );
      expect(response.status).toBe(422);
      bodies.push(await response.json());
    }

    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({
      error: {
        code: "TEMPLATE_APPLY_INELIGIBLE_FORM",
        message: "One or more selected forms cannot receive this template",
      },
    });
    for (const [path, snapshot] of before) expect(fake.store.get(path)).toEqual(snapshot);
    expect(fake.store.has("Form/missing")).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  it("TENANCY: a cross-org form mixed into an otherwise eligible apply set causes zero writes", async () => {
    const owned = seedForm("owned");
    seedForm("foreign-mixed", { organizationId: "org-b" });
    const ownedBefore = structuredClone(fake.store.get("Form/owned"));
    const foreignBefore = structuredClone(fake.store.get("Form/foreign-mixed"));

    const response = await applyRoute.POST(
      request({ mode: "selected", formIds: [owned.id, "foreign-mixed"] }),
      context,
    );

    expect(response.status).toBe(422);
    expect(fake.store.get("Form/owned")).toEqual(ownedBefore);
    expect(fake.store.get("Form/foreign-mixed")).toEqual(foreignBefore);
    expect(fake.writes).toHaveLength(0);
  });

  it("HAPPY ALL: applies to every eligible linked form and reports exactly the committed IDs", async () => {
    seedForm("all-one");
    seedForm("all-two");

    const response = await applyRoute.POST(
      request({ mode: "all", formIds: [] }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      updatedCount: 2,
      updatedIds: ["all-one", "all-two"],
    });
    expect(fake.writes.map((write) => write.path)).toEqual([
      "Form/all-one",
      "Form/all-two",
    ]);
  });

  it("HAPPY SELECTED: updates exactly the requested eligible forms and return IDs match writes", async () => {
    seedForm("selected-one");
    seedForm("selected-two");
    seedForm("not-selected");

    const response = await applyRoute.POST(
      request({ mode: "selected", formIds: ["selected-two", "selected-one"] }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      updatedCount: 2,
      updatedIds: ["selected-two", "selected-one"],
    });
    expect(fake.writes.map((write) => write.path)).toEqual([
      "Form/selected-two",
      "Form/selected-one",
    ]);
    expect(fake.store.get("Form/not-selected")).toMatchObject({
      fields: [expect.objectContaining({ label: "Old company" })],
      templateLink: { templateVersion: 3 },
    });
  });
});
