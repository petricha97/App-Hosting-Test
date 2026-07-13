// @vitest-environment node
/**
 * M3-T3/T5 — RegistrationDraft admin DAL (src/lib/db/adminRegistrationDraft.ts).
 * Spec: agents/docs/specs/m3-registration-paths.md (T3 AC-3; T5 AC-1..AC-8).
 *
 * Locks:
 *  - create: explicit field stamps at the MINTED draftId; selections start
 *    null, attempt 1, lastStepReached "personal_info"; only the token HASH
 *    is stored; schema-level PII assertion (no promo text, no payment keys)
 *  - token-hash access path: getByIdAndTokenHash is null on wrong hash,
 *    wrong event, or missing — a bare draftId grants nothing
 *  - step update allow-list: token hash / tenancy / attempt unreachable
 *  - attempt increment is the dedicated method (fresh idempotency key after
 *    PAYMENT_FAILED)
 *  - abandoned list: newest-updated first, bounded, isAbandoned DERIVED from
 *    ABANDONED_AFTER_MS (24h) — never stored
 *  - path reference check bounded at 5 (path-delete 409)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  generateDraftId,
  hashDraftToken,
  mintDraftToken,
} from "@/lib/draft-token";
import type { RegistrationDraftDoc } from "@/types/collection";

const {
  ABANDONED_AFTER_MS,
  createAdminRegistrationDraft,
  deleteAdminRegistrationDraft,
  getAdminRegistrationDraftByIdAndTokenHash,
  getAdminRegistrationDraftForEvent,
  getAdminRegistrationDraftsForEvent,
  getAdminRegistrationDraftsReferencingPath,
  incrementAdminRegistrationDraftAttempt,
  updateAdminRegistrationDraftStep,
} = await import("@/lib/db/adminRegistrationDraft");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const PATH_ID = "path-1";
const FORM_ID = "form-1";
const SECRET = "unit-test-secret";

function draftInput(draftId: string, tokenHash: string) {
  return {
    draftId,
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    pathId: PATH_ID,
    formId: FORM_ID,
    draftTokenHash: tokenHash,
    stepAnswers: { name: "Ada Lovelace", email: "ada@dentsu.com" },
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@dentsu.com",
  };
}

function seedDraft(id: string, overrides: Partial<RegistrationDraftDoc> = {}) {
  fake.store.set(`RegistrationDraft/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    pathId: PATH_ID,
    formId: FORM_ID,
    draftTokenHash: "hash",
    lastStepReached: "personal_info",
    stepAnswers: {},
    ticketTypeId: null,
    registrationTypeId: null,
    promotionId: null,
    attempt: 1,
    firstName: "",
    lastName: "",
    email: "",
    createdAt: Timestamp.fromMillis(1),
    updatedAt: Timestamp.fromMillis(1),
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("ABANDONED_AFTER_MS — the single 24h constant (T5 AC-8)", () => {
  it("is exactly 24 hours", () => {
    expect(ABANDONED_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("createAdminRegistrationDraft", () => {
  it("creates the doc at the minted draftId with server-owned defaults and only the token HASH", async () => {
    const draftId = generateDraftId();
    const token = mintDraftToken({ draftId, eventId: EVENT_ID, secret: SECRET });
    const tokenHash = hashDraftToken(token);

    await createAdminRegistrationDraft(draftInput(draftId, tokenHash));

    const stored = fake.store.get(`RegistrationDraft/${draftId}`)!;
    expect(stored).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      pathId: PATH_ID,
      formId: FORM_ID,
      draftTokenHash: tokenHash,
      lastStepReached: "personal_info",
      stepAnswers: { name: "Ada Lovelace", email: "ada@dentsu.com" },
      ticketTypeId: null,
      registrationTypeId: null,
      promotionId: null,
      attempt: 1,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@dentsu.com",
    });
    // The RAW token is never stored anywhere in the doc.
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("stores EXACTLY the schema fields — no promo code text, no payment keys (T5 AC-4)", async () => {
    const draftId = generateDraftId();
    await createAdminRegistrationDraft(draftInput(draftId, "hash"));

    const stored = fake.store.get(`RegistrationDraft/${draftId}`)!;
    expect(Object.keys(stored).sort()).toEqual(
      [
        "organizationId",
        "eventId",
        "pathId",
        "formId",
        "draftTokenHash",
        "lastStepReached",
        "stepAnswers",
        "ticketTypeId",
        "registrationTypeId",
        "promotionId",
        "attempt",
        "firstName",
        "lastName",
        "email",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });

  it("defaults name/email denorms to empty strings and fails loudly on a draftId collision", async () => {
    const draftId = generateDraftId();
    await createAdminRegistrationDraft({
      draftId,
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      pathId: PATH_ID,
      formId: FORM_ID,
      draftTokenHash: "hash",
      stepAnswers: {},
    });

    const stored = fake.store.get(`RegistrationDraft/${draftId}`)!;
    expect(stored.firstName).toBe("");
    expect(stored.lastName).toBe("");
    expect(stored.email).toBe("");

    await expect(
      createAdminRegistrationDraft(draftInput(draftId, "other-hash")),
    ).rejects.toThrow(/ALREADY_EXISTS/);
  });
});

describe("getAdminRegistrationDraftByIdAndTokenHash — the SOLE public access path (T3 AC-3, T5 AC-5)", () => {
  it("returns the draft only for the matching hash + event; everything else is null", async () => {
    const draftId = generateDraftId();
    const token = mintDraftToken({ draftId, eventId: EVENT_ID, secret: SECRET });
    const tokenHash = hashDraftToken(token);
    seedDraft(draftId, { draftTokenHash: tokenHash });

    await expect(
      getAdminRegistrationDraftByIdAndTokenHash({
        draftId,
        eventId: EVENT_ID,
        tokenHash,
      }),
    ).resolves.toMatchObject({ id: draftId });

    // A bare draftId (wrong/forged hash) grants nothing.
    await expect(
      getAdminRegistrationDraftByIdAndTokenHash({
        draftId,
        eventId: EVENT_ID,
        tokenHash: hashDraftToken("forged-token"),
      }),
    ).resolves.toBeNull();

    // Cross-event access is null even with the right hash.
    await expect(
      getAdminRegistrationDraftByIdAndTokenHash({
        draftId,
        eventId: "evt-2",
        tokenHash,
      }),
    ).resolves.toBeNull();

    await expect(
      getAdminRegistrationDraftByIdAndTokenHash({
        draftId: "missing",
        eventId: EVENT_ID,
        tokenHash,
      }),
    ).resolves.toBeNull();
  });
});

describe("getAdminRegistrationDraftForEvent — admin surface (org-scoped)", () => {
  it("returns null cross-org / cross-event (manual delete route 404s)", async () => {
    seedDraft("d-1");

    await expect(
      getAdminRegistrationDraftForEvent({
        draftId: "d-1",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toMatchObject({ id: "d-1" });

    await expect(
      getAdminRegistrationDraftForEvent({
        draftId: "d-1",
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).resolves.toBeNull();

    await expect(
      getAdminRegistrationDraftForEvent({
        draftId: "d-1",
        eventId: "evt-2",
        organizationId: ORG_ID,
      }),
    ).resolves.toBeNull();
  });
});

describe("updateAdminRegistrationDraftStep — allow-list", () => {
  it("writes step fields + updatedAt only; tenancy/token/attempt are unreachable", async () => {
    seedDraft("d-1");

    await updateAdminRegistrationDraftStep("d-1", {
      lastStepReached: "ticket_options",
      ticketTypeId: "tt-1",
      registrationTypeId: "rt-1",
      promotionId: "promo-1",
      firstName: "Ada",
    });

    const stored = fake.store.get("RegistrationDraft/d-1")!;
    expect(stored).toMatchObject({
      lastStepReached: "ticket_options",
      ticketTypeId: "tt-1",
      registrationTypeId: "rt-1",
      promotionId: "promo-1",
      firstName: "Ada",
      // Server-owned fields untouched.
      draftTokenHash: "hash",
      attempt: 1,
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      pathId: PATH_ID,
    });

    const update = fake.writes.find((w) => w.type === "update");
    expect(Object.keys(update!.data!).sort()).toEqual([
      "firstName",
      "lastStepReached",
      "promotionId",
      "registrationTypeId",
      "ticketTypeId",
      "updatedAt",
    ]);
  });

  it("covers all four lastStepReached values (T5 AC-1)", async () => {
    for (const step of [
      "personal_info",
      "ticket_options",
      "summary",
      "payment",
    ] as const) {
      fake.reset();
      seedDraft("d-1");

      await updateAdminRegistrationDraftStep("d-1", { lastStepReached: step });

      expect(fake.store.get("RegistrationDraft/d-1")!.lastStepReached).toBe(step);
    }
  });
});

describe("incrementAdminRegistrationDraftAttempt", () => {
  it("bumps only attempt (+ updatedAt) via FieldValue.increment", async () => {
    seedDraft("d-1");

    await incrementAdminRegistrationDraftAttempt("d-1");

    const update = fake.writes.find((w) => w.type === "update");
    expect(Object.keys(update!.data!).sort()).toEqual(["attempt", "updatedAt"]);
    // The increment sentinel, not a client-computed absolute value.
    expect(update!.data!.attempt).toEqual(FieldValue.increment(1));
  });
});

describe("getAdminRegistrationDraftsForEvent — abandoned surface (T5 AC-6)", () => {
  it("lists newest-updated first, org-scoped, with the DERIVED isAbandoned flag", async () => {
    const nowMs = Date.parse("2026-07-10T12:00:00Z");
    seedDraft("d-fresh", {
      updatedAt: Timestamp.fromMillis(nowMs - 60 * 60 * 1000), // 1h old
    });
    seedDraft("d-stale", {
      updatedAt: Timestamp.fromMillis(nowMs - 25 * 60 * 60 * 1000), // 25h old
    });
    seedDraft("d-exactly-24h", {
      updatedAt: Timestamp.fromMillis(nowMs - ABANDONED_AFTER_MS), // boundary: NOT abandoned
    });
    seedDraft("d-foreign", {
      organizationId: "org-other",
      updatedAt: Timestamp.fromMillis(nowMs),
    });

    const drafts = await getAdminRegistrationDraftsForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs,
    });

    expect(drafts.map((d) => d.id)).toEqual([
      "d-fresh",
      "d-exactly-24h",
      "d-stale",
    ]);
    expect(
      drafts.map((d) => [d.id, d.isAbandoned]),
    ).toEqual([
      ["d-fresh", false],
      ["d-exactly-24h", false],
      ["d-stale", true],
    ]);
    // The flag is derived, never stored.
    expect("isAbandoned" in fake.store.get("RegistrationDraft/d-stale")!).toBe(
      false,
    );
  });
});

describe("getAdminRegistrationDraftsReferencingPath (path-delete 409, bounded 5)", () => {
  it("matches drafts on the path, org-scoped, capped at the reference limit", async () => {
    for (let i = 0; i < 7; i += 1) {
      seedDraft(`d-${i}`, { updatedAt: Timestamp.fromMillis(i) });
    }
    seedDraft("d-other-path", { pathId: "path-2" });
    seedDraft("d-foreign", { organizationId: "org-other" });

    const referencing = await getAdminRegistrationDraftsReferencingPath({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pathId: PATH_ID,
    });

    expect(referencing).toHaveLength(5);
    expect(referencing.every((d) => d.pathId === PATH_ID)).toBe(true);
  });
});

describe("deleteAdminRegistrationDraft", () => {
  it("removes the doc (finalize calls this only after Order + FormData exist)", async () => {
    seedDraft("d-1");

    await deleteAdminRegistrationDraft("d-1");

    expect(fake.store.has("RegistrationDraft/d-1")).toBe(false);
  });
});
