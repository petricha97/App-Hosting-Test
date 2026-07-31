// M3-T4 — Response approval workflow: find the M3-T3 submission in
// Responses and walk it through New → Pending → Reviewed → Accepted;
// verify Accepted creates an Attendee (M5-T1's real hook, no longer a stub).
// See agents/docs/specs/m3-registration-paths.md §M3-T4.
//
// Runs as the authenticated ADMIN (default chromium storageState) against
// the per-event Responses screen.
import { test, expect } from "@playwright/test";

import { ACCEPTED_REGISTRANT } from "./fixtures/registration-data";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const responsesUrl = () => `/dashboard/events/${fixtures.eventId}/responses`;
const attendeeFullName = `${ACCEPTED_REGISTRANT.firstName} ${ACCEPTED_REGISTRANT.lastName}`;

test.describe("M3-T4 — Response approval workflow", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("the M3-T3 submission arrives as New with a Ticket label", async ({
    page,
  }) => {
    await page.goto(responsesUrl());
    await page.waitForLoadState("load");

    await page
      .getByLabel("Search responses")
      .fill(ACCEPTED_REGISTRANT.email);

    const row = page.getByRole("row").filter({ hasText: attendeeFullName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(ACCEPTED_REGISTRANT.email)).toBeVisible();
    await expect(row.getByText(/Early Bird/)).toBeVisible();
    await expect(row.getByText("New", { exact: true })).toBeVisible();
  });

  test("walks New → Pending → Reviewed → Accepted; Accept creates the attendee", async ({
    page,
  }) => {
    await page.goto(responsesUrl());
    await page.waitForLoadState("load");
    await page.getByLabel("Search responses").fill(ACCEPTED_REGISTRANT.email);

    const row = page.getByRole("row").filter({ hasText: attendeeFullName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Only run remaining transitions if still short of Accepted (idempotent
    // rerun safety — a prior run may have already accepted this response).
    if (await row.getByText("Accepted", { exact: true }).isVisible().catch(() => false)) {
      await expect(
        row.getByText("Attendee not created", { exact: true }),
      ).toHaveCount(0);
      return;
    }

    if (await row.getByText("New", { exact: true }).isVisible().catch(() => false)) {
      await row.getByRole("button", { name: `Actions for ${attendeeFullName}` }).click();
      await page.getByRole("menuitem", { name: "Mark as pending" }).click();
      await expect(page.getByText(/Marked as pending/).last()).toBeVisible();
      await expect(row.getByText("Pending", { exact: true })).toBeVisible();
    }

    if (await row.getByText("Pending", { exact: true }).isVisible().catch(() => false)) {
      await row.getByRole("button", { name: `Actions for ${attendeeFullName}` }).click();
      await page.getByRole("menuitem", { name: "Mark as reviewed" }).click();
      await expect(page.getByText(/Marked as reviewed/).last()).toBeVisible();
      await expect(row.getByText("Reviewed", { exact: true })).toBeVisible();
    }

    await row.getByRole("button", { name: `Actions for ${attendeeFullName}` }).click();
    await page.getByRole("menuitem", { name: "Accept" }).click();
    await expect(page.getByText("Response accepted").last()).toBeVisible();
    await expect(row.getByText("Accepted", { exact: true })).toBeVisible();

    // Terminal: no more actions menu, and the accept hook (real, not a stub)
    // must have created the attendee synchronously (no "Attendee not
    // created" repair badge left behind).
    await expect(
      row.getByRole("button", { name: `Actions for ${attendeeFullName}` }),
    ).toHaveCount(0);
    await expect(
      row.getByText("Attendee not created", { exact: true }),
    ).toHaveCount(0);
  });

  test("re-accepting is a no-op (idempotent, no duplicate transition)", async ({
    page,
  }) => {
    await page.goto(responsesUrl());
    await page.waitForLoadState("load");
    await page.getByLabel("Search responses").fill(ACCEPTED_REGISTRANT.email);

    const row = page.getByRole("row").filter({ hasText: attendeeFullName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("Accepted", { exact: true })).toBeVisible();
    // Accepted is terminal in M3 — no dropdown menu button renders, just an
    // em-dash placeholder in the actions cell.
    await expect(
      row.getByRole("button", { name: `Actions for ${attendeeFullName}` }),
    ).toHaveCount(0);
  });
});
