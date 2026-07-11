// @vitest-environment node
/**
 * M5-T4 — CheckinConfig admin DAL (src/lib/db/adminCheckinConfig.ts).
 * Spec: agents/docs/specs/m5-attendees-checkin.md (T4 AC-3/AC-8).
 *
 * Locks:
 *  - doc id = eventId (1:1), LAZY: reads return the prototype defaults
 *    (Off/Off/On/On/On) with ZERO writes until the first save
 *  - first upsert creates defaults + patch; later upserts update ONLY the
 *    patched toggle keys
 *  - allow-list: unknown keys and non-boolean values are dropped;
 *    organizationId/eventId/createdAt are unreachable
 *  - tenancy: cross-org doc reads as defaults, cross-org upsert -> null
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  CHECKIN_CONFIG_DEFAULTS,
  getAdminCheckinConfigForEvent,
  upsertAdminCheckinConfig,
} = await import("@/lib/db/adminCheckinConfig");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const DOC_PATH = `CheckinConfig/${EVENT_ID}`;

beforeEach(() => {
  fake.reset();
});

describe("getAdminCheckinConfigForEvent — lazy read-time defaults (T4 AC-3)", () => {
  it("returns the prototype defaults with ZERO writes when no doc exists", async () => {
    const settings = await getAdminCheckinConfigForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(settings).toEqual({
      signatureCollection: false,
      photoCapture: false,
      photoIdVerification: true,
      selfPrintBadges: true,
      walletPasses: true,
    });
    expect(settings).toEqual(CHECKIN_CONFIG_DEFAULTS);
    expect(fake.writes).toHaveLength(0);
    expect(fake.store.has(DOC_PATH)).toBe(false);
  });

  it("returns stored toggles merged over defaults, never another tenant's", async () => {
    fake.store.set(DOC_PATH, {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      signatureCollection: true,
      photoCapture: false,
      photoIdVerification: false,
      selfPrintBadges: true,
      walletPasses: false,
    });

    expect(
      await getAdminCheckinConfigForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toEqual({
      signatureCollection: true,
      photoCapture: false,
      photoIdVerification: false,
      selfPrintBadges: true,
      walletPasses: false,
    });

    // Cross-org: defaults, not the stored doc (defensive IDOR guard).
    expect(
      await getAdminCheckinConfigForEvent({
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toEqual(CHECKIN_CONFIG_DEFAULTS);
  });
});

describe("upsertAdminCheckinConfig — allow-listed lazy upsert", () => {
  it("creates the doc on first save: defaults + patch + tenancy + timestamps", async () => {
    const settings = await upsertAdminCheckinConfig({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: { signatureCollection: true, walletPasses: false },
    });

    expect(settings).toEqual({
      signatureCollection: true,
      photoCapture: false,
      photoIdVerification: true,
      selfPrintBadges: true,
      walletPasses: false,
    });

    const stored = fake.store.get(DOC_PATH)!;
    expect(stored).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      ...settings,
    });
    expect(stored.createdAt).toBeDefined();
    expect(stored.updatedAt).toBeDefined();
  });

  it("later upserts update ONLY the patched keys and survive reload (T4 AC-3)", async () => {
    await upsertAdminCheckinConfig({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: { signatureCollection: true },
    });

    const settings = await upsertAdminCheckinConfig({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: { photoIdVerification: false },
    });

    expect(settings).toMatchObject({
      signatureCollection: true, // untouched by the second patch
      photoIdVerification: false,
    });
    expect(
      await getAdminCheckinConfigForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toEqual(settings);
  });

  it("strips unknown keys and non-boolean values (T4 AC-8) — server-owned fields unreachable", async () => {
    await upsertAdminCheckinConfig({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: {
        walletPasses: false,
        organizationId: "org-evil",
        eventId: "evt-evil",
        rogueKey: true,
        photoCapture: "yes",
      } as unknown as Parameters<typeof upsertAdminCheckinConfig>[0]["patch"],
    });

    const stored = fake.store.get(DOC_PATH)!;
    expect(stored.organizationId).toBe(ORG_ID);
    expect(stored.eventId).toBe(EVENT_ID);
    expect(stored.rogueKey).toBeUndefined();
    expect(stored.photoCapture).toBe(false); // default kept, "yes" dropped
    expect(stored.walletPasses).toBe(false);
  });

  it("returns null (route 404) instead of merging into another tenant's doc", async () => {
    fake.store.set(DOC_PATH, {
      organizationId: "org-other",
      eventId: EVENT_ID,
      ...CHECKIN_CONFIG_DEFAULTS,
    });
    const writesBefore = fake.writes.length;

    const result = await upsertAdminCheckinConfig({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: { signatureCollection: true },
    });

    expect(result).toBeNull();
    expect(fake.writes).toHaveLength(writesBefore);
    expect(fake.store.get(DOC_PATH)!.organizationId).toBe("org-other");
  });

  it("an empty (fully stripped) patch on an existing doc performs zero writes", async () => {
    await upsertAdminCheckinConfig({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: { signatureCollection: true },
    });
    const writesBefore = fake.writes.length;

    const settings = await upsertAdminCheckinConfig({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      patch: { rogue: true } as unknown as Parameters<
        typeof upsertAdminCheckinConfig
      >[0]["patch"],
    });

    expect(settings).toMatchObject({ signatureCollection: true });
    expect(fake.writes).toHaveLength(writesBefore);
  });
});
