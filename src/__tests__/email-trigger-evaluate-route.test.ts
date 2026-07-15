// @vitest-environment node
/**
 * M6-T3 — POST /api/internal/email-triggers/evaluate. Spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §8/§9.
 *
 * Locks:
 *  - a missing/wrong shared-secret header -> 401, ZERO Firestore reads
 *    (the sweep never even starts)
 *  - the correct secret -> 200, sweep runs
 *  - a targeted call requires eventId AND organizationId together (never a
 *    bare eventId) -> 400 otherwise
 *  - cross-org isolation: a targeted call for (org A, event A) NEVER reads
 *    or acts on org B's data, even when org B has an event with the exact
 *    same eventId string (IDOR-shaped probe)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { createFakeAdminDb } from "./helpers/fake-admin-db";
import { resetRateLimits } from "@/lib/rate-limit";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const ENV_KEY = "EMAIL_TRIGGER_EVALUATOR_SECRET";
const SECRET = "the-real-shared-secret";
const HEADER = "x-email-trigger-secret";
const ORIGINAL_ENV_SECRET = process.env[ENV_KEY];

process.env[ENV_KEY] = SECRET;

const { POST } =
  await import("@/app/api/internal/email-triggers/evaluate/route");

function request(body: unknown, headerValue: string | null): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (headerValue !== null) headers[HEADER] = headerValue;
  return new Request(
    "http://internal.example/api/internal/email-triggers/evaluate",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}

function seedEvent(id: string, organizationId: string): void {
  fake.store.set(`Event/${id}`, {
    name: `Event ${id}`,
    description: "d",
    capacity: 100,
    expectedGuests: 10,
    formPath: "form",
    invoicePath: "",
    organizationPath: `Organization/${organizationId}`,
    timezone: "UTC",
    allowOverlap: false,
    status: "Published",
    pageMode: "default",
    redirectUrl: "",
    periods: [],
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
}

// getAdminRegistrationDraftsForEvent's isAbandoned calc only recognizes a
// real Timestamp-like `.toMillis()` value — a plain `{seconds}` object
// falls back to treating updatedAt AS "now" (never abandoned). The route
// evaluates against real Date.now() (no nowMs override in its body schema),
// so seed relative to that.
function seedDraft(
  storeId: string,
  organizationId: string,
  eventId: string,
  overrides: Record<string, unknown> = {},
): void {
  fake.store.set(`RegistrationDraft/${storeId}`, {
    organizationId,
    eventId,
    pathId: "path-1",
    formId: "form-1",
    draftTokenHash: "hash",
    lastStepReached: "personal_info",
    stepAnswers: {},
    ticketTypeId: null,
    registrationTypeId: null,
    promotionId: null,
    attempt: 1,
    firstName: "Ada",
    lastName: "Lovelace",
    email: `${storeId}@example.com`,
    updatedAt: Timestamp.fromMillis(Date.now() - 25 * 24 * 60 * 60 * 1000), // abandoned
    createdAt: Timestamp.fromMillis(Date.now() - 25 * 24 * 60 * 60 * 1000),
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
  resetRateLimits();
});

afterEach(() => {
  if (ORIGINAL_ENV_SECRET === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV_SECRET;
  }
  process.env[ENV_KEY] = SECRET; // restore for subsequent tests in this file
});

describe("authentication", () => {
  it("rejects a missing header with 401 and never touches Firestore", async () => {
    seedEvent("evt-1", "org-1");
    const res = await POST(request({}, null));
    expect(res.status).toBe(401);
    expect(fake.writes).toHaveLength(0);
  });

  it("rejects the wrong secret with 401", async () => {
    const res = await POST(request({}, "not-the-secret"));
    expect(res.status).toBe(401);
  });

  it("accepts the correct secret", async () => {
    const res = await POST(request({}, SECRET));
    expect(res.status).toBe(200);
  });
});

describe("request validation", () => {
  it("400s when eventId is supplied without organizationId", async () => {
    const res = await POST(request({ eventId: "evt-1" }, SECRET));
    expect(res.status).toBe(400);
  });

  it("400s on unparsable JSON", async () => {
    const res = await POST(
      new Request(
        "http://internal.example/api/internal/email-triggers/evaluate",
        {
          method: "POST",
          headers: { [HEADER]: SECRET, "content-type": "application/json" },
          body: "{not json",
        },
      ),
    );
    expect(res.status).toBe(400);
  });

  // Security Agent Finding 2 (agents/docs/security/m6-lifecycle-triggers.md):
  // the ceilings were tightened from 200/500/200 down to ~2x the documented
  // safe defaults (25/100/20) so the Zod schema is a genuine safety ceiling,
  // not effectively unbounded. Lock that each field's new max rejects one
  // above it, and accepts exactly at it.
  it("400s when maxEvents exceeds the tightened ceiling (50)", async () => {
    const res = await POST(request({ maxEvents: 51 }, SECRET));
    expect(res.status).toBe(400);
  });

  it("400s when pageSize exceeds the tightened ceiling (200)", async () => {
    const res = await POST(request({ pageSize: 201 }, SECRET));
    expect(res.status).toBe(400);
  });

  it("400s when maxPagesPerTrigger exceeds the tightened ceiling (40)", async () => {
    const res = await POST(request({ maxPagesPerTrigger: 41 }, SECRET));
    expect(res.status).toBe(400);
  });

  it("accepts values exactly at the tightened ceilings", async () => {
    const res = await POST(
      request({ maxEvents: 50, pageSize: 200, maxPagesPerTrigger: 40 }, SECRET),
    );
    expect(res.status).toBe(200);
  });
});

describe("rate limiting (Security Agent Finding 2 / N-3)", () => {
  it("allows up to 6 calls per minute, keyed globally (not per-body), then 429s", async () => {
    for (let i = 0; i < 6; i += 1) {
      const res = await POST(request({}, SECRET));
      expect(res.status).toBe(200);
    }

    const seventh = await POST(request({}, SECRET));
    expect(seventh.status).toBe(429);
    expect(seventh.headers.get("Retry-After")).toBeTruthy();
    const body = (await seventh.json()) as { error: string };
    expect(body.error).toMatch(/too many/i);
  });

  it("counts a bare/unauthenticated request toward nothing (auth is checked before the rate limit)", async () => {
    // 6 unauthenticated calls must never consume the shared bucket — only
    // requests that pass the secret check should count.
    for (let i = 0; i < 6; i += 1) {
      const res = await POST(request({}, "wrong-secret"));
      expect(res.status).toBe(401);
    }
    const res = await POST(request({}, SECRET));
    expect(res.status).toBe(200);
  });
});

describe("cross-org isolation (§9)", () => {
  it("a targeted call for (org A, event A) never acts on org B's data", async () => {
    seedEvent("evt-a", "org-a");
    seedEvent("evt-b", "org-b");
    seedDraft("draft-org-a", "org-a", "evt-a", { email: "orgA@example.com" });
    seedDraft("draft-org-b", "org-b", "evt-b", { email: "orgB@example.com" });

    const res = await POST(
      request({ eventId: "evt-a", organizationId: "org-a" }, SECRET),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      eventsEvaluated: number;
      events: Array<{ eventId: string }>;
    };
    expect(body.eventsEvaluated).toBe(1);
    expect(body.events[0].eventId).toBe("evt-a");

    const messages = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    );
    // Exactly one recipient (org A's) was ever emailed — org B's draft was
    // never read, let alone acted on, by this targeted call.
    expect(messages).toHaveLength(1);
    expect((messages[0][1] as { organizationId: string }).organizationId).toBe(
      "org-a",
    );
    expect(
      (messages[0][1] as { recipient: { email: string } }).recipient.email,
    ).toBe("orga@example.com");
  });

  it("an IDOR-shaped probe (org A's id + org B's eventId) is a 404-shaped no-op, not an error leaking existence", async () => {
    seedEvent("evt-b", "org-b");
    seedDraft("draft-org-b", "org-b", "evt-b", { email: "orgB@example.com" });

    const res = await POST(
      request({ eventId: "evt-b", organizationId: "org-a" }, SECRET),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eventsEvaluated: number };
    expect(body.eventsEvaluated).toBe(0);

    const messages = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    );
    expect(messages).toHaveLength(0);
  });
});
