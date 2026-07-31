// M2-T2 — Discounts tab: surfaces the org's promotion-template engine inside
// Pricing → Discounts, plus the M2-new fields (validity window, usage cap,
// level). See agents/docs/specs/m2-pricing-commerce.md §M2-T2.
//
// The Discounts tab is READ-ONLY over EventPromotion docs — creation happens
// via an org-level PromotionTemplate (Promotions → Templates) attached to the
// event from the event Overview page. Seeds ONE discount ("QA10") Phase 2's
// checkout flow can reference — do not delete it afterwards.
import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import {
  DISCOUNT_VALID_FROM_DATE,
  DISCOUNT_VALID_UNTIL_DATE,
  type SeededFixtures,
} from "./fixtures/test-data";

const TEMPLATES_URL = "/dashboard/promotions/templates";
let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const overviewUrl = () => `/dashboard/events/${fixtures.eventId}`;
const discountsUrl = () =>
  `/dashboard/events/${fixtures.eventId}/pricing?tab=discounts`;

test.describe("M2-T2 — Discounts tab", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("creates the QA10 promotion template at the org level", async ({
    page,
  }) => {
    await page.goto(TEMPLATES_URL);
    await page.waitForLoadState("load");

    const exists = (await page.locator("body").innerText().catch(() => "")).includes(
      "QA10",
    );
    if (exists) return;

    await page.getByRole("button", { name: "New template" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New Template" })).toBeVisible();

    await dialog.getByLabel("Template Name").fill("QA10");
    // discountType is a free-text field but must be the literal lowercase
    // "percentage"/"fixed" string for downstream rendering (Pricing's
    // formatDiscountAmount, src/features/pricing/utils.ts) to recognize it —
    // any other casing/spelling silently renders "—" everywhere it's shown.
    await dialog.getByLabel("Discount Type").fill("percentage");
    await dialog.getByLabel("Discount Value").fill("10");

    // "Enable promo code" has no real label-for association on its Switch
    // (the text is a plain sibling <p>, not a <Label>) — target the switch
    // by role instead of relying on getByLabel/getByText.
    await dialog.getByRole("switch").click();
    await dialog.getByLabel("Promo Code").fill("QA10OFF");

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Template created")).toBeVisible();
  });

  test("attaches the QA10 template to the dedicated event", async ({
    page,
  }) => {
    await page.goto(overviewUrl());
    await page.waitForLoadState("load");

    const alreadyAttached = (
      await page.locator("#promotions").innerText().catch(() => "")
    ).includes("QA10");
    if (alreadyAttached) return;

    await page.getByRole("button", { name: "Attach template" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Attach Promotion Template" })).toBeVisible();
    await dialog.getByText("QA10", { exact: true }).click();
    await dialog.getByRole("button", { name: "Attach", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Promotion attached to event")).toBeVisible();
  });

  test("Discounts tab lists QA10 with the right code/level/amount", async ({
    page,
  }) => {
    await page.goto(discountsUrl());
    await page.waitForLoadState("load");
    await expect(page.getByRole("tab", { name: "Discounts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    for (const header of ["Name", "Code", "Level", "Amount / %", "Valid", "Used", "Active"]) {
      await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
    }

    // Level/usage-cap/active are edited by the "Discount settings" test below
    // against this SAME persistent real-Firestore event across re-runs, so
    // this test only asserts the fields that never change after creation
    // (code, amount) rather than the create-time defaults, which the next
    // test may have already overwritten in a prior session.
    const row = page.getByRole("row").filter({ hasText: "QA10" });
    await expect(row.getByText("QA10OFF", { exact: true })).toBeVisible();
    await expect(row.getByText("10%", { exact: true })).toBeVisible();
  });

  test("Discount settings dialog sets Partner level + validity window + usage cap", async ({
    page,
  }) => {
    await page.goto(discountsUrl());
    await page.waitForLoadState("load");

    const row = page.getByRole("row").filter({ hasText: "QA10" });
    await row.getByRole("button", { name: /discount settings/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Discount settings" })).toBeVisible();

    await dialog.getByLabel("Level").click();
    await page.getByRole("option", { name: "Partner", exact: true }).click();
    await dialog.getByLabel("Valid from").fill(DISCOUNT_VALID_FROM_DATE);
    await dialog.getByLabel("Valid until").fill(DISCOUNT_VALID_UNTIL_DATE);
    // Idempotent: only toggle on if a prior run hasn't already enabled it
    // (this dialog pre-fills from the existing discount's current settings).
    const limitUsesSwitch = dialog.getByRole("switch", { name: "Limit uses" });
    if (!(await limitUsesSwitch.isChecked())) {
      await limitUsesSwitch.click();
    }
    await dialog.getByLabel("Usage cap").fill("50");

    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Discount settings updated")).toBeVisible();

    const updatedRow = page.getByRole("row").filter({ hasText: "QA10" });
    await expect(updatedRow.getByText("Partner", { exact: true })).toBeVisible();
    await expect(updatedRow.getByText("0 / 50", { exact: true })).toBeVisible();
    await expect(updatedRow.getByText(/Jul 26.*Dec 31/i)).toBeVisible();
  });
});
