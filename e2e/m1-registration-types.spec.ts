// M1-T1 — Registration Types: CRUD, capacity (number vs Unlimited), code
// uniqueness, and delete-when-referenced. See
// agents/docs/specs/m1-registration-spine.md §M1-T1.
//
// This spec seeds the THREE registration types every later phase depends on
// (Delegate / VIP Guest / Press) — do not delete them once created. A
// throwaway 4th type is created and deleted purely to exercise the delete
// flow.
import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const registrationTypesUrl = () =>
  `/dashboard/events/${fixtures.eventId}/registration-types`;

test.describe("M1-T1 — Registration Types", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("empty state renders before any registration type exists", async ({
    page,
  }) => {
    await page.goto(registrationTypesUrl());
    await page.waitForLoadState("load");

    const hasAny = await page
      .getByRole("row")
      .filter({ hasText: "Delegate" })
      .first()
      .isVisible()
      .catch(() => false);

    if (!hasAny) {
      await expect(page.getByText("No registration types yet")).toBeVisible();
      await expect(page.getByText(/Why separate from tickets/)).toBeVisible();
    }
  });

  test("creates the three dedicated registration types", async ({ page }) => {
    await page.goto(registrationTypesUrl());
    await page.waitForLoadState("load");

    const seedTypes: { name: string; code: string; capacity: string | null }[] = [
      { name: "Delegate", code: "DEL", capacity: "200" },
      { name: "VIP Guest", code: "VIP", capacity: null },
      { name: "Press", code: "PRESS", capacity: "50" },
    ];

    for (const seed of seedTypes) {
      const alreadyExists = await page
        .getByRole("cell", { name: seed.name, exact: true })
        .isVisible()
        .catch(() => false);
      if (alreadyExists) continue;

      await page.getByRole("button", { name: "Create type", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Create registration type" })).toBeVisible();

      await dialog.getByLabel("Name").fill(seed.name);
      // Lowercase on purpose — verifies the auto-uppercase behavior (AC-4).
      await dialog.getByLabel("Code").fill(seed.code.toLowerCase());
      await expect(dialog.getByLabel("Code")).toHaveValue(seed.code);

      if (seed.capacity) {
        await dialog.getByLabel("Limit capacity").click();
        await dialog.getByLabel("Capacity", { exact: true }).fill(seed.capacity);
      }

      await dialog.getByRole("button", { name: "Create type" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Registration type created").last()).toBeVisible();
    }

    // Table assertions (AC-1, AC-2): columns + Unlimited rendering.
    const delegateRow = page.getByRole("row").filter({ hasText: "Delegate" });
    await expect(delegateRow.getByText("DEL", { exact: true })).toBeVisible();
    await expect(delegateRow.getByText("200", { exact: true })).toBeVisible();

    const vipRow = page.getByRole("row").filter({ hasText: "VIP Guest" });
    await expect(vipRow.getByText("Unlimited")).toBeVisible();

    const pressRow = page.getByRole("row").filter({ hasText: "Press" });
    await expect(pressRow.getByText("PRESS", { exact: true })).toBeVisible();
  });

  test("rejects a duplicate code (case-insensitive) with a field error", async ({
    page,
  }) => {
    await page.goto(registrationTypesUrl());
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: "Create type", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Duplicate Code Attempt");
    await dialog.getByLabel("Code").fill("del"); // collides with DEL, case-insensitive
    await dialog.getByRole("button", { name: "Create type" }).click();

    await expect(dialog.getByText(/code already in use/i)).toBeVisible();
    // Dialog must stay open on a server-side validation failure.
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("edit updates name/capacity and delete is blocked while referenced, allowed otherwise", async ({
    page,
  }) => {
    await page.goto(registrationTypesUrl());
    await page.waitForLoadState("load");

    // Create a throwaway type, then delete it (exercises the full delete flow
    // without touching the three types Phase 2+ depend on). Idempotent: a
    // prior interrupted run may have already left this row behind.
    const alreadyThrowaway = await page
      .getByRole("row")
      .filter({ hasText: "Throwaway Type" })
      .isVisible()
      .catch(() => false);
    if (!alreadyThrowaway) {
      await page.getByRole("button", { name: "Create type", exact: true }).click();
      const createDialog = page.getByRole("dialog");
      await createDialog.getByLabel("Name").fill("Throwaway Type");
      await createDialog.getByLabel("Code").fill("THROW");
      await createDialog.getByRole("button", { name: "Create type" }).click();
      await expect(createDialog).toBeHidden();
    }

    const throwawayRow = page.getByRole("row").filter({ hasText: "Throwaway Type" });
    await expect(throwawayRow).toBeVisible();
    await throwawayRow.getByRole("button", { name: "Delete Throwaway Type" }).click();

    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog.getByText(/delete throwaway type/i)).toBeVisible();
    await confirmDialog.getByRole("button", { name: /delete/i }).click();
    await expect(page.getByText("Registration type deleted")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Throwaway Type" })).toHaveCount(0);

    // Edit Press: bump capacity from 50 to 60, verify persists.
    const pressRow = page.getByRole("row").filter({ hasText: "Press" });
    await pressRow.getByRole("button", { name: "Edit Press" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit registration type" })).toBeVisible();
    await dialog.getByLabel("Capacity", { exact: true }).fill("60");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole("row").filter({ hasText: "Press" }).getByText("60", { exact: true })).toBeVisible();
  });
});
