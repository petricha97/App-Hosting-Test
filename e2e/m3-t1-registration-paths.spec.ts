// M3-T1 — Registration Paths admin: numbered path, code, audience, payment
// method, active flag; table + flow-diagram card; create/edit/delete.
// See agents/docs/specs/m3-registration-paths.md §M3-T1.
//
// Seeds the TWO registration paths every later M3/M4 spec depends on — do not
// delete them once created:
//   - "1 Delegate — Card" (DEL-CARD): audience Delegate, payment Card, USD.
//     Used by the M3-T3 public flow walkthrough (Early Bird ticket).
//   - "2 Press — Comp" (PRESS-COMP): audience Press, payment Comp, USD.
//     Has zero eligible open tickets right now (Press Pass is manually
//     closed) — used to exercise the comp/4-step admin rendering and the
//     public "no tickets available" empty state.
import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const pathsUrl = () => `/dashboard/events/${fixtures.eventId}/registration-paths`;

test.describe("M3-T1 — Registration Paths admin", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("creates the Delegate/Card and Press/Comp paths", async ({ page }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");

    const hasDelegatePath = await page
      .getByRole("row")
      .filter({ hasText: "1 Delegate — Card" })
      .isVisible()
      .catch(() => false);

    if (!hasDelegatePath) {
      await page.getByRole("button", { name: "Create path", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "Create registration path" }),
      ).toBeVisible();

      await dialog.getByLabel("Name").fill("1 Delegate — Card");
      await dialog.getByLabel("Code").fill("del-card");
      await expect(dialog.getByLabel("Code")).toHaveValue("DEL-CARD");
      await dialog.getByLabel("Audience").click();
      await page.getByRole("option", { name: "Delegate", exact: true }).click();
      await dialog.getByLabel("Payment method").click();
      await page.getByRole("option", { name: "Card", exact: true }).click();
      // Currency stays on its USD default.
      await dialog.getByRole("button", { name: "Create path" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Registration path created").last()).toBeVisible();
    }

    const hasPressPath = await page
      .getByRole("row")
      .filter({ hasText: "2 Press — Comp" })
      .isVisible()
      .catch(() => false);

    if (!hasPressPath) {
      await page.getByRole("button", { name: "Create path", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("2 Press — Comp");
      await dialog.getByLabel("Code").fill("press-comp");
      await dialog.getByLabel("Audience").click();
      await page.getByRole("option", { name: "Press", exact: true }).click();
      await dialog.getByLabel("Payment method").click();
      await page.getByRole("option", { name: /Comp — free with confirmation/ }).click();
      await expect(
        dialog.getByText("The Payment step is skipped for this path."),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Create path" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Registration path created").last()).toBeVisible();
    }

    // Table columns exactly per spec (+ the M4-T2 Page divergence column).
    for (const header of [
      "Registration path",
      "Code",
      "Audience",
      "Payment",
      "Currency",
      "Page",
      "Active",
    ]) {
      await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
    }

    const delegateRow = page.getByRole("row").filter({ hasText: "1 Delegate — Card" });
    await expect(delegateRow.getByText("DEL-CARD", { exact: true })).toBeVisible();
    await expect(delegateRow.getByRole("cell", { name: "Delegate", exact: true })).toBeVisible();
    await expect(delegateRow.getByText("Card", { exact: true })).toBeVisible();
    await expect(delegateRow.getByText("USD", { exact: true })).toBeVisible();
    await expect(delegateRow.getByText("Default", { exact: true })).toBeVisible();

    const pressRow = page.getByRole("row").filter({ hasText: "2 Press — Comp" });
    await expect(pressRow.getByText("PRESS-COMP", { exact: true })).toBeVisible();
    await expect(pressRow.getByRole("cell", { name: "Press", exact: true })).toBeVisible();
    await expect(pressRow.getByText("Comp", { exact: true })).toBeVisible();

    // Both paths must be Active for the public picker test (T3) to see 2.
    for (const row of [delegateRow, pressRow]) {
      const yesBadge = row.getByText("Yes", { exact: true });
      if (!(await yesBadge.isVisible().catch(() => false))) {
        await row.getByRole("switch").click();
        await expect(page.getByText(/Path activated/).last()).toBeVisible();
      }
    }
  });

  test("flow-diagram card shows 5 steps for the first active (card) path", async ({
    page,
  }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");

    await expect(page.getByText("Path: 1 Delegate — Card")).toBeVisible();
    await expect(
      page.getByText("Each page is customizable in the Page Builder."),
    ).toBeVisible();
    for (const chip of [
      "1 · Personal Information",
      "2 · Ticket & Options",
      "3 · Registration Summary",
      "4 · Payment",
      "5 · Confirmation + QR",
    ]) {
      await expect(page.getByText(chip, { exact: true })).toBeVisible();
    }
  });

  test("flow-diagram card renders 4 steps (Payment omitted) for a comp path", async ({
    page,
  }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");

    // Temporarily deactivate the Delegate/Card path so Press/Comp becomes the
    // first ACTIVE path the flow card reflects (T1 AC-3), then restore it —
    // both paths must stay active for the T3 public-picker test.
    const delegateRow = page.getByRole("row").filter({ hasText: "1 Delegate — Card" });
    await delegateRow.getByRole("switch").click();
    await expect(page.getByText(/Path deactivated/).last()).toBeVisible();

    await expect(page.getByText("Path: 2 Press — Comp")).toBeVisible();
    for (const chip of [
      "1 · Personal Information",
      "2 · Ticket & Options",
      "3 · Registration Summary",
      "4 · Confirmation + QR",
    ]) {
      await expect(page.getByText(chip, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("3 · Payment", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Payment skipped — Comp")).toBeVisible();

    // Restore.
    await page.reload();
    await page.waitForLoadState("load");
    await page.getByRole("row").filter({ hasText: "1 Delegate — Card" }).getByRole("switch").click();
    await expect(page.getByText(/Path activated/).last()).toBeVisible();
  });

  test("rejects a duplicate code (case-insensitive) with a field error", async ({
    page,
  }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: "Create path", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Duplicate Code Attempt");
    await dialog.getByLabel("Code").fill("del-card"); // collides with DEL-CARD
    await dialog.getByRole("button", { name: "Create path" }).click();

    await expect(
      dialog.getByText("This code is already used by another path."),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("creates, edits, and deletes a throwaway path (full CRUD + delete)", async ({
    page,
  }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");

    const originalName = "9 Throwaway — None";
    const editedName = "9 Throwaway — None Edited";

    let row = page.getByRole("row").filter({ hasText: /9 Throwaway — None/ });
    if (!(await row.first().isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Create path", exact: true }).click();
      const createDialog = page.getByRole("dialog");
      await createDialog.getByLabel("Name").fill(originalName);
      await createDialog.getByLabel("Code").fill("throw-path");
      // Audience left on its "Any registration type" default.
      await createDialog.getByLabel("Payment method").click();
      await page.getByRole("option", { name: "None — free" }).click();
      await createDialog.getByRole("button", { name: "Create path" }).click();
      await expect(createDialog).toBeHidden();
      row = page.getByRole("row").filter({ hasText: originalName });
    }

    if (
      await row
        .filter({ hasText: editedName })
        .count()
        .then((n) => n === 0)
    ) {
      await row
        .filter({ hasText: originalName })
        .getByRole("button", { name: `Edit ${originalName}` })
        .click();
      const editDialog = page.getByRole("dialog");
      await editDialog.getByLabel("Name").fill(editedName);
      await editDialog.getByRole("button", { name: "Save changes" }).click();
      await expect(editDialog).toBeHidden();
    }

    const editedRow = page.getByRole("row").filter({ hasText: editedName });
    await expect(editedRow).toBeVisible();
    await expect(editedRow.getByRole("cell", { name: "Any", exact: true })).toBeVisible();
    await editedRow.getByRole("button", { name: `Delete ${editedName}` }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Registration path deleted").last()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: editedName })).toHaveCount(0);
  });

  test("Page column shows Default badge with a working Customize link", async ({
    page,
  }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");

    const delegateRow = page.getByRole("row").filter({ hasText: "1 Delegate — Card" });
    await expect(
      delegateRow.getByRole("link", { name: /Customize page for 1 Delegate — Card/ }),
    ).toBeVisible();
  });
});
