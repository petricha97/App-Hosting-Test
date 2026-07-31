// M5-T1 — Attendee entity + QR identity: verify the real Attendee records
// Phase 2's accepted "Priya Kapoor" registrations produced (denormalized
// name/email/ticket/regType, qrTokenHash present) via a direct, read-only
// Firebase Admin lookup — no UI for "view one Attendee doc" exists, so this
// is the correct verification surface (mirrors the M5 spec's own AC-1).
//
// M5-T2 — Attendee roster screen (`/dashboard/events/[eventId]/attendees`,
// "Attendee list" tab): search, status filter, count badge, CSV export, and
// a REAL "+ Register attendee" manual-registration run (a genuinely new
// attendee, distinct from every public-flow registrant Phase 2 created).
// See agents/docs/specs/m5-attendees-checkin.md §M5-T1/§M5-T2.
import { test, expect } from "@playwright/test";

import { getAdminAttendeesForEmail } from "./fixtures/admin-live";
import { MANUAL_REGISTRANT, ACCEPTED_REGISTRANT } from "./fixtures/registration-data";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const attendeesUrl = () => `/dashboard/events/${fixtures.eventId}/attendees`;
const ticketsUrl = () => `/dashboard/events/${fixtures.eventId}/tickets`;

// Phase 1 seeded "Press Pass" as manually closed (isOpen: false) and
// "Standard" with a sales window that hasn't opened yet — the ONLY two
// tickets eligible for the "2 Press — Comp" path's audience are therefore
// both currently unavailable, and manual registration's server-side
// `validateTicketSelection` enforces the same eligibility × open × priced
// rules as the public flow (no admin bypass, by spec design — "one code
// path" decision). To exercise a REAL manual registration this phase
// legitimately, briefly flips Press Pass's "Available for registration"
// toggle on via the real Ticket Types screen, then restores it to closed
// afterward so Phase 1's seeded state is unchanged for later phases.
async function setPressPassAvailability(
  page: import("@playwright/test").Page,
  available: boolean,
) {
  await page.goto(ticketsUrl());
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: "Edit Press Pass" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit ticket type" });
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByLabel("Available for registration");
  const isChecked = await toggle.isChecked();
  if (isChecked !== available) {
    await toggle.click();
  }
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("M5-T1 — Attendee entity + QR identity (direct verification)", () => {
  test("Priya Kapoor's accepted registrations produced real Attendee docs with denorms + qrTokenHash", async () => {
    const attendees = await getAdminAttendeesForEmail({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
      email: ACCEPTED_REGISTRANT.email,
    });

    expect(attendees.length).toBeGreaterThanOrEqual(4);
    for (const attendee of attendees) {
      expect(attendee.status).toBe("accepted");
      expect(attendee.email).toBe(ACCEPTED_REGISTRANT.email);
      expect(attendee.ticketLabel).toBe("Early Bird");
      expect(attendee.registrationTypeLabel).toBe("Delegate");
      // qrTokenHash is a sha256 hex digest — 64 hex chars, never the raw
      // token (M5-T1 AC-6: only the hash is ever persisted).
      expect(attendee.qrTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(["not-arrived", "checked-in"]).toContain(attendee.checkInState);
    }
  });
});

test.describe("M5-T2 — Attendee roster screen", () => {
  test.describe.configure({ mode: "serial" });

  test("Attendee list tab: search finds the accepted Priya Kapoor rows with correct badges", async ({
    page,
  }) => {
    await page.goto(attendeesUrl());
    await page.waitForLoadState("load");

    await expect(
      page.getByRole("heading", { name: "Attendees" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Attendee list" })).toHaveAttribute(
      "data-state",
      "active",
    );

    await page.getByLabel("Search attendees").fill(ACCEPTED_REGISTRANT.email);
    const row = page
      .getByRole("row")
      .filter({ hasText: `${ACCEPTED_REGISTRANT.firstName} ${ACCEPTED_REGISTRANT.lastName}` })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(row.getByText("Early Bird", { exact: true })).toBeVisible();
    // Not-arrived (muted) or already checked-in — this file runs before the
    // M5-T5 scan spec, so every row is still "Not arrived" at this point.
    await expect(row.getByText("Not arrived", { exact: true })).toBeVisible();
  });

  test("Status filter: Accepted keeps the Accepted row, Pending never shows an Accepted badge", async ({
    page,
  }) => {
    await page.goto(attendeesUrl());
    await page.waitForLoadState("load");
    await page.getByLabel("Search attendees").fill(ACCEPTED_REGISTRANT.email);

    await page.getByLabel("Filter by status").click();
    await page.getByRole("option", { name: "Accepted", exact: true }).click();
    const acceptedRow = page
      .getByRole("row")
      .filter({ hasText: ACCEPTED_REGISTRANT.email })
      .first();
    await expect(acceptedRow).toBeVisible();
    await expect(acceptedRow.getByText("Accepted", { exact: true })).toBeVisible();

    await page.getByLabel("Filter by status").click();
    await page.getByRole("option", { name: "Pending", exact: true }).click();
    // NOTE: Phase 2 left one extra, never-accepted FormData submission under
    // this same identity (an interrupted debugging run — documented in
    // agents/docs/qa/e2e-regression-m3-m4.md as harmless). That submission
    // legitimately renders here as a "Pending" row under Priya's email, so
    // the correct assertion is "no ACCEPTED-badged row survives the Pending
    // filter", not "zero rows for this email" (a stricter count-0 assertion
    // would be a false failure against genuine, documented test data).
    const rowsAfterPendingFilter = page
      .getByRole("row")
      .filter({ hasText: ACCEPTED_REGISTRANT.email });
    const count = await rowsAfterPendingFilter.count();
    for (let i = 0; i < count; i += 1) {
      await expect(
        rowsAfterPendingFilter.nth(i).getByText("Accepted", { exact: true }),
      ).toHaveCount(0);
    }
  });

  test("Count badge reflects the accepted Attendee count (not the visible row count)", async ({
    page,
  }) => {
    await page.goto(attendeesUrl());
    await page.waitForLoadState("load");

    const badge = page.getByText(/\d+ attendees?$/);
    await expect(badge.first()).toBeVisible();
    const text = await badge.first().textContent();
    const n = Number(text?.match(/\d+/)?.[0] ?? "0");
    expect(n).toBeGreaterThanOrEqual(4);
  });

  test("Export CSV downloads a real file containing Priya Kapoor's row", async ({
    page,
  }) => {
    await page.goto(attendeesUrl());
    await page.waitForLoadState("load");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^attendees-.*\.csv$/);
    const streamPath = await download.path();
    expect(streamPath).toBeTruthy();
    const fs = await import("node:fs");
    const content = fs.readFileSync(streamPath!, "utf-8");
    expect(content).toContain(ACCEPTED_REGISTRANT.email);
    expect(content).toContain("Early Bird");
  });

  test("+ Register attendee: card path is disabled with the public-flow tooltip", async ({
    page,
  }) => {
    await page.goto(attendeesUrl());
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: "Register attendee" }).click();
    await expect(
      page.getByRole("dialog", { name: "Register attendee" }),
    ).toBeVisible();

    await page.getByLabel("Registration path").click();
    const cardOption = page.getByRole("option", { name: /1 Delegate — Card/ });
    await expect(cardOption).toHaveAttribute("data-disabled", "");
    // Close the listbox without selecting the disabled option.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("+ Register attendee: comp path completes a real manual registration", async ({
    page,
  }) => {
    // DEFECT-ADJACENT FINDING (documented in the phase report, not filed as
    // a blocking bug): server-side `validateTicketSelection` in
    // attendees/register/route.ts enforces the SAME "eligibility × open ×
    // priced" rule as the public flow — it does NOT let an admin manually
    // register someone onto a ticket that is closed/not-yet-open, even
    // though the dialog's own client-side ticket filter only checks audience
    // eligibility (not isOpen/sales-window), so the dialog happily lets you
    // select and submit a closed ticket, which the server then 400s with
    // "This selection is no longer available." Both of "2 Press — Comp"'s
    // audience-eligible tickets (Press Pass, Standard) are currently
    // unavailable (Press Pass manually closed; Standard's sales window
    // hasn't opened) — see agents/docs/qa/e2e-regression-m3-m4.md's own note
    // on this path. Briefly open Press Pass via the real Ticket Types screen
    // so this manual-registration path can be genuinely exercised, then
    // restore it to closed afterward.
    await setPressPassAvailability(page, true);

    await page.goto(attendeesUrl());
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: "Register attendee" }).click();
    const dialog = page.getByRole("dialog", { name: "Register attendee" });
    await expect(dialog).toBeVisible();

    await page.getByLabel("Registration path").click();
    await page.getByRole("option", { name: /2 Press — Comp/ }).click();

    await page.getByLabel("Ticket").click();
    await page.getByRole("option", { name: "Press Pass" }).click();

    // Path audience (Press) + ticket audience (Press-only) resolve
    // unambiguously — a read-only summary line renders, not a picker.
    await expect(dialog.getByText(/Registration type:/)).toBeVisible();
    await expect(dialog.getByText("Press", { exact: true })).toBeVisible();

    await dialog.getByLabel("First name").fill(MANUAL_REGISTRANT.firstName);
    await dialog.getByLabel("Last name").fill(MANUAL_REGISTRANT.lastName);
    await dialog.getByLabel("Email").fill(MANUAL_REGISTRANT.email);

    await dialog.getByRole("button", { name: "Register attendee" }).click();
    try {
      await expect(page.getByText("Attendee registered").last()).toBeVisible({
        timeout: 15_000,
      });
      await expect(dialog).toHaveCount(0);

      // The roster reflects the new attendee (router.refresh on success).
      await page.getByLabel("Search attendees").fill(MANUAL_REGISTRANT.email);
      const row = page
        .getByRole("row")
        .filter({
          hasText: `${MANUAL_REGISTRANT.firstName} ${MANUAL_REGISTRANT.lastName}`,
        })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText("Accepted", { exact: true })).toBeVisible();
      await expect(row.getByText("Press Pass", { exact: true })).toBeVisible();

      // Cross-verify server-side: a real Attendee doc exists with the right
      // denorms (not just a UI-only optimistic row).
      const attendees = await getAdminAttendeesForEmail({
        organizationId: fixtures.organizationId,
        eventId: fixtures.eventId,
        email: MANUAL_REGISTRANT.email,
      });
      expect(attendees.length).toBeGreaterThanOrEqual(1);
      expect(attendees[0].status).toBe("accepted");
      expect(attendees[0].registrationTypeLabel).toBe("Press");
      expect(attendees[0].ticketLabel).toBe("Press Pass");

      console.log(
        `[M5-T2] Manually registered attendee: ${MANUAL_REGISTRANT.firstName} ` +
          `${MANUAL_REGISTRANT.lastName} <${MANUAL_REGISTRANT.email}>, ` +
          `path "2 Press — Comp", ticket "Press Pass", registration type "Press", ` +
          `Attendee doc id ${attendees[0].id}.`,
      );
    } finally {
      // Restore Phase 1's seeded state regardless of outcome.
      await setPressPassAvailability(page, false);
    }
  });
});
