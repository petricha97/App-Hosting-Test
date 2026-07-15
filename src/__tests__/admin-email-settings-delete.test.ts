// @vitest-environment node
/**
 * M6-T2 — deleteAdminEmailSettings (src/lib/db/adminEmailSettings.ts), the
 * Full-Stack DAL addition backing "Reset to platform default" (design §6 /
 * spec §6 AC-3). Flagged for Backend review — same conventions as the
 * existing EmailSettings DAL (doc id = eventId, tenancy re-checked).
 *
 * Locks:
 *  - deleting an existing doc removes it (subsequent get -> null, defaults
 *    resolve again);
 *  - deleting when NO doc exists is a harmless no-op (ok:true, idempotent);
 *  - cross-org delete attempt -> CROSS_ORG, ZERO writes (the doc survives).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  deleteAdminEmailSettings,
  getAdminEmailSettingsForEvent,
  upsertAdminEmailSettings,
} = await import("@/lib/db/adminEmailSettings");

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";
const EVENT_ID = "evt-1";
const DOC_PATH = `EmailSettings/${EVENT_ID}`;

const VALID_SETTINGS = {
  fromName: "Innovation Summit",
  fromAddress: "events@example.com",
  replyTo: null,
};

beforeEach(() => {
  fake.reset();
});

describe("deleteAdminEmailSettings", () => {
  it("removes an existing doc — subsequent reads resolve to null (defaults again)", async () => {
    await upsertAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      settings: VALID_SETTINGS,
    });
    expect(fake.store.has(DOC_PATH)).toBe(true);

    const result = await deleteAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(fake.store.has(DOC_PATH)).toBe(false);
    expect(
      await getAdminEmailSettingsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toBeNull();
  });

  it("is a harmless no-op when no doc exists yet (idempotent)", async () => {
    const result = await deleteAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(result).toEqual({ ok: true });
  });

  it("refuses a cross-org delete (CROSS_ORG), zero writes — the doc survives", async () => {
    await upsertAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      settings: VALID_SETTINGS,
    });

    const result = await deleteAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: OTHER_ORG_ID,
    });

    expect(result).toEqual({ ok: false, code: "CROSS_ORG" });
    expect(fake.store.has(DOC_PATH)).toBe(true);
  });
});
