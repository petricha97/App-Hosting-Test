// @vitest-environment node
/**
 * M7-T2 — Email overview report loader.
 * Spec: agents/docs/specs/m7-report-templates.md §5.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { loadEmailOverviewPage, loadEmailOverviewExport } =
  await import("@/features/reports/server/load-email-overview");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function seedMessage(id: string, overrides: Record<string, unknown> = {}) {
  fake.store.set(`EmailMessage/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    definitionId: null,
    kind: "invitation",
    dedupeKey: id,
    recipient: { name: "Ada Lovelace", email: "ada@example.com" },
    attendeeId: null,
    submissionId: null,
    from: { name: "Events", address: "events@example.com" },
    replyTo: null,
    subject: "You're invited",
    bodyHtml: "<p>hi</p>",
    bodyText: "hi",
    status: "queued",
    attemptCount: 0,
    lastError: null,
    providerMessageId: null,
    provider: "dev-outbox",
    queuedAt: { seconds: 1, toDate: () => new Date(1000) },
    sentAt: null,
    failedAt: null,
    createdAt: { seconds: 1, toDate: () => new Date(1000) },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("loadEmailOverviewPage — kind resolution (spec §5 AC-1)", () => {
  it("resolves a catalog kind to its display name, and falls back to the raw kind for an ad-hoc send", async () => {
    seedMessage("m-1", {
      kind: "invitation",
      status: "sent",
      createdAt: { seconds: 2 },
    });
    seedMessage("m-2", {
      kind: "manual",
      status: "failed",
      lastError: { message: "SMTP timeout" },
      createdAt: { seconds: 1 },
    });

    const page = await loadEmailOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    const byKind = new Map(page.rows.map((r) => [r.emailName, r]));
    expect(byKind.has("Invitation")).toBe(true);
    // "manual" has no catalog entry — falls back to the raw kind string.
    expect(byKind.has("manual")).toBe(true);
  });

  it("a failed message's lastError renders exactly as stored (AC-2)", async () => {
    seedMessage("m-1", {
      status: "failed",
      lastError: { message: "Provider rejected the message" },
    });

    const page = await loadEmailOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].lastError).toBe("Provider rejected the message");
    expect(page.rows[0].status).toBe("Failed");
  });

  it("a queued message's lastError/sentAt/failedAt render as empty strings", async () => {
    seedMessage("m-1");

    const page = await loadEmailOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].lastError).toBe("");
    expect(page.rows[0].sentAt).toBe("");
    expect(page.rows[0].failedAt).toBe("");
  });

  it("zero email messages returns zero rows (AC-3)", async () => {
    const page = await loadEmailOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows).toEqual([]);
  });
});

describe("loadEmailOverviewExport — 1000-row cap", () => {
  it("caps at 1000 rows for a 1200-message fixture", async () => {
    for (let i = 0; i < 1200; i += 1) {
      seedMessage(`m-${i}`, { createdAt: { seconds: i } });
    }

    const rows = await loadEmailOverviewExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toHaveLength(1000);
  });
});
