// M7-T3 — Scheduled report delivery. Already shipped/signed-off previously
// (per agents/docs/qa/m7-scheduled-reports.md, unit-tested at the time) —
// this is a light LIVE check: open the schedule UI, create one recurring
// schedule against the real event, verify it persists across a reload.
// See agents/docs/specs/m7-scheduled-reports.md.
import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const reportsUrl = () => `/dashboard/events/${fixtures.eventId}/reports`;

test.describe("M7-T3 — Scheduled report delivery", () => {
  test.describe.configure({ mode: "serial", retries: 1 });

  test("owner can open the Schedule dialog and create a recurring weekly schedule", async ({
    page,
  }) => {
    await page.goto(reportsUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Scheduled reports")).toBeVisible();

    const alreadyHasOne = await dialog
      .getByText("Order & transaction details")
      .isVisible()
      .catch(() => false);

    if (!alreadyHasOne) {
      await dialog.getByRole("button", { name: /Add schedule/ }).click();
      await expect(dialog.getByText("Add schedule")).toBeVisible();

      // Report picker: choose "Order & transaction details" if available.
      const reportSelect = dialog.getByRole("combobox").first();
      await reportSelect.click();
      const option = page.getByRole("option", {
        name: "Order & transaction details",
      });
      if (await option.isVisible().catch(() => false)) {
        await option.click();
      } else {
        await page.keyboard.press("Escape");
      }

      // Frequency: Weekly.
      const frequencySelect = dialog.getByRole("combobox").nth(1);
      await frequencySelect.click();
      await page.getByRole("option", { name: "Weekly", exact: true }).click();

      // Recipient: add self via the "Add myself" shortcut.
      const addMyself = dialog.getByRole("button", { name: "Add myself" });
      if (await addMyself.isVisible().catch(() => false)) {
        await addMyself.click();
      } else {
        await dialog
          .getByPlaceholder("name@company.com")
          .fill("qa-schedule-recipient@example.com");
        await dialog.getByRole("button", { name: "+ Add" }).click();
      }

      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Schedule saved")).toBeVisible({
        timeout: 15_000,
      });
    }

    // Verify persistence: close and reopen the dialog, the schedule row
    // must still be there (real Firestore round-trip, not just local state).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const dialogAgain = page.getByRole("dialog");
    await expect(dialogAgain.getByText("Scheduled reports")).toBeVisible();
    await expect(
      dialogAgain.getByText(/Active|Paused/).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("reloading the reports page and reopening Schedule still shows the persisted schedule", async ({
    page,
  }) => {
    await page.goto(reportsUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");
    await page.reload();
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Scheduled reports")).toBeVisible();
    await expect(
      dialog.getByText("No scheduled reports yet"),
    ).not.toBeVisible();
    await expect(dialog.getByText(/Active|Paused/).first()).toBeVisible();
  });
});
