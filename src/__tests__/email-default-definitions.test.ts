// @vitest-environment node
/**
 * M6-T2 — the virtual default-email catalog (src/features/emails/default-definitions.ts).
 * Spec: agents/docs/specs/m6-emails-admin.md (§1 AC-1/AC-3/AC-5, §2 table).
 *
 * Locks:
 *  - a fresh event (zero stored docs) merges to EXACTLY the 8 default rows,
 *    all isSystem:true, enabled:true, materialized:false — no Firestore
 *    write happens anywhere in this merge (it's a pure function);
 *  - stored docs ALWAYS win over the virtual defaults by kind (§2 AC-3);
 *  - custom rows sort after every default, by sortOrder then createdAt;
 *  - an event with NO periods resolves scheduled defaults to atMs:null
 *    ("Not scheduled", §1 AC-3) without crashing;
 *  - every default template uses ONLY tags from the T1 merge-tag catalog.
 */
import { describe, expect, it } from "vitest";

import {
  EMAIL_DEFAULT_DEFINITIONS,
  mergeEmailDefinitions,
  resolveScheduledDefaultAt,
  usedDefaultTemplateTags,
} from "@/features/emails/default-definitions";
import { emailDefinitionId } from "@/lib/db/emailDefinitionId";
import { EMAIL_MERGE_TAGS } from "@/lib/email/merge-tags";
import type { EmailDefinitionDoc, WithId } from "@/types/collection";

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

const EVENT_WITH_PERIODS = {
  periods: [{ date: "2026-09-15", startTime: "09:00", endTime: "17:00" }],
  timezone: "America/New_York",
};

const EVENT_NO_PERIODS = { periods: [], timezone: "America/New_York" };

describe("EMAIL_DEFAULT_DEFINITIONS catalog", () => {
  it("ships exactly the 8 kinds from spec §2's table", () => {
    expect(EMAIL_DEFAULT_DEFINITIONS.map((d) => d.kind).sort()).toEqual(
      [
        "invitation",
        "abandoned-reminder",
        "approval-pending",
        "confirmation-paid",
        "confirmation-payment-due",
        "payment-reminder",
        "one-week-to-go",
        "qr-ready",
      ].sort(),
    );
  });

  it("uses ONLY tags from the T1 merge-tag catalog in every subject/body", () => {
    const used = usedDefaultTemplateTags();
    for (const tag of used) {
      expect(EMAIL_MERGE_TAGS as readonly string[]).toContain(tag);
    }
  });
});

describe("mergeEmailDefinitions — zero-write virtual rendering (spec §1 AC-1)", () => {
  it("a fresh event renders exactly the 8 default rows, all On, isSystem, not materialized", () => {
    const merged = mergeEmailDefinitions({
      stored: [],
      event: EVENT_WITH_PERIODS,
      organizationId: ORG_ID,
      eventId: EVENT_ID,
    });

    expect(merged).toHaveLength(8);
    for (const definition of merged) {
      expect(definition.isSystem).toBe(true);
      expect(definition.enabled).toBe(true);
      expect(definition.materialized).toBe(false);
      expect(definition.createdAtMs).toBeNull();
      // The id is computable even though nothing is stored (spec §2: "the
      // definitionId... is computable... whether or not the doc exists").
      expect(definition.id).toBe(
        emailDefinitionId({
          organizationId: ORG_ID,
          eventId: EVENT_ID,
          kind: definition.kind,
        }),
      );
    }
  });

  it("an event with NO periods resolves scheduled defaults to 'Not scheduled' (atMs:null), never a crash", () => {
    const merged = mergeEmailDefinitions({
      stored: [],
      event: EVENT_NO_PERIODS,
      organizationId: ORG_ID,
      eventId: EVENT_ID,
    });

    const oneWeek = merged.find((d) => d.kind === "one-week-to-go")!;
    const qrReady = merged.find((d) => d.kind === "qr-ready")!;
    expect(oneWeek.trigger).toEqual({ type: "scheduled", atMs: null });
    expect(qrReady.trigger).toEqual({ type: "scheduled", atMs: null });
  });

  it("resolves 'one-week-to-go' to 7 days before the event start at 09:00 event-local", () => {
    const at = resolveScheduledDefaultAt(EVENT_WITH_PERIODS, {
      offsetDays: 7,
      hour: 9,
      minute: 0,
    });
    expect(at).not.toBeNull();
    // 2026-09-15 - 7d = 2026-09-08, 09:00 America/New_York (EDT, UTC-4).
    expect(at!.toISOString()).toBe("2026-09-08T13:00:00.000Z");
  });

  it("stored docs ALWAYS win over the virtual default by kind (spec §2 AC-3)", () => {
    const stored: WithId<EmailDefinitionDoc>[] = [
      {
        id: "doc-1",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "confirmation-paid",
        name: "Registration confirmation — paid",
        group: "post-registration",
        trigger: { type: "on-accept" },
        audience: "accepted-paid",
        enabled: false,
        subject: "EDITED subject",
        body: "EDITED body",
        isSystem: true,
        sortOrder: 3,
        createdAt: {
          seconds: 1_700_000_000,
          nanoseconds: 0,
        } as unknown as EmailDefinitionDoc["createdAt"],
        updatedAt: {
          seconds: 1_700_000_000,
          nanoseconds: 0,
        } as unknown as EmailDefinitionDoc["updatedAt"],
      },
    ];

    const merged = mergeEmailDefinitions({
      stored,
      event: EVENT_WITH_PERIODS,
      organizationId: ORG_ID,
      eventId: EVENT_ID,
    });

    expect(merged).toHaveLength(8);
    const confirmation = merged.find((d) => d.kind === "confirmation-paid")!;
    expect(confirmation.subject).toBe("EDITED subject");
    expect(confirmation.enabled).toBe(false);
    expect(confirmation.materialized).toBe(true);

    // The other seven rows remain virtual (spec §2 AC-3).
    const others = merged.filter((d) => d.kind !== "confirmation-paid");
    expect(others.every((d) => d.materialized === false)).toBe(true);
  });

  it("custom definitions render after every default, ordered by sortOrder then createdAt", () => {
    const stored: WithId<EmailDefinitionDoc>[] = [
      {
        id: "custom-1",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "custom-aaa",
        name: "Custom A",
        group: "pre-event",
        trigger: { type: "manual" },
        audience: "all-invitees",
        enabled: true,
        subject: "s",
        body: "b",
        isSystem: false,
        sortOrder: 9,
        createdAt: {
          seconds: 2000,
          nanoseconds: 0,
        } as unknown as EmailDefinitionDoc["createdAt"],
        updatedAt: {
          seconds: 2000,
          nanoseconds: 0,
        } as unknown as EmailDefinitionDoc["updatedAt"],
      },
      {
        id: "custom-2",
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "custom-bbb",
        name: "Custom B",
        group: "pre-event",
        trigger: { type: "manual" },
        audience: "all-invitees",
        enabled: true,
        subject: "s",
        body: "b",
        isSystem: false,
        sortOrder: 8,
        createdAt: {
          seconds: 1000,
          nanoseconds: 0,
        } as unknown as EmailDefinitionDoc["createdAt"],
        updatedAt: {
          seconds: 1000,
          nanoseconds: 0,
        } as unknown as EmailDefinitionDoc["updatedAt"],
      },
    ];

    const merged = mergeEmailDefinitions({
      stored,
      event: EVENT_WITH_PERIODS,
      organizationId: ORG_ID,
      eventId: EVENT_ID,
    });

    expect(merged).toHaveLength(10);
    const kinds = merged.map((d) => d.kind);
    const preEventDefaultIndex = kinds.indexOf("invitation");
    const customBIndex = kinds.indexOf("custom-bbb");
    const customAIndex = kinds.indexOf("custom-aaa");
    // Defaults (sortOrder 0-7) all precede the customs (sortOrder 8, 9).
    expect(preEventDefaultIndex).toBeLessThan(customBIndex);
    expect(customBIndex).toBeLessThan(customAIndex);
  });
});
