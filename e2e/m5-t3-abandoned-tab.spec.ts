// M5-T3 — Abandoned tab UI (`/dashboard/events/[eventId]/attendees`,
// "Abandoned" tab). See agents/docs/specs/m5-attendees-checkin.md §M5-T3.
//
// TIMING CAVEAT (spec'd behavior, not a defect — see the M5-T3/M3-T5 specs'
// own note and this phase's brief): the tab only surfaces drafts whose
// `updatedAt` is >24h stale (`ABANDONED_AFTER_MS`). Phase 2's "Amara Osei"
// drafts were created well under 24h before this phase runs (confirmed
// below via a direct, read-only Firestore lookup — the real system clock at
// spec-authoring time was 2026-07-30, drafts created the same day). This
// spec therefore verifies:
//   (a) the drafts genuinely exist with the correct fields, via a direct
//       Admin SDK read (the "legitimate alternative verification" this
//       phase's brief calls for when the UI-visibility criterion itself is
//       untimed-out), and
//   (b) the real UI's empty state + disabled "Email all" button in the
//       zero-abandoned-rows case — which IS the honest, currently-true state
//       of this screen, not a workaround.
// If a future re-run happens >24h after the drafts' updatedAt, the "table
// renders real rows" branch below activates instead of the empty-state one.
import { test, expect } from "@playwright/test";

import { getAdminAbandonedDraftsForEmail } from "./fixtures/admin-live";
import { ABANDONED_REGISTRANT } from "./fixtures/registration-data";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const attendeesUrl = () =>
  `/dashboard/events/${fixtures.eventId}/attendees?tab=abandoned`;

test.describe("M5-T3 — Abandoned tab", () => {
  test("Amara Osei's draft(s) exist with lastStepReached=summary (direct verification)", async () => {
    const drafts = await getAdminAbandonedDraftsForEmail({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
      email: ABANDONED_REGISTRANT.email,
    });

    expect(drafts.length).toBeGreaterThanOrEqual(1);
    for (const draft of drafts) {
      expect(draft.firstName).toBe(ABANDONED_REGISTRANT.firstName);
      expect(draft.lastName).toBe(ABANDONED_REGISTRANT.lastName);
      expect(draft.email).toBe(ABANDONED_REGISTRANT.email);
    }
    // At least one draft reached "summary" (Registration Summary), per the
    // M3-T5 abandonment point.
    expect(drafts.some((d) => d.lastStepReached === "summary")).toBe(true);

    const stillWithin24h = drafts.every((d) => d.ageHours < 24);
    console.log(
      `[M5-T3] ${drafts.length} draft(s) for ${ABANDONED_REGISTRANT.email}, ` +
        `ages (hours): ${drafts.map((d) => d.ageHours.toFixed(2)).join(", ")}. ` +
        `All still <24h old: ${stillWithin24h} — the Abandoned tab will not ` +
        `surface them in the UI until each individually crosses the 24h mark.`,
    );
  });

  test("Abandoned tab UI: empty state (or real rows, if 24h has genuinely elapsed) + Email all button state", async ({
    page,
  }) => {
    const drafts = await getAdminAbandonedDraftsForEmail({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
      email: ABANDONED_REGISTRANT.email,
    });
    const anyPast24h = drafts.some((d) => d.ageHours >= 24);

    await page.goto(attendeesUrl());
    await page.waitForLoadState("load");
    await expect(page.getByRole("tab", { name: /Abandoned/ })).toHaveAttribute(
      "data-state",
      "active",
    );

    const emailAllButton = page.getByRole("button", { name: "Email all" });
    await expect(emailAllButton).toBeVisible();

    if (!anyPast24h) {
      // Honest current-state assertion (timing note above): zero abandoned
      // rows for THIS identity — assert the documented empty state and the
      // disabled Email-all button (disabled whenever the visible row count
      // is zero, per src/features/attendees/components/abandoned-tab.tsx).
      await expect(
        page.getByText("No abandoned registrations", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Registrations idle for more than 24 hours land here.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(emailAllButton).toBeDisabled();
    } else {
      const row = page
        .getByRole("row")
        .filter({ hasText: ABANDONED_REGISTRANT.firstName })
        .first();
      await expect(row).toBeVisible();
      // Email column is masked to domain-only — no local part anywhere.
      await expect(row.getByText("@dentsu.com")).toBeVisible();
      await expect(
        row.getByText(ABANDONED_REGISTRANT.email, { exact: true }),
      ).toHaveCount(0);
      await expect(row.getByText("Registration Summary")).toBeVisible();
      await expect(emailAllButton).toBeEnabled();
    }
  });
});
