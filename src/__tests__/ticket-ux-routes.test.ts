// @vitest-environment node
// Verifies authentication, payload allow-lists and error contracts for the
// default-audience and isolated ticket pause/resume endpoints using the real scope resolver.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  ensureAdminDefaultRegistrationType: vi.fn(),
  updateAdminTicketType: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: mocks.decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail: mocks.getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization: mocks.getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationType", () => ({ ensureAdminDefaultRegistrationType: mocks.ensureAdminDefaultRegistrationType }));
vi.mock("@/lib/db/adminTicketType", () => ({ updateAdminTicketType: mocks.updateAdminTicketType }));

import { POST } from "@/app/api/dashboard/events/[eventId]/registration-types/default/route";
import { PATCH } from "@/app/api/dashboard/events/[eventId]/tickets/[ticketTypeId]/sales/route";

const context = { params: Promise.resolve({ eventId: "event-a", ticketTypeId: "ticket-a" }) };
const defaultAudience = { registrationTypeId: "default-a", name: "General attendee", code: "GENERAL", capacity: null };

// Creates a JSON mutation request; malformed body tests supply their own Request.
function request(body: unknown, method = "POST") {
  return new Request("http://localhost/api/dashboard/events/event-a", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  mocks.decodeUser.mockResolvedValue({ email: "owner@example.com" });
  mocks.getAdminUserByEmail.mockResolvedValue({
    organizationId: "org-a",
    organizations: [{ organizationId: "org-a", role: "owner" }],
    permissions: ["write:events"],
  });
  mocks.getAdminEventForOrganization.mockResolvedValue({ id: "event-a" });
  mocks.ensureAdminDefaultRegistrationType.mockResolvedValue({ ok: true, ...defaultAudience });
  mocks.updateAdminTicketType.mockResolvedValue({ ok: true });
});

describe.each([
  { label: "default audience", handler: POST, body: { capacity: null } },
  { label: "ticket sales", handler: PATCH, body: { isOpen: false } },
])("$label authorization", ({ handler, body }) => {
  it("rejects missing sessions before data access", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect((await handler(request(body), context)).status).toBe(401);
    expect(mocks.ensureAdminDefaultRegistrationType).not.toHaveBeenCalled();
    expect(mocks.updateAdminTicketType).not.toHaveBeenCalled();
  });

  it("rejects users without event write permission", async () => {
    mocks.getAdminUserByEmail.mockResolvedValue({
      organizationId: "org-a",
      organizations: [{ organizationId: "org-a", role: "member" }],
      permissions: ["view:events"],
    });
    expect((await handler(request(body), context)).status).toBe(403);
    expect(mocks.ensureAdminDefaultRegistrationType).not.toHaveBeenCalled();
    expect(mocks.updateAdminTicketType).not.toHaveBeenCalled();
  });

  it("hides foreign events", async () => {
    mocks.getAdminEventForOrganization.mockResolvedValue(null);
    expect((await handler(request(body), context)).status).toBe(404);
    expect(mocks.getAdminEventForOrganization).toHaveBeenCalledWith("event-a", "org-a");
    expect(mocks.ensureAdminDefaultRegistrationType).not.toHaveBeenCalled();
    expect(mocks.updateAdminTicketType).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const malformed = new Request("http://localhost/api", { method: "POST", body: "{" });
    expect((await handler(malformed, context)).status).toBe(400);
    expect(mocks.ensureAdminDefaultRegistrationType).not.toHaveBeenCalled();
    expect(mocks.updateAdminTicketType).not.toHaveBeenCalled();
  });
});

describe("POST default audience", () => {
  it.each([null, 100])("creates with capacity %s and only trusted tenant fields", async (capacity) => {
    const response = await POST(request({ capacity, organizationId: "foreign", eventId: "foreign", registeredCount: 99 }), context);
    expect(response.status).toBe(200);
    expect(mocks.ensureAdminDefaultRegistrationType).toHaveBeenCalledWith({ eventId: "event-a", organizationId: "org-a", capacity });
    await expect(response.json()).resolves.toEqual(defaultAudience);
  });

  it("returns actual saved values when reusing an edited audience", async () => {
    const saved = { ...defaultAudience, name: "Attendees", code: "ATT", capacity: 20 };
    mocks.ensureAdminDefaultRegistrationType.mockResolvedValue({ ok: true, ...saved });
    const response = await POST(request({ capacity: null }), context);
    await expect(response.json()).resolves.toEqual(saved);
  });

  it.each([{}, { capacity: 0 }, { capacity: -1 }, { capacity: 1.5 }, { capacity: 1_000_001 }, { capacity: "100" }])("rejects invalid capacity %j", async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(mocks.ensureAdminDefaultRegistrationType).not.toHaveBeenCalled();
  });

  it("returns an actionable conflict for an unrelated code collision", async () => {
    mocks.ensureAdminDefaultRegistrationType.mockResolvedValue({ ok: false, code: "CODE_TAKEN" });
    const response = await POST(request({ capacity: null }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Reopen ticket creation");
  });

  it("hides a foreign stable identity document", async () => {
    mocks.ensureAdminDefaultRegistrationType.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    expect((await POST(request({ capacity: null }), context)).status).toBe(404);
  });
});

describe("PATCH ticket sales", () => {
  it.each([true, false])("updates only isOpen=%s even when a stale full ticket is sent", async (isOpen) => {
    const response = await PATCH(request({ isOpen, name: "Stale name", capacity: 1, salesStart: null, salesEnd: null, organizationId: "foreign", registeredCount: 0 }, "PATCH"), context);
    expect(response.status).toBe(200);
    expect(mocks.updateAdminTicketType).toHaveBeenCalledWith(
      { eventId: "event-a", organizationId: "org-a", ticketTypeId: "ticket-a" },
      { isOpen },
    );
    await expect(response.json()).resolves.toEqual({ ticketTypeId: "ticket-a", isOpen });
  });

  it.each([{}, { isOpen: "true" }, { isOpen: 1 }, { isOpen: null }])("rejects non-boolean input %j", async (body) => {
    expect((await PATCH(request(body, "PATCH"), context)).status).toBe(400);
    expect(mocks.updateAdminTicketType).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or foreign ticket rejected by the transaction", async () => {
    mocks.updateAdminTicketType.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    expect((await PATCH(request({ isOpen: true }, "PATCH"), context)).status).toBe(404);
  });
});
