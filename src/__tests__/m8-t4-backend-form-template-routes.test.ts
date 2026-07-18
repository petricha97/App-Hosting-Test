// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ rows: new Map<string, Row>(), cookie: "token" as string | undefined, permissions: ["write:form"], org: "org-a" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/auth-utils", () => ({ default: async () => ({ email: "owner@example.com" }) }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail: async () => ({ organizationId: state.org, permissions: state.permissions }) }));
vi.mock("@/lib/db/adminFormTemplate", () => ({
  createAdminFormTemplate: async (data: Row) => { state.rows.set("FormTemplate/new-template", data); return "new-template"; },
  getAdminFormTemplateForOrganization: async (id: string, org: string) => { const row = state.rows.get(`FormTemplate/${id}`); return row?.organizationId === org ? { id, ...row } : null; },
  updateAdminFormTemplate: async (id: string, data: Row) => state.rows.set(`FormTemplate/${id}`, { ...state.rows.get(`FormTemplate/${id}`), ...data }),
}));
vi.mock("@/lib/db/adminForm", () => ({
  getAdminLinkedFormsForTemplate: async ({ templateId, organizationId }: Row) => [...state.rows.entries()]
    .filter(([p, r]) => p.startsWith("Form/") && r.organizationId === organizationId && r.templateLink?.templateId === templateId)
    .map(([p, r]) => ({ id: p.split("/")[1], ...r })),
  applyAdminTemplateToForms: async ({ template, forms }: Row) => {
    for (const form of forms) state.rows.set(`Form/${form.id}`, { ...state.rows.get(`Form/${form.id}`), fields: template.fields, templateLink: { ...form.templateLink, templateVersion: template.version } });
    return forms.map((form: Row) => form.id);
  },
}));

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
  state.rows.clear(); state.cookie = "token"; state.permissions = ["write:form"]; state.org = "org-a";
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

  it("apply changes all and only linked, same-org, non-detached selected forms", async () => {
    state.rows.set("Form/owned", { organizationId: "org-a", eventId: "event-a", content: "preserve", fields: [{ id: "old" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } });
    state.rows.set("Form/detached", { organizationId: "org-a", fields: [{ id: "custom" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: true } });
    state.rows.set("Form/foreign", { organizationId: "org-b", fields: [{ id: "foreign" }], templateLink: { templateId: "template-a", templateVersion: 1, detached: false } });
    const response = await applyRoute.POST(req({ mode: "selected", formIds: ["owned", "detached", "foreign"] }), ctx("template-a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updatedCount: 1, updatedIds: ["owned"] });
    expect(state.rows.get("Form/owned")).toMatchObject({ content: "preserve", fields, templateLink: { templateVersion: 2 } });
    expect(state.rows.get("Form/detached")?.fields).toEqual([{ id: "custom" }]);
    expect(state.rows.get("Form/foreign")?.fields).toEqual([{ id: "foreign" }]);
  });
});
