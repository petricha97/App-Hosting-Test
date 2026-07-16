// @vitest-environment node
/**
 * M6-T2 — POST /api/dashboard/events/[eventId]/emails/test-send
 * Spec §5: "the one send affordance in T2" — kind:"test", a FRESH server-
 * minted dedupeKey per call (double-click => two rows, by design), disabled
 * definitions refused (§2 AC-5), rate limit 10/min/user/event.
 *
 * Locks:
 *  - every call mints its OWN dedupeKey -> sendEventEmail is invoked once
 *    per HTTP call with a DIFFERENT dedupeKey each time (§5 AC-5: "double-
 *    click creates one row per click only because each mints a new
 *    dedupeKey");
 *  - a disabled definition (enabled:false) is refused with a typed 409,
 *    sendEventEmail is never invoked;
 *  - unknown kind -> 404;
 *  - the 11th call within a minute for the same (user, event) -> 429.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminEmailDefinitionByKind,
  listAdminAttendeesForEvent,
  sendEventEmail,
  resolveEmailBlockRenderContext,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminEmailDefinitionByKind: vi.fn(),
  listAdminAttendeesForEvent: vi.fn(),
  sendEventEmail: vi.fn(),
  resolveEmailBlockRenderContext: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminEmailDefinition", () => ({
  getAdminEmailDefinitionByKind,
}));
vi.mock("@/lib/db/adminAttendee", () => ({ listAdminAttendeesForEvent }));
vi.mock("@/lib/email/send-service", () => ({ sendEventEmail }));
// M6-T4 B-1: mocked at its own module boundary (covered directly by
// email-block-render-context.test.ts, plus a pass-through assertion below).
vi.mock("@/features/emails/server/resolve-block-context", () => ({
  resolveEmailBlockRenderContext,
}));

import { resetRateLimits } from "@/lib/rate-limit";

import { POST } from "@/app/api/dashboard/events/[eventId]/emails/test-send/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};

function testSendRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/emails/test-send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
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
  listAdminAttendeesForEvent.mockResolvedValue([]);
  getAdminEmailDefinitionByKind.mockResolvedValue(null); // fall back to the virtual default
  resolveEmailBlockRenderContext.mockResolvedValue({});
  sendEventEmail.mockResolvedValue({
    ok: true,
    outcome: "sent",
    messageId: "msg-1",
    providerMessageId: "dev-1",
    renderReport: { usedTags: [], missingTags: [], unknownTags: [] },
  });
});

describe("POST test-send — M6-T4 B-1: live block-render context reaches the rendered HTML", () => {
  it("passes eventId/organizationId to resolveEmailBlockRenderContext and a RegistrationEmbed block renders the REAL open-state link, not the empty-state fallback", async () => {
    resolveEmailBlockRenderContext.mockResolvedValue({
      registrationCta: {
        state: "open",
        registerHref: "https://app.example.com/events/evt-1/register",
      },
    });
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "doc-1",
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      subject: "s",
      body: "b",
      enabled: true,
      isSystem: true,
      bodyMode: "blocks",
      bodyBlocks: [
        {
          id: "reg-1",
          type: "RegistrationEmbed",
          props: {
            title: "Register",
            body: "Join us",
            buttonLabel: "Register now",
          },
        },
      ],
    });

    await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );

    expect(resolveEmailBlockRenderContext).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    const call = sendEventEmail.mock.calls[0][0];
    expect(call.template.bodyHtml).toContain(
      "https://app.example.com/events/evt-1/register",
    );
    expect(call.template.bodyHtml).not.toContain(
      "Registration isn&#39;t set up on this page yet",
    );
  });
});

describe("POST test-send", () => {
  it("sends a test for a virtual default (confirmation-paid) with a fresh dedupeKey", async () => {
    const response = await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(sendEventEmail).toHaveBeenCalledTimes(1);
    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "test",
        recipient: { name: "Test recipient", email: "you@example.com" },
      }),
    );
  });

  it("double-click => two calls with DIFFERENT dedupeKeys (spec §5 AC-5)", async () => {
    await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );
    await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );

    expect(sendEventEmail).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = sendEventEmail.mock.calls;
    expect(firstCall[0].dedupeKey).not.toBe(secondCall[0].dedupeKey);
  });

  it("refuses a disabled definition (409), never calls sendEventEmail (spec §2 AC-5)", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "doc-1",
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      subject: "s",
      body: "b",
      enabled: false,
      isSystem: true,
    });

    const response = await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );

    expect(response.status).toBe(409);
    expect(sendEventEmail).not.toHaveBeenCalled();
  });

  it("404s an unknown kind", async () => {
    const response = await POST(
      testSendRequest({
        kind: "does-not-exist",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );

    expect(response.status).toBe(404);
    expect(sendEventEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient email (400)", async () => {
    const response = await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "not-an-email",
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(sendEventEmail).not.toHaveBeenCalled();
  });

  it("rate-limits at 10/min/user/event (the 11th call in a minute -> 429)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await POST(
        testSendRequest({
          kind: "confirmation-paid",
          recipientEmail: "you@example.com",
        }),
        makeContext(),
      );
      expect(response.status).toBe(200);
    }

    const eleventh = await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );
    expect(eleventh.status).toBe(429);
    expect(sendEventEmail).toHaveBeenCalledTimes(10);
  });

  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );
    expect(response.status).toBe(403);
    expect(sendEventEmail).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await POST(
      testSendRequest({
        kind: "confirmation-paid",
        recipientEmail: "you@example.com",
      }),
      makeContext(),
    );
    expect(response.status).toBe(404);
    expect(sendEventEmail).not.toHaveBeenCalled();
  });
});
