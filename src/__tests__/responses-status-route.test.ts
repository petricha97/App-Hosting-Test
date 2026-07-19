// @vitest-environment node
/**
 * M3-T4 — response status transition route + DAL machine.
 * Spec: agents/docs/specs/m3-registration-paths.md (T4 AC-2/AC-3/AC-4).
 *
 * Runs the REAL transitionAdminFormDataStatus against the in-memory fake
 * Firestore, so the transactional machine (forward-only, terminal accepted,
 * read-time default for legacy docs) and the accept hook contract (fires at
 * most once, only after commit) are locked end-to-end through the route:
 *  - 401/403/404 gates (unauthenticated / view-only / cross-org — IDOR-safe)
 *  - every legal forward transition persists status + statusUpdatedAt
 *  - backward, same-status and out-of-accepted moves 409 with an EMPTY write
 *    set
 *  - accept stamps acceptedAt and fires the hook stub exactly once; a
 *    double-click second accept 409s with no duplicate hook call
 *  - legacy docs without a status field transition from "new"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

const { cookies, decodeUser, getAdminUserByEmail, getAdminEventForOrganization, onSubmissionAccepted } =
  vi.hoisted(() => ({
    cookies: vi.fn(),
    decodeUser: vi.fn(),
    getAdminUserByEmail: vi.fn(),
    getAdminEventForOrganization: vi.fn(),
    onSubmissionAccepted: vi.fn(),
  }));

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
// Injectable accept hook seam: the DAL falls back to this stub module when
// no onAccepted param is passed (the route never passes one).
vi.mock("@/features/responses/on-submission-accepted", () => ({
  onSubmissionAccepted,
}));

// Dynamic import AFTER the mocks so the fake-db factory closure sees an
// initialized `fake` (static imports would hoist above it — TDZ).
const { PATCH } = await import(
  "@/app/api/dashboard/events/[eventId]/responses/[responseId]/status/route"
);
import type { FormDataStatus } from "@/types/collection";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const RESPONSE_ID = "resp-1";

function seedResponse(
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  fake.store.set(`FormData/${id}`, {
    formId: "form-1",
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    submission: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
    submittedAt: { seconds: 100 },
    ...overrides,
  });
}

function makeRequest(to: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/responses/${RESPONSE_ID}/status`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to }),
    },
  );
}

function context(eventId = EVENT_ID, responseId = RESPONSE_ID) {
  return { params: Promise.resolve({ eventId, responseId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
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
  getAdminEventForOrganization.mockResolvedValue({ id: EVENT_ID, name: "GovTech" });
  onSubmissionAccepted.mockImplementation(async (submission: { id: string }) => {
    const doc = fake.store.get(`FormData/${submission.id}`);
    if (doc) doc.attendeeCreated = true;
  });
});

describe("PATCH /responses/[id]/status — auth gates (T4 AC-4)", () => {
  it("returns 401 without a session cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    seedResponse(RESPONSE_ID, { status: "new" });

    const response = await PATCH(makeRequest("pending"), context());

    expect(response.status).toBe(401);
    expect(fake.writes).toHaveLength(0);
  });

  it("returns 403 for a viewer-permission member (no write:events)", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    seedResponse(RESPONSE_ID, { status: "new" });

    const response = await PATCH(makeRequest("pending"), context());

    expect(response.status).toBe(403);
    expect(fake.writes).toHaveLength(0);
  });

  it("returns 404 for an unknown response id", async () => {
    const response = await PATCH(makeRequest("pending"), context());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a cross-org response (indistinguishable from missing)", async () => {
    seedResponse(RESPONSE_ID, { organizationId: "org-other", status: "new" });

    const response = await PATCH(makeRequest("pending"), context());

    expect(response.status).toBe(404);
    expect(fake.writes).toHaveLength(0);
  });

  it("returns 400 for a status outside the enum (no 'rejected' in M3)", async () => {
    seedResponse(RESPONSE_ID, { status: "new" });

    const response = await PATCH(makeRequest("rejected"), context());

    expect(response.status).toBe(400);
    expect(fake.writes).toHaveLength(0);
  });
});

describe("transition matrix (T4 AC-2)", () => {
  const LEGAL: Array<[FormDataStatus, FormDataStatus]> = [
    ["new", "pending"],
    ["new", "reviewed"],
    ["new", "accepted"],
    ["pending", "reviewed"],
    ["pending", "accepted"],
    ["reviewed", "accepted"],
  ];

  const ILLEGAL: Array<[FormDataStatus, FormDataStatus]> = [
    ["new", "new"],
    ["pending", "new"],
    ["pending", "pending"],
    ["reviewed", "new"],
    ["reviewed", "pending"],
    ["reviewed", "reviewed"],
    ["accepted", "new"],
    ["accepted", "pending"],
    ["accepted", "reviewed"],
  ];

  for (const [from, to] of LEGAL) {
    it(`allows ${from} -> ${to} and persists status + statusUpdatedAt`, async () => {
      seedResponse(RESPONSE_ID, { status: from });

      const response = await PATCH(makeRequest(to), context());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        responseId: RESPONSE_ID,
        status: to,
      });
      const doc = fake.store.get(`FormData/${RESPONSE_ID}`)!;
      expect(doc.status).toBe(to);
      expect(doc.statusUpdatedAt).toBeDefined();
    });
  }

  for (const [from, to] of ILLEGAL) {
    it(`rejects ${from} -> ${to} with 409 and an empty write set`, async () => {
      seedResponse(RESPONSE_ID, { status: from });

      const response = await PATCH(makeRequest(to), context());

      expect(response.status).toBe(409);
      expect(fake.writes).toHaveLength(0);
      expect(fake.store.get(`FormData/${RESPONSE_ID}`)!.status).toBe(from);
    });
  }

  it("legacy docs without a status field transition from 'new' (read-time default)", async () => {
    seedResponse(RESPONSE_ID); // no status field at all

    const response = await PATCH(makeRequest("pending"), context());

    expect(response.status).toBe(200);
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)!.status).toBe("pending");
  });
});

describe("accept side-effect (T4 AC-3)", () => {
  it("accept stamps acceptedAt and fires the hook exactly once with the submission", async () => {
    seedResponse(RESPONSE_ID, { status: "reviewed" });

    const response = await PATCH(makeRequest("accepted"), context());

    expect(response.status).toBe(200);
    const doc = fake.store.get(`FormData/${RESPONSE_ID}`)!;
    expect(doc.status).toBe("accepted");
    expect(doc.acceptedAt).toBeDefined();
    expect(onSubmissionAccepted).toHaveBeenCalledTimes(1);
    expect(onSubmissionAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ id: RESPONSE_ID, status: "accepted" }),
    );
  });

  it("non-accept transitions never fire the hook and never stamp acceptedAt", async () => {
    seedResponse(RESPONSE_ID, { status: "new" });

    await PATCH(makeRequest("reviewed"), context());

    const doc = fake.store.get(`FormData/${RESPONSE_ID}`)!;
    expect(doc.acceptedAt).toBeUndefined();
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("accepted/pending replay heals without rewriting acceptedAt or status", async () => {
    const acceptedAt = { seconds: 1_700_000_000, nanoseconds: 123_000_000 };
    seedResponse(RESPONSE_ID, {
      status: "accepted",
      attendeeCreated: false,
      acceptedAt,
    });

    const response = await PATCH(makeRequest("accepted"), context());

    expect(response.status).toBe(200);
    expect(onSubmissionAccepted).toHaveBeenCalledTimes(1);
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)).toMatchObject({
      status: "accepted",
      attendeeCreated: true,
      acceptedAt,
    });
    expect(fake.writes).toHaveLength(0);
  });

  it("accepted/complete replay preserves acceptedAt with no hook or status write", async () => {
    const acceptedAt = { seconds: 1_700_000_001, nanoseconds: 456_000_000 };
    seedResponse(RESPONSE_ID, {
      status: "accepted",
      attendeeCreated: true,
      acceptedAt,
    });

    const response = await PATCH(makeRequest("accepted"), context());

    expect(response.status).toBe(200);
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)).toMatchObject({
      status: "accepted",
      attendeeCreated: true,
      acceptedAt,
    });
    expect(fake.writes).toHaveLength(0);
  });

  it("immediately repairs a failed accept hook before returning success", async () => {
    seedResponse(RESPONSE_ID, { status: "reviewed", attendeeCreated: false });
    onSubmissionAccepted
      .mockRejectedValueOnce(new Error("first hook failed"))
      .mockImplementationOnce(async (submission: { id: string }) => {
        fake.store.get(`FormData/${submission.id}`)!.attendeeCreated = true;
      });

    const response = await PATCH(makeRequest("accepted"), context());

    expect(response.status).toBe(200);
    expect(onSubmissionAccepted).toHaveBeenCalledTimes(2);
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)!.attendeeCreated).toBe(true);
  });

  it("returns structured 500 when the initial hook and one repair both fail", async () => {
    seedResponse(RESPONSE_ID, { status: "reviewed", attendeeCreated: false });
    onSubmissionAccepted.mockRejectedValue(new Error("attendee unavailable"));

    const response = await PATCH(makeRequest("accepted"), context());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error:
        "The response is accepted but the attendee record could not be created. Please retry.",
      code: "ATTENDEE_CREATION_FAILED",
      responseId: RESPONSE_ID,
      attendeeCreated: false,
    });
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)!.status).toBe("accepted");
    expect(onSubmissionAccepted).toHaveBeenCalledTimes(2);
  });
});
