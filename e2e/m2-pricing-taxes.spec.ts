// M2-T3 — Taxes & Service Fees tabs: Taxes CRUD (name/code/type/rate/active),
// inline Active toggle, Service Fees designed empty state. See
// agents/docs/specs/m2-pricing-commerce.md §M2-T3.
//
// Seeds the TWO taxes Phase 2's pricing math checks will reference (matching
// the spec's own worked examples): "NY Sales Tax" (TAX-NY, 8.875%, active)
// and "UK VAT" (VAT-UK, 20.00%, inactive). Do not delete them afterwards.
import { test, expect } from "@playwright/test";

import { getInputByFormItemLabel } from "./fixtures/dom-helpers";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const pricingUrl = () =>
  `/dashboard/events/${fixtures.eventId}/pricing?tab=taxes`;
const serviceFeesUrl = () =>
  `/dashboard/events/${fixtures.eventId}/pricing?tab=service-fees`;

test.describe("M2-T3 — Taxes tab", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("creates NY Sales Tax (percentage, 8.875%, active)", async ({ page }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");
    await expect(page.getByRole("tab", { name: "Taxes", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const exists = (await page.locator("table").innerText().catch(() => "")).includes(
      "NY Sales Tax",
    );
    if (exists) return;

    await page.getByRole("button", { name: "Create tax", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("NY Sales Tax");
    await dialog.getByLabel("Code").fill("tax-ny");
    await expect(dialog.getByLabel("Code")).toHaveValue("TAX-NY");
    // Type defaults to Percentage already.
    await getInputByFormItemLabel(dialog, "Rate").fill("8.875");

    await dialog.getByRole("button", { name: "Create tax" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Tax created").last()).toBeVisible();
  });

  test("creates UK VAT (percentage, 20.00%) then deactivates it", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    const alreadyExists = (
      await page.locator("table").innerText().catch(() => "")
    ).includes("UK VAT");

    if (!alreadyExists) {
      await page.getByRole("button", { name: "Create tax", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("UK VAT");
      await dialog.getByLabel("Code").fill("vat-uk");
      await getInputByFormItemLabel(dialog, "Rate").fill("20");
      await dialog.getByRole("button", { name: "Create tax" }).click();
      await expect(dialog).toBeHidden();
    }

    // Worked example (spec §M2-T4 table) has VAT-UK inactive — deactivate via
    // the inline table switch (AC-3).
    const vatRow = page.getByRole("row").filter({ hasText: "UK VAT" });
    const stillActive = await vatRow.getByRole("switch").isChecked();
    if (stillActive) {
      await vatRow.getByRole("switch").click();
      await expect(page.getByText("Tax deactivated").last()).toBeVisible();
    }
    await expect(vatRow.getByRole("switch")).not.toBeChecked();
  });

  test("Taxes table renders the 5 columns with correct rate formatting and Active state", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    for (const header of ["Name", "Code", "Type", "Rate", "Active"]) {
      await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
    }

    const nyRow = page.getByRole("row").filter({ hasText: "NY Sales Tax" });
    await expect(nyRow.getByText("TAX-NY", { exact: true })).toBeVisible();
    await expect(nyRow.getByText("8.875%", { exact: true })).toBeVisible();
    await expect(nyRow.getByText("Percentage", { exact: true })).toBeVisible();
    await expect(nyRow.getByText("Yes", { exact: true })).toBeVisible();

    const vatRow = page.getByRole("row").filter({ hasText: "UK VAT" });
    await expect(vatRow.getByText("20.00%", { exact: true })).toBeVisible();
    await expect(vatRow.getByText("No", { exact: true })).toBeVisible();
  });

  test("rejects a duplicate tax code (case-insensitive)", async ({ page }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: "Create tax", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Duplicate NY Tax Attempt");
    await dialog.getByLabel("Code").fill("tax-ny");
    await getInputByFormItemLabel(dialog, "Rate").fill("5");
    await dialog.getByRole("button", { name: "Create tax" }).click();

    await expect(dialog.getByText(/code already in use/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("creates, edits, and deletes a fixed-amount throwaway tax", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    const originalName = "QA Throwaway Fixed Tax";
    const editedName = "QA Throwaway Fixed Tax Edited";
    let row = page
      .getByRole("row")
      .filter({ hasText: new RegExp(`${originalName}(?: Edited)?`) });

    if (!(await row.first().isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Create tax", exact: true }).click();
      const createDialog = page.getByRole("dialog");
      await createDialog.getByLabel("Name").fill(originalName);
      await createDialog.getByLabel("Code").fill("QA-FIX");
      await createDialog.getByLabel("Type").click();
      await page.getByRole("option", { name: "Fixed amount" }).click();
      await getInputByFormItemLabel(createDialog, "Amount").fill("3.50");
      await createDialog.getByRole("button", { name: "Create tax" }).click();
      await expect(createDialog).toBeHidden();
      row = page.getByRole("row").filter({ hasText: originalName });
    }

    if (await row.filter({ hasText: editedName }).count().then((n) => n === 0)) {
      await row
        .filter({ hasText: originalName })
        .getByRole("button", { name: `Edit ${originalName}` })
        .click();
      const editDialog = page.getByRole("dialog");
      await editDialog.getByLabel("Name").fill(editedName);
      await getInputByFormItemLabel(editDialog, "Amount").fill("4.25");
      await editDialog.getByRole("button", { name: "Save changes" }).click();
      await expect(editDialog).toBeHidden();
    }

    const editedRow = page.getByRole("row").filter({ hasText: editedName });
    await expect(editedRow.getByText("$4.25")).toBeVisible();
    await editedRow
      .getByRole("button", { name: `Delete ${editedName}` })
      .click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Tax deleted").last()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: editedName })).toHaveCount(
      0,
    );
  });
});

test.describe("M2-T3 — Service Fees tab", () => {
  test("renders the designed empty state with no create affordance", async ({
    page,
  }) => {
    await page.goto(serviceFeesUrl());
    await page.waitForLoadState("load");
    await expect(page.getByRole("tab", { name: "Service Fees" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await expect(page.getByText("No service fees configured")).toBeVisible();
    await expect(
      page.getByText(/per-order processing fee/i),
    ).toBeVisible();
    // No create button anywhere in this tab's panel (M2-T3 spec: stubbed
    // empty state only, no entity/API in M2).
    const panel = page.getByRole("tabpanel", { name: "Service Fees" });
    await expect(panel.getByRole("button", { name: /create/i })).toHaveCount(0);
  });
});
