// @vitest-environment node
/**
 * M4-T2 — EventPage pageKey model (src/lib/db/adminEventPage.ts).
 * Spec ACs: 22 (draft-only path page never publicly resolvable), 24
 * (independent save/publish per page), 26 (delete cascade helper), 27
 * (legacy docs without pageKey behave as "default"), plus the gap-list fix:
 * lookups filter eventId matches by pageKey instead of first-org-match.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));
// adminEventPage stamps FieldValue.serverTimestamp(); resolve it to a
// timestamp-like value so schema parses succeed against the fake store.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ seconds: 999 }) },
}));

const {
  DEFAULT_EVENT_PAGE_KEY,
  deleteAdminEventPagesForPageKey,
  getAdminEventPageForEvent,
  getAdminEventPageKeysForEvent,
  getAdminPublishedEventPageForEvent,
  publishAdminEventPage,
  saveAdminEventPageDraft,
} = await import("@/lib/db/adminEventPage");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const CONTENT = { content: [], root: {}, zones: {} };

function seedPage(
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  fake.store.set(`EventPage/${id}`, {
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    title: `Page ${id}`,
    status: "draft",
    storagePrefix: `organizations/${ORG_ID}/events/${EVENT_ID}/event-pages`,
    draftContent: CONTENT,
    publishedContent: null,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("getAdminEventPageForEvent — pageKey filtering", () => {
  it("reads a LEGACY doc (no pageKey field) as the default page (AC-27)", async () => {
    seedPage("legacy");

    const page = await getAdminEventPageForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page?.id).toBe("legacy");
    expect(page?.pageKey).toBe(DEFAULT_EVENT_PAGE_KEY);
  });

  it("disambiguates multiple pages per event by pageKey (gap-list fix)", async () => {
    seedPage("default-page", { pageKey: "default" });
    seedPage("path-page", { pageKey: "path-1" });

    const defaultPage = await getAdminEventPageForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "default",
    });
    const pathPage = await getAdminEventPageForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
    });

    expect(defaultPage?.id).toBe("default-page");
    expect(pathPage?.id).toBe("path-page");
  });

  it("never serves the default doc for a path pageKey — even via the eventPagePath id shortcut", async () => {
    seedPage("default-page");

    const page = await getAdminEventPageForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      eventPagePath: "EventPage/default-page",
      pageKey: "path-1",
    });

    expect(page).toBeNull();
  });

  it("is org-scoped: another org's page for the same event never resolves", async () => {
    seedPage("foreign", { organizationId: "org-2", pageKey: "path-1" });

    const page = await getAdminEventPageForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
    });

    expect(page).toBeNull();
  });
});

describe("saveAdminEventPageDraft / publishAdminEventPage — per-page independence", () => {
  it("creates a doc stamped with the pageKey, then updates THAT doc on re-save (uniqueness per eventId+pageKey)", async () => {
    const first = await saveAdminEventPageDraft({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
      title: "Sponsor page",
      draftContent: CONTENT,
    });

    const second = await saveAdminEventPageDraft({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
      title: "Sponsor page v2",
      draftContent: CONTENT,
    });

    expect(second.id).toBe(first.id);
    const stored = fake.store.get(`EventPage/${first.id}`);
    expect(stored?.pageKey).toBe("path-1");
    expect(stored?.title).toBe("Sponsor page v2");
    // Only ONE EventPage doc exists for this (eventId, pageKey).
    const pages = [...fake.store.keys()].filter((key) =>
      key.startsWith("EventPage/"),
    );
    expect(pages).toHaveLength(1);
  });

  it("publishing a path page never touches the default page doc (AC-24)", async () => {
    seedPage("default-page", { pageKey: "default", status: "published", publishedContent: CONTENT });

    await publishAdminEventPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
      title: "Sponsor page",
      draftContent: CONTENT,
    });

    const defaultWrites = fake.writes.filter(
      (write) => write.path === "EventPage/default-page",
    );
    expect(defaultWrites).toHaveLength(0);

    const pathPage = await getAdminPublishedEventPageForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
    });
    expect(pathPage?.status).toBe("published");
  });

  it("a draft-only path page is not publicly resolvable (AC-22)", async () => {
    seedPage("draft-path", { pageKey: "path-1", status: "draft" });

    const page = await getAdminPublishedEventPageForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
    });

    expect(page).toBeNull();
  });
});

describe("getAdminEventPageKeysForEvent", () => {
  it("lists existing pageKeys, counting legacy docs as default", async () => {
    seedPage("legacy");
    seedPage("path-page", { pageKey: "path-1" });
    seedPage("foreign", { organizationId: "org-2", pageKey: "path-2" });

    const keys = await getAdminEventPageKeysForEvent({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(keys.sort()).toEqual(["default", "path-1"]);
  });
});

describe("deleteAdminEventPagesForPageKey — delete cascade (AC-26)", () => {
  it("deletes only the docs for that (eventId, org, pageKey)", async () => {
    seedPage("default-page", { pageKey: "default" });
    seedPage("path-page", { pageKey: "path-1" });
    seedPage("other-path-page", { pageKey: "path-2" });
    seedPage("foreign", { organizationId: "org-2", pageKey: "path-1" });

    const deleted = await deleteAdminEventPagesForPageKey({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
    });

    expect(deleted).toBe(1);
    expect(fake.store.has("EventPage/path-page")).toBe(false);
    expect(fake.store.has("EventPage/default-page")).toBe(true);
    expect(fake.store.has("EventPage/other-path-page")).toBe(true);
    expect(fake.store.has("EventPage/foreign")).toBe(true);
  });

  it("returns 0 when the path never had a page", async () => {
    seedPage("default-page", { pageKey: "default" });

    const deleted = await deleteAdminEventPagesForPageKey({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      pageKey: "path-1",
    });

    expect(deleted).toBe(0);
  });
});
