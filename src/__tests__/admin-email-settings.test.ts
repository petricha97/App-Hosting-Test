// @vitest-environment node
/**
 * M6-T1 — EmailSettings DAL (src/lib/db/adminEmailSettings.ts) + sender
 * identity resolution (src/lib/email/sender-identity.ts).
 * Spec: agents/docs/specs/m6-email-infrastructure.md (§4 AC 1-4).
 *
 * Locks:
 *  - doc id = eventId, LAZY: reads NEVER write; no doc -> null from the DAL
 *    and in-memory defaults from resolveEmailSenderIdentity
 *  - defaults: fromName = event name (header-sanitized), fromAddress =
 *    EMAIL_DEFAULT_FROM, dev fallback "events@dev.local" with a ONE-TIME
 *    warn; non-dev transport without the env var FAILS CLOSED
 *  - Zod at write: invalid addresses / newlines / oversized values rejected
 *    as typed VALIDATION results; addresses lowercased
 *  - tenancy: cross-org getter -> null; cross-org upsert -> CROSS_ORG with
 *    zero writes (IDOR-safe)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { getAdminEmailSettingsForEvent, upsertAdminEmailSettings } =
  await import("@/lib/db/adminEmailSettings");
const { DEV_FALLBACK_FROM_ADDRESS, resolveEmailSenderIdentity } =
  await import("@/lib/email/sender-identity");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const DOC_PATH = `EmailSettings/${EVENT_ID}`;

const VALID_SETTINGS = {
  fromName: "Innovation Summit",
  fromAddress: "events@example.com",
  replyTo: null,
};

beforeEach(() => {
  fake.reset();
  vi.unstubAllEnvs();
});

describe("getAdminEmailSettingsForEvent — lazy, tenant-scoped (AC-1/AC-4)", () => {
  it("returns null with ZERO writes when no doc exists (no lazy write on read)", async () => {
    const settings = await getAdminEmailSettingsForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(settings).toBeNull();
    expect(fake.writes).toHaveLength(0);
    expect(fake.store.has(DOC_PATH)).toBe(false);
  });

  it("returns the stored doc for the owning org and null for any other org", async () => {
    fake.store.set(DOC_PATH, {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      ...VALID_SETTINGS,
    });

    expect(
      await getAdminEmailSettingsForEvent({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
      }),
    ).toMatchObject({ fromAddress: "events@example.com" });

    expect(
      await getAdminEmailSettingsForEvent({
        eventId: EVENT_ID,
        organizationId: "org-other",
      }),
    ).toBeNull();
  });
});

describe("upsertAdminEmailSettings — Zod at write (AC-2/AC-3)", () => {
  it("creates the doc lazily on first save with server-owned org/event fields", async () => {
    const result = await upsertAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      settings: VALID_SETTINGS,
    });

    expect(result.ok).toBe(true);
    expect(fake.store.get(DOC_PATH)).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      fromName: "Innovation Summit",
      fromAddress: "events@example.com",
      replyTo: null,
    });
  });

  it("lowercases addresses and accepts a replyTo", async () => {
    const result = await upsertAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      settings: {
        fromName: "Events Team",
        fromAddress: "Events@Example.COM",
        replyTo: "Reply@Example.COM",
      },
    });

    expect(result.ok).toBe(true);
    expect(fake.store.get(DOC_PATH)).toMatchObject({
      fromAddress: "events@example.com",
      replyTo: "reply@example.com",
    });
  });

  it.each([
    ["not an email", { ...VALID_SETTINGS, fromAddress: "not-an-email" }],
    [
      "embedded newline",
      { ...VALID_SETTINGS, fromAddress: "a@b.com\nBcc: x@y.com" },
    ],
    [
      "over 254 chars",
      { ...VALID_SETTINGS, fromAddress: `${"a".repeat(250)}@example.com` },
    ],
    [
      "header-unsafe from name",
      { ...VALID_SETTINGS, fromName: 'Events <evil@x.com>"' },
    ],
    ["invalid replyTo", { ...VALID_SETTINGS, replyTo: "nope" }],
  ])(
    "rejects %s as a typed VALIDATION result with zero writes",
    async (_label, settings) => {
      const result = await upsertAdminEmailSettings({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        settings,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION");
      expect(fake.writes).toHaveLength(0);
    },
  );

  it("updates only the identity fields on a later save and 404s cross-org", async () => {
    await upsertAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      settings: VALID_SETTINGS,
    });
    const createdAt = fake.store.get(DOC_PATH)!.createdAt;

    const updated = await upsertAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      settings: { ...VALID_SETTINGS, fromAddress: "new@example.com" },
    });
    expect(updated.ok).toBe(true);
    expect(fake.store.get(DOC_PATH)).toMatchObject({
      fromAddress: "new@example.com",
      createdAt,
      organizationId: ORG_ID,
    });

    const writesBefore = fake.writes.length;
    const crossOrg = await upsertAdminEmailSettings({
      eventId: EVENT_ID,
      organizationId: "org-other",
      settings: VALID_SETTINGS,
    });
    expect(crossOrg).toEqual({ ok: false, code: "CROSS_ORG" });
    expect(fake.writes).toHaveLength(writesBefore);
  });
});

describe("resolveEmailSenderIdentity — read-time defaults (AC-1)", () => {
  it("resolves the documented defaults with ZERO writes when no doc exists", async () => {
    vi.stubEnv("EMAIL_DEFAULT_FROM", "noreply@configured.com");

    const identity = await resolveEmailSenderIdentity({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      eventName: "Innovation Summit",
    });

    expect(identity).toEqual({
      fromName: "Innovation Summit",
      fromAddress: "noreply@configured.com",
      replyTo: null,
      source: "defaults",
    });
    expect(fake.writes).toHaveLength(0);
    expect(fake.store.has(DOC_PATH)).toBe(false);
  });

  it("prefers the stored doc when one exists", async () => {
    fake.store.set(DOC_PATH, {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      fromName: "The Economist Events",
      fromAddress: "events@economist.com",
      replyTo: "rsvp@economist.com",
    });

    const identity = await resolveEmailSenderIdentity({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      eventName: "Innovation Summit",
    });

    expect(identity).toEqual({
      fromName: "The Economist Events",
      fromAddress: "events@economist.com",
      replyTo: "rsvp@economist.com",
      source: "settings",
    });
  });

  it("sanitizes the default fromName derived from the event name (header safety)", async () => {
    vi.stubEnv("EMAIL_DEFAULT_FROM", "noreply@configured.com");

    const identity = await resolveEmailSenderIdentity({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      eventName: ' Ken\'s "Big" <Launch>\r\n Party ',
    });

    expect(identity.fromName).toBe("Ken's Big Launch Party");
  });

  it("falls back to the dev address with a ONE-TIME warn under the dev-outbox transport", async () => {
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fresh = await import("@/lib/email/sender-identity");

    expect(fresh.resolveDefaultFromAddress()).toBe(DEV_FALLBACK_FROM_ADDRESS);
    expect(fresh.resolveDefaultFromAddress()).toBe(DEV_FALLBACK_FROM_ADDRESS);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("FAILS CLOSED when a non-dev transport is configured without EMAIL_DEFAULT_FROM", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "sendgrid");

    vi.resetModules();
    const fresh = await import("@/lib/email/sender-identity");

    expect(() => fresh.resolveDefaultFromAddress()).toThrow(
      /EMAIL_DEFAULT_FROM/,
    );
  });
});
