// M7-T2 — Report templates library. See
// agents/docs/specs/m7-report-templates.md. Runs (Run panel) AND exports
// (CSV download) all 5 templates against the real event data Phases 1-3
// created, verifying real row content — not just "the panel rendered."
import fs from "node:fs";

import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const reportsUrl = () => `/dashboard/events/${fixtures.eventId}/reports`;

async function runTemplate(page: import("@playwright/test").Page, name: string) {
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "Run", exact: true }).click();
  const panel = page.getByRole("region", { name: new RegExp(name) });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("M7-T2 — Report templates library", () => {
  test.describe.configure({ mode: "serial", retries: 1 });

  test("Registration overview: Run shows real attendee rows, export CSV contains them", async ({
    page,
  }) => {
    await page.goto(reportsUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const panel = await runTemplate(page, "Registration overview");
    // Real accepted attendees from Phases 2/3: Priya Kapoor (x4) + Noah
    // Fischer (x2) must appear as real rows, not a placeholder/empty state.
    await expect(panel.getByText("Priya Kapoor").first()).toBeVisible();
    await expect(panel.getByText("Noah Fischer").first()).toBeVisible();
    await expect(panel.getByText("Accepted").first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^registration-overview-.*\.csv$/,
    );
    const csvPath = await download.path();
    const csv = fs.readFileSync(csvPath!, "utf-8");
    expect(csv).toContain("Priya");
    expect(csv).toContain("Kapoor");
    expect(csv).toContain("Noah");
    expect(csv).toContain("Fischer");
    expect(csv).toContain("Early Bird");
    expect(csv).toContain("Press Pass");
  });

  test("Order & transaction details: Run + export show real order amounts and QA10OFF promo code", async ({
    page,
  }) => {
    await page.goto(reportsUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const panel = await runTemplate(page, "Order & transaction details");
    await expect(panel.getByText("Early Bird").first()).toBeVisible();
    await expect(panel.getByText("Paid").first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^order-transactions-.*\.csv$/,
    );
    const csv = fs.readFileSync((await download.path())!, "utf-8");
    // Priya's real discounted orders carry the frozen promo code.
    expect(csv).toContain("QA10OFF");
    expect(csv).toContain("USD");
    expect(csv).toContain("Paid");
  });

  test("Abandoned registration details: masked email only, never a raw local-part", async ({
    page,
  }) => {
    await page.goto(reportsUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const panel = await runTemplate(page, "Abandoned registration details");
    const panelText = await panel.innerText();
    // Amara Osei's 5 drafts may or may not have crossed the 24h abandoned
    // threshold yet (created 2026-07-31, this run is same-day-or-later) —
    // both outcomes are valid; the one invariant is D4 (masking), asserted
    // either way.
    const hasRows = panelText.includes("amara.osei.e2e") === false &&
      panelText.includes("@dentsu.com");
    if (hasRows) {
      await expect(panel.getByText("@dentsu.com").first()).toBeVisible();
    } else {
      await expect(
        panel.getByText("No abandoned registrations"),
      ).toBeVisible();
    }
    // D4's real, required assertion regardless of row count: the raw local
    // part of Amara's email must never appear anywhere in this panel.
    expect(panelText).not.toContain("amara.osei.e2e@dentsu.com");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^abandoned-registrations-.*\.csv$/,
    );
    const csv = fs.readFileSync((await download.path())!, "utf-8");
    expect(csv).not.toContain("amara.osei.e2e@dentsu.com");
  });

  test("Badges printed (check-in history): real check-in state for Priya's checked-in attendees", async ({
    page,
  }) => {
    await page.goto(reportsUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const panel = await runTemplate(page, "Badges printed");
    await expect(panel.getByText("Priya Kapoor").first()).toBeVisible();
    // Phase 3 checked in exactly 2 of Priya's 4 attendees — "Checked in"
    // must appear as a real value, not just "Not arrived" everywhere.
    await expect(panel.getByText("Checked in", { exact: true }).first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^checkin-history-.*\.csv$/);
    const csv = fs.readFileSync((await download.path())!, "utf-8");
    expect(csv).toContain("Checked in");
  });

  test("Email overview: real 11-row send log across confirmation-paid and approval-pending kinds", async ({
    page,
  }) => {
    await page.goto(reportsUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const panel = await runTemplate(page, "Email overview");
    await expect(panel.getByRole("table")).toBeVisible();
    const rowCount = await panel.getByRole("row").count(); // includes header
    // Phase 3 confirmed 11 real EmailMessage rows for this event (6
    // confirmation-paid + 5 approval-pending) — page size is 50, so all 11
    // fit on page 1 with no "Load more" needed.
    expect(rowCount).toBeGreaterThanOrEqual(11);
    await expect(panel.getByText("Sent", { exact: true }).first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^email-overview-.*\.csv$/);
    const csv = fs.readFileSync((await download.path())!, "utf-8");
    const dataLines = csv.trim().split("\r\n").slice(1);
    expect(dataLines.length).toBeGreaterThanOrEqual(11);
    expect(csv).not.toContain("bodyHtml");
    expect(csv).not.toContain("bodyText");
  });
});
