// M5-T5 — Check-in scan flow (`/dashboard/events/[eventId]/checkin/scan`,
// the admin scanner shortcut — same ScannerSurface as the public
// `/scan/[eventId]` team-session route, authenticated by the admin session
// instead). THE key test of this phase: a real QR token, legitimately
// re-minted for one of Priya Kapoor's actual Attendee docs (deterministic
// HMAC per src/lib/qr/qr-token.ts — see e2e/fixtures/qr-token.ts), resolved
// and confirmed through the real scan UI. Headless Chromium has no camera
// device, so getUserMedia() fails immediately and the surface's own
// camera-denied fallback auto-opens the REQUIRED manual token entry field
// (design §4 AC-11) — this is the intended fallback path, not a workaround.
// See agents/docs/specs/m5-attendees-checkin.md §M5-T5.
import { test, expect } from "@playwright/test";

import { getAdminAttendeesForEmail } from "./fixtures/admin-live";
import { mintQrTokenForHarness } from "./fixtures/qr-token";
import { ACCEPTED_REGISTRANT } from "./fixtures/registration-data";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;
let qrToken: string;
let attendeeDocId: string;

test.beforeAll(async () => {
  fixtures = readSeededFixtures();
  const attendees = await getAdminAttendeesForEmail({
    organizationId: fixtures.organizationId,
    eventId: fixtures.eventId,
    email: ACCEPTED_REGISTRANT.email,
  });
  const notArrived = attendees.find((a) => a.checkInState === "not-arrived");
  if (!notArrived) {
    throw new Error(
      "Expected at least one not-arrived Priya Kapoor Attendee to scan in — " +
        "none found (all already checked in from a prior run?).",
    );
  }
  attendeeDocId = notArrived.id;
  qrToken = mintQrTokenForHarness(fixtures.eventId, notArrived.submissionId);
});

const scannerUrl = () =>
  `/dashboard/events/${fixtures.eventId}/checkin/scan`;

async function openManualEntry(page: import("@playwright/test").Page) {
  await page.goto(scannerUrl());
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "Scanner" })).toBeVisible();

  // Camera fails (no device in headless Chromium) -> auto-opens manual
  // entry. Wait generously: the qr-scanner lib is dynamically imported, then
  // getUserMedia rejects, then React state updates.
  const manualInput = page.getByPlaceholder("Paste the pass code");
  await expect(manualInput).toBeVisible({ timeout: 20_000 });
  return manualInput;
}

test.describe("M5-T5 — Check-in scan flow", () => {
  test.describe.configure({ mode: "serial" });

  test("camera-denied fallback auto-opens manual entry (AC-11)", async ({
    page,
  }) => {
    await page.goto(scannerUrl());
    await page.waitForLoadState("load");
    const manualToggle = page.getByRole("button", {
      name: "Enter code manually",
    });
    await expect(manualToggle).toHaveAttribute("aria-expanded", "true", {
      timeout: 20_000,
    });
    await expect(
      page.getByText(/Camera unavailable/, { exact: false }),
    ).toBeVisible();
  });

  test("valid QR resolves to the attendee card WITHOUT checking in yet (resolve ≠ confirm)", async ({
    page,
  }) => {
    const manualInput = await openManualEntry(page);
    await manualInput.fill(qrToken);
    await page.getByRole("button", { name: "Look up" }).click();

    const result = page.getByRole("status");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result.getByText("Pass valid", { exact: true })).toBeVisible();
    await expect(result.getByText("Not checked in yet")).toBeVisible();
    await expect(
      result.getByText(
        `${ACCEPTED_REGISTRANT.firstName} ${ACCEPTED_REGISTRANT.lastName}`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(result.getByText("Delegate", { exact: true })).toBeVisible();
    await expect(result.getByText("Early Bird", { exact: true })).toBeVisible();
    await expect(result.getByRole("button", { name: "Check in" })).toBeVisible();
  });

  test("confirming check-in flips to Checked in and updates the stat cards", async ({
    page,
  }) => {
    const manualInput = await openManualEntry(page);
    await manualInput.fill(qrToken);
    await page.getByRole("button", { name: "Look up" }).click();

    const result = page.getByRole("status");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await result.getByRole("button", { name: "Check in" }).click();
    await expect(result.getByText("Checked in", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Verify server-side, not just the client card: the real Attendee doc
    // flipped state (this is the ground truth Phase 4's reports will read).
    const attendees = await getAdminAttendeesForEmail({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
      email: ACCEPTED_REGISTRANT.email,
    });
    const scanned = attendees.find((a) => a.id === attendeeDocId);
    expect(scanned?.checkInState).toBe("checked-in");

    await result.getByRole("button", { name: "Scan next" }).click();
    await expect(page.getByRole("status")).toHaveCount(0);

    // The check-in config's stat cards reflect the new state.
    await page.goto(
      `/dashboard/events/${fixtures.eventId}/checkin`,
    );
    await page.waitForLoadState("load");
    // Fixed render order: Checked in, Expected, Badges ready. Defensive
    // .first(3)-slice against the transient dev-mode double-render artifact
    // documented in agents/docs/qa/e2e-regression-m3-m4.md.
    const statValues = page.locator("p.text-3xl");
    await expect(statValues.first()).toBeVisible();
    const [checkedInText] = (await statValues.allTextContents()).slice(0, 3);
    expect(Number(checkedInText)).toBeGreaterThanOrEqual(1);
  });

  test("re-scanning the SAME QR shows 'already checked in', never a duplicate success", async ({
    page,
  }) => {
    const manualInput = await openManualEntry(page);
    await manualInput.fill(qrToken);
    await page.getByRole("button", { name: "Look up" }).click();

    const result = page.getByRole("status");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(
      result.getByText("Already checked in", { exact: true }),
    ).toBeVisible();
    // Never the fresh-confirm success button on a re-scan.
    await expect(
      result.getByRole("button", { name: "Check in" }),
    ).toHaveCount(0);
  });

  test("an invalid/garbage QR value shows the invalid-scan state, never a crash", async ({
    page,
  }) => {
    const manualInput = await openManualEntry(page);
    await manualInput.fill("this-is-not-a-real-qr-token-at-all");
    await page.getByRole("button", { name: "Look up" }).click();

    const result = page.getByRole("status");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result.getByText("Invalid pass", { exact: true })).toBeVisible();
  });
});
