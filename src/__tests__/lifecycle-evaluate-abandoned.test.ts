// @vitest-environment node
/**
 * M6-T3 — §3 periodic trigger `abandoned-24h` (`abandoned-reminder`).
 * Spec: agents/docs/specs/m6-lifecycle-triggers.md §3.
 *
 * Locks:
 *  - dedupeKey = draftId — re-evaluating the same still-abandoned draft on
 *    every subsequent tick produces ZERO additional rows
 *  - the email is sent to the draft's FULL email, never a masked value
 *  - a draft with an empty email produces a typed rejection, zero row,
 *    zero crash, and the tick continues to the next candidate
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { evaluateAbandonedReminderTrigger } =
  await import("@/lib/email/lifecycle/evaluate-abandoned");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};
const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// getAdminRegistrationDraftsForEvent's isAbandoned calc only recognizes a
// real Timestamp-like `.toMillis()` value — always seed via
// Timestamp.fromMillis (a plain `{seconds}` object silently falls back to
// "now", never abandoned).
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
    email: "ada+full@dentsu.com",
    updatedAt: Timestamp.fromMillis(NOW_MS - 25 * DAY_MS),
    createdAt: Timestamp.fromMillis(NOW_MS - 25 * DAY_MS),
    ...overrides,
  });
}

function stubTransport() {
  return {
    send: vi.fn(async (_input: { to: { name: string; address: string } }) => ({
      status: "sent" as const,
      providerMessageId: "dev-1",
    })),
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    eventName: EVENT.name,
    event: EVENT,
    definitionId: "def-1",
    template: {
      subject: "Finish your registration",
      body: "Come back {first_name}",
    },
    nowMs: NOW_MS,
    pageSize: 100,
    maxPages: 20,
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
});

describe("evaluateAbandonedReminderTrigger", () => {
  it("dedupeKey = draftId: re-evaluating the same abandoned draft on later ticks sends zero more", async () => {
    seedDraft("draft-1");
    const transport = stubTransport();

    const first = await evaluateAbandonedReminderTrigger(
      baseInput({ transport }),
    );
    expect(first.enqueued).toBe(1);

    const second = await evaluateAbandonedReminderTrigger(
      baseInput({ transport }),
    );
    expect(second.enqueued).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1); // never re-sent

    const rows = [...fake.store.keys()].filter((k) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(1);
  });

  it("sends to the FULL email, never a masked display value", async () => {
    seedDraft("draft-1", { email: "distinctive.local.part@dentsu.com" });
    const transport = stubTransport();

    await evaluateAbandonedReminderTrigger(baseInput({ transport }));

    const [[sendCall]] = transport.send.mock.calls;
    expect(sendCall.to.address).toBe("distinctive.local.part@dentsu.com");
  });

  it("an empty email produces a typed rejection — zero row, zero crash, tick continues", async () => {
    seedDraft("draft-empty-email", { email: "" });
    seedDraft("draft-ok", { email: "ok@example.com" });
    const transport = stubTransport();

    const outcome = await evaluateAbandonedReminderTrigger(
      baseInput({ transport }),
    );

    expect(outcome.rejected).toBe(1);
    expect(outcome.enqueued).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("two distinct abandoned drafts each get their own row (dedupeKey is per-draft)", async () => {
    seedDraft("draft-a", { email: "a@example.com" });
    seedDraft("draft-b", { email: "b@example.com" });
    const transport = stubTransport();

    const outcome = await evaluateAbandonedReminderTrigger(
      baseInput({ transport }),
    );

    expect(outcome.enqueued).toBe(2);
  });

  it("a draft that has not yet crossed the abandoned threshold never fires", async () => {
    seedDraft("draft-fresh", { updatedAt: Timestamp.fromMillis(NOW_MS) });
    const transport = stubTransport();

    const outcome = await evaluateAbandonedReminderTrigger(
      baseInput({ transport }),
    );

    expect(outcome.enqueued).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
  });
});
