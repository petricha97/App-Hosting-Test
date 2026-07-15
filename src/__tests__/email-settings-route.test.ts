// @vitest-environment node
/**
 * M6-T2 — sender settings routes:
 *   GET/PATCH/DELETE /api/dashboard/events/[eventId]/emails/settings
 * Spec §6 AC-1/AC-2/AC-3/AC-4.
 *
 * Locks:
 *  - GET resolves defaults without writing (T1 §4 AC-1 — no upsert call);
 *  - PATCH rejects invalid input (bad email shape, control chars, `<` in
 *    from-name) with FIELD-level errors, persists nothing;
 *  - DELETE ("Reset to platform default") clears the override and the
 *    subsequent resolution reads as "defaults" again;
 *  - both gate write:events, 404 cross-org.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminEmailSettingsForEvent,
  upsertAdminEmailSettings,
  deleteAdminEmailSettings,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminEmailSettingsForEvent: vi.fn(),
  upsertAdminEmailSettings: vi.fn(),
  deleteAdminEmailSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminEmailSettings", () => ({
  getAdminEmailSettingsForEvent,
  upsertAdminEmailSettings,
  deleteAdminEmailSettings,
}));

import { resetRateLimits } from "@/lib/rate-limit";

import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/dashboard/events/[eventId]/emails/settings/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const EVENT = { id: EVENT_ID, name: "Innovation Summit", timezone: "UTC" };

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

function getRequest() {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/emails/settings`,
  );
}

function patchRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/emails/settings`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Owner",
    picture: "",
    email: "owner@example.com",
  });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "owner" }],
    permissions: ["write:events"],
  });
  getAdminEventForOrganization.mockResolvedValue(EVENT);
  getAdminEmailSettingsForEvent.mockResolvedValue(null);
});

describe("GET emails/settings — viewing writes nothing (T1 §4 AC-1)", () => {
  it("resolves the read-time defaults with no stored doc", async () => {
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settings.source).toBe("defaults");
    expect(body.settings.hasStoredDoc).toBe(false);
    expect(upsertAdminEmailSettings).not.toHaveBeenCalled();
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(403);
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(404);
  });
});

describe("PATCH emails/settings — field-level validation (spec §6 AC-2)", () => {
  it("persists a valid identity and echoes source:'settings'", async () => {
    upsertAdminEmailSettings.mockResolvedValue({
      ok: true,
      settings: {
        id: EVENT_ID,
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        fromName: "Innovation Summit",
        fromAddress: "events@example.com",
        replyTo: null,
      },
    });

    const response = await PATCH(
      patchRequest({
        fromName: "Innovation Summit",
        fromAddress: "events@example.com",
        replyTo: "",
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settings.source).toBe("settings");
    expect(body.settings.hasStoredDoc).toBe(true);
  });

  it("rejects an invalid email shape with a FIELD-level error, persists nothing", async () => {
    const response = await PATCH(
      patchRequest({
        fromName: "Events",
        fromAddress: "not-an-email",
        replyTo: "",
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.fieldErrors.fromAddress).toBeDefined();
    expect(upsertAdminEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects a from-name containing '<' (header-forgery guard), persists nothing", async () => {
    const response = await PATCH(
      patchRequest({
        fromName: "Events <evil>",
        fromAddress: "events@example.com",
        replyTo: "",
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.fieldErrors.fromName).toBeDefined();
    expect(upsertAdminEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects an over-length from-name (>100 chars), persists nothing", async () => {
    const response = await PATCH(
      patchRequest({
        fromName: "x".repeat(101),
        fromAddress: "events@example.com",
        replyTo: "",
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(upsertAdminEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects an empty fromAddress on PATCH (empties are not the reset path)", async () => {
    const response = await PATCH(
      patchRequest({ fromName: "Events", fromAddress: "", replyTo: "" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(upsertAdminEmailSettings).not.toHaveBeenCalled();
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await PATCH(
      patchRequest({
        fromName: "Events",
        fromAddress: "events@example.com",
        replyTo: "",
      }),
      makeContext(),
    );
    expect(response.status).toBe(403);
    expect(upsertAdminEmailSettings).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await PATCH(
      patchRequest({
        fromName: "Events",
        fromAddress: "events@example.com",
        replyTo: "",
      }),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(upsertAdminEmailSettings).not.toHaveBeenCalled();
  });
});

describe("DELETE emails/settings — Reset to platform default (spec §6 AC-3)", () => {
  it("clears the override; the response reads back as 'defaults'", async () => {
    deleteAdminEmailSettings.mockResolvedValue({ ok: true });
    getAdminEmailSettingsForEvent.mockResolvedValue(null); // post-delete resolution

    const response = await DELETE(getRequest(), makeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settings.source).toBe("defaults");
    expect(body.settings.hasStoredDoc).toBe(false);
  });

  it("404 on a cross-org delete attempt", async () => {
    deleteAdminEmailSettings.mockResolvedValue({
      ok: false,
      code: "CROSS_ORG",
    });

    const response = await DELETE(getRequest(), makeContext());

    expect(response.status).toBe(404);
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await DELETE(getRequest(), makeContext());
    expect(response.status).toBe(403);
    expect(deleteAdminEmailSettings).not.toHaveBeenCalled();
  });

  it("rate-limits at 20/min/user (the 21st call in a minute -> 429)", async () => {
    deleteAdminEmailSettings.mockResolvedValue({ ok: true });
    getAdminEmailSettingsForEvent.mockResolvedValue(null);

    for (let i = 0; i < 20; i += 1) {
      const response = await DELETE(getRequest(), makeContext());
      expect(response.status).toBe(200);
    }

    const twentyFirst = await DELETE(getRequest(), makeContext());
    expect(twentyFirst.status).toBe(429);
    expect(deleteAdminEmailSettings).toHaveBeenCalledTimes(20);
  });
});
