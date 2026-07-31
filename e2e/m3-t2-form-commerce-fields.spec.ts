// M3-T2 — Form builder commerce fields: ticket-selector + promo-code, added
// to the event's registration form and published. See
// agents/docs/specs/m3-registration-paths.md §M3-T2.
//
// Publishes the event's registration form — a prerequisite for M3-T3's
// public flow (the /register route 404s to the legacy-fallback "not
// available" state until a published form exists).
//
// NOTE: until the first Save/Publish, the builder's field additions are
// LOCAL React state only (no Form doc exists yet) — a fresh page load before
// that first save shows the "start from template / start from scratch"
// chooser again and loses any in-progress (unsaved) edits. openBuilder()
// below handles the chooser on every navigation; test 1 explicitly saves a
// draft before test 2/3 reload the page, so the added fields persist.
import { test, expect, type Page } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const formUrl = () => `/dashboard/events/${fixtures.eventId}/form`;

async function openBuilder(page: Page) {
  await page.goto(formUrl());
  await page.waitForLoadState("load");

  // First-ever visit shows the "start from template / start from scratch"
  // chooser (no Form doc exists yet) — pick scratch to reach the actual
  // builder workspace with the Commerce palette.
  const startFromScratch = page.getByRole("link", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
    await page.waitForLoadState("load");
    await expect(page.getByText("Commerce", { exact: true })).toBeVisible();
  }
}

test.describe("M3-T2 — Form builder commerce fields", () => {
  test.describe.configure({ mode: "serial", retries: 2 });

  test("adds the Ticket selector and Promo code fields, then saves a draft", async ({
    page,
  }) => {
    await openBuilder(page);
    await expect(page.getByText("Commerce", { exact: true })).toBeVisible();

    const ticketButton = page.locator("button").filter({ hasText: "Ticket selector" });
    const promoButton = page.locator("button").filter({ hasText: "Promo code" });

    const hasTicketField = await page
      .getByText("ticket · from Ticket Types", { exact: true })
      .isVisible()
      .catch(() => false);
    if (!hasTicketField) {
      await expect(ticketButton).toBeEnabled();
      await ticketButton.click();
      await expect(
        page.getByText("ticket · from Ticket Types", { exact: true }),
      ).toBeVisible();
    }

    const hasPromoField = await page
      .getByText("promo_code · from Promotions", { exact: true })
      .isVisible()
      .catch(() => false);
    if (!hasPromoField) {
      await expect(promoButton).toBeEnabled();
      await promoButton.click();
      await expect(
        page.getByText("promo_code · from Promotions", { exact: true }),
      ).toBeVisible();
    }

    // Cardinality guard (T2 AC-2): once placed, the palette entries disable.
    await expect(ticketButton).toBeDisabled();
    await expect(promoButton).toBeDisabled();

    // Canvas rows carry the "event field" badge — one per commerce field.
    await expect(page.getByText("event field", { exact: true })).toHaveCount(2);

    // Persist now (status stays "draft") so the fields survive the next
    // test's fresh page load as a REAL Form doc, not just local state.
    await page.getByRole("button", { name: /Save draft|Publish form/ }).click();
    await expect(
      page.getByText(/Registration form saved|Registration form published/).last(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("field settings panel shows the locked key + commerce-only notes", async ({
    page,
  }) => {
    await openBuilder(page);

    await page.getByText("Select your ticket", { exact: true }).first().click();
    await expect(
      page.getByText(
        "Options come automatically from this event's Ticket Types and Pricing.",
      ),
    ).toBeVisible();

    // Click the canvas row (not the palette entry, also labelled "Promo
    // code") via its unique commerce subtitle.
    await page.getByText("promo_code · from Promotions", { exact: true }).click();
    await expect(
      page.getByText("Always optional. Codes are validated at checkout."),
    ).toBeVisible();
  });

  test("publishes the registration form", async ({ page }) => {
    await openBuilder(page);
    // Let client hydration settle before driving the native <select> — a
    // selectOption fired before React attaches its handlers can silently
    // no-op (the DOM value flips back once hydration catches up).
    await expect(page.getByLabel("Form title")).toBeVisible();

    await page.getByLabel("Status").selectOption("published");
    await expect(page.getByLabel("Status")).toHaveValue("published");

    // Wait for the submit button label to actually flip before clicking, so
    // the click can never race the select's onChange re-render.
    const publishButton = page.getByRole("button", { name: "Publish form" });
    await expect(publishButton).toBeVisible();
    await publishButton.click();
    await expect(page.getByText("Registration form published").last()).toBeVisible({
      timeout: 15_000,
    });
  });
});
