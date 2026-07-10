// @vitest-environment node
/**
 * M3-T4 — FormData status machine + transition method + deterministic
 * finalize create. Spec: agents/docs/specs/m3-registration-paths.md
 * (T4 AC-2/AC-3/AC-4/AC-7; T3 finalize idempotency).
 *
 * Locks:
 *  - pure machine: full forward/backward matrix, accepted terminal,
 *    same-status rejected; legacy/malformed status reads as "new"
 *  - transitionAdminFormDataStatus: forward persists status+statusUpdatedAt,
 *    accept stamps acceptedAt, backward/repeat -> INVALID_TRANSITION with an
 *    EMPTY write set, cross-org/missing -> NOT_FOUND (IDOR-safe)
 *  - accept hook fires AT MOST ONCE (double-accept: second call fails before
 *    the hook), default hook is the responses stub
 *  - createAdminFormDataForDraft: deterministic id from draftId, "new" +
 *    orderId/pathId/ticketLabel populated, idempotent replay returns the
 *    existing doc with zero writes (crash-recovery contract)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
const stubHook = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
vi.mock("@/features/responses/on-submission-accepted", () => ({
  onSubmissionAccepted: stubHook,
}));

import {
  FORM_DATA_STATUSES,
  applyFormDataReadDefaults,
  canTransitionFormDataStatus,
  readFormDataStatus,
} from "@/lib/db/formDataStatus";
import { formDataIdFromDraftId } from "@/lib/db/formDataId";
import { orderIdFromIdempotencyKey } from "@/lib/orders/order-id";
import type { FormDataDoc, FormDataStatus } from "@/types/collection";

const { transitionAdminFormDataStatus, createAdminFormDataForDraft } =
  await import("@/lib/db/adminFormData");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const RESPONSE_ID = "resp-1";
const RESPONSE_PATH = `FormData/${RESPONSE_ID}`;

function seedResponse(overrides: Partial<FormDataDoc> = {}) {
  fake.store.set(RESPONSE_PATH, {
    formId: "form-1",
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    submission: { name: "Ada" },
    submittedAt: { seconds: 1_700_000_000 },
    ...overrides,
  });
}

function transition(to: FormDataStatus, overrides = {}) {
  return transitionAdminFormDataStatus({
    responseId: RESPONSE_ID,
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    to,
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
  stubHook.mockReset();
});

describe("canTransitionFormDataStatus — full matrix (T4 AC-2)", () => {
  // Every ordered pair: allowed iff strictly forward.
  const RANK: Record<FormDataStatus, number> = {
    new: 0,
    pending: 1,
    reviewed: 2,
    accepted: 3,
  };

  for (const from of FORM_DATA_STATUSES) {
    for (const to of FORM_DATA_STATUSES) {
      const expected = RANK[to] > RANK[from];
      it(`${from} -> ${to} is ${expected ? "allowed" : "rejected"}`, () => {
        expect(canTransitionFormDataStatus(from, to)).toBe(expected);
      });
    }
  }
});

describe("read-time defaults (legacy docs, no backfill)", () => {
  it('reads a missing status as "new" and a malformed one as "new"', () => {
    expect(readFormDataStatus({} as FormDataDoc)).toBe("new");
    expect(
      readFormDataStatus({ status: "bogus" } as unknown as FormDataDoc),
    ).toBe("new");
    expect(readFormDataStatus({ status: "reviewed" } as FormDataDoc)).toBe(
      "reviewed",
    );
  });

  it("defaults the full M3 field set without touching populated docs", () => {
    const legacy = {
      formId: "f",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      submission: {},
      submittedAt: { seconds: 1 },
    } as FormDataDoc;

    expect(applyFormDataReadDefaults(legacy)).toMatchObject({
      status: "new",
      orderId: null,
      pathId: null,
      ticketLabel: null,
      attendeeCreated: false,
    });

    const populated = {
      ...legacy,
      status: "accepted" as const,
      orderId: "ord-1",
      pathId: "path-1",
      ticketLabel: "VIP",
      attendeeCreated: true,
    };
    expect(applyFormDataReadDefaults(populated)).toMatchObject({
      status: "accepted",
      orderId: "ord-1",
      pathId: "path-1",
      ticketLabel: "VIP",
      attendeeCreated: true,
    });
  });
});

describe("transitionAdminFormDataStatus", () => {
  it("persists a forward transition with statusUpdatedAt (legacy doc counts as new)", async () => {
    seedResponse(); // no status field -> reads as "new"

    const result = await transition("pending");

    expect(result).toMatchObject({ ok: true });
    const stored = fake.store.get(RESPONSE_PATH)!;
    expect(stored.status).toBe("pending");
    expect(stored.statusUpdatedAt).toBeDefined();
    expect(stored.acceptedAt).toBeUndefined();
    expect(stubHook).not.toHaveBeenCalled();
  });

  it("allows skipping forward (new -> accepted) and stamps acceptedAt", async () => {
    seedResponse();

    const result = await transition("accepted");

    expect(result).toMatchObject({ ok: true });
    const stored = fake.store.get(RESPONSE_PATH)!;
    expect(stored.status).toBe("accepted");
    expect(stored.acceptedAt).toBeDefined();
    expect(stubHook).toHaveBeenCalledTimes(1);
    expect(stubHook.mock.calls[0][0]).toMatchObject({
      id: RESPONSE_ID,
      eventId: EVENT_ID,
    });
  });

  it("rejects every backward move with an empty write set", async () => {
    for (const [from, to] of [
      ["pending", "new"],
      ["reviewed", "pending"],
      ["reviewed", "new"],
      ["accepted", "reviewed"],
      ["accepted", "new"],
    ] as const) {
      fake.reset();
      seedResponse({ status: from });

      const result = await transition(to);

      expect(result).toEqual({
        ok: false,
        code: "INVALID_TRANSITION",
        message: expect.stringContaining(`"${from}"`),
      });
      expect(fake.writes).toHaveLength(0);
      expect(fake.store.get(RESPONSE_PATH)!.status).toBe(from);
    }
  });

  it("rejects same-status repeats (accepted is terminal in M3)", async () => {
    seedResponse({ status: "accepted" });

    const result = await transition("accepted");

    expect(result).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(fake.writes).toHaveLength(0);
    expect(stubHook).not.toHaveBeenCalled();
  });

  it("fires the accept hook AT MOST ONCE under a double-accept (T4 AC-3)", async () => {
    seedResponse({ status: "reviewed" });

    const first = await transition("accepted");
    const second = await transition("accepted");

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(stubHook).toHaveBeenCalledTimes(1);
  });

  it("prefers an injected onAccepted over the default stub", async () => {
    seedResponse();
    const custom = vi.fn();

    await transition("accepted", { onAccepted: custom });

    expect(custom).toHaveBeenCalledTimes(1);
    expect(stubHook).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for cross-org and cross-event ids (IDOR-safe) and missing docs", async () => {
    seedResponse({ organizationId: "org-other" });
    expect(await transition("pending")).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });

    fake.reset();
    seedResponse({ eventId: "evt-other" });
    expect(await transition("pending")).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });

    fake.reset(); // nothing seeded
    expect(await transition("pending")).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(fake.writes).toHaveLength(0);
  });
});

describe("createAdminFormDataForDraft — deterministic id + idempotent replay (T3)", () => {
  const DRAFT_ID = "draft-abc";
  const input = {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    draftId: DRAFT_ID,
    formId: "form-1",
    submission: { name: "Ada", ticket: "VIP" },
    orderId: "ord-1",
    pathId: "path-1",
    ticketLabel: "VIP",
  };

  const EXPECTED_ID = formDataIdFromDraftId({
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    draftId: DRAFT_ID,
  });

  it("creates the submission at the draft-derived id with status new and populated commerce fields (T4 AC-7)", async () => {
    const result = await createAdminFormDataForDraft(input);

    expect(result.created).toBe(true);
    expect(result.formDataId).toBe(EXPECTED_ID);

    const stored = fake.store.get(`FormData/${EXPECTED_ID}`)!;
    expect(stored).toMatchObject({
      formId: "form-1",
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      submission: { name: "Ada", ticket: "VIP" },
      status: "new",
      orderId: "ord-1",
      pathId: "path-1",
      ticketLabel: "VIP",
      statusUpdatedAt: null,
      acceptedAt: null,
      attendeeCreated: false,
    });
  });

  it("replays idempotently: second call returns the existing doc, zero writes (crash recovery)", async () => {
    await createAdminFormDataForDraft(input);
    const writesAfterFirst = fake.writes.length;

    const replay = await createAdminFormDataForDraft({
      ...input,
      // Even drifted display fields never rewrite an existing submission.
      ticketLabel: "changed",
    });

    expect(replay.created).toBe(false);
    expect(replay.formDataId).toBe(EXPECTED_ID);
    expect(replay.formData.ticketLabel).toBe("VIP");
    expect(fake.writes).toHaveLength(writesAfterFirst);
  });

  it("namespaces ids per (org, event, draft) and never collides with Order ids", () => {
    const base = { organizationId: ORG_ID, eventId: EVENT_ID, draftId: DRAFT_ID };
    expect(formDataIdFromDraftId(base)).toBe(formDataIdFromDraftId({ ...base }));
    expect(formDataIdFromDraftId({ ...base, draftId: "other" })).not.toBe(
      EXPECTED_ID,
    );
    expect(formDataIdFromDraftId({ ...base, organizationId: "org-2" })).not.toBe(
      EXPECTED_ID,
    );
    expect(formDataIdFromDraftId({ ...base, eventId: "evt-2" })).not.toBe(
      EXPECTED_ID,
    );
    // Domain prefix keeps the derivation disjoint from order ids built from
    // the same tuple.
    expect(
      orderIdFromIdempotencyKey({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        idempotencyKey: DRAFT_ID,
      }),
    ).not.toBe(EXPECTED_ID);
  });
});
