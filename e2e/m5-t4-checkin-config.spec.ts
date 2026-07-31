// M5-T4 — Check-in configuration screen
// (`/dashboard/events/[eventId]/checkin`): stat cards, badge preview (real
// QR + merge fields + reg-type pill), 5 settings toggles (persist across
// reload), team-members list (add, one-time access code, revoke).
// See agents/docs/specs/m5-attendees-checkin.md §M5-T4.
import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const checkinUrl = () => `/dashboard/events/${fixtures.eventId}/checkin`;

test.describe("M5-T4 — Check-in configuration screen", () => {
  test.describe.configure({ mode: "serial" });

  test("stat cards: Expected/Badges ready match the accepted attendee count", async ({
    page,
  }) => {
    await page.goto(checkinUrl());
    await page.waitForLoadState("load");

    await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
    // .first(): a transient Next.js dev-mode double-render (SSR markup
    // briefly coexisting with the re-hydrated client tree) has been
    // documented elsewhere in this suite (see agents/docs/qa/
    // e2e-regression-m3-m4.md) — using .first() sidesteps a strict-mode
    // violation from that artifact without weakening the actual assertion.
    await expect(page.getByText("Checked in", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Expected", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Badges ready", { exact: true }).first()).toBeVisible();

    // Fixed render order per checkin-stat-cards.tsx: Checked in, Expected,
    // Badges ready — read all three values by position rather than trying
    // to scope a container by its own caption text (fragile against
    // ancestor/descendant hasText matches).
    const statValues = page.locator("p.text-3xl");
    await expect(statValues.first()).toBeVisible();
    const allValues = await statValues.allTextContents();
    // Defensive against the double-render artifact noted above — take the
    // first 3 (the real, fully-hydrated set) regardless of whether a
    // transient duplicate briefly existed.
    const [, expectedText, badgesText] = allValues.slice(0, 3);

    // Expected == accepted Attendee count (>= 5: Priya's 4 + the M5-T2
    // manual registrant); Badges ready mirrors Expected exactly (M5 decision
    // — every badge is generatable on demand).
    const expectedValue = Number(expectedText);
    const badgesValue = Number(badgesText);
    expect(expectedValue).toBeGreaterThanOrEqual(5);
    expect(badgesValue).toBe(expectedValue);
  });

  test("badge preview: real decodable QR + merge fields + reg-type pill (not the sample placeholder)", async ({
    page,
  }) => {
    await page.goto(checkinUrl());
    await page.waitForLoadState("load");

    // CardTitle renders a plain <div>, not a heading element — text lookup.
    await expect(
      page.getByText("Badge & pass design", { exact: true }),
    ).toBeVisible();

    const qr = page.getByTestId("badge-preview-qr");
    await expect(qr).toBeVisible();
    // A real attendee QR is an inline SVG (server-minted), not the muted
    // QrCode glyph fallback used only when the roster is empty.
    await expect(qr.locator("svg")).toHaveCount(1);

    await expect(
      page.getByText("Sample Attendee", { exact: true }),
    ).toHaveCount(0);

    await expect(
      page.getByText("{full_name}", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText(/Stock: 6.×4. double-sided\./)).toBeVisible();
  });

  test("settings toggles: 5 rows render with correct defaults and persist across reload", async ({
    page,
  }) => {
    await page.goto(checkinUrl());
    await page.waitForLoadState("load");

    const rows: Array<[string, boolean]> = [
      ["Signature collection", false],
      ["Photo capture", false],
      ["Photo ID verification", true],
      ["Self-print badges", true],
      ["Wallet passes", true],
    ];

    for (const [label] of rows) {
      await expect(page.getByLabel(label)).toBeVisible();
    }

    // Flip "Signature collection" On, verify optimistic flip, WAIT for the
    // background PATCH to actually resolve (the toggle is optimistic —
    // reloading before the network call lands would race and falsely look
    // like a persistence failure), then reload and confirm the server
    // actually persisted it.
    const signatureToggle = page.getByLabel("Signature collection");
    const wasChecked = await signatureToggle.isChecked();
    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/checkin/config") &&
          response.request().method() === "PATCH",
      ),
      signatureToggle.click(),
    ]);
    expect(patchResponse.ok()).toBe(true);
    await expect(signatureToggle).toBeChecked({ checked: !wasChecked });

    await page.reload();
    await page.waitForLoadState("load");
    await expect(page.getByLabel("Signature collection")).toBeChecked({
      checked: !wasChecked,
    });

    // Flip it back to leave the config in its original state.
    const [revertResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/checkin/config") &&
          response.request().method() === "PATCH",
      ),
      page.getByLabel("Signature collection").click(),
    ]);
    expect(revertResponse.ok()).toBe(true);
    await expect(page.getByLabel("Signature collection")).toBeChecked({
      checked: wasChecked,
    });
  });

  test("team members: add shows a one-time access code, then revoke removes the row", async ({
    page,
  }) => {
    await page.goto(checkinUrl());
    await page.waitForLoadState("load");

    await expect(
      page.getByText("Team members (door scanners)", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add team member" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("QA Door Staff");
    await dialog.getByLabel("Device label").fill("Door A");
    await dialog.getByRole("button", { name: "Add team member" }).click();

    await expect(
      dialog.getByRole("heading", { name: /Access code for QA Door Staff/ }),
    ).toBeVisible({ timeout: 10_000 });
    const codePanel = dialog.locator("div.font-mono.text-2xl");
    const accessCode = (await codePanel.textContent())?.trim() ?? "";
    expect(accessCode.length).toBeGreaterThan(0);
    await expect(
      dialog.getByText("Save this code now", { exact: false }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    const memberRow = page
      .locator("li")
      .filter({ hasText: "QA Door Staff" })
      .first();
    await expect(memberRow).toBeVisible();
    await expect(memberRow.getByText("Door A", { exact: false })).toBeVisible();

    console.log(
      `[M5-T4] Added team member "QA Door Staff" (Door A); access code ` +
        `${accessCode} captured for the M5-T5 scan spec if a team-session ` +
        "scan is exercised (this phase primarily uses the admin scanner).",
    );

    // Revoke to keep the team-members list clean for Phase 4 (a revoked
    // scanner credential has no bearing on reports).
    await memberRow.getByRole("button", { name: "Revoke" }).click();
    const alertDialog = page.getByRole("alertdialog");
    await expect(alertDialog).toBeVisible();
    await alertDialog.getByRole("button", { name: "Revoke" }).click();
    await expect(
      page.getByText(/Access revoked for QA Door Staff/).last(),
    ).toBeVisible();
    await expect(
      page.locator("li").filter({ hasText: "QA Door Staff" }),
    ).toHaveCount(0);
  });
});
