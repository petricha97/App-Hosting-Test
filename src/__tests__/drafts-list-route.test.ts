// @vitest-environment node
/**
 * M5-T3 — abandoned drafts list route
 * (GET /api/dashboard/events/[eventId]/drafts):
 * - write:events-gated (M5 shared decision), 404 cross-org (IDOR-safe);
 * - returns ONLY isAbandoned drafts (T3 AC-1 — the strict >24h derivation
 *   lives in the DAL; a fresher draft never leaves the server);
 * - every email is masked to DOMAIN ONLY — the response body carries no
 *   local part anywhere (T3 AC-3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminRegistrationDraftsForEvent,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminRegistrationDraftsForEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  getAdminRegistrationDraftsForEvent,
}));

import { GET } from "@/app/api/dashboard/events/[eventId]/drafts/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

function ts(ms: number) {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    pathId: "path-1",
    formId: "form-1",
    draftTokenHash: "hash",
    lastStepReached: "summary",
    stepAnswers: {},
    ticketTypeId: null,
    registrationTypeId: null,
    promotionId: null,
    attempt: 1,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada.lovelace@dentsu.com",
    createdAt: ts(1000),
    updatedAt: ts(2000),
    isAbandoned: true,
    ...overrides,
  };
}

function makeRequest() {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/drafts`,
  );
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: "token" } : undefined),
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
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    name: "GovTech Conference",
  });
  getAdminRegistrationDraftsForEvent.mockResolvedValue([
    makeDraft(),
    makeDraft({
      id: "draft-fresh",
      email: "fresh.person@example.com",
      isAbandoned: false,
    }),
  ]);
});

describe("GET /events/[eventId]/drafts — abandoned list (M5-T3)", () => {
  it("401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(401);
    expect(getAdminRegistrationDraftsForEvent).not.toHaveBeenCalled();
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(403);
    expect(getAdminRegistrationDraftsForEvent).not.toHaveBeenCalled();
  });

  it("404 for a cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(404);
  });

  it("returns only abandoned drafts with masked emails — no local part in the body", async () => {
    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(200);

    const raw = await response.text();
    const body = JSON.parse(raw) as {
      drafts: Array<Record<string, unknown>>;
    };

    // Only the abandoned draft is present (T3 AC-1).
    expect(body.drafts.map((draft) => draft.id)).toEqual(["draft-1"]);
    expect(body.drafts[0]).toMatchObject({
      name: "Ada Lovelace",
      maskedEmail: "@dentsu.com",
      lastStepReached: "summary",
    });

    // No local part — of EITHER draft — anywhere in the payload (T3 AC-3).
    expect(raw).not.toContain("ada.lovelace");
    expect(raw).not.toContain("fresh.person");
    expect(raw).not.toContain("example.com"); // fresh draft fully absent
  });
});
