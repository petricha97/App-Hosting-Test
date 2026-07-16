// @vitest-environment node
/**
 * M6-T4 — bodyMode/bodyBlocks join the SAME editable-fields bucket as
 * subject/body in src/lib/db/adminEmailDefinition.ts (spec §2: "editable
 * for both isSystem and custom definitions... NOT a new locked-field
 * category"). Companion to admin-email-definition.test.ts (unmodified by
 * this ticket) — kept as a separate file to avoid touching a test file a
 * parallel agent may also be editing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { upsertAdminEmailDefinition } =
  await import("@/lib/db/adminEmailDefinition");

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

const SAMPLE_BLOCKS = [
  {
    id: "hero-1",
    type: "Hero" as const,
    props: {
      eyebrow: "",
      heading: "Welcome",
      body: "",
      primaryCtaLabel: "",
      secondaryCtaLabel: "",
      imageUrl: "",
    },
  },
];

beforeEach(() => {
  fake.reset();
});

describe("bodyMode/bodyBlocks — new docs default to text/[] and are settable at create (spec §2 AC-5)", () => {
  it("a brand-new SYSTEM definition materializes with bodyMode 'text' and bodyBlocks [] when the patch doesn't mention them", async () => {
    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.definition.bodyMode).toBe("text");
    expect(result.definition.bodyBlocks).toEqual([]);
  });

  it("a brand-new definition can be created directly in block mode via the patch", async () => {
    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-1",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: { bodyMode: "blocks", bodyBlocks: SAMPLE_BLOCKS },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.definition.bodyMode).toBe("blocks");
    expect(result.definition.bodyBlocks).toEqual(SAMPLE_BLOCKS);
  });
});

describe("bodyMode/bodyBlocks — editable for isSystem:true definitions (spec §2: NOT a new locked-field category)", () => {
  it("a SYSTEM definition accepts a bodyMode/bodyBlocks patch with ZERO locked-field rejection", async () => {
    await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: {},
    });

    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "confirmation-paid",
      isSystem: true,
      ifAbsent: SYSTEM_IF_ABSENT,
      patch: { bodyMode: "blocks", bodyBlocks: SAMPLE_BLOCKS },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.definition.bodyMode).toBe("blocks");
    expect(result.definition.bodyBlocks).toEqual(SAMPLE_BLOCKS);

    const stored = fake.store.get(
      `EmailDefinition/${result.definition.id}`,
    ) as Record<string, unknown>;
    expect(stored.bodyMode).toBe("blocks");
    expect(stored.bodyBlocks).toEqual(SAMPLE_BLOCKS);
  });

  it("a CUSTOM definition accepts the exact same patch shape (identical editability, spec §2)", async () => {
    const created = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-2",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {},
    });
    if (!created.ok) throw new Error("unreachable");

    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-2",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: { bodyMode: "blocks", bodyBlocks: SAMPLE_BLOCKS },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.definition.bodyMode).toBe("blocks");
  });
});

describe("bodyMode round-trip: switching modes never deletes the other mode's content (spec §2 AC-4)", () => {
  it("block -> text -> block preserves bodyBlocks byte-for-byte", async () => {
    const created = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-3",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: { bodyMode: "blocks", bodyBlocks: SAMPLE_BLOCKS },
    });
    if (!created.ok) throw new Error("unreachable");

    // Switch to text mode WITHOUT sending bodyBlocks at all (mirrors the
    // dialog's "only the mode you save in changes" contract) — bodyBlocks
    // must remain untouched in storage.
    const switchedToText = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-3",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: { bodyMode: "text" },
    });
    expect(switchedToText.ok).toBe(true);
    if (!switchedToText.ok) throw new Error("unreachable");
    expect(switchedToText.definition.bodyMode).toBe("text");
    expect(switchedToText.definition.bodyBlocks).toEqual(SAMPLE_BLOCKS);

    const switchedBackToBlocks = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-3",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: { bodyMode: "blocks" },
    });
    expect(switchedBackToBlocks.ok).toBe(true);
    if (!switchedBackToBlocks.ok) throw new Error("unreachable");
    expect(switchedBackToBlocks.definition.bodyMode).toBe("blocks");
    expect(switchedBackToBlocks.definition.bodyBlocks).toEqual(SAMPLE_BLOCKS);
  });
});

describe("write-time rejection (spec §2 AC-2/AC-3) — re-verified at the DAL boundary", () => {
  it("rejects an unsafe imageUrl inside a Hero block with zero writes", async () => {
    const writesBefore = fake.writes.length;
    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-4",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: {
        bodyMode: "blocks",
        bodyBlocks: [
          {
            id: "hero-1",
            type: "Hero",
            props: {
              eyebrow: "",
              heading: "Welcome",
              body: "",
              primaryCtaLabel: "",
              secondaryCtaLabel: "",
              imageUrl: "javascript:alert(1)",
            },
          },
        ],
      },
    });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("rejects more than 20 blocks with zero writes", async () => {
    const tooManyBlocks = Array.from({ length: 21 }, (_, i) => ({
      id: `schedule-${i}`,
      type: "Schedule" as const,
      props: { title: "Agenda", agenda: "09:00 Doors" },
    }));
    const writesBefore = fake.writes.length;
    const result = await upsertAdminEmailDefinition({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      kind: "custom-5",
      isSystem: false,
      ifAbsent: CUSTOM_IF_ABSENT,
      patch: { bodyMode: "blocks", bodyBlocks: tooManyBlocks },
    });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fake.writes).toHaveLength(writesBefore);
  });
});
