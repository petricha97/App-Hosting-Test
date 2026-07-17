// @vitest-environment node
/**
 * M7-T2 — Abandoned registration details report loader.
 * Spec: agents/docs/specs/m7-report-templates.md §3, D4 (masked email only).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  loadAbandonedRegistrationsPage,
  loadAbandonedRegistrationsExport,
  ABANDONED_EXPORT_MAX_RAW_PAGES,
} = await import("@/features/reports/server/load-abandoned-registrations");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const NOW_MS = 10_000_000;
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

function seedDraft(
  id: string,
  updatedAtMsAgo: number,
  overrides: Record<string, unknown> = {},
) {
  const ms = NOW_MS - updatedAtMsAgo;
  const seconds = ms / 1000;
  // getAdminRegistrationDraftsForEvent derives isAbandoned from
  // updatedAt.toMillis() when present (falling back to nowMs otherwise) —
  // the fake doc needs a real toMillis so the derivation isn't a no-op.
  const timestamp = { seconds, toMillis: () => ms, toDate: () => new Date(ms) };
  fake.store.set(`RegistrationDraft/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    pathId: "path-1",
    formId: "form-1",
    draftTokenHash: "hash",
    lastStepReached: "personal_info",
    stepAnswers: {},
    ticketTypeId: null,
    registrationTypeId: null,
    promotionId: null,
    attempt: 1,
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@dentsu.com",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("loadAbandonedRegistrationsPage — masking + step labels (spec §3)", () => {
  it("renders each of the 4 lastStepReached values with human labels (AC-1)", async () => {
    const steps = [
      "personal_info",
      "ticket_options",
      "summary",
      "payment",
    ] as const;
    steps.forEach((step, i) =>
      seedDraft(`d-${i}`, ABANDONED_AFTER_MS + 1000 + i, {
        lastStepReached: step,
      }),
    );

    const page = await loadAbandonedRegistrationsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: NOW_MS,
    });

    expect(page.rows.map((r) => r.lastStepReached).sort()).toEqual(
      [
        "Payment",
        "Personal Information",
        "Registration Summary",
        "Ticket & Options",
      ].sort(),
    );
  });

  it("the email column is domain-masked — never the raw local part (AC-2)", async () => {
    seedDraft("d-1", ABANDONED_AFTER_MS + 1000, { email: "ada@dentsu.com" });

    const page = await loadAbandonedRegistrationsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: NOW_MS,
    });

    expect(page.rows[0].maskedEmail).toBe("@dentsu.com");
    expect(JSON.stringify(page.rows)).not.toContain("ada@dentsu.com");
  });

  it("a fresh (<24h) draft never appears, even though the raw page includes it (AC-3)", async () => {
    seedDraft("d-fresh", 1000); // 1 second old
    seedDraft("d-abandoned", ABANDONED_AFTER_MS + 1000);

    const page = await loadAbandonedRegistrationsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: NOW_MS,
    });

    expect(page.rows).toHaveLength(1);
  });

  it("zero abandoned drafts (only fresh ones) returns zero rows (AC-5)", async () => {
    seedDraft("d-fresh", 1000);

    const page = await loadAbandonedRegistrationsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: NOW_MS,
    });

    expect(page.rows).toEqual([]);
  });
});

describe("loadAbandonedRegistrationsExport — masking survives to CSV rows (D4)", () => {
  it("exported rows never carry the raw email address", async () => {
    seedDraft("d-1", ABANDONED_AFTER_MS + 1000, { email: "secret@corp.com" });

    const rows = await loadAbandonedRegistrationsExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: NOW_MS,
    });

    expect(JSON.stringify(rows)).not.toContain("secret@corp.com");
    expect(rows[0].maskedEmail).toBe("@corp.com");
  });
});

describe("loadAbandonedRegistrationsExport — two-ceiling loop (spec §3 AC-4)", () => {
  it("500 fresh drafts interleaved with 30 abandoned ones export exactly 30 rows", async () => {
    // Newest-updated-first ordering (updatedAt desc): seed so fresh and
    // abandoned drafts interleave across raw pages when read oldest cursor
    // moves backward in insertion index but forward in recency.
    for (let i = 0; i < 500; i += 1) {
      seedDraft(`fresh-${i}`, 1000 + i); // all <24h old
    }
    for (let i = 0; i < 30; i += 1) {
      seedDraft(`abandoned-${i}`, ABANDONED_AFTER_MS + 100_000 + i);
    }

    const rows = await loadAbandonedRegistrationsExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: NOW_MS,
    });

    expect(rows).toHaveLength(30);
  });

  it("stops at the raw-page ceiling even if 1000 abandoned rows were never reached", async () => {
    // Every draft is fresh — the loop must bail via the raw-page ceiling,
    // not spin until Firestore is exhausted or 1000 abandoned rows appear.
    const totalRawPagesWorth = ABANDONED_EXPORT_MAX_RAW_PAGES * 200 + 400; // well beyond the ceiling
    for (let i = 0; i < totalRawPagesWorth; i += 1) {
      seedDraft(`fresh-${i}`, 1000 + i);
    }

    const readsBefore = fake.queryDocReads;
    const rows = await loadAbandonedRegistrationsExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: NOW_MS,
    });
    const readsAfter = fake.queryDocReads;

    expect(rows).toHaveLength(0);
    // 1 raw RegistrationDraft query per raw page (+ the 2 type-name list
    // calls made once up front) — bounded by ABANDONED_EXPORT_MAX_RAW_PAGES,
    // never scanning the whole fresh-drafts collection.
    expect(readsAfter - readsBefore).toBe(ABANDONED_EXPORT_MAX_RAW_PAGES + 2);
  });
});
