// @vitest-environment node
/**
 * M7-T2 — Badges printed (check-in history) report loader.
 * Spec: agents/docs/specs/m7-report-templates.md §4, D5.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { loadCheckinHistoryPage, loadCheckinHistoryExport } =
  await import("@/features/reports/server/load-checkin-history");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";

function seedAttendee(id: string, overrides: Record<string, unknown> = {}) {
  fake.store.set(`Attendee/${id}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: `sub-${id}`,
    orderId: null,
    pathId: null,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    company: "Acme",
    jobTitle: "Engineer",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tt-1",
    ticketLabel: "General",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "hash",
    createdAt: { seconds: 1, toDate: () => new Date(1000) },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("loadCheckinHistoryPage — checked-in-by resolution (spec §4 AC-1)", () => {
  it("renders the admin's raw userId (email) for an admin check-in, and the team member's name for a team-member check-in", async () => {
    seedAttendee("a-admin", {
      createdAt: { seconds: 2, toDate: () => new Date(2000) },
      checkInState: "checked-in",
      checkedInAt: { seconds: 2, toDate: () => new Date(2000) },
      checkedInBy: { kind: "admin", userId: "owner@example.com" },
    });
    seedAttendee("a-team", {
      createdAt: { seconds: 1, toDate: () => new Date(1000) },
      checkInState: "checked-in",
      checkedInAt: { seconds: 1, toDate: () => new Date(1000) },
      checkedInBy: { kind: "team-member", name: "Door Staff" },
    });

    const page = await loadCheckinHistoryPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    // Newest first: a-admin (createdAt 2) then a-team (createdAt 1).
    expect(page.rows[0].checkedInBy).toBe("owner@example.com");
    expect(page.rows[1].checkedInBy).toBe("Door Staff");
  });

  it("a not-arrived attendee renders empty Checked-in at / by, never null/undefined text (AC-2)", async () => {
    seedAttendee("a-1");

    const page = await loadCheckinHistoryPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].checkedInAt).toBe("");
    expect(page.rows[0].checkedInBy).toBe("");
    expect(page.rows[0].checkInState).toBe("Not arrived");
  });
});

describe("loadCheckinHistoryPage — narrower scope than Registration overview (AC-3)", () => {
  it("excludes cancelled attendees", async () => {
    seedAttendee("a-accepted", {
      status: "accepted",
      createdAt: { seconds: 2 },
    });
    seedAttendee("a-cancelled", {
      status: "cancelled",
      createdAt: { seconds: 1 },
    });

    const page = await loadCheckinHistoryPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].name).toBe("Ada Lovelace");
  });

  it("zero accepted attendees returns zero rows (AC-4)", async () => {
    seedAttendee("a-cancelled", { status: "cancelled" });

    const page = await loadCheckinHistoryPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows).toEqual([]);
  });
});

describe("loadCheckinHistoryExport — 1000-row cap", () => {
  it("caps at 1000 rows for a 1200-accepted-attendee fixture", async () => {
    for (let i = 0; i < 1200; i += 1) {
      seedAttendee(`a-${i}`, { createdAt: { seconds: i } });
    }

    const rows = await loadCheckinHistoryExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toHaveLength(1000);
  });
});
