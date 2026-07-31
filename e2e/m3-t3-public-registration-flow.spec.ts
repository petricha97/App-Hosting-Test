// M3-T3 — Public multi-step registration flow: the key end-to-end test.
// Walks the REAL public flow as an unauthenticated visitor: path picker →
// Personal Information → Ticket & Options (Early Bird as a Delegate) →
// Registration Summary → Payment (simulated) → Confirmation + QR.
// See agents/docs/specs/m3-registration-paths.md §M3-T3.
//
// Depends on M3-T1 (2 active paths: "1 Delegate — Card", "2 Press — Comp")
// and M3-T2 (the published form carrying the ticket-selector + promo-code
// fields). Creates a REAL Order + FormData submission that M3-T4 (response
// approval) picks up next.
import { test, expect } from "@playwright/test";

import { ACCEPTED_REGISTRANT } from "./fixtures/registration-data";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

// Public registration must be exercised as a genuine unauthenticated
// visitor — override the chromium project's logged-in storageState here.
test.use({ storageState: { cookies: [], origins: [] } });

const registerUrl = () => `/events/${fixtures.eventId}/register`;

test.describe("M3-T3 — Public multi-step registration flow", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test("2 active paths → the path picker renders, ordered by sortOrder", async ({
    page,
  }) => {
    await page.goto(registerUrl());
    await page.waitForLoadState("load");

    await expect(
      page.getByRole("heading", { name: "How are you registering?" }),
    ).toBeVisible();
    const links = page.getByRole("link").filter({ hasText: /Delegate — Card|Press — Comp/ });
    await expect(links).toHaveCount(2);
    // sortOrder: Delegate/Card (0) before Press/Comp (1).
    await expect(links.nth(0)).toContainText("1 Delegate — Card");
    await expect(links.nth(1)).toContainText("2 Press — Comp");
    await expect(page.getByText("Delegate · Pays by card")).toBeVisible();
    await expect(page.getByText("Press · Complimentary")).toBeVisible();
  });

  test("an inactive/forced ?path= 404s", async ({ page }) => {
    const response = await page.goto(`${registerUrl()}?path=not-a-real-path-id`);
    expect(response?.status()).toBe(404);
  });

  test("completes the full flow as a Delegate buying Early Bird with the QA10OFF promo", async ({
    page,
  }) => {
    await page.goto(registerUrl());
    await page.waitForLoadState("load");
    await page.getByRole("link", { name: /1 Delegate — Card/ }).click();
    await expect(page).toHaveURL(/\/register\?path=/);

    // Step 1 — Personal Information.
    await expect(
      page.getByRole("heading", { name: "Personal Information" }),
    ).toBeVisible();
    await page.getByLabel("First name").fill(ACCEPTED_REGISTRANT.firstName);
    await page.getByLabel("Last name").fill(ACCEPTED_REGISTRANT.lastName);
    await page.getByLabel("Email").fill(ACCEPTED_REGISTRANT.email);
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2 — Ticket & Options: Early Bird is the only ticket currently open
    // + priced for the Delegate audience (Standard's sales window has not
    // started yet; Press Pass is manually closed and ineligible anyway).
    await expect(
      page.getByRole("heading", { name: "Ticket & Options" }),
    ).toBeVisible();
    await expect(page.getByText("Select your ticket")).toBeVisible();
    const earlyBirdCard = page.getByText("Early Bird", { exact: true });
    await expect(earlyBirdCard).toBeVisible();
    await expect(page.getByText("$750.00")).toBeVisible();
    await earlyBirdCard.click();

    await page.getByLabel("Promo code").fill("QA10OFF");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/QA10OFF applied/)).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3 — Registration Summary: server-quoted totals only.
    await expect(
      page.getByRole("heading", { name: "Registration Summary" }),
    ).toBeVisible();
    await expect(page.getByText("$750.00")).toBeVisible(); // subtotal
    await expect(page.getByText(/Promo QA10OFF/)).toBeVisible();
    await expect(page.getByText(/75\.00/)).toBeVisible(); // 10% of $750
    await expect(page.getByText("TAX-NY", { exact: true })).toBeVisible();
    await expect(page.getByText("Total", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Confirm & pay" }).click();

    // Step 4 — Payment: simulated provider, format-only client validation.
    await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
    await expect(
      page.getByText(/Simulated payment — no real charge is made/),
    ).toBeVisible();
    await page.getByLabel("Name on card").fill("Priya Kapoor");
    await page.getByLabel("Card number").fill("4242 4242 4242 4242");
    await page.getByLabel("Expiry").fill("12 / 29");
    await page.getByLabel("CVC").fill("123");
    await page.getByRole("button", { name: "Pay now" }).click();

    // Step 5 — Confirmation: registration + order refs, and a REAL QR (M5-T1
    // has already landed — a live SVG entry pass, not just the placeholder).
    await expect(
      page.getByRole("heading", { name: /You.re registered!/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Registration reference")).toBeVisible();
    const regRef = page.getByText(/^REG-/);
    await expect(regRef).toBeVisible();
    const regRefText = await regRef.textContent();
    const qr = page.getByRole("img", { name: "Your entry QR code" });
    await expect(qr).toBeVisible();
    const qrSvgHandle = await qr.locator("svg").count();
    expect(qrSvgHandle).toBeGreaterThan(0);

    console.log(`[M3-T3] Accepted-flow registration reference: ${regRefText}`);
  });
});
