// @vitest-environment node
/**
 * M6-T1 — send service + transport selection (src/lib/email/send-service.ts,
 * src/lib/email/transport.ts).
 * Spec: agents/docs/specs/m6-email-infrastructure.md (§1 AC 1-4, §2 AC 1-3,
 * §6 edge cases 2-5).
 *
 * Locks:
 *  - EMAIL_TRANSPORT unset / "dev-outbox" -> row persisted + `sent` with a
 *    "dev-" provider id and NO network request
 *  - unknown EMAIL_TRANSPORT -> factory throws (fail closed); the created
 *    row lands `failed` with that reason; caller gets a typed failure
 *  - transport throw / failed result -> row `failed` with lastError, typed
 *    failure (never an unhandled exception)
 *  - duplicate logical send -> ONE doc, at most ONE transport call
 *  - validation failures (invalid recipient, oversized rendered content)
 *    are typed rejections with ZERO writes
 *  - empty batch -> { enqueued: 0 } no-op; batch is all-or-nothing on
 *    recipient validation; one bad entry never poisons the rest
 *  - sender identity: defaults with no doc (no doc created); corrupted
 *    stored doc -> row `failed`, never a malformed header
 *  - retryEmailMessage: failed -> queued -> re-attempt can land sent;
 *    sent/queued -> typed no-op
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { retryEmailMessage, sendEventEmail, sendEventEmailBatch } =
  await import("@/lib/email/send-service");
const { getEmailTransport } = await import("@/lib/email/transport");
const { EMAIL_SUBJECT_MAX_CHARS } = await import("@/lib/email/schemas");
import type { EmailTransport } from "@/lib/email/transport";

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function baseSend(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    eventName: "Innovation Summit",
    kind: "confirmation-paid",
    dedupeKey: "submission-1",
    recipient: { name: "Kenneth Cha", email: "kenneth@example.com" },
    template: {
      subject: "Your pass for {event_title}",
      bodyHtml: "<p>Dear {first_name}</p>",
      bodyText: "Dear {first_name}",
    },
    context: { eventTitle: "Innovation Summit", firstName: "Kenneth" },
    ...overrides,
  };
}

function stubTransport(
  result: {
    status: "sent" | "failed";
    providerMessageId: string | null;
    failureReason?: string;
  } = {
    status: "sent",
    providerMessageId: "stub-1",
  },
): EmailTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => result) };
}

function storedMessages() {
  return [...fake.store.entries()].filter(([path]) =>
    path.startsWith("EmailMessage/"),
  );
}

beforeEach(() => {
  fake.reset();
  vi.unstubAllEnvs();
  vi.stubEnv("EMAIL_DEFAULT_FROM", "noreply@configured.com");
});

describe("transport selection — fail closed (§1 AC-2/AC-3)", () => {
  it("defaults to the dev outbox: row persisted + sent with a dev- provider id, NO network I/O", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must not be touched"));

    const result = await sendEventEmail(baseSend());

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("sent");
    if (result.ok && result.outcome === "sent") {
      expect(result.providerMessageId).toBe(`dev-${result.messageId}`);
    }
    expect(storedMessages()).toHaveLength(1);
    expect(storedMessages()[0][1]).toMatchObject({
      status: "sent",
      provider: "dev-outbox",
      subject: "Your pass for Innovation Summit",
      bodyHtml: "<p>Dear Kenneth</p>",
      bodyText: "Dear Kenneth",
      from: { name: "Innovation Summit", address: "noreply@configured.com" },
      replyTo: null,
      attemptCount: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('accepts an explicit EMAIL_TRANSPORT="dev-outbox"', async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "dev-outbox");

    const result = await sendEventEmail(baseSend());
    expect(result.outcome).toBe("sent");
  });

  it("getEmailTransport throws a descriptive configuration error for unknown values", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "sendgrid");

    expect(() => getEmailTransport()).toThrow(/EMAIL_TRANSPORT.*sendgrid/);
  });

  it("an unknown EMAIL_TRANSPORT lands the row failed with the config reason — never silently sent", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "sendgrid");

    const result = await sendEventEmail(baseSend());

    expect(result).toMatchObject({ ok: false, outcome: "failed" });
    if (!result.ok && result.outcome === "failed") {
      expect(result.reason).toMatch(/EMAIL_TRANSPORT/);
    }
    expect(storedMessages()[0][1]).toMatchObject({ status: "failed" });
    expect(
      (storedMessages()[0][1].lastError as { message: string }).message,
    ).toMatch(/EMAIL_TRANSPORT/);
  });
});

describe("transport failures (§1 AC-4, §2 AC-3)", () => {
  it("a transport returning failed lands the row failed with lastError and a typed result", async () => {
    const transport = stubTransport({
      status: "failed",
      providerMessageId: null,
      failureReason: "mailbox unavailable",
    });

    const result = await sendEventEmail(baseSend({ transport }));

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "mailbox unavailable",
    });
    expect(storedMessages()[0][1]).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastError: { message: "mailbox unavailable" },
    });
  });

  it("a transport that THROWS is caught: row failed, typed failure, no unhandled exception", async () => {
    const transport: EmailTransport = {
      send: async () => {
        throw new Error("socket hang up");
      },
    };

    const result = await sendEventEmail(baseSend({ transport }));

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "socket hang up",
    });
    expect(storedMessages()[0][1]).toMatchObject({ status: "failed" });
  });

  it("a sent transition that does not land is surfaced as failed — never reported sent (no silent swallow)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const transport: EmailTransport = {
      send: async (message) => {
        // Force the transition to miss: the row vanishes out-of-band
        // between the transport call and markAdminEmailMessageSent.
        fake.store.delete(`EmailMessage/${message.messageId}`);
        return { status: "sent", providerMessageId: "stub-x" };
      },
    };

    const result = await sendEventEmail(baseSend({ transport }));

    expect(result).toMatchObject({ ok: false, outcome: "failed" });
    if (!result.ok && result.outcome === "failed") {
      expect(result.reason).toMatch(
        /sent transition did not land \(NOT_FOUND\)/,
      );
    }
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

describe("duplicate suppression (§2 AC-1)", () => {
  it("the same logical send twice yields ONE doc and at most ONE transport call", async () => {
    const transport = stubTransport();

    const first = await sendEventEmail(baseSend({ transport }));
    const second = await sendEventEmail(baseSend({ transport }));

    expect(first.outcome).toBe("sent");
    expect(second).toMatchObject({
      ok: true,
      outcome: "duplicate",
      status: "sent",
    });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(storedMessages()).toHaveLength(1);
  });

  it("editing the template later never alters the already-sent doc (§2 AC-8)", async () => {
    const transport = stubTransport();
    await sendEventEmail(baseSend({ transport }));

    const edited = await sendEventEmail(
      baseSend({
        transport,
        template: {
          subject: "EDITED {event_title}",
          bodyHtml: "<p>EDITED</p>",
          bodyText: "EDITED",
        },
      }),
    );

    expect(edited.outcome).toBe("duplicate");
    expect(storedMessages()[0][1]).toMatchObject({
      subject: "Your pass for Innovation Summit",
      bodyHtml: "<p>Dear Kenneth</p>",
    });
  });
});

describe("validation rejections — zero writes (§6 edge cases 3/4)", () => {
  it("rejects an invalid recipient as a typed INVALID_RECIPIENT with no outbox row", async () => {
    const transport = stubTransport();

    const result = await sendEventEmail(
      baseSend({
        transport,
        recipient: { name: "X", email: "not-an-email" },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      outcome: "rejected",
      code: "INVALID_RECIPIENT",
    });
    expect(storedMessages()).toHaveLength(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("rejects an oversized rendered subject BEFORE any write (boundary: 255 passes, 256 fails)", async () => {
    const transport = stubTransport();

    const atLimit = await sendEventEmail(
      baseSend({
        transport,
        template: {
          subject: "s".repeat(EMAIL_SUBJECT_MAX_CHARS),
          bodyHtml: "<p>x</p>",
          bodyText: "x",
        },
      }),
    );
    expect(atLimit.outcome).toBe("sent");

    fake.reset();
    const overLimit = await sendEventEmail(
      baseSend({
        transport,
        dedupeKey: "submission-2",
        template: {
          subject: "s".repeat(EMAIL_SUBJECT_MAX_CHARS + 1),
          bodyHtml: "<p>x</p>",
          bodyText: "x",
        },
      }),
    );

    expect(overLimit).toMatchObject({
      ok: false,
      outcome: "rejected",
      code: "CONTENT_TOO_LARGE",
    });
    expect(storedMessages()).toHaveLength(0);
  });

  it("rejects an oversized rendered bodyText the same way", async () => {
    const result = await sendEventEmail(
      baseSend({
        transport: stubTransport(),
        template: {
          subject: "s",
          bodyHtml: "<p>x</p>",
          bodyText: "t".repeat(64 * 1024 + 1),
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      outcome: "rejected",
      code: "CONTENT_TOO_LARGE",
    });
    expect(storedMessages()).toHaveLength(0);
  });

  it("strips control characters originating in the subject TEMPLATE itself — never stored, never handed to a transport", async () => {
    const transport = stubTransport();

    const result = await sendEventEmail(
      baseSend({
        transport,
        template: {
          subject: "Your\r\nBcc: attacker@x.com\u0000 pass for {event_title}",
          bodyHtml: "<p>x</p>",
          bodyText: "x",
        },
      }),
    );

    expect(result.outcome).toBe("sent");
    const expectedSubject =
      "YourBcc: attacker@x.com pass for Innovation Summit";
    expect(storedMessages()[0][1].subject).toBe(expectedSubject);
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expectedSubject }),
    );
  });
});

describe("sender identity at send (§4 AC 1-3)", () => {
  it("uses the read-time defaults when no EmailSettings doc exists — and creates none", async () => {
    await sendEventEmail(baseSend({ transport: stubTransport() }));

    expect(storedMessages()[0][1].from).toEqual({
      name: "Innovation Summit",
      address: "noreply@configured.com",
    });
    expect(fake.store.has(`EmailSettings/${EVENT_ID}`)).toBe(false);
  });

  it("snapshots the stored settings into every subsequent outbox row", async () => {
    fake.store.set(`EmailSettings/${EVENT_ID}`, {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      fromName: "The Economist Events",
      fromAddress: "events@economist.com",
      replyTo: "rsvp@economist.com",
    });

    await sendEventEmail(baseSend({ transport: stubTransport() }));

    expect(storedMessages()[0][1]).toMatchObject({
      from: { name: "The Economist Events", address: "events@economist.com" },
      replyTo: "rsvp@economist.com",
    });
  });

  it("a settings doc corrupted out-of-band lands the message failed — never a malformed header", async () => {
    fake.store.set(`EmailSettings/${EVENT_ID}`, {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      fromName: "Evil",
      fromAddress: "not-an-email\r\nBcc: attacker@x.com",
      replyTo: null,
    });
    const transport = stubTransport();

    const result = await sendEventEmail(baseSend({ transport }));

    expect(result).toMatchObject({ ok: false, outcome: "failed" });
    expect(storedMessages()[0][1]).toMatchObject({ status: "failed" });
    expect(transport.send).not.toHaveBeenCalled();
  });
});

describe("batch enqueue (§6 edge cases 2/4/5)", () => {
  type BatchInput = Parameters<typeof sendEventEmailBatch>[0];

  function baseBatch(
    recipients: BatchInput["recipients"],
    overrides: Partial<BatchInput> = {},
  ): BatchInput {
    return {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      eventName: "Innovation Summit",
      kind: "blast",
      template: {
        subject: "Hello {first_name}",
        bodyHtml: "<p>Hi {first_name}</p>",
        bodyText: "Hi {first_name}",
      },
      recipients,
      ...overrides,
    };
  }

  it("an empty recipient list is a calm no-op: { enqueued: 0 }, zero writes", async () => {
    const result = await sendEventEmailBatch(baseBatch([]));

    expect(result).toEqual({ ok: true, enqueued: 0, results: [] });
    expect(fake.writes).toHaveLength(0);
  });

  it("is ALL-OR-NOTHING on recipient validation: one invalid entry writes nothing", async () => {
    const transport = stubTransport();

    const result = await sendEventEmailBatch(
      baseBatch(
        [
          {
            recipient: { name: "A", email: "a@example.com" },
            dedupeKey: "d-1",
            context: { firstName: "A" },
          },
          {
            recipient: { name: "B", email: "broken" },
            dedupeKey: "d-2",
            context: { firstName: "B" },
          },
        ],
        { transport },
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_RECIPIENTS");
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]).toMatchObject({ index: 1, email: "broken" });
    }
    expect(fake.writes).toHaveLength(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("renders per recipient and enqueues each — one row per recipient", async () => {
    const transport = stubTransport();

    const result = await sendEventEmailBatch(
      baseBatch(
        [
          {
            recipient: { name: "A", email: "a@example.com" },
            dedupeKey: "d-1",
            context: { firstName: "Ada" },
          },
          {
            recipient: { name: "B", email: "b@example.com" },
            dedupeKey: "d-2",
            context: { firstName: "Bob" },
          },
        ],
        { transport },
      ),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.enqueued).toBe(2);
      expect(result.results.map((r) => r.outcome)).toEqual(["sent", "sent"]);
    }
    const bodies = storedMessages().map((m) => m[1].bodyText);
    expect(bodies).toEqual(expect.arrayContaining(["Hi Ada", "Hi Bob"]));
    expect(transport.send).toHaveBeenCalledTimes(2);
  });

  it("one oversized/bad entry fails ONLY that recipient — the rest still send (edge 5)", async () => {
    const transport = stubTransport();

    const result = await sendEventEmailBatch(
      baseBatch(
        [
          {
            recipient: { name: "A", email: "a@example.com" },
            dedupeKey: "d-1",
            context: { firstName: "Ada" },
          },
          {
            recipient: { name: "B", email: "b@example.com" },
            dedupeKey: "d-2",
            // Renders past the subject limit for this recipient only.
            context: { firstName: "B".repeat(300) },
          },
        ],
        { transport },
      ),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.enqueued).toBe(1);
      expect(result.results[0].outcome).toBe("sent");
      expect(result.results[1]).toMatchObject({
        outcome: "rejected",
        code: "CONTENT_TOO_LARGE",
      });
    }
    expect(storedMessages()).toHaveLength(1);
  });

  it("duplicates inside a batch do not re-send and do not count as enqueued", async () => {
    const transport = stubTransport();
    const entry = {
      recipient: { name: "A", email: "a@example.com" },
      dedupeKey: "d-1",
      context: { firstName: "Ada" },
    };

    const result = await sendEventEmailBatch(
      baseBatch([entry, { ...entry }], { transport }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.enqueued).toBe(1);
      expect(result.results.map((r) => r.outcome)).toEqual([
        "sent",
        "duplicate",
      ]);
    }
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
});

describe("retryEmailMessage — explicit retry (§2 AC-4)", () => {
  it("re-attempts a failed message and can land it sent (attemptCount 2)", async () => {
    const failing = stubTransport({
      status: "failed",
      providerMessageId: null,
      failureReason: "boom",
    });
    const first = await sendEventEmail(baseSend({ transport: failing }));
    expect(first.outcome).toBe("failed");
    const messageId = first.ok
      ? ""
      : (first as { messageId: string }).messageId;

    const retry = await retryEmailMessage({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      transport: stubTransport({ status: "sent", providerMessageId: "stub-2" }),
    });

    expect(retry).toMatchObject({
      ok: true,
      outcome: "sent",
      providerMessageId: "stub-2",
    });
    expect(fake.store.get(`EmailMessage/${messageId}`)).toMatchObject({
      status: "sent",
      attemptCount: 2,
      providerMessageId: "stub-2",
    });
  });

  it("is a typed no-op with zero writes on a sent message", async () => {
    const sent = await sendEventEmail(baseSend({ transport: stubTransport() }));
    const messageId = sent.ok && sent.outcome === "sent" ? sent.messageId : "";
    const writesBefore = fake.writes.length;

    const retry = await retryEmailMessage({
      messageId,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      transport: stubTransport(),
    });

    expect(retry).toEqual({
      ok: false,
      outcome: "not-retryable",
      status: "sent",
    });
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("answers not-found for missing and cross-org messages (IDOR-safe)", async () => {
    const failing = stubTransport({
      status: "failed",
      providerMessageId: null,
      failureReason: "boom",
    });
    const first = await sendEventEmail(baseSend({ transport: failing }));
    const messageId = first.ok
      ? ""
      : (first as { messageId: string }).messageId;

    expect(
      await retryEmailMessage({
        messageId: "missing",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        transport: stubTransport(),
      }),
    ).toEqual({ ok: false, outcome: "not-found" });

    expect(
      await retryEmailMessage({
        messageId,
        eventId: EVENT_ID,
        organizationId: "org-other",
        transport: stubTransport(),
      }),
    ).toEqual({ ok: false, outcome: "not-found" });
  });
});
