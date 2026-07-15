// @vitest-environment node
/**
 * M6-T3 — the six §6 audience segment queries
 * (src/lib/email/lifecycle/audience-queries.ts). Spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §6.
 *
 * Locks:
 *  - `all-invitees` is a documented no-op — zero candidates, zero query
 *  - `abandoned` only returns isAbandoned drafts with a non-empty email
 *  - `pending-approval` matches status IN [new, pending, reviewed] only
 *  - `accepted-all` matches Attendee.status === "accepted" only
 *  - `accepted-paid` / `accepted-invoice` enforce the TWO-CONDITION
 *    eligibility: Attendee.status === "accepted" AND the linked Order's
 *    paymentStatus — an outstanding order with NO Attendee (not yet
 *    accepted) contributes ZERO candidates, even though the order matches
 *    on paymentStatus alone
 *  - every query is bounded + cursor-paginated (never a full read)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { createFakeAdminDb } from "./helpers/fake-admin-db";
import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { queryAudiencePage } =
  await import("@/lib/email/lifecycle/audience-queries");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// getAdminRegistrationDraftsForEvent's isAbandoned calc only recognizes a
// real Timestamp-like `.toMillis()` value (a plain `{seconds}` object falls
// back to "now", never abandoned) — always seed via Timestamp.fromMillis.
function seedDraft(id: string, overrides: Record<string, unknown> = {}): void {
  fake.store.set(`RegistrationDraft/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
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
    email: "ada@example.com",
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

function seedFormData(
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  fake.store.set(`FormData/${id}`, {
    formId: "form-1",
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    submission: {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
    },
    submittedAt: { seconds: 1 },
    status: "new",
    orderId: null,
    pathId: "path-1",
    ticketLabel: null,
    ...overrides,
  });
}

function seedAttendee(
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  fake.store.set(`Attendee/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: `sub-${id}`,
    orderId: null,
    pathId: "path-1",
    firstName: "Alan",
    lastName: "Turing",
    email: "alan@example.com",
    company: "Bletchley",
    jobTitle: "Cryptanalyst",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tt-1",
    ticketLabel: "General",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "hash",
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

// getAdminAttendeeBySubmissionId does a DIRECT DOC GET at the deterministic
// id derived from submissionId — an attendee seeded under an arbitrary key
// (fine for the query-based accepted-all tests above) is invisible to the
// Order-first traversal. Used by the accepted-paid/accepted-invoice tests
// below, which resolve attendees exactly that way.
function seedAttendeeForSubmission(
  submissionId: string,
  overrides: Record<string, unknown> = {},
): string {
  const id = attendeeIdFromSubmissionId({
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId,
  });
  fake.store.set(`Attendee/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId,
    orderId: null,
    pathId: "path-1",
    firstName: "Alan",
    lastName: "Turing",
    email: "alan@example.com",
    company: "Bletchley",
    jobTitle: "Cryptanalyst",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tt-1",
    ticketLabel: "General",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "hash",
    createdAt: Timestamp.fromMillis(1),
    updatedAt: Timestamp.fromMillis(1),
    ...overrides,
  });
  return id;
}

function seedOrder(id: string, overrides: Record<string, unknown> = {}): void {
  fake.store.set(`Order/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: `sub-${id}`,
    ticketTypeId: "tt-1",
    registrationTypeId: "rt-1",
    feeId: "fee-1",
    promotionId: null,
    taxIds: [],
    currency: "USD",
    amounts: {
      subtotalMinor: 1000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1000,
    },
    snapshot: {
      feeName: "Fee",
      basePriceMinor: 1000,
      promoCode: null,
      discountType: null,
      discountValue: null,
      taxLines: [],
    },
    paymentMethod: "invoice",
    paymentStatus: "outstanding",
    paymentProvider: "simulated",
    providerPaymentId: null,
    idempotencyKey: id,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("all-invitees", () => {
  it("is a documented no-op: zero candidates, zero query", async () => {
    seedAttendee("a-1"); // proves the audience truly never queries anything
    const page = await queryAudiencePage({
      audience: "all-invitees",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 10,
      startAfterMs: null,
      nowMs: NOW_MS,
    });
    expect(page).toEqual({
      candidates: [],
      nextCursorMs: null,
      hasMore: false,
    });
  });
});

describe("abandoned", () => {
  it("only returns isAbandoned drafts — never a fresh (not-yet-24h) draft", async () => {
    seedDraft("d-abandoned", {
      email: "abandoned@example.com",
      updatedAt: Timestamp.fromMillis(NOW_MS - 25 * DAY_MS),
    });
    seedDraft("d-fresh", {
      email: "fresh@example.com",
      updatedAt: Timestamp.fromMillis(NOW_MS),
    });

    const page = await queryAudiencePage({
      audience: "abandoned",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 10,
      startAfterMs: null,
      nowMs: NOW_MS,
    });

    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0]).toMatchObject({
      recipientKey: "d-abandoned",
      recipient: { email: "abandoned@example.com" },
    });
  });

  it("passes an empty-email abandoned draft through as a candidate — the RUNNER layer rejects it (spec §3: safety net, not a hard query precondition)", async () => {
    seedDraft("d-no-email", {
      email: "",
      updatedAt: Timestamp.fromMillis(NOW_MS - 25 * DAY_MS),
    });

    const page = await queryAudiencePage({
      audience: "abandoned",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 10,
      startAfterMs: null,
      nowMs: NOW_MS,
    });

    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0].recipient.email).toBe("");
  });
});

describe("pending-approval", () => {
  it("matches status IN [new, pending, reviewed] only — never accepted", async () => {
    seedFormData("f-new", { status: "new" });
    seedFormData("f-pending", { status: "pending" });
    seedFormData("f-reviewed", { status: "reviewed" });
    seedFormData("f-accepted", { status: "accepted" });

    const page = await queryAudiencePage({
      audience: "pending-approval",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 10,
      startAfterMs: null,
      nowMs: NOW_MS,
    });

    expect(page.candidates.map((c) => c.recipientKey).sort()).toEqual([
      "f-new",
      "f-pending",
      "f-reviewed",
    ]);
  });
});

describe("accepted-all", () => {
  it("matches Attendee.status === accepted only, no Order join", async () => {
    seedAttendee("a-accepted", { status: "accepted" });
    seedAttendee("a-cancelled", { status: "cancelled" });

    const page = await queryAudiencePage({
      audience: "accepted-all",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 10,
      startAfterMs: null,
      nowMs: NOW_MS,
    });

    expect(page.candidates.map((c) => c.recipientKey)).toEqual(["a-accepted"]);
  });
});

describe("accepted-paid / accepted-invoice — two-condition eligibility", () => {
  it("accepted-invoice requires BOTH accepted Attendee AND outstanding Order", async () => {
    // Eligible: outstanding order + accepted attendee.
    seedOrder("o-eligible", { paymentStatus: "outstanding" });
    const eligibleAttendeeId = seedAttendeeForSubmission("sub-o-eligible", {
      status: "accepted",
    });

    // Outstanding order but the submission was never accepted (no Attendee
    // at all) — spec §4 AC-3: must contribute ZERO candidates.
    seedOrder("o-not-accepted", { paymentStatus: "outstanding" });

    // Outstanding order whose Attendee exists but is cancelled.
    seedOrder("o-cancelled", { paymentStatus: "outstanding" });
    seedAttendeeForSubmission("sub-o-cancelled", { status: "cancelled" });

    // Paid order — must never show up in accepted-invoice.
    seedOrder("o-paid", { paymentStatus: "paid" });
    seedAttendeeForSubmission("sub-o-paid", { status: "accepted" });

    const page = await queryAudiencePage({
      audience: "accepted-invoice",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 10,
      startAfterMs: null,
      nowMs: NOW_MS,
    });

    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0].recipientKey).toBe(eligibleAttendeeId);
    expect(page.candidates[0].orderId).toBe("o-eligible");
    expect(page.candidates[0].orderCreatedAtMs).not.toBeNull();
  });

  it("accepted-paid matches paid AND comped, never outstanding", async () => {
    seedOrder("o-paid", { paymentStatus: "paid" });
    const paidId = seedAttendeeForSubmission("sub-o-paid", {
      status: "accepted",
    });
    seedOrder("o-comped", { paymentStatus: "comped" });
    const compedId = seedAttendeeForSubmission("sub-o-comped", {
      status: "accepted",
    });
    seedOrder("o-outstanding", { paymentStatus: "outstanding" });
    seedAttendeeForSubmission("sub-o-outstanding", { status: "accepted" });

    const page = await queryAudiencePage({
      audience: "accepted-paid",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 10,
      startAfterMs: null,
      nowMs: NOW_MS,
    });

    expect(page.candidates.map((c) => c.recipientKey).sort()).toEqual(
      [compedId, paidId].sort(),
    );
  });
});

describe("pagination", () => {
  it("accepted-all pages via a cursor, never returning more than `limit`", async () => {
    for (let i = 0; i < 5; i += 1) {
      seedAttendee(`a-${i}`, { status: "accepted", createdAt: { seconds: i } });
    }

    const firstPage = await queryAudiencePage({
      audience: "accepted-all",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 2,
      startAfterMs: null,
      nowMs: NOW_MS,
    });
    expect(firstPage.candidates).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursorMs).not.toBeNull();

    const secondPage = await queryAudiencePage({
      audience: "accepted-all",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 2,
      startAfterMs: firstPage.nextCursorMs,
      nowMs: NOW_MS,
    });
    expect(secondPage.candidates).toHaveLength(2);

    const thirdPage = await queryAudiencePage({
      audience: "accepted-all",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 2,
      startAfterMs: secondPage.nextCursorMs,
      nowMs: NOW_MS,
    });
    expect(thirdPage.candidates).toHaveLength(1);
    expect(thirdPage.hasMore).toBe(false);

    const seen = [
      ...firstPage.candidates,
      ...secondPage.candidates,
      ...thirdPage.candidates,
    ]
      .map((c) => c.recipientKey)
      .sort();
    expect(seen).toEqual(["a-0", "a-1", "a-2", "a-3", "a-4"]);
  });
});
