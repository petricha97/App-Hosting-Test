// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ rows: new Map<string, Row>(), cookie: "token" as string | undefined, permissions: ["write:form"], org: "org-a", forceApplyLimit: false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/auth-utils", () => ({ default: async () => ({ email: "owner@example.com" }) }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail: async () => ({ organizationId: state.org, permissions: state.permissions }) }));
vi.mock("@/lib/db/adminFormTemplate", () => ({
  createAdminFormTemplate: async (data: Row) => { state.rows.set("FormTemplate/new-template", data); return "new-template"; },
  getAdminFormTemplateForOrganization: async (id: string, org: string) => { const row = state.rows.get(`FormTemplate/${id}`); return row?.organizationId === org ? { id, ...row } : null; },
  updateAdminFormTemplate: async (id: string, data: Row) => state.rows.set(`FormTemplate/${id}`, { ...state.rows.get(`FormTemplate/${id}`), ...data }),
}));
vi.mock("@/lib/db/adminForm", () => {
  class TemplateApplyLimitError extends Error {}
  class TemplateApplyIneligibleFormError extends Error {}

  return {
    MAX_TEMPLATE_APPLY_FORMS: 500,
    TemplateApplyLimitError,
    TemplateApplyIneligibleFormError,
    getAdminLinkedFormsForTemplate: async ({ templateId, organizationId, limit }: Row) => [...state.rows.entries()]
      .filter(([p, r]) => p.startsWith("Form/") && r.organizationId === organizationId && r.templateLink?.templateId === templateId)
      .slice(0, limit)
      .map(([p, r]) => ({ id: p.split("/")[1], ...r })),
    applyAdminTemplateToForms: async ({ template, forms }: Row) => {
      if (state.forceApplyLimit) throw new TemplateApplyLimitError();
      const resolvedForms = forms.map((form: Row) => ({ id: form.id, ...state.rows.get(`Form/${form.id}`) }));
      if (resolvedForms.some((form: Row) => form.organizationId !== template.organizationId || form.templateLink?.templateId !== template.id || form.templateLink?.detached)) {
        throw new TemplateApplyIneligibleFormError();
      }
      for (const form of resolvedForms) state.rows.set(`Form/${form.id}`, { ...state.rows.get(`Form/${form.id}`), fields: template.fields, templateLink: { ...form.templateLink, templateVersion: template.version } });
      return forms.map((form: Row) => form.id);
    },
  };
});

const collectionRoute = await import("@/app/api/dashboard/forms/templates/route");
const itemRoute = await import("@/app/api/dashboard/forms/templates/[templateId]/route");
const applyRoute = await import("@/app/api/dashboard/forms/templates/[templateId]/apply/route");

const fields = [
  { id: "first", key: "first_name", label: "First name", type: "text", placeholder: "", helpText: "", required: true, isMandatory: true, order: 0, origin: "mandatory" },
  { id: "last", key: "last_name", label: "Last name", type: "text", placeholder: "", helpText: "", required: true, isMandatory: true, order: 1, origin: "mandatory" },
  { id: "email", key: "email", label: "Email", type: "email", placeholder: "", helpText: "", required: true, isMandatory: true, order: 2, origin: "mandatory" },
];
const body = { title: "Registration", description: "Reusable", status: "active", fields };
const req = (value: unknown) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const ctx = (templateId: string) => ({ params: Promise.resolve({ templateId }) });

beforeEach(() => {
  state.rows.clear(); state.cookie = "token"; state.permissions = ["write:form"]; state.org = "org-a"; state.forceApplyLimit = false;
  state.rows.set("FormTemplate/template-a", { organizationId: "org-a", ...body, version: 2 });
  state.rows.set("FormTemplate/template-b", { organizationId: "org-b", ...body, version: 5 });
});

describe("form template API route boundaries", () => {
  it("requires authentication and exact write:form permission", async () => {
    state.cookie = undefined;
    expect((await collectionRoute.POST(req(body))).status).toBe(401);
    state.cookie = "token"; state.permissions = [];
    expect((await collectionRoute.POST(req(body))).status).toBe(403);
    expect(state.rows.has("FormTemplate/new-template")).toBe(false);
  });

  it("creation validates fields and stamps the server-derived organization", async () => {
    expect((await collectionRoute.POST(req({ ...body, fields: [] }))).status).toBe(400);
    expect(state.rows.has("FormTemplate/new-template")).toBe(false);
    expect((await collectionRoute.POST(req({ ...body, organizationId: "org-b" }))).status).toBe(200);
    expect(state.rows.get("FormTemplate/new-template")).toMatchObject({ organizationId: "org-a", title: "Registration", version: 1 });
  });

  it("gates the template item and apply handlers on authentication and exact write:form permission", async () => {
    state.cookie = undefined;
    expect((await itemRoute.POST(req(body), ctx("template-a"))).status).toBe(401);
    expect((await applyRoute.POST(req({ mode: "all", formIds: [] }), ctx("template-a"))).status).toBe(401);
    state.cookie = "token"; state.permissions = ["write:events"];
    expect((await itemRoute.POST(req(body), ctx("template-a"))).status).toBe(403);
    expect((await applyRoute.POST(req({ mode: "all", formIds: [] }), ctx("template-a"))).status).toBe(403);
    expect(state.rows.get("FormTemplate/template-a")?.version).toBe(2);
  });

  it("updates only an owned template and malformed fields cause no write", async () => {
    expect((await itemRoute.POST(req({ ...body, title: "Hacked" }), ctx("template-b"))).status).toBe(404);
    expect(state.rows.get("FormTemplate/template-b")?.title).toBe("Registration");
    expect((await itemRoute.POST(req({ ...body, fields: [] }), ctx("template-a"))).status).toBe(400);
    expect(state.rows.get("FormTemplate/template-a")?.version).toBe(2);
    expect((await itemRoute.POST(req({ ...body, title: "Updated" }), ctx("template-a"))).status).toBe(200);
    expect(state.rows.get("FormTemplate/template-a")).toMatchObject({ title: "Updated", version: 3, organizationId: "org-a" });
  });

  it("apply rejects a foreign template before reading or changing forms", async () => {
    state.rows.set("Form/foreign", { organizationId: "org-b", title: "Keep", fields: [{ id: "old" }], templateLink: { templateId: "template-b", templateVersion: 1, detached: false } });
    expect((await applyRoute.POST(req({ mode: "all", formIds: [] }), ctx("template-b"))).status).toBe(404);
    expect(state.rows.get("Form/foreign")?.fields).toEqual([{ id: "old" }]);
  });

  it("apply changes a linked, same-org, non-detached selected form", async () => {
    state.rows.set("Form/owned", { organizationId: "org-a", eventId: "event-a", content: "preserve", fields: [{ id: "old" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } });
    state.rows.set("Form/detached", { organizationId: "org-a", fields: [{ id: "custom" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: true } });
    state.rows.set("Form/foreign", { organizationId: "org-b", fields: [{ id: "foreign" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } });
    const response = await applyRoute.POST(req({ mode: "selected", formIds: ["owned"] }), ctx("template-a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updatedCount: 1, updatedIds: ["owned"] });
    expect(state.rows.get("Form/owned")).toMatchObject({ content: "preserve", fields, templateLink: { templateVersion: 2 } });
    expect(state.rows.get("Form/detached")?.fields).toEqual([{ id: "custom" }]);
    expect(state.rows.get("Form/foreign")?.fields).toEqual([{ id: "foreign" }]);
  });

  it("rejects a detached selected form with a generic 422 and no writes", async () => {
    const original = { organizationId: "org-a", fields: [{ id: "custom" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: true } };
    state.rows.set("Form/detached", original);

    const response = await applyRoute.POST(req({ mode: "selected", formIds: ["detached"] }), ctx("template-a"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "TEMPLATE_APPLY_INELIGIBLE_FORM", message: "One or more selected forms cannot receive this template" } });
    expect(state.rows.get("Form/detached")).toEqual(original);
  });

  it("rejects an unlinked or nonexistent selected form without revealing existence and makes no writes", async () => {
    const linked = { organizationId: "org-a", fields: [{ id: "old" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } };
    state.rows.set("Form/linked", linked);

    const response = await applyRoute.POST(req({ mode: "selected", formIds: ["missing"] }), ctx("template-a"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "TEMPLATE_APPLY_INELIGIBLE_FORM", message: "One or more selected forms cannot receive this template" } });
    expect(state.rows.get("Form/linked")).toEqual(linked);
    expect(state.rows.has("Form/missing")).toBe(false);
  });

  it("rejects a cross-organization selected form with a generic 422 and no writes", async () => {
    const foreign = { organizationId: "org-b", fields: [{ id: "foreign" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } };
    state.rows.set("Form/foreign", foreign);

    const response = await applyRoute.POST(req({ mode: "selected", formIds: ["foreign"] }), ctx("template-a"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "TEMPLATE_APPLY_INELIGIBLE_FORM", message: "One or more selected forms cannot receive this template" } });
    expect(state.rows.get("Form/foreign")).toEqual(foreign);
  });

  it("maps the DAL apply-limit backstop to the existing 422 response", async () => {
    state.rows.set("Form/owned", { organizationId: "org-a", fields: [{ id: "old" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } });
    state.forceApplyLimit = true;

    const response = await applyRoute.POST(req({ mode: "selected", formIds: ["owned"] }), ctx("template-a"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "TEMPLATE_APPLY_LIMIT_EXCEEDED", message: "A template can be applied to at most 500 linked forms at once", maxForms: 500 } });
    expect(state.rows.get("Form/owned")?.fields).toEqual([{ id: "old" }]);
  });

  it("apply-all updates every eligible linked form within the bound", async () => {
    state.rows.set("Form/one", { organizationId: "org-a", fields: [{ id: "old-one" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } });
    state.rows.set("Form/two", { organizationId: "org-a", fields: [{ id: "old-two" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } });

    const response = await applyRoute.POST(req({ mode: "all", formIds: [] }), ctx("template-a"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updatedCount: 2, updatedIds: ["one", "two"] });
    expect(state.rows.get("Form/one")?.fields).toEqual(fields);
    expect(state.rows.get("Form/two")?.fields).toEqual(fields);
  });

  it("selected apply resolves a requested form beyond the 501-row discovery bound", async () => {
    for (let index = 0; index <= 501; index += 1) {
      state.rows.set(`Form/form-${index}`, {
        organizationId: "org-a",
        fields: [{ id: `old-${index}` }],
        templateLink: { templateId: "template-a", templateVersion: 1, detached: false },
      });
    }

    const response = await applyRoute.POST(req({ mode: "selected", formIds: ["form-501"] }), ctx("template-a"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updatedCount: 1, updatedIds: ["form-501"] });
    expect(state.rows.get("Form/form-501")?.fields).toEqual(fields);
  });

  it("rejects more than 500 selected form IDs with the apply limit error", async () => {
    const formIds = Array.from({ length: 501 }, (_, index) => `form-${index}`);

    const response = await applyRoute.POST(req({ mode: "selected", formIds }), ctx("template-a"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "TEMPLATE_APPLY_LIMIT_EXCEEDED",
        message: "A template can be applied to at most 500 linked forms at once",
        maxForms: 500,
      },
    });
  });

  it("rejects an over-limit apply-all request without changing any forms", async () => {
    for (let index = 0; index <= 500; index += 1) {
      state.rows.set(`Form/form-${index}`, {
        organizationId: "org-a",
        fields: [{ id: `old-${index}` }],
        templateLink: { templateId: "template-a", templateVersion: 1, detached: false },
      });
    }

    const response = await applyRoute.POST(req({ mode: "all", formIds: [] }), ctx("template-a"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "TEMPLATE_APPLY_LIMIT_EXCEEDED",
        message: "A template can be applied to at most 500 linked forms at once",
        maxForms: 500,
      },
    });
    for (let index = 0; index <= 500; index += 1) {
      expect(state.rows.get(`Form/form-${index}`)?.fields).toEqual([{ id: `old-${index}` }]);
    }
  });
});
