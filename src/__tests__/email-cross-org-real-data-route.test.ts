// @vitest-environment node
/**
 * QA (M6-T2 gate 3) — genuine two-org, route-level cross-org isolation test.
 *
 * Every pre-existing M6-T2 route test (email-definitions-route.test.ts,
 * email-messages-route.test.ts, email-settings-route.test.ts) mocks the DAL
 * modules directly (`vi.mock("@/lib/db/adminEmailDefinition", …)`), so their
 * "404 cross-org" cases only prove the route trusts whatever the mock
 * returns — they never exercise the real tenancy-filtering code inside the
 * DAL query/transaction logic together with the HTTP route layer.
 *
 * This file mocks ONLY the Firestore boundary (`@/app/lib/firestore`, via
 * the same in-memory `fake-admin-db` helper the DAL-level tests use) and
 * `next/headers` / `@/lib/auth-utils` / `@/lib/db/adminUser` /
 * `@/lib/db/adminEvent` (session + org/event resolution — already covered
 * exhaustively by route-scope.test.ts and event-org-scoping.test.ts, so
 * re-mocking that specific gate here is not a loss of coverage). The
 * `adminEmailDefinition` / `adminEmailMessage` / `adminEmailSettings`
 * modules are REAL, unmocked, and share ONE fake Firestore instance across
 * two genuinely seeded organizations — reproducing a real multi-tenant
 * Firestore collection. Every real API route handler is called directly.
 *
 * Spec refs: §2 AC-4, §5 AC-6, §6 AC-4, §7 AC-3 (two-org seed test —
 * "definitions, settings, and log rows never leak across orgs on any
 * surface").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));

import { resetRateLimits } from "@/lib/rate-limit";

// Dynamic imports (not static top-level imports): these modules transitively
// import "@/app/lib/firestore", whose vi.mock factory closes over `fake` —
// vi.mock factories are hoisted above static imports, so a static import
// here would evaluate the factory (and read `fake`) before the `const fake =
// createFakeAdminDb()` above it has run (TDZ error). Deferring to a dynamic
// import after `fake` is assigned is the same pattern
// admin-email-definition.test.ts already uses.
const { upsertAdminEmailDefinition, mintCustomEmailDefinitionKind } =
  await import("@/lib/db/adminEmailDefinition");
const { createAdminEmailMessageIfAbsent } =
  await import("@/lib/db/adminEmailMessage");
const { upsertAdminEmailSettings } =
  await import("@/lib/db/adminEmailSettings");

const { DELETE: DELETE_DEFINITION, PATCH: PATCH_DEFINITION } =
  await import("@/app/api/dashboard/events/[eventId]/emails/definitions/[kind]/route");
const { GET: GET_DEFINITIONS } =
  await import("@/app/api/dashboard/events/[eventId]/emails/definitions/route");
const { GET: GET_MESSAGES } =
  await import("@/app/api/dashboard/events/[eventId]/emails/messages/route");
const { GET: GET_SETTINGS } =
  await import("@/app/api/dashboard/events/[eventId]/emails/settings/route");

const ORG_1 = "org-1";
const ORG_2 = "org-2";
const EVENT_1 = { id: "evt-1", name: "Org One Conference", timezone: "UTC" };
const EVENT_2 = { id: "evt-2", name: "Org Two Conference", timezone: "UTC" };

function actingAs(organizationId: string, event: typeof EVENT_1) {
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: `u-${organizationId}`,
    name: "Owner",
    picture: "",
    email: `owner@${organizationId}.example.com`,
  });
  getAdminUserByEmail.mockResolvedValue({
    organizationId,
    organizations: [{ organizationId, role: "owner" }],
    permissions: ["write:events"],
  });
  // Mirrors the real getAdminEventForOrganization contract: only resolves
  // when the event actually belongs to the caller's own org — any other
  // (eventId, organizationId) pairing is a miss, exactly like the DAL's own
  // eventBelongsToOrganization check.
  getAdminEventForOrganization.mockImplementation(
    async (eventId: string, orgId: string) => {
      if (eventId === event.id && orgId === organizationId) return event;
      return null;
    },
  );
}

function getRequest(eventId: string, query = "") {
  return new Request(
    `http://localhost/api/dashboard/events/${eventId}/emails/definitions${query}`,
  );
}

function jsonRequest(
  method: string,
  eventId: string,
  path: string,
  body: unknown,
) {
  return new Request(
    `http://localhost/api/dashboard/events/${eventId}${path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function ctx(eventId: string) {
  return { params: Promise.resolve({ eventId }) };
}

function ctxWithKind(eventId: string, kind: string) {
  return { params: Promise.resolve({ eventId, kind }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  fake.reset();
});

async function seedTwoOrgTenants() {
  // Org 1: a toggled-off system default + a custom definition.
  await upsertAdminEmailDefinition({
    organizationId: ORG_1,
    eventId: EVENT_1.id,
    kind: "invitation",
    isSystem: true,
    ifAbsent: {
      name: "Invitation",
      group: "pre-event",
      trigger: { type: "manual" },
      audience: "all-invitees",
      enabled: true,
      subject: "You're invited — {event_title}",
      body: "Join us, {first_name}.",
      sortOrder: 0,
    },
    patch: { enabled: false },
  });
  const org1CustomKind = mintCustomEmailDefinitionKind();
  await upsertAdminEmailDefinition({
    organizationId: ORG_1,
    eventId: EVENT_1.id,
    kind: org1CustomKind,
    isSystem: false,
    ifAbsent: {
      name: "Org 1 VIP reminder",
      group: "pre-event",
      trigger: { type: "manual" },
      audience: "all-invitees",
      enabled: true,
      subject: "VIP reminder",
      body: "Hi {first_name}",
      sortOrder: 10,
    },
    patch: {},
  });

  // Org 2: its OWN "invitation" default stays untouched (never toggled) +
  // its own differently-named custom definition.
  const org2CustomKind = mintCustomEmailDefinitionKind();
  await upsertAdminEmailDefinition({
    organizationId: ORG_2,
    eventId: EVENT_2.id,
    kind: org2CustomKind,
    isSystem: false,
    ifAbsent: {
      name: "Org 2 VIP reminder",
      group: "pre-event",
      trigger: { type: "manual" },
      audience: "all-invitees",
      enabled: true,
      subject: "VIP reminder",
      body: "Hi {first_name}",
      sortOrder: 10,
    },
    patch: {},
  });

  // One EmailMessage row per org.
  await createAdminEmailMessageIfAbsent({
    organizationId: ORG_1,
    eventId: EVENT_1.id,
    definitionId: "def-1",
    kind: "test",
    dedupeKey: "dk-org1",
    recipient: { name: "Org1 Recipient", email: "org1-recipient@example.com" },
    attendeeId: null,
    submissionId: null,
    from: { name: "Org 1", address: "org1@example.com" },
    replyTo: null,
    subject: "Org 1 subject",
    bodyHtml: "<p>Org 1 body</p>",
    bodyText: "Org 1 body",
  });
  await createAdminEmailMessageIfAbsent({
    organizationId: ORG_2,
    eventId: EVENT_2.id,
    definitionId: "def-2",
    kind: "test",
    dedupeKey: "dk-org2",
    recipient: { name: "Org2 Recipient", email: "org2-recipient@example.com" },
    attendeeId: null,
    submissionId: null,
    from: { name: "Org 2", address: "org2@example.com" },
    replyTo: null,
    subject: "Org 2 subject",
    bodyHtml: "<p>Org 2 body</p>",
    bodyText: "Org 2 body",
  });

  // Distinct sender settings per org.
  await upsertAdminEmailSettings({
    organizationId: ORG_1,
    eventId: EVENT_1.id,
    settings: {
      fromName: "Org One Events",
      fromAddress: "events@org1.example.com",
      replyTo: null,
    },
  });
  await upsertAdminEmailSettings({
    organizationId: ORG_2,
    eventId: EVENT_2.id,
    settings: {
      fromName: "Org Two Events",
      fromAddress: "events@org2.example.com",
      replyTo: null,
    },
  });

  return { org1CustomKind, org2CustomKind };
}

describe("QA — real two-org data through the actual route handlers (unmocked DAL)", () => {
  it("GET /definitions never returns another org's custom definition or toggle state", async () => {
    const { org1CustomKind, org2CustomKind } = await seedTwoOrgTenants();

    actingAs(ORG_1, EVENT_1);
    const org1Res = await GET_DEFINITIONS(
      getRequest(EVENT_1.id),
      ctx(EVENT_1.id),
    );
    expect(org1Res.status).toBe(200);
    const org1Body = await org1Res.json();
    const org1Kinds = org1Body.definitions.map((d: { kind: string }) => d.kind);

    expect(org1Kinds).toContain(org1CustomKind);
    expect(org1Kinds).not.toContain(org2CustomKind);
    expect(org1Body.definitions).toHaveLength(9); // 8 defaults + 1 custom
    const invitationRow = org1Body.definitions.find(
      (d: { kind: string }) => d.kind === "invitation",
    );
    expect(invitationRow.enabled).toBe(false); // org-1's own toggle

    actingAs(ORG_2, EVENT_2);
    const org2Res = await GET_DEFINITIONS(
      getRequest(EVENT_2.id),
      ctx(EVENT_2.id),
    );
    const org2Body = await org2Res.json();
    const org2Kinds = org2Body.definitions.map((d: { kind: string }) => d.kind);

    expect(org2Kinds).toContain(org2CustomKind);
    expect(org2Kinds).not.toContain(org1CustomKind);
    expect(org2Body.definitions).toHaveLength(9);
    const org2Invitation = org2Body.definitions.find(
      (d: { kind: string }) => d.kind === "invitation",
    );
    // Org 2 never toggled its own "invitation" row — must still read
    // enabled:true (virtual default), proving org-1's toggle materialized a
    // SEPARATE doc at a distinct deterministic id, not a shared one.
    expect(org2Invitation.enabled).toBe(true);
    expect(org2Invitation.materialized).toBe(false);
  });

  it("DELETE of org-1's custom definition never removes org-2's similarly-shaped row", async () => {
    const { org1CustomKind, org2CustomKind } = await seedTwoOrgTenants();

    actingAs(ORG_1, EVENT_1);
    const delRes = await DELETE_DEFINITION(
      jsonRequest(
        "DELETE",
        EVENT_1.id,
        `/emails/definitions/${org1CustomKind}`,
        {},
      ),
      ctxWithKind(EVENT_1.id, org1CustomKind),
    );
    expect(delRes.status).toBe(200);

    actingAs(ORG_2, EVENT_2);
    const org2Res = await GET_DEFINITIONS(
      getRequest(EVENT_2.id),
      ctx(EVENT_2.id),
    );
    const org2Body = await org2Res.json();
    const org2Kinds = org2Body.definitions.map((d: { kind: string }) => d.kind);
    expect(org2Kinds).toContain(org2CustomKind);
  });

  it("PATCH scoped to org-1 cannot reach org-2's event (404, zero writes)", async () => {
    await seedTwoOrgTenants();
    const writesBefore = fake.writes.length;

    // Authenticated as org-1, but the URL path names org-2's eventId — the
    // real getAdminEventForOrganization(evt-2, org-1) mock mirrors the real
    // DAL's ownership check and returns null.
    actingAs(ORG_1, EVENT_1);
    const res = await PATCH_DEFINITION(
      jsonRequest("PATCH", EVENT_2.id, "/emails/definitions/invitation", {
        enabled: true,
      }),
      ctxWithKind(EVENT_2.id, "invitation"),
    );

    expect(res.status).toBe(404);
    expect(fake.writes.length).toBe(writesBefore); // no mutation leaked through
  });

  it("GET /messages never returns another org's send-log rows", async () => {
    await seedTwoOrgTenants();

    actingAs(ORG_1, EVENT_1);
    const res = await GET_MESSAGES(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_1.id}/emails/messages`,
      ),
      ctx(EVENT_1.id),
    );
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].recipient.email).toBe("org1-recipient@example.com");
    expect(
      body.messages.some(
        (m: { recipient: { email: string } }) =>
          m.recipient.email === "org2-recipient@example.com",
      ),
    ).toBe(false);
  });

  it("GET /settings resolves only the caller's own org's sender identity", async () => {
    await seedTwoOrgTenants();

    actingAs(ORG_1, EVENT_1);
    const org1Res = await GET_SETTINGS(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_1.id}/emails/settings`,
      ),
      ctx(EVENT_1.id),
    );
    const org1Body = await org1Res.json();
    expect(org1Body.settings.fromName).toBe("Org One Events");
    expect(org1Body.settings.fromAddress).toBe("events@org1.example.com");

    actingAs(ORG_2, EVENT_2);
    const org2Res = await GET_SETTINGS(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_2.id}/emails/settings`,
      ),
      ctx(EVENT_2.id),
    );
    const org2Body = await org2Res.json();
    expect(org2Body.settings.fromName).toBe("Org Two Events");
    expect(org2Body.settings.fromAddress).toBe("events@org2.example.com");
  });

  it("a fresh event (no prior writes) renders the 8 virtual defaults with literally zero Firestore writes recorded by the real DAL", async () => {
    actingAs(ORG_1, EVENT_1);
    const res = await GET_DEFINITIONS(getRequest(EVENT_1.id), ctx(EVENT_1.id));
    const body = await res.json();
    expect(body.definitions).toHaveLength(8);
    expect(
      body.definitions.every((d: { materialized: boolean }) => !d.materialized),
    ).toBe(true);
    expect(fake.writes).toHaveLength(0);
  });
});
