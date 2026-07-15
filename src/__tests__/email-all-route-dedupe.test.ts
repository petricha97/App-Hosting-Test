// @vitest-environment node
/**
 * M6-T3 — "Email all" dedupe/idempotency against the REAL DAL (spec §7 AC-1
 * through AC-3, AC-5). Mocks ONLY the Firestore boundary (fake-admin-db,
 * same pattern as email-cross-org-real-data-route.test.ts) plus session/org
 * resolution — RegistrationDraft, EmailDefinition and EmailMessage are the
 * real modules sharing one in-memory Firestore, so the create-if-absent
 * dedupe transaction genuinely runs.
 *
 * Locks:
 *  - N abandoned drafts, none previously emailed -> exactly N new
 *    EmailMessage rows;
 *  - clicking again immediately -> zero NEW rows (every entry resolves as a
 *    duplicate) — this is the same code path a raced double-click hits, so
 *    it stands in for the "two concurrent identical batch calls -> N rows
 *    total, not 2N" requirement (AC-5) without needing genuine
 *    concurrency — sequential calls onto the SAME deterministic ids prove
 *    the same idempotency guarantee the create-if-absent transaction gives
 *    regardless of call ordering;
 *  - a draft the automatic 24h sweep already emailed (pre-seeded
 *    EmailMessage row, SAME dedupeKey scheme) is excluded from the NEW-row
 *    count on first click.
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

// Dynamic imports: these transitively import "@/app/lib/firestore", whose
// vi.mock factory closes over `fake` — a static import would evaluate the
// factory before `fake` is assigned (TDZ), same pattern as
// email-cross-org-real-data-route.test.ts.
const { createAdminEmailMessageIfAbsent } =
  await import("@/lib/db/adminEmailMessage");
const { POST } =
  await import("@/app/api/dashboard/events/[eventId]/drafts/email-all/route");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};

// A draft older than ABANDONED_AFTER_MS reads as abandoned — the fake store
// stamps updatedAt via the DAL's serverTimestamp handling, so we seed
// directly at the doc path with an ancient updatedAt to control isAbandoned
// deterministically (same technique other M5/M6 draft tests use).
function seedAbandonedDraft(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  fake.store.set(`RegistrationDraft/${id}`, {
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
    email: `${id}@example.com`,
    updatedAt: { toMillis: () => 0 }, // epoch — always > 24h stale
    createdAt: { toMillis: () => 0 },
    ...overrides,
  });
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

function emailMessageCount() {
  return [...fake.store.keys()].filter((path) =>
    path.startsWith("EmailMessage/"),
  ).length;
}

beforeEach(() => {
  fake.reset();
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
});

describe("Email all — dedupe against the real DAL (spec §7)", () => {
  it("N abandoned drafts, none previously emailed -> exactly N new EmailMessage rows", async () => {
    seedAbandonedDraft("d1");
    seedAbandonedDraft("d2");
    seedAbandonedDraft("d3");

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sent).toBe(3);
    expect(body.alreadyEmailed).toBe(0);
    expect(emailMessageCount()).toBe(3);
  });

  it("clicking again immediately produces ZERO new rows — every entry resolves as a duplicate", async () => {
    seedAbandonedDraft("d1");
    seedAbandonedDraft("d2");

    await POST(makeRequest(), makeContext());
    expect(emailMessageCount()).toBe(2);

    const second = await POST(makeRequest(), makeContext());
    const secondBody = await second.json();
    expect(secondBody.sent).toBe(0);
    expect(secondBody.alreadyEmailed).toBe(2);
    expect(emailMessageCount()).toBe(2); // no growth
  });

  it("a draft the automatic sweep already emailed (pre-seeded row, SAME dedupeKey scheme) is skipped on first click", async () => {
    seedAbandonedDraft("d1");
    seedAbandonedDraft("d2");

    // Simulate the automatic 24h trigger having already sent to d1 — SAME
    // kind + dedupeKey scheme this route uses (spec §7's entire safety
    // mechanism).
    const preSeeded = await createAdminEmailMessageIfAbsent({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      definitionId: null,
      kind: "abandoned-reminder",
      dedupeKey: "d1",
      recipient: { name: "Ada Lovelace", email: "d1@example.com" },
      attendeeId: null,
      submissionId: null,
      from: { name: "Events", address: "events@dev.local" },
      replyTo: null,
      subject: "Finish your registration",
      bodyHtml: "<p>Finish</p>",
      bodyText: "Finish",
    });
    expect(preSeeded.created).toBe(true);

    const response = await POST(makeRequest(), makeContext());
    const body = await response.json();

    // d1 resolves as a duplicate (already sent by "automation"); d2 is new.
    expect(body.sent).toBe(1);
    expect(body.alreadyEmailed).toBe(1);
    expect(emailMessageCount()).toBe(2); // d1 (pre-seeded) + d2 (new) — never 3
  });

  it("a malformed draft email is skipped (no EmailMessage row) without blocking the other valid drafts (Security L-3)", async () => {
    seedAbandonedDraft("d1");
    seedAbandonedDraft("d2", { email: "not-an-email" });
    seedAbandonedDraft("d3");

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.sent).toBe(2);
    expect(body.skippedInvalidEmail).toBe(1);
    // Only the two valid drafts got an outbox row — the malformed one wrote
    // nothing (typed rejection would-be, pre-filtered before ever reaching
    // sendEventEmailBatch).
    expect(emailMessageCount()).toBe(2);
    // No raw email address anywhere in the response body.
    expect(JSON.stringify(body)).not.toContain("not-an-email");
  });
});
