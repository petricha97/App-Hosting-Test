// @vitest-environment node
/**
 * M6-T3 — POST /api/dashboard/events/[eventId]/drafts/email-all
 * Spec §7: bulk-sends abandoned-reminder to every currently-visible
 * (isAbandoned) draft, sharing the automatic 24h trigger's dedupe scheme
 * (dedupeKey = draftId). Full-mock unit test (DAL mocked at the boundary) —
 * the dedupe/idempotency behavior itself is proven against the REAL DAL in
 * email-all-route-dedupe.test.ts.
 *
 * Locks:
 *  - refuses (409, typed) when abandoned-reminder is disabled — zero calls
 *    to sendEventEmailBatch;
 *  - 404s an unknown/never-materialized kind (defensive; unreachable in
 *    practice since the kind is a fixed system catalog entry);
 *  - blank-email drafts are filtered OUT of the batch call (never sent to
 *    sendEventEmailBatch, which is all-or-nothing on invalid recipients);
 *  - a malformed (but non-blank) draft email is pre-split out via
 *    emailRecipientSchema BEFORE the batch call — same per-candidate
 *    isolation as paged-trigger-runner.ts's periodic sends — so it never
 *    blocks the rest of the batch and is never echoed back raw in the
 *    response (Security L-3, agents/docs/security/m6-lifecycle-triggers.md);
 *  - the response tallies sent vs already-emailed (duplicate) vs failed
 *    from sendEventEmailBatch's per-recipient results;
 *  - route permission matrix: 403 without write:events, 404 cross-org;
 *  - rate-limited (10/min/user/event, same posture as test-send).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  getAdminEmailDefinitionByKind,
  getAdminRegistrationDraftsForEvent,
  sendEventEmailBatch,
  resolveEmailBlockRenderContext,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminEmailDefinitionByKind: vi.fn(),
  getAdminRegistrationDraftsForEvent: vi.fn(),
  sendEventEmailBatch: vi.fn(),
  resolveEmailBlockRenderContext: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminEmailDefinition", () => ({
  getAdminEmailDefinitionByKind,
}));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  getAdminRegistrationDraftsForEvent,
}));
vi.mock("@/lib/email/send-service", () => ({ sendEventEmailBatch }));
// M6-T4 B-1: mocked at its own module boundary (covered directly by
// email-block-render-context.test.ts, plus a pass-through assertion below).
vi.mock("@/features/emails/server/resolve-block-context", () => ({
  resolveEmailBlockRenderContext,
}));

import { resetRateLimits } from "@/lib/rate-limit";

import { POST } from "@/app/api/dashboard/events/[eventId]/drafts/email-all/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    isAbandoned: true,
    ...overrides,
  };
}

function makeRequest() {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/drafts/email-all`,
    { method: "POST" },
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
  getAdminEmailDefinitionByKind.mockResolvedValue(null); // virtual default, enabled:true
  resolveEmailBlockRenderContext.mockResolvedValue({});
  getAdminRegistrationDraftsForEvent.mockResolvedValue([draft()]);
  sendEventEmailBatch.mockResolvedValue({
    ok: true,
    enqueued: 1,
    results: [
      { email: "ada@example.com", ok: true, outcome: "sent", messageId: "m1" },
    ],
  });
});

describe("POST email-all — happy path", () => {
  it("sends abandoned-reminder to every visible abandoned draft and tallies the result", async () => {
    getAdminRegistrationDraftsForEvent.mockResolvedValue([
      draft({ id: "d1" }),
      draft({ id: "d2" }),
    ]);
    sendEventEmailBatch.mockResolvedValue({
      ok: true,
      enqueued: 2,
      results: [
        {
          email: "ada@example.com",
          ok: true,
          outcome: "sent",
          messageId: "m1",
        },
        {
          email: "ada@example.com",
          ok: true,
          outcome: "duplicate",
          messageId: "m2",
          status: "sent",
        },
      ],
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      total: 2,
      attempted: 2,
      sent: 1,
      alreadyEmailed: 1,
      failed: 0,
      skippedNoEmail: 0,
    });

    expect(sendEventEmailBatch).toHaveBeenCalledTimes(1);
    const input = sendEventEmailBatch.mock.calls[0][0];
    expect(input.kind).toBe("abandoned-reminder");
    expect(input.recipients).toHaveLength(2);
    expect(input.recipients[0].dedupeKey).toBe("d1");
    expect(input.recipients[1].dedupeKey).toBe("d2");
  });

  it("filters out drafts with a blank email before calling the batch (never sent, never blocks the others)", async () => {
    getAdminRegistrationDraftsForEvent.mockResolvedValue([
      draft({ id: "d1", email: "ada@example.com" }),
      draft({ id: "d2", email: "" }),
    ]);
    sendEventEmailBatch.mockResolvedValue({
      ok: true,
      enqueued: 1,
      results: [
        {
          email: "ada@example.com",
          ok: true,
          outcome: "sent",
          messageId: "m1",
        },
      ],
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    const input = sendEventEmailBatch.mock.calls[0][0];
    expect(input.recipients).toHaveLength(1);
    expect(input.recipients[0].dedupeKey).toBe("d1");

    await expect(response.json()).resolves.toMatchObject({
      total: 2,
      attempted: 1,
      skippedNoEmail: 1,
    });
  });

  it("a single malformed-email draft is pre-split out and does NOT block the rest of the batch (Security L-3)", async () => {
    getAdminRegistrationDraftsForEvent.mockResolvedValue([
      draft({ id: "d1", email: "ada@example.com" }),
      // Fails emailRecipientSchema's .email() check — clears the looser
      // form-field regex but not the stricter send-time schema (the exact
      // divergence the security review reasoned through).
      draft({ id: "d2", email: "not-an-email" }),
      draft({ id: "d3", email: "grace@example.com" }),
    ]);
    sendEventEmailBatch.mockResolvedValue({
      ok: true,
      enqueued: 2,
      results: [
        {
          email: "ada@example.com",
          ok: true,
          outcome: "sent",
          messageId: "m1",
        },
        {
          email: "grace@example.com",
          ok: true,
          outcome: "sent",
          messageId: "m2",
        },
      ],
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);

    // The invalid draft is never handed to sendEventEmailBatch — only the
    // two valid recipients are, so it cannot poison the whole call.
    expect(sendEventEmailBatch).toHaveBeenCalledTimes(1);
    const input = sendEventEmailBatch.mock.calls[0][0];
    expect(input.recipients).toHaveLength(2);
    expect(
      input.recipients.map((entry: { dedupeKey: string }) => entry.dedupeKey),
    ).toEqual(["d1", "d3"]);

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      total: 3,
      attempted: 2,
      sent: 2,
      skippedInvalidEmail: 1,
    });
    // No raw email address anywhere in the response body (Security L-3).
    expect(JSON.stringify(body)).not.toContain("not-an-email");
    expect(JSON.stringify(body)).not.toContain("@example.com");
  });

  it("zero abandoned drafts is a calm no-op success (never calls the batch with an empty array unnecessarily, but tolerates it)", async () => {
    getAdminRegistrationDraftsForEvent.mockResolvedValue([]);
    sendEventEmailBatch.mockResolvedValue({
      ok: true,
      enqueued: 0,
      results: [],
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 0,
      attempted: 0,
      sent: 0,
    });
  });
});

describe("POST email-all — M6-T4 B-1: live block-render context reaches the rendered HTML", () => {
  it("resolves the block context ONCE for the whole batch (snapshot, spec §1 AC-9) and a TicketPricingTable block renders REAL prices, not the empty-state message", async () => {
    getAdminRegistrationDraftsForEvent.mockResolvedValue([
      draft({ id: "d1" }),
      draft({ id: "d2" }),
    ]);
    resolveEmailBlockRenderContext.mockResolvedValue({
      pricing: {
        currencies: ["USD"],
        tickets: [
          {
            name: "General Admission",
            code: "GA",
            soldOut: false,
            audienceNames: [],
            prices: [{ currency: "USD", minPriceMinor: 5000, isFrom: false }],
          },
        ],
      },
    });
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "def-1",
      kind: "abandoned-reminder",
      subject: "s",
      body: "b",
      enabled: true,
      isSystem: true,
      bodyMode: "blocks",
      bodyBlocks: [
        { id: "tp-1", type: "TicketPricingTable", props: { title: "Tickets" } },
      ],
    });
    sendEventEmailBatch.mockResolvedValue({
      ok: true,
      enqueued: 2,
      results: [
        {
          email: "ada@example.com",
          ok: true,
          outcome: "sent",
          messageId: "m1",
        },
        {
          email: "ada@example.com",
          ok: true,
          outcome: "sent",
          messageId: "m2",
        },
      ],
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);

    expect(resolveEmailBlockRenderContext).toHaveBeenCalledTimes(1);
    expect(resolveEmailBlockRenderContext).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    const input = sendEventEmailBatch.mock.calls[0][0];
    expect(input.template.bodyHtml).toContain("General Admission");
    expect(input.template.bodyHtml).toContain("$50.00");
    expect(input.template.bodyHtml).not.toContain(
      "Tickets will be announced soon.",
    );
  });
});

describe("POST email-all — disabled definition refusal (spec §7)", () => {
  it("refuses with a typed 409 and never calls sendEventEmailBatch", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "def-1",
      kind: "abandoned-reminder",
      subject: "s",
      body: "b",
      enabled: false,
      isSystem: true,
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(409);
    expect(sendEventEmailBatch).not.toHaveBeenCalled();
  });
});

describe("POST email-all — permission matrix (spec §9)", () => {
  it("403 without write:events", async () => {
    getAdminUserByEmail.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [{ organizationId: ORG_ID, role: "member" }],
      permissions: [],
    });
    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(403);
    expect(sendEventEmailBatch).not.toHaveBeenCalled();
  });

  it("404 cross-org/unknown event", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);
    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(404);
    expect(sendEventEmailBatch).not.toHaveBeenCalled();
  });
});

describe("POST email-all — rate limit", () => {
  it("rate-limits at 10/min/user/event (the 11th call in a minute -> 429)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await POST(makeRequest(), makeContext());
      expect(response.status).toBe(200);
    }
    const eleventh = await POST(makeRequest(), makeContext());
    expect(eleventh.status).toBe(429);
    expect(sendEventEmailBatch).toHaveBeenCalledTimes(10);
  });
});
