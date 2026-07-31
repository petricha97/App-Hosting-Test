// M2-T1 — Fees + Pricing screen shell: 4 tabs (Fees/Discounts/Taxes/Service
// Fees), Fees tab CRUD, price×ticket×registration-type×currency uniqueness,
// comp (0-price) display. See agents/docs/specs/m2-pricing-commerce.md §M2-T1.
//
// Depends on M1's Early Bird/Standard/Press Pass tickets and
// Delegate/Press registration types already existing. Seeds the THREE fees
// Phase 2's registration/checkout flow will reference — do not delete them.
import { test, expect } from "@playwright/test";

import { getInputByFormItemLabel } from "./fixtures/dom-helpers";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const pricingUrl = () => `/dashboard/events/${fixtures.eventId}/pricing`;
const ticketsUrl = () => `/dashboard/events/${fixtures.eventId}/tickets`;

test.describe("M2-T1 — Pricing shell + Fees tab", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("Pricing screen shows all 4 tabs with Fees active by default", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    for (const tabName of ["Fees", "Discounts", "Taxes", "Service Fees"]) {
      await expect(
        page.getByRole("tab", { name: tabName, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Fees", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("creates the Early Bird / Delegate / USD fee ($750.00)", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    const exists = (await page.locator("table").innerText().catch(() => "")).includes(
      "Early Bird — Delegate",
    );
    if (exists) return;

    await page.getByRole("button", { name: "Create fee", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Create fee" })).toBeVisible();

    await dialog.getByLabel("Name").fill("Early Bird — Delegate (USD)");
    await dialog.getByLabel("Ticket").click();
    await page.getByRole("option", { name: /Early Bird/ }).click();
    await dialog.getByLabel("Registration type").click();
    await page.getByRole("option", { name: "Delegate", exact: true }).click();
    // Currency defaults to USD already.
    await getInputByFormItemLabel(dialog, "Base price").fill("750.00");

    await dialog.getByRole("button", { name: "Create fee" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Fee created").last()).toBeVisible();
  });

  test("creates the Early Bird / Delegate / GBP fee (£600.00)", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    const name = "Early Bird — Delegate (GBP)";
    if (
      (await page.locator("table").innerText().catch(() => "")).includes(name)
    ) {
      return;
    }

    await page.getByRole("button", { name: "Create fee", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Ticket").click();
    await page.getByRole("option", { name: /Early Bird/ }).click();
    await dialog.getByLabel("Registration type").click();
    await page.getByRole("option", { name: "Delegate", exact: true }).click();
    await dialog.getByLabel("Currency").click();
    await page.getByRole("option", { name: "GBP", exact: true }).click();
    await getInputByFormItemLabel(dialog, "Base price").fill("600.00");
    await dialog.getByRole("button", { name: "Create fee" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Fee created").last()).toBeVisible();
  });

  test("creates the Standard / All types / USD fee ($950.00)", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    const exists = (await page.locator("table").innerText().catch(() => "")).includes(
      "Standard — All types",
    );
    if (exists) return;

    await page.getByRole("button", { name: "Create fee", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Standard — All types (USD)");
    await dialog.getByLabel("Ticket").click();
    await page.getByRole("option", { name: "Standard — STD" }).click();
    // Registration type left on its default: "All registration types".
    await getInputByFormItemLabel(dialog, "Base price").fill("950.00");

    await dialog.getByRole("button", { name: "Create fee" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Fee created").last()).toBeVisible();
  });

  test("creates the Press Pass / Press / USD comp fee ($0.00 → Comp)", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    const exists = (await page.locator("table").innerText().catch(() => "")).includes(
      "Press Pass — Press",
    );
    if (exists) return;

    await page.getByRole("button", { name: "Create fee", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Press Pass — Press (Comp)");
    await dialog.getByLabel("Ticket").click();
    await page.getByRole("option", { name: /Press Pass/ }).click();
    await dialog.getByLabel("Registration type").click();
    await page.getByRole("option", { name: "Press", exact: true }).click();
    await getInputByFormItemLabel(dialog, "Base price").fill("0.00");

    await dialog.getByRole("button", { name: "Create fee" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Fee created").last()).toBeVisible();
  });

  test("Fees table shows the 5 columns, correct prices, and Comp display", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    for (const header of ["Fee name", "Ticket", "Registration type", "Base price", "Status"]) {
      await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
    }

    const ebRow = page.getByRole("row").filter({ hasText: "Early Bird — Delegate" });
    await expect(ebRow.filter({ hasText: "USD" }).getByText("$750.00")).toBeVisible();
    await expect(ebRow.filter({ hasText: "GBP" }).getByText("£600.00")).toBeVisible();
    await expect(ebRow.getByText("Delegate", { exact: true }).first()).toBeVisible();

    const stdRow = page.getByRole("row").filter({ hasText: "Standard — All types" });
    await expect(stdRow.getByText("$950.00")).toBeVisible();
    await expect(stdRow.getByRole("cell", { name: "All types", exact: true })).toBeVisible();

    const compRow = page.getByRole("row").filter({ hasText: "Press Pass — Press" });
    await expect(compRow.getByText("Comp", { exact: true })).toBeVisible();
  });

  test("rejects a duplicate (ticket, registration type, currency) combination", async ({
    page,
  }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: "Create fee", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Duplicate Early Bird / Delegate / USD");
    await dialog.getByLabel("Ticket").click();
    await page.getByRole("option", { name: /Early Bird/ }).click();
    await dialog.getByLabel("Registration type").click();
    await page.getByRole("option", { name: "Delegate", exact: true }).click();
    await getInputByFormItemLabel(dialog, "Base price").fill("999.00");

    await dialog.getByRole("button", { name: "Create fee" }).click();
    await expect(
      dialog.getByText(/fee for this ticket, registration type and currency already exists/i),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("creates, edits, and deletes a throwaway fee", async ({ page }) => {
    await page.goto(pricingUrl());
    await page.waitForLoadState("load");

    const originalName = "QA Throwaway Fee";
    const editedName = "QA Throwaway Fee Edited";
    let row = page
      .getByRole("row")
      .filter({ hasText: new RegExp(`${originalName}(?: Edited)?`) });

    if (!(await row.first().isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Create fee", exact: true }).click();
      const createDialog = page.getByRole("dialog");
      await createDialog.getByLabel("Name").fill(originalName);
      await createDialog.getByLabel("Ticket").click();
      await page.getByRole("option", { name: /Standard/ }).click();
      await createDialog.getByLabel("Registration type").click();
      await page.getByRole("option", { name: "VIP Guest", exact: true }).click();
      await createDialog.getByLabel("Currency").click();
      await page.getByRole("option", { name: "EUR", exact: true }).click();
      await getInputByFormItemLabel(createDialog, "Base price").fill("123.45");
      await createDialog.getByRole("button", { name: "Create fee" }).click();
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
      await getInputByFormItemLabel(editDialog, "Base price").fill("125.00");
      await editDialog.getByRole("button", { name: "Save changes" }).click();
      await expect(editDialog).toBeHidden();
    }

    const editedRow = page.getByRole("row").filter({ hasText: editedName });
    await expect(editedRow.getByText("€125.00")).toBeVisible();
    await editedRow
      .getByRole("button", { name: `Delete ${editedName}` })
      .click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Fee deleted").last()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: editedName })).toHaveCount(
      0,
    );
  });

  test("Ticket Types Price column now reads from Fees instead of the placeholder", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    const ebRow = page.getByRole("row").filter({ hasText: "Early Bird" });
    await expect(ebRow).toContainText("$750.00");

    const pressRow = page.getByRole("row").filter({ hasText: "Press Pass" });
    await expect(pressRow.getByText("Comp", { exact: true })).toBeVisible();
  });
});
