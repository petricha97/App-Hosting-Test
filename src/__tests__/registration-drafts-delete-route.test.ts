// @vitest-environment node
/**
 * M3-T5 AC-7 — manual draft delete route (REGRESSION TEST, defect QA-M3-D1).
 * Spec: agents/docs/specs/m3-registration-paths.md (T5 AC-7):
 *   "Manual delete route removes a draft (`DELETE .../drafts/[draftId]`,
 *    `write:events`, 404 cross-org); no auto-delete job exists in M3."
 * Data model (agents/docs/data-models/m3-registration-paths.md §RegistrationDraft):
 *   "Manual purge = admin delete route over getAdminRegistrationDraftForEvent
 *    (org-scoped, 404 cross-org) + deleteAdminRegistrationDraft."
 *
 * QA finding (2026-07-11): the DAL primitives exist and are tested
 * (admin-registration-draft.test.ts), but NO route wires them — organizers
 * cannot purge a draft's PII on request. This file FAILS until the route
 * lands at src/app/api/dashboard/events/[eventId]/drafts/[draftId]/route.ts
 * and then locks its contract so the purge capability cannot silently
 * regress:
 *  - 401 unauthenticated / 403 view-only (write:events required)
 *  - 404 unknown or cross-org event and unknown or cross-org draft
 *    (IDOR-safe, indistinguishable from missing)
 *  - success deletes exactly the addressed draft via the org-scoped lookup
 *
 * The DAL is mocked at the module boundary per the sibling route tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminRegistrationDraftForEvent,
  deleteAdminRegistrationDraft,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminRegistrationDraftForEvent: vi.fn(),
  deleteAdminRegistrationDraft: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  getAdminRegistrationDraftForEvent,
  deleteAdminRegistrationDraft,
}));

const EVENT_ID = "evt-1";
const DRAFT_ID = "a".repeat(32);
const ORG_ID = "org-1";

// Spec route location (T5 AC-7). The specifier is built dynamically (and
// @vite-ignore'd) so a missing module surfaces as a CLEAR assertion failure
// in loadDeleteHandler below instead of a transform-time crash of the whole
// suite file.
const ROUTE_MODULE =
  "@/app/api/dashboard/events/[eventId]/drafts/[draftId]/route";

type DeleteHandler = (
  request: Request,
  context: { params: Promise<{ eventId: string; draftId: string }> },
) => Promise<Response>;

async function loadDeleteHandler(): Promise<DeleteHandler> {
  let mod: Record<string, unknown> | null = null;
  try {
    mod = (await import(/* @vite-ignore */ ROUTE_MODULE)) as Record<
      string,
      unknown
    >;
  } catch {
    mod = null;
  }
  expect(
    mod,
    "T5 AC-7 defect QA-M3-D1: the manual draft purge route " +
      "DELETE /api/dashboard/events/[eventId]/drafts/[draftId] does not " +
      "exist — organizers cannot delete a draft's PII on request.",
  ).not.toBeNull();
  expect(
    typeof mod?.DELETE,
    "drafts/[draftId]/route.ts must export a DELETE handler",
  ).toBe("function");
  return mod!.DELETE as DeleteHandler;
}

function makeRequest() {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/drafts/${DRAFT_ID}`,
    { method: "DELETE" },
  );
}

function context(eventId = EVENT_ID, draftId = DRAFT_ID) {
  return { params: Promise.resolve({ eventId, draftId }) };
}

const draft = {
  id: DRAFT_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  pathId: "path-1",
  formId: "form-1",
  draftTokenHash: "hash",
  lastStepReached: "ticket_options",
  stepAnswers: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
  ticketTypeId: "tick-1",
  registrationTypeId: "rt-1",
  promotionId: null,
  attempt: 1,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
};

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
  getAdminRegistrationDraftForEvent.mockResolvedValue(draft);
  deleteAdminRegistrationDraft.mockResolvedValue(undefined);
});

describe("DELETE /events/[eventId]/drafts/[draftId] — manual purge (T5 AC-7)", () => {
  it("returns 401 without a session cookie and never deletes", async () => {
    const DELETE = await loadDeleteHandler();
    cookies.mockResolvedValue({ get: () => undefined });

    const response = await DELETE(makeRequest(), context());

    expect(response.status).toBe(401);
    expect(deleteAdminRegistrationDraft).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer-permission member (write:events required)", async () => {
    const DELETE = await loadDeleteHandler();
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });

    const response = await DELETE(makeRequest(), context());

    expect(response.status).toBe(403);
    expect(deleteAdminRegistrationDraft).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-org/unknown event", async () => {
    const DELETE = await loadDeleteHandler();
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await DELETE(makeRequest(), context());

    expect(response.status).toBe(404);
    expect(deleteAdminRegistrationDraft).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-org/unknown draft (org-scoped lookup, IDOR-safe)", async () => {
    const DELETE = await loadDeleteHandler();
    getAdminRegistrationDraftForEvent.mockResolvedValue(null);

    const response = await DELETE(makeRequest(), context());

    expect(response.status).toBe(404);
    expect(deleteAdminRegistrationDraft).not.toHaveBeenCalled();
  });

  it("deletes the draft through the org-scoped lookup on success", async () => {
    const DELETE = await loadDeleteHandler();

    const response = await DELETE(makeRequest(), context());

    expect(response.status).toBeLessThan(300);
    expect(getAdminRegistrationDraftForEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: DRAFT_ID,
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    );
    expect(deleteAdminRegistrationDraft).toHaveBeenCalledTimes(1);
    expect(deleteAdminRegistrationDraft).toHaveBeenCalledWith(DRAFT_ID);
  });
});
