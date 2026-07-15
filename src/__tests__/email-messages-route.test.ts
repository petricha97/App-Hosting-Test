// @vitest-environment node
/**
 * M6-T2 — send-log routes:
 *   GET  /api/dashboard/events/[eventId]/emails/messages
 *   POST /api/dashboard/events/[eventId]/emails/messages/[messageId]/retry
 * Spec: agents/docs/specs/m6-emails-admin.md (§5 AC-2/AC-3/AC-4/AC-6).
 *
 * Locks:
 *  - status and kind filters are MUTUALLY EXCLUSIVE — the route rejects the
 *    combination itself (400), so the DAL's own throw is unreachable (§5
 *    AC-3);
 *  - retry: NOT_RETRYABLE (sent/queued) -> 409 (a raced retry of a
 *    just-sent row is a calm typed error, never a duplicate-send
 *    appearance), NOT_FOUND (missing OR cross-org) -> 404 (§5 AC-4, AC-6);
 *  - the log never renders another org's rows — cross-org access -> 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  listAdminEmailMessagesForEvent,
  countAdminEmailMessagesForEvent,
  getAdminEmailMessageForEvent,
  retryEmailMessage,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  listAdminEmailMessagesForEvent: vi.fn(),
  countAdminEmailMessagesForEvent: vi.fn(),
  getAdminEmailMessageForEvent: vi.fn(),
  retryEmailMessage: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminEmailMessage", () => ({
  listAdminEmailMessagesForEvent,
  countAdminEmailMessagesForEvent,
  getAdminEmailMessageForEvent,
  EMAIL_MESSAGE_LIST_LIMIT: 50,
}));
vi.mock("@/lib/email/send-service", () => ({ retryEmailMessage }));

import { GET } from "@/app/api/dashboard/events/[eventId]/emails/messages/route";
import { POST as RETRY } from "@/app/api/dashboard/events/[eventId]/emails/messages/[messageId]/retry/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const MESSAGE_ID = "msg-1";

const EVENT = { id: EVENT_ID, name: "Innovation Summit", timezone: "UTC" };

const MESSAGE = {
  id: MESSAGE_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  definitionId: null,
  kind: "test",
  dedupeKey: "dk-1",
  recipient: { name: "Test", email: "test@example.com" },
  attendeeId: null,
  submissionId: null,
  from: { name: "Events", address: "events@example.com" },
  replyTo: null,
  subject: "Hi",
  bodyHtml: "<p>Hi</p>",
  bodyText: "Hi",
  status: "sent",
  attemptCount: 1,
  lastError: null,
  providerMessageId: "dev-1",
  provider: "dev-outbox",
  queuedAt: { seconds: 1000, nanoseconds: 0 },
  sentAt: { seconds: 1001, nanoseconds: 0 },
  failedAt: null,
  createdAt: { seconds: 999, nanoseconds: 0 },
  updatedAt: { seconds: 1001, nanoseconds: 0 },
};

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

function makeMessageContext(messageId: string) {
  return { params: Promise.resolve({ eventId: EVENT_ID, messageId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
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
  listAdminEmailMessagesForEvent.mockResolvedValue([]);
  countAdminEmailMessagesForEvent.mockResolvedValue(0);
});

describe("GET emails/messages", () => {
  it("rejects combining status and kind filters (400) — the DAL's own throw stays unreachable", async () => {
    const response = await GET(
      new Request(`http://localhost/x?status=sent&kind=confirmation-paid`),
      makeContext(),
    );
    expect(response.status).toBe(400);
    expect(listAdminEmailMessagesForEvent).not.toHaveBeenCalled();
  });

  it("empty log: count 0, no rows, no cursor (spec §5 AC-1 empty state contract)", async () => {
    const response = await GET(
      new Request("http://localhost/x"),
      makeContext(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ messages: [], count: 0, nextCursor: null });
  });

  it("returns a nextCursor only when the page is FULL (limit reached)", async () => {
    listAdminEmailMessagesForEvent.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        ...MESSAGE,
        id: `msg-${index}`,
        createdAt: { seconds: 1000 + index, nanoseconds: 0 },
      })),
    );
    countAdminEmailMessagesForEvent.mockResolvedValue(120);

    const response = await GET(
      new Request("http://localhost/x"),
      makeContext(),
    );
    const body = await response.json();
    expect(body.messages).toHaveLength(50);
    expect(body.nextCursor).not.toBeNull();
  });

  it("400 on an invalid status value", async () => {
    const response = await GET(
      new Request("http://localhost/x?status=bogus"),
      makeContext(),
    );
    expect(response.status).toBe(400);
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await GET(
      new Request("http://localhost/x"),
      makeContext(),
    );
    expect(response.status).toBe(403);
  });

  it("404 cross-org — the log never renders another org's rows", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await GET(
      new Request("http://localhost/x"),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(listAdminEmailMessagesForEvent).not.toHaveBeenCalled();
  });
});

describe("POST messages/[messageId]/retry", () => {
  it("NOT_RETRYABLE (already sent) -> 409, no duplicate-send appearance", async () => {
    retryEmailMessage.mockResolvedValue({
      ok: false,
      outcome: "not-retryable",
      status: "sent",
    });

    const response = await RETRY(
      new Request("http://localhost/x", { method: "POST" }),
      makeMessageContext(MESSAGE_ID),
    );

    expect(response.status).toBe(409);
    expect(getAdminEmailMessageForEvent).not.toHaveBeenCalled();
  });

  it("NOT_FOUND (missing OR cross-org) -> 404", async () => {
    retryEmailMessage.mockResolvedValue({ ok: false, outcome: "not-found" });

    const response = await RETRY(
      new Request("http://localhost/x", { method: "POST" }),
      makeMessageContext(MESSAGE_ID),
    );

    expect(response.status).toBe(404);
  });

  it("a successful retry re-fetches and returns the frozen row", async () => {
    retryEmailMessage.mockResolvedValue({
      ok: true,
      outcome: "sent",
      messageId: MESSAGE_ID,
      providerMessageId: "dev-2",
    });
    getAdminEmailMessageForEvent.mockResolvedValue(MESSAGE);

    const response = await RETRY(
      new Request("http://localhost/x", { method: "POST" }),
      makeMessageContext(MESSAGE_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message.status).toBe("sent");
  });

  it("a re-attempt that fails again still returns the row (not an HTTP error)", async () => {
    retryEmailMessage.mockResolvedValue({
      ok: false,
      outcome: "failed",
      messageId: MESSAGE_ID,
      reason: "transport down",
    });
    getAdminEmailMessageForEvent.mockResolvedValue({
      ...MESSAGE,
      status: "failed",
    });

    const response = await RETRY(
      new Request("http://localhost/x", { method: "POST" }),
      makeMessageContext(MESSAGE_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message.status).toBe("failed");
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await RETRY(
      new Request("http://localhost/x", { method: "POST" }),
      makeMessageContext(MESSAGE_ID),
    );
    expect(response.status).toBe(403);
    expect(retryEmailMessage).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await RETRY(
      new Request("http://localhost/x", { method: "POST" }),
      makeMessageContext(MESSAGE_ID),
    );
    expect(response.status).toBe(404);
    expect(retryEmailMessage).not.toHaveBeenCalled();
  });
});
