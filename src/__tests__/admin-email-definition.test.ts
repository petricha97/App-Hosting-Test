// @vitest-environment node
/**
 * M6-T2 — EmailDefinition DAL (src/lib/db/adminEmailDefinition.ts).
 * Spec: agents/docs/specs/m6-emails-admin.md (§2 AC 1-6).
 *
 * Locks:
 *  - create-if-absent at the deterministic id: concurrent upserts for the
 *    same kind collapse onto EXACTLY ONE doc
 *  - locked-field enforcement on isSystem:true docs (name/group/audience/
 *    trigger-type) -> typed LOCKED_FIELDS, zero writes
 *  - custom (isSystem:false) trigger type restricted to manual/scheduled
 *  - cross-org/cross-event reads and writes -> typed NOT_FOUND, zero writes
 *  - 100-per-event cap enforced at create only
 *  - delete: custom only; system defaults -> typed SYSTEM_LOCKED, zero
 *    writes; deleting a custom definition never touches EmailMessage
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  EMAIL_DEFINITION_LIST_LIMIT,
  MAX_EMAIL_DEFINITIONS_PER_EVENT,
  deleteAdminEmailDefinition,
  getAdminEmailDefinitionByKind,
  getAdminEmailDefinitionForEvent,
  listAdminEmailDefinitionsForEvent,
  mintCustomEmailDefinitionKind,
  upsertAdminEmailDefinition,
} = await import("@/lib/db/adminEmailDefinition");
const { emailDefinitionId } = await import("@/lib/db/emailDefinitionId");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

const SYSTEM_IF_ABSENT = {
  name: "Registration confirmation — paid",
  group: "post-registration" as const,
  trigger: { type: "on-accept" as const },
  audience: "accepted-paid" as const,
  enabled: true,
  subject: "Registration confirmed — {event_title}",
  body: "Dear {first_name}, your pass is confirmed.",
  sortOrder: 0,
};

const SCHEDULED_SYSTEM_IF_ABSENT = {
  name: "One week to go",
  group: "debt-chase" as const,
  trigger: { type: "scheduled" as const, at: null },
  audience: "accepted-all" as const,
  enabled: true,
  subject: "One week to go — {event_title}",
  body: "See you soon, {first_name}.",
  sortOrder: 0,
};

const CUSTOM_IF_ABSENT = {
  name: "VIP reminder",
  group: "pre-event" as const,
  trigger: { type: "manual" as const },
  audience: "all-invitees" as const,
  enabled: true,
  subject: "A quick reminder",
  body: "Hi {first_name}, see you there.",
  sortOrder: 5,
};

beforeEach(() => {
  fake.reset();
});

describe("upsertAdminEmailDefinition — materialize on first edit (AC-1)", () => {
  it("creates a doc at the deterministic id for a system default's first edit", async () => {
    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: { subject: "Custom subject — {event_title}" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.created).toBe(true);

    const expectedId = emailDefinitionId({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
    });
    expect(result.definition.id).toBe(expectedId);
    expect(fake.store.get(`EmailDefinition/${expectedId}`)).toMatchObject({
      kind: "confirmation-paid",
      isSystem: true,
      subject: "Custom subject — {event_title}",
      // Untouched fields fall back to the catalog default.
      body: SYSTEM_IF_ABSENT.body,
      name: SYSTEM_IF_ABSENT.name,
    });
  });

  it("a replayed upsert for the SAME kind collapses onto exactly one doc (create-if-absent race, M6-T1 pattern)", async () => {
    // The in-memory fake models Firestore's read-write race guard
    // (tx.create throws on an already-materialized path) but not automatic
    // transaction RETRY on contention — so, like adminEmailMessage.test.ts's
    // "collapses a duplicate enqueue" case, this exercises the race guard
    // via a REPLAYED call rather than a literal Promise.all: a genuinely
    // concurrent pair of calls in production would have the loser's
    // transaction retried by the Firestore client and observe the winner's
    // doc on replay, landing in the SAME update branch asserted here.
    const call = () =>
      upsertAdminEmailDefinition({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "confirmation-paid",
        isSystem: true,
        ifAbsent: SYSTEM_IF_ABSENT,
        patch: { enabled: false },
      });

    const first = await call();
    const second = await call();

    expect(first.ok && first.created).toBe(true);
    expect(second.ok && second.created).toBe(false);

    const definitionId = emailDefinitionId({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
    });
    const allDocsForKind = [...fake.store.keys()].filter((key) =>
      key.startsWith("EmailDefinition/"),
    );
    expect(allDocsForKind).toEqual([`EmailDefinition/${definitionId}`]);
  });

  it("a second call updates the SAME doc — no duplicates, stored values win", async () => {
    const first = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: { subject: "First edit" },
    });
    expect(first.ok && first.created).toBe(true);

    const second = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: { subject: "Second edit" },
    });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.created).toBe(false);
    expect(second.definition.subject).toBe("Second edit");

    const definitionId = emailDefinitionId({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
    });
    const allDocsForKind = [...fake.store.keys()].filter((key) =>
      key.startsWith("EmailDefinition/"),
    );
    expect(allDocsForKind).toEqual([`EmailDefinition/${definitionId}`]);
  });

  it("creates a brand-new custom definition with a server-minted kind", async () => {
    const kind = mintCustomEmailDefinitionKind();
    expect(kind).toMatch(/^custom-[0-9a-f-]{36}$/);

    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind,
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.created).toBe(true);
    expect(result.definition.isSystem).toBe(false);
    expect(result.definition.kind).toBe(kind);
  });
});

describe("locked-field rejection on system definitions (AC-2)", () => {
  it("rejects name/group/audience edits on a system definition — zero writes", async () => {
    await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });
    const writesBefore = fake.writes.length;

    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: { name: "Renamed", group: "pre-event", audience: "abandoned" },
    });

    expect(result).toEqual({
      ok: false,
      code: "LOCKED_FIELDS",
      fields: ["name", "group", "audience"],
    });
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("rejects a trigger TYPE change on a system definition, but allows the scheduled datetime to change", async () => {
    await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "one-week-to-go",
      isSystem: true,
      ifAbsent: SCHEDULED_SYSTEM_IF_ABSENT,
      patch: {},
    });

    const typeChange = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "one-week-to-go",
      isSystem: true,
      ifAbsent: SCHEDULED_SYSTEM_IF_ABSENT,
      patch: { trigger: { type: "manual" } },
    });
    expect(typeChange).toEqual({
      ok: false,
      code: "LOCKED_FIELDS",
      fields: ["trigger"],
    });

    const dateChange = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "one-week-to-go",
      isSystem: true,
      ifAbsent: SCHEDULED_SYSTEM_IF_ABSENT,
      patch: {
        trigger: { type: "scheduled", at: new Date("2026-09-01T09:00:00Z") },
      },
    });
    expect(dateChange.ok).toBe(true);
  });

  it("rejects a lifecycle auto-trigger on a CUSTOM definition (OQ-1 default: manual/scheduled only)", async () => {
    const kind = mintCustomEmailDefinitionKind();

    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind,
      isSystem: false,
      ifAbsent: { ...CUSTOM_IF_ABSENT, trigger: { type: "on-accept" } },
      patch: {},
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION",
      issues: ["Custom emails may only use a Manual or Scheduled trigger."],
    });
    expect(fake.store.size).toBe(0);
  });

  it("rejects out-of-bounds Zod input (oversized subject, non-positive offsetsDays) with zero writes", async () => {
    const oversizedSubject = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: { subject: "x".repeat(256) },
    });
    expect(oversizedSubject.ok).toBe(false);
    expect(oversizedSubject).toMatchObject({ code: "VALIDATION" });

    const badOffsets = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "payment-reminder",
      isSystem: true,
      ifAbsent: {
        ...SYSTEM_IF_ABSENT,
        trigger: { type: "unpaid-offsets", offsetsDays: [7, -1, 21] },
      },
      patch: {},
    });
    expect(badOffsets.ok).toBe(false);
    expect(badOffsets).toMatchObject({ code: "VALIDATION" });

    expect(fake.store.size).toBe(0);
  });
});

describe("cross-org/cross-event isolation (AC-4)", () => {
  it("reads on an id owned by another org/event answer null with ZERO writes", async () => {
    await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });

    // Simulate a hash-collision-shaped cross-tenant doc directly, since the
    // deterministic id makes a REAL cross-org collision cryptographically
    // unreachable — this exercises the defense-in-depth tenancy re-check.
    const foreignId = emailDefinitionId({
      organizationId: "org-2",
      eventId: "evt-2",
      kind: "confirmation-paid",
    });
    fake.store.set(`EmailDefinition/${foreignId}`, {
      organizationId: "org-2",
      eventId: "evt-2",
      kind: "confirmation-paid",
      ...SYSTEM_IF_ABSENT,
      isSystem: true,
      createdAt: { seconds: 1 },
      updatedAt: { seconds: 1 },
    });

    const writesBefore = fake.writes.length;
    const crossOrgResult = await getAdminEmailDefinitionForEvent({
      definitionId: foreignId,
      eventId: "evt-2",
      organizationId: "org-1",
    });
    expect(crossOrgResult).toBeNull();
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("upsert against an id whose STORED doc belongs to another org answers NOT_FOUND with ZERO writes", async () => {
    // Same contrivance as above, but exercised through the upsert
    // transaction's own tenancy re-check rather than a plain read: a doc
    // already sits at the id ORG_ID/EVENT_ID/"confirmation-paid" would
    // resolve to, but is stamped with a DIFFERENT organizationId (only
    // reachable via out-of-band corruption, since the id is otherwise
    // derived from that exact tuple).
    const definitionId = emailDefinitionId({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
    });
    fake.store.set(`EmailDefinition/${definitionId}`, {
      organizationId: "org-other",
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      ...SYSTEM_IF_ABSENT,
      isSystem: true,
      createdAt: { seconds: 1 },
      updatedAt: { seconds: 1 },
    });
    const writesBefore = fake.writes.length;

    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: { subject: "Attempted takeover" },
    });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.get(`EmailDefinition/${definitionId}`)).toMatchObject({
      organizationId: "org-other",
      subject: SYSTEM_IF_ABSENT.subject,
    });
  });

  it("getAdminEmailDefinitionForEvent / ByKind never return another org's doc", async () => {
    await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });

    expect(
      await getAdminEmailDefinitionByKind({
        kind: "confirmation-paid",
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toBeNull();
    expect(
      await getAdminEmailDefinitionByKind({
        kind: "confirmation-paid",
        eventId: "evt-other",
        organizationId: ORG_ID,
      }),
    ).toBeNull();
    expect(
      await getAdminEmailDefinitionByKind({
        kind: "confirmation-paid",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toMatchObject({ kind: "confirmation-paid" });
  });

  it("listAdminEmailDefinitionsForEvent never returns another org's rows", async () => {
    await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });
    await upsertAdminEmailDefinition({
      organizationId: "org-other",
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });

    const rows = await listAdminEmailDefinitionsForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.organizationId === ORG_ID)).toBe(true);
    expect(EMAIL_DEFINITION_LIST_LIMIT).toBe(200);
  });
});

describe("100-per-event cap (spec §2)", () => {
  it("enforces the cap only at CREATE — existing docs remain editable at the cap", async () => {
    expect(MAX_EMAIL_DEFINITIONS_PER_EVENT).toBe(100);

    for (let i = 0; i < MAX_EMAIL_DEFINITIONS_PER_EVENT; i += 1) {
      const result = await upsertAdminEmailDefinition({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: `custom-${i}`,
        isSystem: false,
        ifAbsent: CUSTOM_IF_ABSENT,
        patch: {},
      });
      expect(result.ok).toBe(true);
    }

    const overCap = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-over-cap",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {},
    });
    expect(overCap).toEqual({ ok: false, code: "CAP_REACHED" });

    // A DIFFERENT event is unaffected by this event's cap.
    const otherEvent = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: "evt-other",
      kind: "custom-0",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {},
    });
    expect(otherEvent.ok).toBe(true);

    // Editing an existing doc at the cap still succeeds (cap only blocks
    // NEW docs).
    const editAtCap = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-0",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: { subject: "Edited at cap" },
    });
    expect(editAtCap.ok).toBe(true);
    if (editAtCap.ok) {
      expect(editAtCap.created).toBe(false);
      expect(editAtCap.definition.subject).toBe("Edited at cap");
    }
  });
});

describe("deleteAdminEmailDefinition — custom only (AC-5/AC-6)", () => {
  it("deletes a custom definition", async () => {
    const kind = mintCustomEmailDefinitionKind();
    const created = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind,
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {},
    });
    if (!created.ok) throw new Error("unreachable");

    const result = await deleteAdminEmailDefinition({
      definitionId: created.definition.id,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(fake.store.has(`EmailDefinition/${created.definition.id}`)).toBe(
      false,
    );
  });

  it("refuses to delete a system definition — typed SYSTEM_LOCKED, zero writes", async () => {
    const created = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });
    if (!created.ok) throw new Error("unreachable");
    const writesBefore = fake.writes.length;

    const result = await deleteAdminEmailDefinition({
      definitionId: created.definition.id,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual({ ok: false, code: "SYSTEM_LOCKED" });
    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.has(`EmailDefinition/${created.definition.id}`)).toBe(
      true,
    );
  });

  it("answers NOT_FOUND for missing AND cross-org/cross-event ids, zero writes", async () => {
    const created = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: mintCustomEmailDefinitionKind(),
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {},
    });
    if (!created.ok) throw new Error("unreachable");
    const writesBefore = fake.writes.length;

    expect(
      await deleteAdminEmailDefinition({
        definitionId: "missing",
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await deleteAdminEmailDefinition({
        definitionId: created.definition.id,
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await deleteAdminEmailDefinition({
        definitionId: created.definition.id,
        eventId: "evt-other",
        organizationId: ORG_ID,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("deleting a custom definition never touches its historical EmailMessage rows (audit retention)", async () => {
    const created = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: mintCustomEmailDefinitionKind(),
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {},
    });
    if (!created.ok) throw new Error("unreachable");

    fake.store.set("EmailMessage/msg-1", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      definitionId: created.definition.id,
      kind: created.definition.kind,
      status: "sent",
    });

    await deleteAdminEmailDefinition({
      definitionId: created.definition.id,
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(fake.store.get("EmailMessage/msg-1")).toMatchObject({
      definitionId: created.definition.id,
      kind: created.definition.kind,
      status: "sent",
    });
  });
});
