// @vitest-environment node
/**
 * M6-T1 — EmailMessage outbox DAL (src/lib/db/adminEmailMessage.ts).
 * Spec: agents/docs/specs/m6-email-infrastructure.md (§2 AC 1-8).
 *
 * Locks:
 *  - create-if-absent at the deterministic id: duplicate enqueues collapse
 *    onto EXACTLY ONE doc with zero extra writes
 *  - status machine: queued -> sent | failed; failed -> queued (explicit
 *    retry only); "sent" is terminal; invalid transitions are typed no-ops
 *    with ZERO writes
 *  - attemptCount counts COMPLETED attempts (incremented by sent/failed)
 *  - lastError is truncated (bounded, single-line)
 *  - the rendered snapshot (subject/bodyHtml/bodyText/from) is NEVER touched
 *    by any transition (audit parity with OrderSnapshot)
 *  - list/count: org-scoped in the query, bounded, newest-first, status/kind
 *    filters not combinable, cross-org rows never returned
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  EMAIL_LAST_ERROR_MAX_CHARS,
  EMAIL_MESSAGE_LIST_LIMIT,
  countAdminEmailMessagesForEvent,
  createAdminEmailMessageIfAbsent,
  getAdminEmailMessageForEvent,
  listAdminEmailMessagesForEvent,
  markAdminEmailMessageFailed,
  markAdminEmailMessageSent,
  retryFailedEmailMessage,
  truncateEmailError,
} = await import("@/lib/db/adminEmailMessage");
const { emailMessageId } = await import("@/lib/db/emailMessageId");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    definitionId: null,
    kind: "confirmation-paid",
    dedupeKey: "submission-1",
    recipient: { name: "Kenneth Cha", email: "kenneth@example.com" },
    attendeeId: "att-1",
    submissionId: "submission-1",
    from: { name: "Innovation Summit", address: "events@example.com" },
    replyTo: null,
    subject: "Your pass",
    bodyHtml: "<p>Dear Kenneth</p>",
    bodyText: "Dear Kenneth",
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
});

describe("createAdminEmailMessageIfAbsent — never double-send (AC-1)", () => {
  it("creates a queued doc at the deterministic id with the full snapshot", async () => {
    const result = await createAdminEmailMessageIfAbsent(baseInput());

    expect(result.created).toBe(true);
    expect(result.messageId).toBe(
      emailMessageId({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "confirmation-paid",
        recipientEmail: "kenneth@example.com",
        dedupeKey: "submission-1",
      }),
    );

    const stored = fake.store.get(`EmailMessage/${result.messageId}`)!;
    expect(stored).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      definitionId: null,
      kind: "confirmation-paid",
      dedupeKey: "submission-1",
      recipient: { name: "Kenneth Cha", email: "kenneth@example.com" },
      from: { name: "Innovation Summit", address: "events@example.com" },
      replyTo: null,
      subject: "Your pass",
      bodyHtml: "<p>Dear Kenneth</p>",
      bodyText: "Dear Kenneth",
      status: "queued",
      attemptCount: 0,
      lastError: null,
      providerMessageId: null,
      provider: "dev-outbox",
      sentAt: null,
      failedAt: null,
    });
  });

  it("collapses a duplicate enqueue onto the existing doc with ZERO writes", async () => {
    const first = await createAdminEmailMessageIfAbsent(baseInput());
    const writesAfterFirst = fake.writes.length;

    const second = await createAdminEmailMessageIfAbsent(baseInput());

    expect(second.created).toBe(false);
    expect(second.messageId).toBe(first.messageId);
    expect(fake.writes).toHaveLength(writesAfterFirst);
  });

  it("dedupes case-variant recipient emails and stores the lowercased form", async () => {
    const first = await createAdminEmailMessageIfAbsent(baseInput());
    const second = await createAdminEmailMessageIfAbsent(
      baseInput({
        recipient: { name: "Kenneth Cha", email: "Kenneth@EXAMPLE.com" },
      }),
    );

    expect(second.created).toBe(false);
    expect(second.messageId).toBe(first.messageId);
    expect(first.message.recipient.email).toBe("kenneth@example.com");
  });

  it("a new dedupeKey produces a second, separately-audited row (deliberate re-send)", async () => {
    const first = await createAdminEmailMessageIfAbsent(baseInput());
    const second = await createAdminEmailMessageIfAbsent(
      baseInput({ dedupeKey: "resend-2026-07-13" }),
    );

    expect(second.created).toBe(true);
    expect(second.messageId).not.toBe(first.messageId);
  });
});

describe("status transitions (AC-2/AC-3)", () => {
  it("markSent: queued -> sent with sentAt, providerMessageId, attemptCount 1", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());

    const result = await markAdminEmailMessageSent({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      providerMessageId: "dev-abc",
    });

    expect(result).toEqual({ ok: true });
    const stored = fake.store.get(`EmailMessage/${messageId}`)!;
    expect(stored).toMatchObject({
      status: "sent",
      providerMessageId: "dev-abc",
      attemptCount: 1,
    });
    expect(stored.sentAt).not.toBeNull();
  });

  it("markSent on an already-sent doc is a typed no-op with zero writes (sent is terminal)", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    await markAdminEmailMessageSent({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      providerMessageId: "dev-1",
    });
    const writesBefore = fake.writes.length;

    const result = await markAdminEmailMessageSent({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      providerMessageId: "dev-2",
    });

    expect(result).toEqual({
      ok: false,
      code: "INVALID_STATUS",
      status: "sent",
    });
    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.get(`EmailMessage/${messageId}`)!.providerMessageId).toBe(
      "dev-1",
    );
  });

  it("markFailed: queued -> failed with failedAt, truncated lastError, attemptCount 1", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    const longError = `boom\n${"x".repeat(2000)}`;

    const result = await markAdminEmailMessageFailed({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      errorMessage: longError,
    });

    expect(result).toEqual({ ok: true });
    const stored = fake.store.get(`EmailMessage/${messageId}`)!;
    const lastError = stored.lastError as { message: string };
    expect(stored).toMatchObject({ status: "failed", attemptCount: 1 });
    expect(stored.failedAt).not.toBeNull();
    expect(lastError.message.length).toBeLessThanOrEqual(
      EMAIL_LAST_ERROR_MAX_CHARS,
    );
    expect(lastError.message).not.toContain("\n");
  });

  it("markFailed on a sent doc is a typed no-op with zero writes", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    await markAdminEmailMessageSent({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      providerMessageId: "dev-1",
    });
    const writesBefore = fake.writes.length;

    const result = await markAdminEmailMessageFailed({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      errorMessage: "late failure",
    });

    expect(result).toEqual({
      ok: false,
      code: "INVALID_STATUS",
      status: "sent",
    });
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("markSent answers NOT_FOUND for missing AND cross-org/cross-event docs with ZERO writes (IDOR-safe)", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    const writesBefore = fake.writes.length;

    expect(
      await markAdminEmailMessageSent({
        messageId: "missing",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        providerMessageId: "dev-x",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await markAdminEmailMessageSent({
        messageId,
        eventId: EVENT_ID,
        organizationId: "org-other",
        providerMessageId: "dev-x",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await markAdminEmailMessageSent({
        messageId,
        eventId: "evt-other",
        organizationId: ORG_ID,
        providerMessageId: "dev-x",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.get(`EmailMessage/${messageId}`)!).toMatchObject({
      status: "queued",
      attemptCount: 0,
      providerMessageId: null,
    });
  });

  it("markFailed answers NOT_FOUND for missing AND cross-org/cross-event docs with ZERO writes (IDOR-safe)", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    const writesBefore = fake.writes.length;

    expect(
      await markAdminEmailMessageFailed({
        messageId: "missing",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        errorMessage: "boom",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await markAdminEmailMessageFailed({
        messageId,
        eventId: EVENT_ID,
        organizationId: "org-other",
        errorMessage: "boom",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await markAdminEmailMessageFailed({
        messageId,
        eventId: "evt-other",
        organizationId: ORG_ID,
        errorMessage: "boom",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.get(`EmailMessage/${messageId}`)!).toMatchObject({
      status: "queued",
      attemptCount: 0,
      lastError: null,
    });
  });

  it("transitions NEVER touch the rendered snapshot or resolved from (AC-8)", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    await markAdminEmailMessageFailed({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      errorMessage: "boom",
    });
    await retryFailedEmailMessage({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    await markAdminEmailMessageSent({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      providerMessageId: "dev-1",
    });

    const transitionWrites = fake.writes.filter((w) => w.type === "update");
    for (const write of transitionWrites) {
      expect(Object.keys(write.data ?? {})).not.toEqual(
        expect.arrayContaining(["subject", "bodyHtml", "bodyText", "from"]),
      );
    }

    const stored = fake.store.get(`EmailMessage/${messageId}`)!;
    expect(stored).toMatchObject({
      subject: "Your pass",
      bodyHtml: "<p>Dear Kenneth</p>",
      bodyText: "Dear Kenneth",
      from: { name: "Innovation Summit", address: "events@example.com" },
    });
  });

  it("truncateEmailError collapses whitespace and bounds the length", () => {
    expect(truncateEmailError("  a\r\n b\t c  ")).toBe("a b c");
    const truncated = truncateEmailError("y".repeat(5000));
    expect(truncated).toHaveLength(EMAIL_LAST_ERROR_MAX_CHARS);
    expect(truncated.endsWith("…")).toBe(true);
  });
});

describe("retryFailedEmailMessage — explicit failed -> queued only (AC-4)", () => {
  it("transitions a failed doc back to queued; a later attempt can land sent with attemptCount 2", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    await markAdminEmailMessageFailed({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      errorMessage: "boom",
    });

    const retry = await retryFailedEmailMessage({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(retry.ok).toBe(true);
    expect(fake.store.get(`EmailMessage/${messageId}`)!.status).toBe("queued");

    await markAdminEmailMessageSent({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      providerMessageId: "dev-2",
    });
    expect(fake.store.get(`EmailMessage/${messageId}`)!).toMatchObject({
      status: "sent",
      attemptCount: 2,
      providerMessageId: "dev-2",
    });
  });

  it("is a typed no-op with ZERO writes on a sent doc (terminal)", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    await markAdminEmailMessageSent({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      providerMessageId: "dev-1",
    });
    const writesBefore = fake.writes.length;

    const result = await retryFailedEmailMessage({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual({
      ok: false,
      code: "NOT_RETRYABLE",
      status: "sent",
    });
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("is a typed no-op on a doc that is already queued", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    const writesBefore = fake.writes.length;

    const result = await retryFailedEmailMessage({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual({
      ok: false,
      code: "NOT_RETRYABLE",
      status: "queued",
    });
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("answers NOT_FOUND for missing docs AND cross-org docs (IDOR-safe)", async () => {
    const { messageId } = await createAdminEmailMessageIfAbsent(baseInput());
    await markAdminEmailMessageFailed({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      errorMessage: "boom",
    });

    expect(
      await retryFailedEmailMessage({
        messageId: "nope",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    const writesBefore = fake.writes.length;
    expect(
      await retryFailedEmailMessage({
        messageId,
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.writes).toHaveLength(writesBefore);
  });
});

describe("reads — tenancy, bounds, filters (AC-5/AC-6)", () => {
  function seedMessage(
    id: string,
    overrides: Record<string, unknown> = {},
  ): void {
    fake.store.set(`EmailMessage/${id}`, {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      definitionId: null,
      kind: "confirmation-paid",
      dedupeKey: id,
      recipient: { name: "R", email: `${id}@example.com` },
      attendeeId: null,
      submissionId: null,
      from: { name: "Events", address: "events@example.com" },
      replyTo: null,
      subject: "s",
      bodyHtml: "<p>h</p>",
      bodyText: "t",
      status: "sent",
      attemptCount: 1,
      lastError: null,
      providerMessageId: `dev-${id}`,
      provider: "dev-outbox",
      queuedAt: { seconds: 1 },
      sentAt: { seconds: 2 },
      failedAt: null,
      createdAt: { seconds: 1 },
      updatedAt: { seconds: 2 },
      ...overrides,
    });
  }

  it("getAdminEmailMessageForEvent returns null for missing / cross-event / cross-org docs", async () => {
    seedMessage("m-1");

    expect(
      await getAdminEmailMessageForEvent({
        messageId: "m-1",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toMatchObject({ id: "m-1", subject: "s" });

    expect(
      await getAdminEmailMessageForEvent({
        messageId: "missing",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBeNull();
    expect(
      await getAdminEmailMessageForEvent({
        messageId: "m-1",
        eventId: "evt-other",
        organizationId: ORG_ID,
      }),
    ).toBeNull();
    expect(
      await getAdminEmailMessageForEvent({
        messageId: "m-1",
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toBeNull();
  });

  it("lists newest-first, bounded, with a createdAt cursor — never another org's rows", async () => {
    seedMessage("m-1", { createdAt: { seconds: 10 } });
    seedMessage("m-2", { createdAt: { seconds: 20 } });
    seedMessage("m-3", { createdAt: { seconds: 30 } });
    seedMessage("other-org", {
      organizationId: "org-other",
      createdAt: { seconds: 40 },
    });

    const page = await listAdminEmailMessagesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      limit: 2,
    });
    expect(page.map((m) => m.id)).toEqual(["m-3", "m-2"]);

    const next = await listAdminEmailMessagesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      startAfterCreatedAtMs: 20 * 1000,
    });
    expect(next.map((m) => m.id)).toEqual(["m-1"]);
    expect(EMAIL_MESSAGE_LIST_LIMIT).toBe(50);
  });

  it("filters by status OR kind — but never both (no composite index for that shape)", async () => {
    seedMessage("m-sent", { status: "sent", createdAt: { seconds: 10 } });
    seedMessage("m-failed", { status: "failed", createdAt: { seconds: 20 } });
    seedMessage("m-manual", { kind: "manual", createdAt: { seconds: 30 } });

    const failed = await listAdminEmailMessagesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      status: "failed",
    });
    expect(failed.map((m) => m.id)).toEqual(["m-failed"]);

    const manual = await listAdminEmailMessagesForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      kind: "manual",
    });
    expect(manual.map((m) => m.id)).toEqual(["m-manual"]);

    await expect(
      listAdminEmailMessagesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        status: "failed",
        kind: "manual",
      }),
    ).rejects.toThrow(/cannot be combined/);
  });

  it("counts via the aggregate with the same filters and org scoping", async () => {
    seedMessage("m-1", { status: "sent" });
    seedMessage("m-2", { status: "failed" });
    seedMessage("m-3", { status: "failed", kind: "manual" });
    seedMessage("other-org", { organizationId: "org-other" });

    expect(
      await countAdminEmailMessagesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBe(3);
    expect(
      await countAdminEmailMessagesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        status: "failed",
      }),
    ).toBe(2);
    expect(
      await countAdminEmailMessagesForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        kind: "manual",
      }),
    ).toBe(1);
    expect(
      await countAdminEmailMessagesForEvent({
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toBe(1);
  });
});
