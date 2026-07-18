// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Timestamp } from "firebase-admin/firestore";

type Row = Record<string, unknown>;
const rows = new Map<string, Row>();

function comparable(value: unknown): unknown {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis(): number }).toMillis();
  }
  return value;
}

function collection(name: string) {
  const filters: Array<[string, string, unknown]> = [];
  const query = {
    where(field: string, op: string, value: unknown) {
      filters.push([field, op, value]);
      return query;
    },
    count() {
      return {
        async get() {
          const matches = [...rows.entries()].filter(([path, row]) => {
            if (!path.startsWith(`${name}/`)) return false;
            return filters.every(([field, op, expected]) => {
              const actual = comparable(row[field]);
              const wanted = comparable(expected);
              if (op === "==") return actual === wanted;
              if (op === "<") return (actual as number) < (wanted as number);
              throw new Error(`unsupported ${op}`);
            });
          });
          return { data: () => ({ count: matches.length }) };
        },
      };
    },
  };
  return {
    ...query,
    doc(id: string) {
      return {
        async get() {
          const data = rows.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      };
    },
  };
}

vi.mock("@/app/lib/firestore", () => ({
  adminDb: { collection },
}));

const { ABANDONED_AFTER_MS, countAdminAbandonedRegistrationDraftsForEvent } =
  await import("@/lib/db/adminRegistrationDraft");
const { hasAdminCheckinConfigForEvent } = await import(
  "@/lib/db/adminCheckinConfig"
);

const NOW = 2_000_000_000;

beforeEach(() => rows.clear());

describe("countAdminAbandonedRegistrationDraftsForEvent", () => {
  it("uses the strict 24-hour boundary and excludes completed/deleted drafts", async () => {
    rows.set("RegistrationDraft/exact", {
      eventId: "evt-1",
      organizationId: "org-1",
      updatedAt: Timestamp.fromMillis(NOW - ABANDONED_AFTER_MS),
    });
    rows.set("RegistrationDraft/old", {
      eventId: "evt-1",
      organizationId: "org-1",
      updatedAt: Timestamp.fromMillis(NOW - ABANDONED_AFTER_MS - 1),
    });
    // A completed draft has been deleted, so there is intentionally no row.

    await expect(
      countAdminAbandonedRegistrationDraftsForEvent({
        eventId: "evt-1",
        organizationId: "org-1",
        nowMs: NOW,
      }),
    ).resolves.toBe(1);
  });

  it("isolates both event and organization", async () => {
    const old = Timestamp.fromMillis(NOW - ABANDONED_AFTER_MS - 1);
    rows.set("RegistrationDraft/owned", {
      eventId: "evt-1",
      organizationId: "org-1",
      updatedAt: old,
    });
    rows.set("RegistrationDraft/other-org", {
      eventId: "evt-1",
      organizationId: "org-2",
      updatedAt: old,
    });
    rows.set("RegistrationDraft/other-event", {
      eventId: "evt-2",
      organizationId: "org-1",
      updatedAt: old,
    });

    await expect(
      countAdminAbandonedRegistrationDraftsForEvent({
        eventId: "evt-1",
        organizationId: "org-1",
        nowMs: NOW,
      }),
    ).resolves.toBe(1);
  });
});

describe("hasAdminCheckinConfigForEvent", () => {
  it("returns false without a saved config and true for an owned config", async () => {
    await expect(
      hasAdminCheckinConfigForEvent({
        eventId: "evt-1",
        organizationId: "org-1",
      }),
    ).resolves.toBe(false);

    rows.set("CheckinConfig/evt-1", { organizationId: "org-1" });
    await expect(
      hasAdminCheckinConfigForEvent({
        eventId: "evt-1",
        organizationId: "org-1",
      }),
    ).resolves.toBe(true);
  });

  it("treats another organization's deterministic document as absent", async () => {
    rows.set("CheckinConfig/evt-1", { organizationId: "org-2" });
    await expect(
      hasAdminCheckinConfigForEvent({
        eventId: "evt-1",
        organizationId: "org-1",
      }),
    ).resolves.toBe(false);
  });
});
