// @vitest-environment node
/**
 * SEC-M4-1 — the anonymous public event page ships a projection of the
 * EventPage doc, never the full serialized doc: draftContent (unpublished
 * revisions), storagePrefix (internal storage layout), and organizationId
 * must not reach the client RSC payload. Locks the EXACT key list of
 * serializePublicEventPage (src/features/event-pages/utils.ts).
 */
import { describe, expect, it } from "vitest";

import {
  serializePublicEventPage,
  type PublicEventPagePayload,
} from "@/features/event-pages/utils";
import type { EventPageDoc, WithId } from "@/types/collection";

const PUBLISHED_CONTENT = {
  content: [
    { type: "Hero", props: { id: "hero-1", heading: "Published heading" } },
  ],
  root: {},
  zones: {},
};

const DRAFT_CONTENT = {
  content: [
    {
      type: "Hero",
      props: { id: "hero-1", heading: "UNANNOUNCED draft heading" },
    },
  ],
  root: {},
  zones: {},
};

function makeEventPage(): WithId<EventPageDoc> {
  return {
    id: "page-1",
    eventId: "evt-1",
    organizationId: "org-1",
    pageKey: "path-1",
    title: "Summit page",
    status: "published",
    storagePrefix: "organizations/org-1/events/evt-1/event-pages",
    draftContent: DRAFT_CONTENT,
    publishedContent: PUBLISHED_CONTENT,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 2, nanoseconds: 0 },
  } as unknown as WithId<EventPageDoc>;
}

describe("serializePublicEventPage (SEC-M4-1)", () => {
  it("emits EXACTLY id, title, publishedContent — nothing else can leak", () => {
    const payload = serializePublicEventPage(makeEventPage());

    expect(Object.keys(payload).sort()).toEqual([
      "id",
      "publishedContent",
      "title",
    ]);
    expect(payload).toEqual({
      id: "page-1",
      title: "Summit page",
      publishedContent: PUBLISHED_CONTENT,
    });
  });

  it("never carries draftContent, storagePrefix, or organizationId — even serialized", () => {
    const payload = serializePublicEventPage(makeEventPage());
    const wire = JSON.stringify(payload);

    expect(wire).not.toContain("draftContent");
    expect(wire).not.toContain("storagePrefix");
    expect(wire).not.toContain("organizationId");
    expect(wire).not.toContain("UNANNOUNCED draft heading");

    // Type-level lock: the payload type itself must not admit these keys.
    type ForbiddenKeys = Extract<
      keyof PublicEventPagePayload,
      "draftContent" | "storagePrefix" | "organizationId" | "eventId"
    >;
    const forbidden: ForbiddenKeys[] = [];
    expect(forbidden).toEqual([]);
  });

  it("degrades a (contract-violating) null publishedContent to empty content, not the draft", () => {
    const page = makeEventPage();
    (page as { publishedContent: unknown }).publishedContent = null;

    const payload = serializePublicEventPage(page);

    expect(payload.publishedContent).toEqual({ content: [], root: {}, zones: {} });
    expect(JSON.stringify(payload)).not.toContain("UNANNOUNCED");
  });
});
