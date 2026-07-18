// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  cookie: "token" as string | undefined,
  permissions: ["write:events", "write:promotion"],
  activeOrg: "org-a",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }),
}));
vi.mock("@/lib/auth-utils", () => ({ default: async () => ({ email: "OWNER@EXAMPLE.COM" }) }));
vi.mock("@/lib/db/adminUser", () => ({
  getAdminUserByEmail: async () => ({
    organizationId: state.activeOrg,
    organizations: [{ organizationId: state.activeOrg }],
    permissions: state.permissions,
  }),
}));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventForOrganization: async (id: string, org: string) => {
    const row = state.rows.get(`Event/${id}`);
    return row?.organizationId === org ? { id, ...row } : null;
  },
}));
vi.mock("@/lib/db/adminEventPromotion", () => ({
  getAdminEventPromotionsForEvent: async (eventId: string, org: string) =>
    [...state.rows.entries()].filter(([p, r]) => p.startsWith(`Event/${eventId}/EventPromotion/`) && r.organizationId === org).map(([p, r]) => ({ id: p.split("/").at(-1), ...r })),
  getAdminEventPromotionById: async (eventId: string, id: string) => {
    const row = state.rows.get(`Event/${eventId}/EventPromotion/${id}`);
    return row ? { id, ...row } : null;
  },
  createAdminEventPromotion: async (eventId: string, data: Row) => {
    state.rows.set(`Event/${eventId}/EventPromotion/new-promo`, data);
    return "new-promo";
  },
  updateAdminEventPromotion: async (eventId: string, id: string, data: Row) => {
    const path = `Event/${eventId}/EventPromotion/${id}`;
    state.rows.set(path, { ...state.rows.get(path), ...data });
  },
  deleteAdminEventPromotion: async (eventId: string, id: string) => state.rows.delete(`Event/${eventId}/EventPromotion/${id}`),
}));
vi.mock("@/lib/db/adminPromotionTemplate", () => ({
  getAdminPromotionTemplateForOrganization: async (id: string, org: string) => {
    const row = state.rows.get(`PromotionTemplate/${id}`);
    return row?.organizationId === org ? { id, ...row } : null;
  },
  createAdminPromotionTemplate: async (data: Row) => { state.rows.set("PromotionTemplate/new-template", data); return "new-template"; },
  updateAdminPromotionTemplate: async (id: string, data: Row) => state.rows.set(`PromotionTemplate/${id}`, { ...state.rows.get(`PromotionTemplate/${id}`), ...data }),
  deleteAdminPromotionTemplate: async (id: string) => state.rows.delete(`PromotionTemplate/${id}`),
  applyTemplateToInheritingEvents: async (id: string, org: string, fields: Row) => {
    let count = 0;
    for (const [path, row] of state.rows) if (path.includes("/EventPromotion/") && row.templateId === id && row.organizationId === org && row.inheritFromParent) { state.rows.set(path, { ...row, ...fields }); count++; }
    return count;
  },
  applyTemplateToSpecificEvents: async (id: string, org: string, eventIds: string[], fields: Row, options: { overwriteCustom: boolean }) => {
    const matches = eventIds.map((eventId) => [...state.rows.entries()].find(([p, r]) => p.startsWith(`Event/${eventId}/EventPromotion/`) && r.templateId === id && r.organizationId === org));
    const skippedMissing = eventIds.filter((_, index) => !matches[index]);
    if (skippedMissing.length > 0) return { updated: 0, skippedCustom: [], skippedMissing };
    let updated = 0; const skippedCustom: string[] = [];
    for (const [index, eventId] of eventIds.entries()) {
      const found = matches[index]!;
      if (!found[1].inheritFromParent && !options.overwriteCustom) { skippedCustom.push(eventId); continue; }
      state.rows.set(found[0], { ...found[1], ...fields, inheritFromParent: true }); updated++;
    }
    return { updated, skippedCustom, skippedMissing };
  },
}));

const eventCollection = await import("@/app/api/dashboard/events/[eventId]/promotions/route");
const eventItem = await import("@/app/api/dashboard/events/[eventId]/promotions/[promotionId]/route");
const templateCollection = await import("@/app/api/dashboard/promotions/templates/route");
const templateItem = await import("@/app/api/dashboard/promotions/templates/[templateId]/route");
const templateApply = await import("@/app/api/dashboard/promotions/templates/[templateId]/apply/route");
const templateApplyEvents = await import("@/app/api/dashboard/promotions/templates/[templateId]/apply-to-events/route");

const promoBody = { name: "Summer", description: "", discountType: "percentage", discountValue: 10, conditions: [], enablePromoCode: false };
const req = (body: unknown = {}) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const eventCtx = (eventId: string, promotionId?: string) => ({ params: Promise.resolve({ eventId, promotionId }) } as any);
const templateCtx = (templateId: string) => ({ params: Promise.resolve({ templateId }) });

beforeEach(() => {
  state.rows.clear(); state.cookie = "token"; state.activeOrg = "org-a";
  state.permissions = ["write:events", "write:promotion"];
  state.rows.set("Event/event-a", { organizationId: "org-a" });
  state.rows.set("Event/event-b", { organizationId: "org-b" });
  state.rows.set("PromotionTemplate/template-a", { organizationId: "org-a", ...promoBody });
  state.rows.set("PromotionTemplate/template-b", { organizationId: "org-b", ...promoBody });
});

describe("event promotion route boundaries", () => {
  it("requires a session and exact write:events permission", async () => {
    state.cookie = undefined;
    expect((await eventCollection.POST(req({ templateId: "template-a" }), eventCtx("event-a"))).status).toBe(401);
    state.cookie = "token"; state.permissions = ["write:promotion"];
    expect((await eventCollection.POST(req({ templateId: "template-a" }), eventCtx("event-a"))).status).toBe(403);
    expect(state.rows.has("Event/event-a/EventPromotion/new-promo")).toBe(false);
  });

  it("rejects a foreign event or template and creates a same-org snapshot", async () => {
    expect((await eventCollection.POST(req({ templateId: "template-a" }), eventCtx("event-b"))).status).toBe(404);
    expect((await eventCollection.POST(req({ templateId: "template-b" }), eventCtx("event-a"))).status).toBe(404);
    const response = await eventCollection.POST(req({ templateId: "template-a" }), eventCtx("event-a"));
    expect(response.status).toBe(200);
    expect(state.rows.get("Event/event-a/EventPromotion/new-promo")).toMatchObject({ organizationId: "org-a", templateId: "template-a", name: "Summer", inheritFromParent: true });
  });

  it("rejects invalid and duplicate attaches without another write", async () => {
    expect((await eventCollection.POST(req({ templateId: "" }), eventCtx("event-a"))).status).toBe(400);
    state.rows.set("Event/event-a/EventPromotion/existing", { organizationId: "org-a", templateId: "template-a" });
    expect((await eventCollection.POST(req({ templateId: "template-a" }), eventCtx("event-a"))).status).toBe(409);
    expect(state.rows.has("Event/event-a/EventPromotion/new-promo")).toBe(false);
  });

  it("cannot update or delete a foreign promotion, but mutates the targeted owned row", async () => {
    state.rows.set("Event/event-a/EventPromotion/foreign", { organizationId: "org-b", name: "Keep" });
    expect((await eventItem.POST(req({ ...promoBody, inheritFromParent: false }), eventCtx("event-a", "foreign"))).status).toBe(404);
    expect((await eventItem.DELETE(req(), eventCtx("event-a", "foreign"))).status).toBe(404);
    expect(state.rows.get("Event/event-a/EventPromotion/foreign")?.name).toBe("Keep");
    state.rows.set("Event/event-a/EventPromotion/owned", { organizationId: "org-a", name: "Old" });
    expect((await eventItem.POST(req({ ...promoBody, name: "New", inheritFromParent: false }), eventCtx("event-a", "owned"))).status).toBe(200);
    expect(state.rows.get("Event/event-a/EventPromotion/owned")?.name).toBe("New");
    expect((await eventItem.DELETE(req(), eventCtx("event-a", "owned"))).status).toBe(200);
    expect(state.rows.has("Event/event-a/EventPromotion/owned")).toBe(false);
  });

  it("gates each promotion item handler on authentication and exact write:events permission", async () => {
    state.rows.set("Event/event-a/EventPromotion/owned", { organizationId: "org-a", name: "Keep" });
    state.cookie = undefined;
    expect((await eventItem.POST(req({ ...promoBody, inheritFromParent: false }), eventCtx("event-a", "owned"))).status).toBe(401);
    expect((await eventItem.DELETE(req(), eventCtx("event-a", "owned"))).status).toBe(401);
    state.cookie = "token"; state.permissions = ["write:promotion"];
    expect((await eventItem.POST(req({ ...promoBody, inheritFromParent: false }), eventCtx("event-a", "owned"))).status).toBe(403);
    expect((await eventItem.DELETE(req(), eventCtx("event-a", "owned"))).status).toBe(403);
    expect(state.rows.get("Event/event-a/EventPromotion/owned")?.name).toBe("Keep");
  });
});

describe("promotion template route boundaries", () => {
  it("gates each template item handler and apply-to-events on authentication and exact write:promotion permission", async () => {
    state.cookie = undefined;
    expect((await templateItem.POST(req(promoBody), templateCtx("template-a"))).status).toBe(401);
    expect((await templateItem.DELETE(req(), templateCtx("template-a"))).status).toBe(401);
    expect((await templateApplyEvents.POST(req({ eventIds: ["event-a"], overwriteCustom: false }), templateCtx("template-a"))).status).toBe(401);
    state.cookie = "token"; state.permissions = ["write:events"];
    expect((await templateItem.POST(req(promoBody), templateCtx("template-a"))).status).toBe(403);
    expect((await templateItem.DELETE(req(), templateCtx("template-a"))).status).toBe(403);
    expect((await templateApplyEvents.POST(req({ eventIds: ["event-a"], overwriteCustom: false }), templateCtx("template-a"))).status).toBe(403);
    expect(state.rows.get("PromotionTemplate/template-a")?.name).toBe("Summer");
  });
  it("creation uses server org and rejects missing permission or invalid conditions", async () => {
    state.permissions = ["write:events"];
    expect((await templateCollection.POST(req(promoBody))).status).toBe(403);
    state.permissions = ["write:promotion"];
    expect((await templateCollection.POST(req({ ...promoBody, conditions: [{ field: "", operator: "eq", value: 1 }] }))).status).toBe(400);
    expect((await templateCollection.POST(req({ ...promoBody, organizationId: "org-b" }))).status).toBe(200);
    expect(state.rows.get("PromotionTemplate/new-template")?.organizationId).toBe("org-a");
  });

  it("foreign template IDs look missing for update/delete and cause no mutation", async () => {
    expect((await templateItem.POST(req({ ...promoBody, name: "Hacked" }), templateCtx("template-b"))).status).toBe(404);
    expect((await templateItem.DELETE(req(), templateCtx("template-b"))).status).toBe(404);
    expect(state.rows.get("PromotionTemplate/template-b")?.name).toBe("Summer");
  });

  it("updates an owned template and propagates only to inheriting same-org promotions", async () => {
    state.rows.set("Event/event-a/EventPromotion/inherit", { organizationId: "org-a", templateId: "template-a", inheritFromParent: true, name: "Old" });
    state.rows.set("Event/event-a/EventPromotion/custom", { organizationId: "org-a", templateId: "template-a", inheritFromParent: false, name: "Custom" });
    state.rows.set("Event/event-b/EventPromotion/foreign", { organizationId: "org-b", templateId: "template-a", inheritFromParent: true, name: "Foreign" });
    const response = await templateItem.POST(req({ ...promoBody, name: "Updated" }), templateCtx("template-a"));
    expect(response.status).toBe(200);
    expect(state.rows.get("Event/event-a/EventPromotion/inherit")?.name).toBe("Updated");
    expect(state.rows.get("Event/event-a/EventPromotion/custom")?.name).toBe("Custom");
    expect(state.rows.get("Event/event-b/EventPromotion/foreign")?.name).toBe("Foreign");
  });

  it("apply requires write:promotion and applies requested inheritance semantics", async () => {
    state.permissions = ["write:events"];
    expect((await templateApply.POST(req(), templateCtx("template-a"))).status).toBe(403);
    state.permissions = ["write:promotion"];
    state.rows.set("Event/event-a/EventPromotion/custom", { organizationId: "org-a", templateId: "template-a", inheritFromParent: false, name: "Custom" });
    state.rows.set("Event/event-a/EventPromotion/inherit", { organizationId: "org-a", templateId: "template-a", inheritFromParent: true, name: "Old" });
    expect((await templateApply.POST(req(), templateCtx("template-a"))).status).toBe(200);
    expect(state.rows.get("Event/event-a/EventPromotion/inherit")?.name).toBe("Summer");
    expect(state.rows.get("Event/event-a/EventPromotion/custom")?.name).toBe("Custom");
  });

  it("apply-to-events validates atomically and preserves owned rows when any target is foreign", async () => {
    expect((await templateApplyEvents.POST(req({ eventIds: [], overwriteCustom: false }), templateCtx("template-a"))).status).toBe(400);
    state.rows.set("Event/event-a/EventPromotion/p1", { organizationId: "org-a", templateId: "template-a", inheritFromParent: true, name: "Old" });
    state.rows.set("Event/event-b/EventPromotion/p2", { organizationId: "org-b", templateId: "template-a", inheritFromParent: true, name: "Foreign" });
    const response = await templateApplyEvents.POST(req({ eventIds: ["event-a", "event-b"], overwriteCustom: false }), templateCtx("template-a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 0, skippedCustom: [], skippedMissing: ["event-b"] });
    expect(state.rows.get("Event/event-a/EventPromotion/p1")?.name).toBe("Old");
    expect(state.rows.get("Event/event-b/EventPromotion/p2")?.name).toBe("Foreign");
  });
});
