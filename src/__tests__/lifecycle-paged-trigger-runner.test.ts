// @vitest-environment node
/**
 * M6-T3 — the generic paged-send engine
 * (src/lib/email/lifecycle/paged-trigger-runner.ts). Spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §8.
 *
 * Locks:
 *  - `enabled` is re-read FRESH at the start of EVERY processed page, not
 *    once per tick — a definition disabled between page 1 and page 2 stops
 *    page 2 (and later pages) while page 1's already-enqueued sends stand
 *  - bounded pages, never an unbounded sendEventEmailBatch call
 *  - interrupting mid-run (small page budget) and "resuming" via a later,
 *    from-scratch invocation produces the correct total with ZERO
 *    duplicate transport sends (dedupeKey is the entire safety mechanism)
 *  - a single malformed recipient is rejected individually (typed, zero
 *    write) without poisoning the rest of its page's batch
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";
import { emailDefinitionId } from "@/lib/db/emailDefinitionId";
import type { SendEmailInput } from "@/lib/email/transport";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { runPagedLifecycleTrigger } =
  await import("@/lib/email/lifecycle/paged-trigger-runner");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};
const KIND = "abandoned-reminder";
const DEFINITION_ID = emailDefinitionId({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  kind: KIND,
});

function stubTransport() {
  return {
    send: vi.fn(async (_input: SendEmailInput) => ({
      status: "sent" as const,
      providerMessageId: "dev-1",
    })),
  };
}

function candidatesPage(recipients: Array<{ email: string; key: string }>) {
  return {
    candidates: recipients.map((r) => ({
      recipientKey: r.key,
      recipient: { name: "Test", email: r.email },
      attendeeId: null,
      submissionId: null,
      orderId: null,
      orderCreatedAtMs: null,
      mergeInput: { submission: { first_name: "Test", email: r.email } },
    })),
    nextCursorMs: null,
    hasMore: false,
  };
}

function seedDefinition(overrides: Record<string, unknown>): void {
  fake.store.set(`EmailDefinition/${DEFINITION_ID}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    kind: KIND,
    name: "Abandoned reminder",
    group: "pre-event",
    trigger: { type: "abandoned-24h" },
    audience: "abandoned",
    enabled: true,
    subject: "s",
    body: "b",
    isSystem: true,
    sortOrder: 1,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

type RunPagedLifecycleTriggerInput = Parameters<
  typeof runPagedLifecycleTrigger
>[0];

function baseInput(
  overrides: Partial<RunPagedLifecycleTriggerInput> = {},
): RunPagedLifecycleTriggerInput {
  return {
    kind: KIND,
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    eventName: EVENT.name,
    event: EVENT,
    definitionId: DEFINITION_ID,
    template: { subject: "Finish up", body: "Come back" },
    pageSize: 100,
    maxPages: 20,
    // One dedupeKey per candidate, equal to its recipientKey — matches
    // §3's abandonedReminderDedupeKey formula closely enough for this
    // generic-engine test file (the trigger-specific formulas themselves
    // are covered by lifecycle-dedupe-keys.test.ts and each evaluate-*
    // test file).
    buildDedupeKeys: (candidate) => [candidate.recipientKey],
    fetchPage: async () => ({
      candidates: [],
      nextCursorMs: null,
      hasMore: false,
    }),
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
});

describe("enabled re-check granularity (§8)", () => {
  it("stops chunk 2 (and later) when disabled between pages, while chunk 1's sends stand", async () => {
    seedDefinition({ enabled: true });
    const transport = stubTransport();

    let call = 0;
    const outcome = await runPagedLifecycleTrigger(
      baseInput({
        maxPages: 5,
        transport,
        fetchPage: async () => {
          call += 1;
          if (call === 1) {
            // Page 1 processes while still enabled — then flips the switch
            // so the runner's OWN pre-page-2 fresh read observes disabled.
            const page = candidatesPage([
              { key: "d-1", email: "a@example.com" },
            ]);
            seedDefinition({ enabled: false });
            return { ...page, hasMore: true, nextCursorMs: 1 };
          }
          // Should never be reached — the runner must stop before fetching
          // page 2 once it observes enabled:false.
          return candidatesPage([{ key: "d-2", email: "b@example.com" }]);
        },
      }),
    );

    expect(outcome.stoppedReason).toBe("disabled");
    expect(outcome.pagesProcessed).toBe(1);
    expect(outcome.enqueued).toBe(1); // page 1's send stands
    expect(call).toBe(1); // page 2's fetchPage was never invoked
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("re-checks enabled per page, not once per recipient", async () => {
    seedDefinition({ enabled: true });
    const transport = stubTransport();

    const outcome = await runPagedLifecycleTrigger(
      baseInput({
        maxPages: 5,
        transport,
        fetchPage: async () =>
          candidatesPage([
            { key: "d-1", email: "a@example.com" },
            { key: "d-2", email: "b@example.com" },
            { key: "d-3", email: "c@example.com" },
          ]),
      }),
    );

    expect(outcome.enqueued).toBe(3);
    expect(outcome.stoppedReason).toBe("exhausted");
  });
});

describe("bounded pages / interruption + resumption", () => {
  it("never calls the transport more than once per unique dedupeKey across an interrupted-then-resumed run", async () => {
    seedDefinition({ enabled: true });
    const allDrafts = Array.from({ length: 7 }, (_, i) => ({
      key: `d-${i}`,
      email: `d${i}@example.com`,
    }));

    function fetchPageFactory() {
      let cursor = 0;
      return async () => {
        const pageItems = allDrafts.slice(cursor, cursor + 2);
        cursor += pageItems.length;
        return {
          candidates: candidatesPage(pageItems).candidates,
          nextCursorMs: cursor < allDrafts.length ? cursor : null,
          hasMore: cursor < allDrafts.length,
        };
      };
    }

    // "Interrupted" run: budget only covers 2 of 4 pages (4 of 7 drafts).
    const transport1 = stubTransport();
    const firstRun = await runPagedLifecycleTrigger(
      baseInput({
        maxPages: 2,
        transport: transport1,
        fetchPage: fetchPageFactory(),
      }),
    );
    expect(firstRun.stoppedReason).toBe("budget");
    expect(firstRun.enqueued).toBe(4);
    expect(transport1.send).toHaveBeenCalledTimes(4);

    // "Later invocation" — a fresh call (no persisted cursor) with a full
    // budget. Already-sent drafts collapse as duplicates; only the
    // remaining 3 actually reach the transport.
    const transport2 = stubTransport();
    const secondRun = await runPagedLifecycleTrigger(
      baseInput({
        maxPages: 20,
        transport: transport2,
        fetchPage: fetchPageFactory(),
      }),
    );
    expect(secondRun.stoppedReason).toBe("exhausted");
    expect(secondRun.enqueued).toBe(3);
    expect(secondRun.duplicates).toBe(4);
    expect(transport2.send).toHaveBeenCalledTimes(3);

    // Total EmailMessage docs across both runs == total eligible drafts,
    // never more (zero duplicate rows created across the interruption).
    const rows = [...fake.store.keys()].filter((k) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(7);
  });

  it("stops itself at the maxPages budget even when more candidates remain", async () => {
    seedDefinition({ enabled: true });
    const transport = stubTransport();
    let calls = 0;

    const outcome = await runPagedLifecycleTrigger(
      baseInput({
        maxPages: 3,
        transport,
        fetchPage: async () => {
          calls += 1;
          return {
            candidates: candidatesPage([
              { key: `d-${calls}`, email: `d${calls}@example.com` },
            ]).candidates,
            nextCursorMs: calls, // always claims more remain
            hasMore: true,
          };
        },
      }),
    );

    expect(calls).toBe(3);
    expect(outcome.pagesProcessed).toBe(3);
    expect(outcome.stoppedReason).toBe("budget");
  });
});

describe("M6-T4 B-1: live block-render context reaches the rendered HTML", () => {
  it("resolves the block context ONCE per tick (snapshot, spec §1 AC-9) and a TicketPricingTable block renders REAL prices, not the empty-state message", async () => {
    seedDefinition({ enabled: true });
    fake.store.set(`Event/${EVENT_ID}`, {
      organizationId: ORG_ID,
      name: EVENT.name,
      periods: [],
      timezone: "UTC",
      formPath: "",
    });
    fake.store.set("TicketType/tt-1", {
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      name: "General Admission",
      code: "GA",
      capacity: null,
      registeredCount: 0,
      isOpen: true,
      salesStart: null,
      salesEnd: null,
      registrationTypeIds: [],
      createdAt: { seconds: 1 },
    });
    fake.store.set("Fee/fee-1", {
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      ticketTypeId: "tt-1",
      registrationTypeId: null,
      currency: "USD",
      basePriceMinor: 5000,
      status: "active",
      createdAt: { seconds: 1 },
    });
    const transport = stubTransport();

    const outcome = await runPagedLifecycleTrigger(
      baseInput({
        transport,
        template: {
          subject: "Finish up",
          body: "Come back",
          bodyMode: "blocks",
          bodyBlocks: [
            {
              id: "tp-1",
              type: "TicketPricingTable",
              props: { title: "Tickets" },
            },
          ],
        },
        fetchPage: async () =>
          candidatesPage([{ key: "d-1", email: "a@example.com" }]),
      }),
    );

    expect(outcome.enqueued).toBe(1);
    const sent = transport.send.mock.calls[0][0];
    expect(sent.bodyHtml).toContain("General Admission");
    expect(sent.bodyHtml).toContain("$50.00");
    expect(sent.bodyHtml).not.toContain("Tickets will be announced soon.");
  });
});

describe("invalid-recipient isolation", () => {
  it("rejects a malformed recipient individually without poisoning the rest of the page's batch", async () => {
    seedDefinition({ enabled: true });
    const transport = stubTransport();

    const outcome = await runPagedLifecycleTrigger(
      baseInput({
        transport,
        fetchPage: async () =>
          candidatesPage([
            { key: "d-good-1", email: "good1@example.com" },
            { key: "d-bad", email: "" }, // invalid — zod rejects empty email
            { key: "d-good-2", email: "good2@example.com" },
          ]),
      }),
    );

    expect(outcome.enqueued).toBe(2);
    expect(outcome.rejected).toBe(1);
    // The two valid peers still got sent (batched) despite the bad entry.
    expect(transport.send).toHaveBeenCalledTimes(2);
    const rows = [...fake.store.entries()].filter(([k]) =>
      k.startsWith("EmailMessage/"),
    );
    expect(rows).toHaveLength(2);
  });
});
