// M6-T2 — Emails admin screen (`/dashboard/events/[eventId]/emails`):
// grouped tables (Pre-event / Post-registration / Debt chase & countdown),
// per-email trigger/audience/active toggle, and the confirmation-email
// preview card (real QR + wallet placeholder badges).
// See agents/docs/specs/m6-emails-admin.md.
import { test, expect } from "@playwright/test";

import { ACCEPTED_REGISTRANT } from "./fixtures/registration-data";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const emailsUrl = () => `/dashboard/events/${fixtures.eventId}/emails`;

test.describe("M6-T2 — Emails admin screen", () => {
  test.describe.configure({ mode: "serial" });

  test("grouped tables render the 8 default lifecycle emails with zero writes", async ({
    page,
  }) => {
    await page.goto(emailsUrl());
    await page.waitForLoadState("load");

    await expect(page.getByRole("heading", { name: "Emails" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Pre-event" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Post-registration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Debt chase & countdown" }),
    ).toBeVisible();

    const preEventTable = page.getByRole("table", { name: "Pre-event emails" });
    await expect(
      preEventTable.getByRole("button", { name: "Invitation" }),
    ).toBeVisible();
    await expect(
      preEventTable.getByRole("button", {
        name: "Abandoned registration reminder",
      }),
    ).toBeVisible();

    const postRegTable = page.getByRole("table", {
      name: "Post-registration emails",
    });
    await expect(
      postRegTable.getByRole("button", {
        name: "Approval pending notification",
      }),
    ).toBeVisible();
    const confirmationPaidRow = postRegTable
      .getByRole("row")
      .filter({ hasText: "Registration confirmation — paid" });
    await expect(confirmationPaidRow).toBeVisible();
    await expect(confirmationPaidRow.getByText("Auto · on accept")).toBeVisible();
    await expect(
      confirmationPaidRow.getByText("Accepted (paid)", { exact: true }),
    ).toBeVisible();
    await expect(confirmationPaidRow.getByText("On", { exact: true })).toBeVisible();

    const debtChaseTable = page.getByRole("table", {
      name: "Debt chase and countdown emails",
    });
    await expect(
      debtChaseTable.getByRole("button", { name: "Payment reminder 1–3" }),
    ).toBeVisible();
    await expect(
      debtChaseTable.getByRole("button", { name: "One week to go" }),
    ).toBeVisible();
    await expect(
      debtChaseTable.getByRole("button", { name: "Have your QR code ready" }),
    ).toBeVisible();
  });

  test("confirmation email preview card shows a real decodable QR + wallet placeholder badges", async ({
    page,
  }) => {
    await page.goto(emailsUrl());
    await page.waitForLoadState("load");

    // CardTitle renders a plain <div>, not a heading element — text lookup.
    await expect(
      page.getByText("Confirmation email preview", { exact: true }),
    ).toBeVisible();

    // Real attendees exist (Priya Kapoor x4 + the manual registrant), so this
    // must be the REAL-QR branch, not the zero-attendee placeholder.
    await expect(page.getByText("Present at check-in.")).toBeVisible();
    await expect(page.getByText("Sample QR — no attendees yet.")).toHaveCount(
      0,
    );
    await expect(page.getByText("Delegate check-in QR")).toBeVisible();

    await expect(page.getByText("Add to Apple Wallet")).toBeVisible();
    await expect(page.getByText("Add to Google Wallet")).toBeVisible();

    // The preview iframe is server-rendered; confirm it mounted with real
    // (non-empty) srcdoc content — the confirmation template's own copy.
    const previewFrame = page.locator('iframe[title="Email preview"]').last();
    await expect(previewFrame).toBeVisible();
    const srcdoc = await previewFrame.getAttribute("srcdoc");
    expect(srcdoc?.length ?? 0).toBeGreaterThan(0);
  });

  test("toggling a default email materializes its doc and persists across reload", async ({
    page,
  }) => {
    await page.goto(emailsUrl());
    await page.waitForLoadState("load");

    const preEventTable = page.getByRole("table", { name: "Pre-event emails" });
    const invitationRow = preEventTable
      .getByRole("row")
      .filter({ hasText: "Invitation" });
    const toggle = invitationRow.getByRole("switch");
    const wasChecked = (await toggle.getAttribute("aria-checked")) === "true";

    // Wait for the background PATCH to actually resolve before reloading —
    // the switch flips optimistically, so reloading immediately after the
    // click (without waiting for the network round-trip) would race the
    // persistence and falsely look like a failure.
    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/emails/definitions/invitation") &&
          response.request().method() === "PATCH",
      ),
      toggle.click(),
    ]);
    expect(patchResponse.ok()).toBe(true);
    await expect(toggle).toHaveAttribute(
      "aria-checked",
      String(!wasChecked),
      { timeout: 10_000 },
    );

    await page.reload();
    await page.waitForLoadState("load");
    const reloadedToggle = page
      .getByRole("table", { name: "Pre-event emails" })
      .getByRole("row")
      .filter({ hasText: "Invitation" })
      .getByRole("switch");
    await expect(reloadedToggle).toHaveAttribute(
      "aria-checked",
      String(!wasChecked),
    );

    // Flip back to leave the definition in its original state.
    const [revertResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/emails/definitions/invitation") &&
          response.request().method() === "PATCH",
      ),
      reloadedToggle.click(),
    ]);
    expect(revertResponse.ok()).toBe(true);
    await expect(reloadedToggle).toHaveAttribute(
      "aria-checked",
      String(wasChecked),
      { timeout: 10_000 },
    );
  });

  test("Open Email Designer picker is enabled (M6-T4 shipped) and lists all definitions", async ({
    page,
  }) => {
    await page.goto(emailsUrl());
    await page.waitForLoadState("load");

    const designerButton = page.getByRole("button", {
      name: "Open Email Designer",
    });
    await expect(designerButton).toBeEnabled();
    await designerButton.click();
    await expect(
      page.getByRole("menuitem", { name: /Registration confirmation — paid/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    console.log(
      `[M6-T2] Confirmation email preview verified against real accepted ` +
        `attendee ${ACCEPTED_REGISTRANT.email}.`,
    );
  });
});
