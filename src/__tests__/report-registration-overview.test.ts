// @vitest-environment node
/**
 * M7-T2 — Registration overview report loader.
 * Spec: agents/docs/specs/m7-report-templates.md §1.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { loadRegistrationOverviewPage, loadRegistrationOverviewExport } =
  await import("@/features/reports/server/load-registration-overview");

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
    updatedAt: { seconds: 1, toDate: () => new Date(1000) },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("loadRegistrationOverviewPage — column output (spec §1)", () => {
  it("renders both accepted and cancelled rows with the correct Status cell (AC-1)", async () => {
    seedAttendee("a-1", { status: "accepted", createdAt: { seconds: 2 } });
    seedAttendee("a-2", { status: "cancelled", createdAt: { seconds: 1 } });

    const page = await loadRegistrationOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows.map((r) => r.status)).toEqual(["Accepted", "Cancelled"]);
  });

  it("renders the real jobTitle field (AC-2)", async () => {
    seedAttendee("a-1", { jobTitle: "Staff Engineer" });

    const page = await loadRegistrationOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].jobTitle).toBe("Staff Engineer");
  });

  it("produces every column in the exact spec order", async () => {
    seedAttendee("a-1", {
      checkInState: "checked-in",
      checkedInAt: { seconds: 5, toDate: () => new Date(5000) },
    });

    const page = await loadRegistrationOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0]).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      company: "Acme",
      jobTitle: "Engineer",
      registrationType: "Delegate",
      ticketType: "General",
      status: "Accepted",
      checkInState: "Checked in",
      checkedInAt: new Date(5000).toISOString(),
      registeredAt: new Date(1000).toISOString(),
    });
  });

  it("empty check-in state renders empty string, never null/undefined text", async () => {
    seedAttendee("a-1");

    const page = await loadRegistrationOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows[0].checkedInAt).toBe("");
  });
});

describe("loadRegistrationOverviewPage — pagination (AC-4)", () => {
  it("120 attendees paginate 50 + 50 + 20 with zero duplicate/missing rows", async () => {
    for (let i = 0; i < 120; i += 1) {
      seedAttendee(`a-${i}`, { createdAt: { seconds: i } });
    }

    const seen: string[] = [];
    let cursorMs: number | undefined;
    for (let page = 0; page < 3; page += 1) {
      const result = await loadRegistrationOverviewPage({
        eventId: EVENT_ID,
        organizationId: ORG_ID,
        cursorMs,
      });
      seen.push(...result.rows.map((r) => r.registeredAt));
      cursorMs = result.nextCursorMs ?? undefined;
    }

    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });
});

describe("loadRegistrationOverviewExport — row cap (D2)", () => {
  it("exports all rows under the 1000 cap, matching Run's row shape", async () => {
    for (let i = 0; i < 120; i += 1) {
      seedAttendee(`a-${i}`, { createdAt: { seconds: i } });
    }

    const rows = await loadRegistrationOverviewExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toHaveLength(120);
  });

  it("caps at exactly 1000 rows for a 1200-attendee fixture", async () => {
    for (let i = 0; i < 1200; i += 1) {
      seedAttendee(`a-${i}`, { createdAt: { seconds: i } });
    }

    const rows = await loadRegistrationOverviewExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(rows).toHaveLength(1000);
  });
});
