// @vitest-environment node
/**
 * M6-T2 — definitions routes:
 *   GET/POST   /api/dashboard/events/[eventId]/emails/definitions
 *   PATCH/DELETE /api/dashboard/events/[eventId]/emails/definitions/[kind]
 * Spec: agents/docs/specs/m6-emails-admin.md (§1 AC-1/AC-2, §2 AC-2/AC-4/AC-6,
 * §7 AC-1/AC-3).
 *
 * Locks:
 *  - GET renders the merged (virtual + stored) list with ZERO Firestore
 *    writes on a fresh event (§1 AC-1);
 *  - PATCH materializes a default's first edit through
 *    upsertAdminEmailDefinition (toggle -> the DAL upsert call, §1 AC-2);
 *  - locked-field violations (LOCKED_FIELDS) surface as 400 with field
 *    errors, never silently applied;
 *  - POST mints a server-side "custom-*" kind — never trusts a client kind;
 *  - DELETE refuses system defaults (409 SYSTEM_LOCKED) and 404s a missing
 *    custom kind;
 *  - every route 403s without write:events and 404s cross-org/unknown event
 *    (route-scope.test.ts already locks the underlying gate — this file
 *    exercises the wiring, not the whole gate ladder again).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  listAdminEmailDefinitionsForEvent,
  upsertAdminEmailDefinition,
  deleteAdminEmailDefinition,
  getAdminEmailDefinitionByKind,
  mintCustomEmailDefinitionKind,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  listAdminEmailDefinitionsForEvent: vi.fn(),
  upsertAdminEmailDefinition: vi.fn(),
  deleteAdminEmailDefinition: vi.fn(),
  getAdminEmailDefinitionByKind: vi.fn(),
  mintCustomEmailDefinitionKind: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminEmailDefinition", () => ({
  listAdminEmailDefinitionsForEvent,
  upsertAdminEmailDefinition,
  deleteAdminEmailDefinition,
  getAdminEmailDefinitionByKind,
  mintCustomEmailDefinitionKind,
  MAX_EMAIL_DEFINITIONS_PER_EVENT: 100,
}));

import { resetRateLimits } from "@/lib/rate-limit";

import {
  DELETE,
  PATCH,
} from "@/app/api/dashboard/events/[eventId]/emails/definitions/[kind]/route";
import {
  GET,
  POST,
} from "@/app/api/dashboard/events/[eventId]/emails/definitions/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";

const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [{ date: "2026-09-15", startTime: "09:00", endTime: "17:00" }],
  timezone: "America/New_York",
};

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

function makeKindContext(kind: string) {
  return { params: Promise.resolve({ eventId: EVENT_ID, kind }) };
}

function getRequest(
  url = `http://localhost/api/dashboard/events/${EVENT_ID}/emails/definitions`,
) {
  return new Request(url);
}

function jsonRequest(method: string, body: unknown, url?: string) {
  return new Request(
    url ??
      `http://localhost/api/dashboard/events/${EVENT_ID}/emails/definitions`,
    {
      method,
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
  listAdminEmailDefinitionsForEvent.mockResolvedValue([]);
});

describe("GET definitions — zero-write virtual rendering (spec §1 AC-1)", () => {
  it("renders the 8 default rows on a fresh event with zero DAL writes", async () => {
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.definitions).toHaveLength(8);
    expect(
      body.definitions.every(
        (d: { materialized: boolean }) => d.materialized === false,
      ),
    ).toBe(true);
    expect(upsertAdminEmailDefinition).not.toHaveBeenCalled();
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(403);
    expect(listAdminEmailDefinitionsForEvent).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await GET(getRequest(), makeContext());
    expect(response.status).toBe(404);
  });
});

describe("PATCH definitions/[kind] — materialize-on-first-edit (spec §1 AC-2)", () => {
  it("toggling a default Off calls the DAL upsert with the catalog ifAbsent + patch", async () => {
    upsertAdminEmailDefinition.mockResolvedValue({
      ok: true,
      created: true,
      definition: {
        id: "doc-1",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "confirmation-paid",
        name: "Registration confirmation — paid",
        group: "post-registration",
        trigger: { type: "on-accept" },
        audience: "accepted-paid",
        enabled: false,
        subject: "s",
        body: "b",
        isSystem: true,
        sortOrder: 3,
        createdAt: { seconds: 1000, nanoseconds: 0 },
        updatedAt: { seconds: 1000, nanoseconds: 0 },
      },
    });

    const response = await PATCH(
      jsonRequest("PATCH", { enabled: false }),
      makeKindContext("confirmation-paid"),
    );

    expect(response.status).toBe(200);
    expect(upsertAdminEmailDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "confirmation-paid",
        isSystem: true,
        patch: { enabled: false },
      }),
    );
    const body = await response.json();
    expect(body.definition.enabled).toBe(false);
    expect(body.definition.materialized).toBe(true);
  });

  it("LOCKED_FIELDS on a system definition -> 400 with field errors, zero writes reach the caller", async () => {
    upsertAdminEmailDefinition.mockResolvedValue({
      ok: false,
      code: "LOCKED_FIELDS",
      fields: ["name"],
    });

    const response = await PATCH(
      jsonRequest("PATCH", { name: "Renamed" }),
      makeKindContext("confirmation-paid"),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.fieldErrors.name).toBeDefined();
  });

  it("PATCH on an unknown custom kind (never materialized) -> 404", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue(null);

    const response = await PATCH(
      jsonRequest("PATCH", { enabled: false }),
      makeKindContext("custom-does-not-exist"),
    );

    expect(response.status).toBe(404);
    expect(upsertAdminEmailDefinition).not.toHaveBeenCalled();
  });

  it("re-toggling calls the SAME upsert entrypoint again (no separate create path — no duplicates)", async () => {
    upsertAdminEmailDefinition.mockResolvedValue({
      ok: true,
      created: false,
      definition: {
        id: "doc-1",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "confirmation-paid",
        name: "Registration confirmation — paid",
        group: "post-registration",
        trigger: { type: "on-accept" },
        audience: "accepted-paid",
        enabled: true,
        subject: "s",
        body: "b",
        isSystem: true,
        sortOrder: 3,
        createdAt: { seconds: 1000, nanoseconds: 0 },
        updatedAt: { seconds: 1000, nanoseconds: 0 },
      },
    });

    const response = await PATCH(
      jsonRequest("PATCH", { enabled: true }),
      makeKindContext("confirmation-paid"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.created).toBe(false);
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await PATCH(
      jsonRequest("PATCH", { enabled: false }),
      makeKindContext("confirmation-paid"),
    );
    expect(response.status).toBe(403);
    expect(upsertAdminEmailDefinition).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await PATCH(
      jsonRequest("PATCH", { enabled: false }),
      makeKindContext("confirmation-paid"),
    );
    expect(response.status).toBe(404);
    expect(upsertAdminEmailDefinition).not.toHaveBeenCalled();
  });

  it("rate-limits at 60/min/user/event (the 61st call in a minute -> 429)", async () => {
    upsertAdminEmailDefinition.mockResolvedValue({
      ok: true,
      created: true,
      definition: {
        id: "doc-1",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "confirmation-paid",
        name: "Registration confirmation — paid",
        group: "post-registration",
        trigger: { type: "on-accept" },
        audience: "accepted-paid",
        enabled: false,
        subject: "s",
        body: "b",
        isSystem: true,
        sortOrder: 3,
        createdAt: { seconds: 1000, nanoseconds: 0 },
        updatedAt: { seconds: 1000, nanoseconds: 0 },
      },
    });

    for (let i = 0; i < 60; i += 1) {
      const response = await PATCH(
        jsonRequest("PATCH", { enabled: false }),
        makeKindContext("confirmation-paid"),
      );
      expect(response.status).toBe(200);
    }

    const sixtyFirst = await PATCH(
      jsonRequest("PATCH", { enabled: false }),
      makeKindContext("confirmation-paid"),
    );
    expect(sixtyFirst.status).toBe(429);
    expect(upsertAdminEmailDefinition).toHaveBeenCalledTimes(60);
  });
});

describe("POST definitions — server-minted custom kind (spec §2 AC-2)", () => {
  it("mints the kind server-side and ignores a client-supplied kind", async () => {
    mintCustomEmailDefinitionKind.mockReturnValue("custom-server-minted");
    upsertAdminEmailDefinition.mockResolvedValue({
      ok: true,
      created: true,
      definition: {
        id: "doc-custom",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "custom-server-minted",
        name: "My custom email",
        group: "pre-event",
        trigger: { type: "manual" },
        audience: "all-invitees",
        enabled: true,
        subject: "s",
        body: "b",
        isSystem: false,
        sortOrder: 8,
        createdAt: { seconds: 1000, nanoseconds: 0 },
        updatedAt: { seconds: 1000, nanoseconds: 0 },
      },
    });

    const response = await POST(
      jsonRequest("POST", {
        kind: "attacker-supplied-kind",
        name: "My custom email",
        group: "pre-event",
        audience: "all-invitees",
        enabled: true,
        subject: "s",
        body: "b",
        trigger: { type: "manual" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(201);
    expect(upsertAdminEmailDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "custom-server-minted",
        isSystem: false,
      }),
    );
  });

  it("rejects a non-manual/scheduled trigger type for a custom definition (400)", async () => {
    const response = await POST(
      jsonRequest("POST", {
        name: "My custom email",
        group: "pre-event",
        audience: "all-invitees",
        enabled: true,
        subject: "s",
        body: "b",
        trigger: { type: "on-accept" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(upsertAdminEmailDefinition).not.toHaveBeenCalled();
  });

  it("CAP_REACHED -> 409", async () => {
    mintCustomEmailDefinitionKind.mockReturnValue("custom-x");
    upsertAdminEmailDefinition.mockResolvedValue({
      ok: false,
      code: "CAP_REACHED",
    });

    const response = await POST(
      jsonRequest("POST", {
        name: "My custom email",
        group: "pre-event",
        audience: "all-invitees",
        enabled: true,
        subject: "s",
        body: "b",
        trigger: { type: "manual" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(409);
  });

  it("rate-limits at 20/min/user/event (the 21st call in a minute -> 429)", async () => {
    mintCustomEmailDefinitionKind.mockReturnValue("custom-server-minted");
    upsertAdminEmailDefinition.mockResolvedValue({
      ok: true,
      created: true,
      definition: {
        id: "doc-custom",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "custom-server-minted",
        name: "My custom email",
        group: "pre-event",
        trigger: { type: "manual" },
        audience: "all-invitees",
        enabled: true,
        subject: "s",
        body: "b",
        isSystem: false,
        sortOrder: 8,
        createdAt: { seconds: 1000, nanoseconds: 0 },
        updatedAt: { seconds: 1000, nanoseconds: 0 },
      },
    });

    const postBody = {
      name: "My custom email",
      group: "pre-event",
      audience: "all-invitees",
      enabled: true,
      subject: "s",
      body: "b",
      trigger: { type: "manual" },
    };

    for (let i = 0; i < 20; i += 1) {
      const response = await POST(jsonRequest("POST", postBody), makeContext());
      expect(response.status).toBe(201);
    }

    const twentyFirst = await POST(
      jsonRequest("POST", postBody),
      makeContext(),
    );
    expect(twentyFirst.status).toBe(429);
    expect(upsertAdminEmailDefinition).toHaveBeenCalledTimes(20);
  });
});

describe("DELETE definitions/[kind] — custom only (spec §2 AC-6)", () => {
  it("deletes a custom definition", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "doc-custom",
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-1",
      isSystem: false,
    });
    deleteAdminEmailDefinition.mockResolvedValue({ ok: true });

    const response = await DELETE(getRequest(), makeKindContext("custom-1"));

    expect(response.status).toBe(200);
    expect(deleteAdminEmailDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ definitionId: "doc-custom" }),
    );
  });

  it("refuses to delete a system default (409 SYSTEM_LOCKED) — no delete affordance is honored server-side either", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "doc-1",
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
    });
    deleteAdminEmailDefinition.mockResolvedValue({
      ok: false,
      code: "SYSTEM_LOCKED",
    });

    const response = await DELETE(
      getRequest(),
      makeKindContext("confirmation-paid"),
    );

    expect(response.status).toBe(409);
  });

  it("404s a kind that was never materialized", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue(null);

    const response = await DELETE(
      getRequest(),
      makeKindContext("custom-never-existed"),
    );

    expect(response.status).toBe(404);
    expect(deleteAdminEmailDefinition).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await DELETE(getRequest(), makeKindContext("custom-1"));
    expect(response.status).toBe(404);
    expect(deleteAdminEmailDefinition).not.toHaveBeenCalled();
  });

  it("rate-limits at 20/min/user/event (the 21st call in a minute -> 429)", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "doc-custom",
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-1",
      isSystem: false,
    });
    deleteAdminEmailDefinition.mockResolvedValue({ ok: true });

    for (let i = 0; i < 20; i += 1) {
      const response = await DELETE(getRequest(), makeKindContext("custom-1"));
      expect(response.status).toBe(200);
    }

    const twentyFirst = await DELETE(getRequest(), makeKindContext("custom-1"));
    expect(twentyFirst.status).toBe(429);
    expect(deleteAdminEmailDefinition).toHaveBeenCalledTimes(20);
  });
});

describe("cross-org isolation (two-org test, M5 route-matrix pattern)", () => {
  it("org-2's session never reaches org-1's event data on GET", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: OTHER_ORG_ID,
      organizations: [{ organizationId: OTHER_ORG_ID, role: "owner" }],
      permissions: ["write:events"],
    });
    // org-1's event does not belong to org-2 -> lookup returns null.
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await GET(getRequest(), makeContext());

    expect(response.status).toBe(404);
    expect(listAdminEmailDefinitionsForEvent).not.toHaveBeenCalled();
  });
});
