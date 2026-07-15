// @vitest-environment node
/**
 * M6-T3 — §5 periodic trigger `scheduled` (system `one-week-to-go` /
 * `qr-ready` + custom scheduled definitions). Spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §5.
 *
 * Locks:
 *  - null trigger.at never fires (no query at all)
 *  - `now < trigger.at` never fires yet
 *  - fires for the current accepted-all audience once `now >= trigger.at`;
 *    a later tick with no new acceptances sends zero more (dedupeKey =
 *    definitionId:recipientKey)
 *  - catch-up: a newly-accepted attendee after the nominal `at` still
 *    receives it on a LATER tick, as long as that tick is before the
 *    event's first period start
 *  - the catch-up window CLOSES at the event's first period start — an
 *    attendee accepted after the event started never receives it, even
 *    though now >= trigger.at and enabled remain true
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { evaluateScheduledDefinitionTrigger } =
  await import("@/lib/email/lifecycle/evaluate-scheduled");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
// First period starts 2026-08-01 (UTC) — trigger.at nominally a week before.
const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [{ date: "2026-08-01" }],
  timezone: "UTC",
};
const AT_MS = Date.parse("2026-07-25T09:00:00.000Z"); // "one week to go"
const CUTOFF_MS = Date.parse("2026-08-01T00:00:00.000Z"); // event first-period start (UTC midnight)

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
    email: `${id}@example.com`,
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

function stubTransport() {
  return {
    send: vi.fn(async () => ({
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
    definition: {
      id: "def-one-week-to-go",
      kind: "one-week-to-go",
      audience: "accepted-all" as const,
      atMs: AT_MS,
      subject: "One week to go",
      body: "{event_title} is one week away",
    },
    nowMs: AT_MS,
    pageSize: 100,
    maxPages: 20,
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
});

describe("evaluateScheduledDefinitionTrigger", () => {
  it("never fires when trigger.at is null", async () => {
    seedAttendee("a-1");
    const transport = stubTransport();

    const outcome = await evaluateScheduledDefinitionTrigger(
      baseInput({
        transport,
        definition: { ...baseInput().definition, atMs: null },
      }),
    );

    expect(outcome.stoppedReason).toBe("not-due");
    expect(outcome.pagesProcessed).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("does not fire before now reaches trigger.at", async () => {
    seedAttendee("a-1");
    const transport = stubTransport();

    const outcome = await evaluateScheduledDefinitionTrigger(
      baseInput({ transport, nowMs: AT_MS - 1000 }),
    );

    expect(outcome.stoppedReason).toBe("not-due");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("fires for the current audience once due; a later tick with no new members sends zero more", async () => {
    seedAttendee("a-1");
    const transport = stubTransport();

    const first = await evaluateScheduledDefinitionTrigger(
      baseInput({ transport }),
    );
    expect(first.enqueued).toBe(1);

    const second = await evaluateScheduledDefinitionTrigger(
      baseInput({ transport, nowMs: AT_MS + 60 * 60 * 1000 }),
    );
    expect(second.enqueued).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("catch-up: an attendee accepted after the nominal moment still receives it on a later tick", async () => {
    const transport = stubTransport();
    // Nobody accepted yet at the nominal moment.
    const first = await evaluateScheduledDefinitionTrigger(
      baseInput({ transport }),
    );
    expect(first.enqueued).toBe(0);

    // Two days later, someone accepts — still well before the event start.
    seedAttendee("a-late");
    const catchUpMs = AT_MS + 2 * 24 * 60 * 60 * 1000;
    const second = await evaluateScheduledDefinitionTrigger(
      baseInput({ transport, nowMs: catchUpMs }),
    );
    expect(second.enqueued).toBe(1);
  });

  it("the catch-up window CLOSES at the event's first period start — no query even runs past it", async () => {
    seedAttendee("a-post-start");
    const transport = stubTransport();

    const outcome = await evaluateScheduledDefinitionTrigger(
      baseInput({ transport, nowMs: CUTOFF_MS + 60 * 60 * 1000 }),
    );

    expect(outcome.stoppedReason).toBe("past-cutoff");
    expect(outcome.pagesProcessed).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("a custom definition with audience all-invitees fires for zero recipients, no error", async () => {
    seedAttendee("a-1");
    const transport = stubTransport();

    const outcome = await evaluateScheduledDefinitionTrigger(
      baseInput({
        transport,
        definition: {
          ...baseInput().definition,
          audience: "all-invitees" as const,
        },
      }),
    );

    expect(outcome.enqueued).toBe(0);
    expect(outcome.stoppedReason).toBe("exhausted");
    expect(transport.send).not.toHaveBeenCalled();
  });
});
