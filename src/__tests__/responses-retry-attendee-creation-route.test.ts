// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
const transportSend = vi.fn();

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

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/email/dev-outbox-transport", () => ({
  createDevOutboxTransport: () => ({ send: transportSend }),
}));

const { resetRateLimits } = await import("@/lib/rate-limit");
const acceptedHook = await import("@/features/responses/on-submission-accepted");
const onSubmissionAccepted = vi.spyOn(acceptedHook, "onSubmissionAccepted");
const { POST } = await import(
  "@/app/api/dashboard/events/[eventId]/responses/[responseId]/retry-attendee-creation/route"
);

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const RESPONSE_ID = "resp-1";

function seedResponse(overrides: Record<string, unknown> = {}) {
  fake.store.set(`FormData/${RESPONSE_ID}`, {
    formId: "form-1",
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    status: "accepted",
    attendeeCreated: false,
    submission: {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      company: "Analytical Engines",
      job_title: "Programmer",
    },
    ticketLabel: "Delegate",
    qrTokenHash: "original-qr-hash",
    ...overrides,
  });
}

function request(body: string | undefined = "{}") {
  return new Request("http://localhost/retry-attendee-creation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body }),
  });
}

function context(eventId = EVENT_ID, responseId = RESPONSE_ID) {
  return { params: Promise.resolve({ eventId, responseId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetRateLimits();
  transportSend.mockResolvedValue({
    status: "sent",
    providerMessageId: "transport-1",
  });
  cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
  decodeUser.mockResolvedValue({ email: "owner@example.com" });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "owner" }],
    permissions: ["write:events"],
  });
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    name: "GovTech",
    periods: [],
    timezone: "UTC",
  });
});

describe("POST retry-attendee-creation", () => {
  it("returns 401 without a session", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    seedResponse();
    expect((await POST(request(), context())).status).toBe(401);
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("returns 403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: ["view:events"],
    });
    seedResponse();
    expect((await POST(request(), context())).status).toBe(403);
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("returns indistinguishable 404 and cannot heal another organization", async () => {
    seedResponse({ organizationId: "org-2" });
    const response = await POST(request(), context());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Response not found.",
      code: "RESPONSE_NOT_FOUND",
    });
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)!.attendeeCreated).toBe(false);
  });

  it("returns the same 404 for a missing response id without invoking the hook", async () => {
    const response = await POST(request(), context(EVENT_ID, "missing-response"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Response not found.",
      code: "RESPONSE_NOT_FOUND",
    });
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("returns the same 404 for a same-org response owned by another event", async () => {
    seedResponse({ eventId: "evt-other" });
    const response = await POST(request(), context());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Response not found.",
      code: "RESPONSE_NOT_FOUND",
    });
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("returns already_complete without invoking the hook", async () => {
    seedResponse({ attendeeCreated: true });
    const response = await POST(request(undefined), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      responseId: RESPONSE_ID,
      status: "accepted",
      attendeeCreated: true,
      outcome: "already_complete",
    });
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("repairs the response and persists attendee plus completion marker", async () => {
    seedResponse();
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect((await response.json()).outcome).toBe("repaired");
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)!.attendeeCreated).toBe(true);
    expect([...fake.store.keys()].filter((key) => key.startsWith("Attendee/"))).toHaveLength(1);
  });

  it("rejects a non-accepted response without writes", async () => {
    seedResponse({ status: "reviewed" });
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("RESPONSE_NOT_ACCEPTED");
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
    expect([...fake.store.keys()].some((key) => key.startsWith("Attendee/"))).toBe(false);
  });

  it("returns a structured 500 when the hook still fails", async () => {
    seedResponse();
    onSubmissionAccepted.mockRejectedValueOnce(new Error("private failure"));
    const response = await POST(request(), context());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error:
        "The response is accepted but the attendee record could not be created. Please retry.",
      code: "ATTENDEE_CREATION_FAILED",
      responseId: RESPONSE_ID,
      attendeeCreated: false,
    });
  });

  it("rate-limits the 31st request without invoking the hook", async () => {
    seedResponse({ attendeeCreated: true });
    for (let index = 0; index < 30; index += 1) {
      expect((await POST(request(), context())).status).toBe(200);
    }
    const response = await POST(request(), context());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("real-hook replay preserves one attendee and one confirmation send/outbox", async () => {
    seedResponse();
    expect((await POST(request(), context())).status).toBe(200);
    const attendeeEntries = [...fake.store.entries()].filter(([key]) =>
      key.startsWith("Attendee/"),
    );
    expect(attendeeEntries).toHaveLength(1);
    const [attendeePath, attendeeBeforeReplay] = attendeeEntries[0];
    const originalAttendee = { ...attendeeBeforeReplay };

    // Simulate a stale retry payload/read while retaining the deterministic
    // attendee and confirmation outbox identity created by the first call.
    fake.store.get(`FormData/${RESPONSE_ID}`)!.attendeeCreated = false;
    expect((await POST(request(), context())).status).toBe(200);

    expect([...fake.store.keys()].filter((key) => key.startsWith("Attendee/"))).toHaveLength(1);
    expect(fake.store.get(attendeePath)).toEqual(originalAttendee);
    const messages = [...fake.store.entries()].filter(([key]) =>
      key.startsWith("EmailMessage/"),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0][1]).toMatchObject({
      kind: "confirmation-paid",
      attendeeId: attendeePath.split("/")[1],
      dedupeKey: attendeePath.split("/")[1],
      status: "sent",
    });
    expect(transportSend).toHaveBeenCalledTimes(1);
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)!.attendeeCreated).toBe(true);
  });

  it("rejects non-empty payloads", async () => {
    seedResponse();
    expect((await POST(request('{"organizationId":"org-2"}'), context())).status).toBe(400);
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });
});
