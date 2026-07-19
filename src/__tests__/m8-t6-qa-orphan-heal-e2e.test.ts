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

const acceptedHook = await import("@/features/responses/on-submission-accepted");
const realOnSubmissionAccepted = acceptedHook.onSubmissionAccepted;
const hookSpy = vi.spyOn(acceptedHook, "onSubmissionAccepted");
const { PATCH } = await import(
  "@/app/api/dashboard/events/[eventId]/responses/[responseId]/status/route"
);
const { POST } = await import(
  "@/app/api/dashboard/events/[eventId]/responses/[responseId]/retry-attendee-creation/route"
);
const { resetRateLimits } = await import("@/lib/rate-limit");

const EVENT_ID = "evt-qa-orphan";
const ORG_ID = "org-qa";
const RESPONSE_ID = "resp-qa-orphan";

function context() {
  return { params: Promise.resolve({ eventId: EVENT_ID, responseId: RESPONSE_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetRateLimits();
  hookSpy.mockImplementation(realOnSubmissionAccepted);
  transportSend.mockResolvedValue({
    status: "sent",
    providerMessageId: "qa-transport-1",
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
    name: "QA Event",
    periods: [],
    timezone: "UTC",
  });
  fake.store.set(`FormData/${RESPONSE_ID}`, {
    formId: "form-qa",
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    status: "reviewed",
    attendeeCreated: false,
    submission: {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
    },
    ticketLabel: "Delegate",
    qrTokenHash: "qa-original-hash",
    submittedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  });
});

describe("M8-T6 QA orphan-heal lifecycle", () => {
  it("creates a genuine orphan through the status route, surfaces failure, then heals it through the retry route with the real hook", async () => {
    // Both status-route hook attempts fail, after the real DAL has committed
    // acceptance. The explicit retry then runs the unmodified production hook.
    hookSpy
      .mockRejectedValueOnce(new Error("forced initial accept-hook failure"))
      .mockRejectedValueOnce(new Error("forced immediate repair failure"))
      .mockImplementation(realOnSubmissionAccepted);

    const acceptResponse = await PATCH(
      new Request("http://localhost/status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "accepted" }),
      }),
      context(),
    );

    expect(acceptResponse.status).toBe(500);
    await expect(acceptResponse.json()).resolves.toMatchObject({
      code: "ATTENDEE_CREATION_FAILED",
      responseId: RESPONSE_ID,
      attendeeCreated: false,
    });
    const orphan = fake.store.get(`FormData/${RESPONSE_ID}`)!;
    expect(orphan).toMatchObject({ status: "accepted", attendeeCreated: false });
    expect(orphan.acceptedAt).toBeDefined();
    const acceptedAt = orphan.acceptedAt;
    expect([...fake.store.keys()].filter((key) => key.startsWith("Attendee/"))).toHaveLength(0);

    const retryResponse = await POST(
      new Request("http://localhost/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      context(),
    );

    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      responseId: RESPONSE_ID,
      status: "accepted",
      attendeeCreated: true,
      outcome: "repaired",
    });
    expect(hookSpy).toHaveBeenCalledTimes(3);
    expect(fake.store.get(`FormData/${RESPONSE_ID}`)).toMatchObject({
      status: "accepted",
      attendeeCreated: true,
      acceptedAt,
    });

    const attendees = [...fake.store.entries()].filter(([key]) =>
      key.startsWith("Attendee/"),
    );
    expect(attendees).toHaveLength(1);
    const attendeeId = attendees[0][0].split("/")[1];
    const confirmations = [...fake.store.entries()].filter(
      ([key, value]) =>
        key.startsWith("EmailMessage/") && value.kind === "confirmation-paid",
    );
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0][1]).toMatchObject({
      attendeeId,
      dedupeKey: attendeeId,
      status: "sent",
    });
    expect(transportSend).toHaveBeenCalledTimes(1);
  });
});
