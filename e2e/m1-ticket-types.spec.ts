// M1-T2 — Ticket Types (admission items): CRUD, reg-type filter/association,
// sales window driving Open/Closed, capacity vs registered count. See
// agents/docs/specs/m1-registration-spine.md §M1-T2.
//
// Depends on M1-T1's three registration types already existing (Delegate /
// VIP Guest / Press) — run after e2e/m1-registration-types.spec.ts (Playwright
// runs spec files across workers, but this project runs single-worker on
// chromium via the setup dependency, so ordering by filename is effectively
// deterministic here; each test also tolerates re-runs by skipping creation
// when a row already exists).
//
// Seeds the THREE ticket types Phase 2+ (and M2 fees) depend on: Early Bird
// (EB), Standard (STD), Press Pass (PRESS-T). Do not delete them afterwards.
import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import {
  EARLY_BIRD_SALES_END_DATE,
  STANDARD_SALES_START_DATE,
  type SeededFixtures,
} from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const ticketsUrl = () => `/dashboard/events/${fixtures.eventId}/tickets`;

test.describe("M1-T2 — Ticket Types", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("creates Early Bird (open, Delegate-eligible, sales window)", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    const exists = await page
      .getByRole("cell", { name: "Early Bird", exact: true })
      .isVisible()
      .catch(() => false);
    if (exists) return;

    await page.getByRole("button", { name: "Create ticket type", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Early Bird");
    await dialog.getByLabel("Code").fill("eb");
    await expect(dialog.getByLabel("Code")).toHaveValue("EB");

    // Eligible registration types: Delegate only.
    await dialog.getByRole("group", { name: "Who can buy this ticket" }).getByText("Delegate", { exact: true }).click();

    await dialog.getByLabel("Limit capacity").click();
    await dialog.getByLabel("Capacity", { exact: true }).fill("100");

    await dialog.getByLabel("Sales close").fill(EARLY_BIRD_SALES_END_DATE);

    await dialog.getByRole("button", { name: "Create ticket type" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Ticket type created").last()).toBeVisible();
  });

  test("creates Standard (unlimited, all registration types, future sales start)", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    const exists = await page
      .getByRole("cell", { name: "Standard", exact: true })
      .isVisible()
      .catch(() => false);
    if (exists) return;

    await page.getByRole("button", { name: "Create ticket type", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Standard");
    await dialog.getByLabel("Code").fill("std");
    // Leave capacity Unlimited and eligibility unchecked ("All registration types").
    await dialog.getByLabel("Sales open").fill(STANDARD_SALES_START_DATE);
    await dialog.getByRole("button", { name: "Create ticket type" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Ticket type created").last()).toBeVisible();
  });

  test("creates Press Pass (manually closed, Press-eligible)", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    const exists = await page
      .getByRole("cell", { name: "Press Pass", exact: true })
      .isVisible()
      .catch(() => false);
    if (exists) return;

    await page.getByRole("button", { name: "Create ticket type", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Press Pass");
    await dialog.getByLabel("Code").fill("press-t");
    await dialog.getByRole("group", { name: "Who can buy this ticket" }).getByText("Press", { exact: true }).click();
    await dialog.getByLabel("Limit capacity").click();
    await dialog.getByLabel("Capacity", { exact: true }).fill("50");
    // Manual override closed — must show "No" regardless of the (empty) window.
    await dialog.getByLabel("Available for registration").click();

    await dialog.getByRole("button", { name: "Create ticket type" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Ticket type created").last()).toBeVisible();
  });

  test("table renders the 7 columns with correct derived Open state", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    for (const header of [
      "Ticket",
      "Code",
      "Price",
      "Registered",
      "Capacity",
      "Sales window",
      "Open",
    ]) {
      await expect(
        page.getByRole("columnheader", { name: header, exact: true }),
      ).toBeVisible();
    }

    const ebRow = page.getByRole("row").filter({ hasText: "Early Bird" });
    await expect(ebRow.getByText("EB", { exact: true })).toBeVisible();
    await expect(ebRow.getByText("Yes", { exact: true })).toBeVisible();
    // Price is deferred to M2 (fee-derived once a fee exists). This spec runs
    // before M2 fees exist on a clean project, so Price shows the "—" link
    // into Pricing — but this suite reuses ONE persistent real-Firestore
    // event across re-runs, so a fee may already exist from a prior session.
    // Accept either valid state instead of asserting the fee-less placeholder
    // specifically (that transition is exercised by
    // e2e/m2-pricing-fees.spec.ts's dedicated "Price column" test).
    const priceCell = ebRow.getByRole("cell").nth(2);
    await expect(priceCell).not.toBeEmpty();

    const stdRow = page.getByRole("row").filter({ hasText: "Standard" });
    await expect(stdRow.getByText("Unlimited")).toBeVisible();
    await expect(stdRow.getByText(/from Oct 1/i)).toBeVisible();
    await expect(stdRow.getByText("No", { exact: true })).toBeVisible();

    const pressRow = page.getByRole("row").filter({ hasText: "Press Pass" });
    await expect(pressRow.getByText("No", { exact: true })).toBeVisible();
  });

  test("search and registration-type filter compose correctly", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    await page.getByLabel("Search tickets").fill("early");
    await expect(page.getByRole("row").filter({ hasText: "Early Bird" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Standard" })).toHaveCount(0);
    await page.getByLabel("Search tickets").fill("");

    await page.getByLabel("Filter by registration type").click();
    await page.getByRole("option", { name: "Press", exact: true }).click();
    // Press-filtered view should show Press Pass (explicitly eligible) and
    // Standard (unrestricted = eligible for everyone) but not Early Bird
    // (restricted to Delegate only).
    await expect(page.getByRole("row").filter({ hasText: "Press Pass" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Standard" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Early Bird" })).toHaveCount(0);
  });

  test("rejects a duplicate ticket code (case-insensitive)", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: "Create ticket type", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Duplicate EB Attempt");
    await dialog.getByLabel("Code").fill("eb");
    await dialog.getByRole("button", { name: "Create ticket type" }).click();

    await expect(dialog.getByText(/code already in use/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("creates, edits, and deletes a throwaway ticket without touching Phase 2 fixtures", async ({
    page,
  }) => {
    await page.goto(ticketsUrl());
    await page.waitForLoadState("load");

    const originalName = "QA Throwaway Ticket";
    const editedName = "QA Throwaway Ticket Edited";
    let row = page
      .getByRole("row")
      .filter({ hasText: new RegExp(`${originalName}(?: Edited)?`) });

    if (!(await row.first().isVisible().catch(() => false))) {
      await page
        .getByRole("button", { name: "Create ticket type", exact: true })
        .click();
      const createDialog = page.getByRole("dialog");
      await createDialog.getByLabel("Name").fill(originalName);
      await createDialog.getByLabel("Code").fill("QA-TEMP");
      await createDialog.getByLabel("Limit capacity").click();
      await createDialog.getByLabel("Capacity", { exact: true }).fill("5");
      await createDialog
        .getByRole("button", { name: "Create ticket type" })
        .click();
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
      await editDialog.getByLabel("Capacity", { exact: true }).fill("7");
      await editDialog.getByRole("button", { name: "Save changes" }).click();
      await expect(editDialog).toBeHidden();
    }

    const editedRow = page.getByRole("row").filter({ hasText: editedName });
    await expect(editedRow.getByText("7", { exact: true })).toBeVisible();
    await editedRow
      .getByRole("button", { name: `Delete ${editedName}` })
      .click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Ticket type deleted").last()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: editedName })).toHaveCount(
      0,
    );
  });

  test("registration type deletion is blocked when a ticket references it", async ({
    page,
  }) => {
    await page.goto(
      `/dashboard/events/${fixtures.eventId}/registration-types`,
    );
    const delegateRow = page.getByRole("row").filter({ hasText: "Delegate" });
    await delegateRow
      .getByRole("button", { name: "Delete Delegate" })
      .click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirm.getByText(/used by .*ticket type/i)).toBeVisible();
    await confirm.getByRole("button", { name: "Close" }).click();
    await expect(delegateRow).toBeVisible();
  });
});
