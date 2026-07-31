// M3-T5 — Abandoned-registration tracking: a SECOND public registration for
// this event, taken to the Registration Summary step and then abandoned
// (navigated away from) without finalizing. The resulting RegistrationDraft
// must be discoverable later by Phase 3's M5-T3 Abandoned tab.
// See agents/docs/specs/m3-registration-paths.md §M3-T5.
//
// IMPORTANT TIMING CAVEAT (by design, not a defect): the Abandoned tab only
// shows drafts whose `updatedAt` is more than 24h stale
// (ABANDONED_AFTER_MS in src/lib/db/adminRegistrationDraft.ts). This draft
// will NOT appear there until ~24h after this spec runs. Phase 3 must either
// wait for that window or verify via a direct Firestore/Admin lookup if run
// sooner.
import { test, expect } from "@playwright/test";

import { ABANDONED_REGISTRANT } from "./fixtures/registration-data";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

// A genuine unauthenticated visitor session, independent of M3-T3's.
test.use({ storageState: { cookies: [], origins: [] } });

const registerUrl = () => `/events/${fixtures.eventId}/register`;

test.describe("M3-T5 — Abandoned-registration tracking", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test("starts a second registration, reaches Registration Summary, then abandons it", async ({
    page,
  }) => {
    await page.goto(registerUrl());
    await page.waitForLoadState("load");
    await page.getByRole("link", { name: /1 Delegate — Card/ }).click();
    await expect(page).toHaveURL(/\/register\?path=/);

    // Step 1 — Personal Information (creates the RegistrationDraft).
    await expect(
      page.getByRole("heading", { name: "Personal Information" }),
    ).toBeVisible();
    await page.getByLabel("First name").fill(ABANDONED_REGISTRANT.firstName);
    await page.getByLabel("Last name").fill(ABANDONED_REGISTRANT.lastName);
    await page.getByLabel("Email").fill(ABANDONED_REGISTRANT.email);
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2 — Ticket & Options: select Early Bird, skip the promo code.
    await expect(
      page.getByRole("heading", { name: "Ticket & Options" }),
    ).toBeVisible();
    await page.getByText("Early Bird", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3 — Registration Summary: advance far enough that the draft's
    // lastStepReached becomes "summary" (the PATCH fires on this
    // Confirm & pay click, before Payment ever renders) — then STOP. Do not
    // fill card details, do not submit. This is the abandonment point.
    await expect(
      page.getByRole("heading", { name: "Registration Summary" }),
    ).toBeVisible();
    await expect(page.getByText("Total", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Confirm & pay" }).click();
    await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();

    // Abandon: navigate away without ever submitting payment. No draft
    // finalize call is made, so the RegistrationDraft document (and its
    // denormalized firstName/lastName/email) survives as an incomplete,
    // eventually-abandoned record.
    await page.goto("about:blank");

    console.log(
      `[M3-T5] Abandoned registration for ${ABANDONED_REGISTRANT.firstName} ${ABANDONED_REGISTRANT.lastName} ` +
        `(${ABANDONED_REGISTRANT.email}) stopped at the Payment threshold — ` +
        `draft.lastStepReached = "summary" ("Registration Summary" in the Abandoned tab). ` +
        `Visible in the Abandoned tab only after the 24h threshold elapses.`,
    );
  });
});
