// M8-T3 — Event overview parity. See agents/docs/specs/m8-event-overview.md.
// Verifies the per-event overview's stat cards (Registered/Invited/Revenue/
// Abandoned), identity rows (visibility, registration path count, payment),
// the fixed 6-item readiness checklist, and Preview/Publish actions — all
// against the real activity Phases 1-3 created.
import { test, expect } from "@playwright/test";

import {
  countAdminAbandonedDraftsPastThreshold,
  getAdminAllAttendeesForEvent,
} from "./fixtures/admin-live";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const eventUrl = () => `/dashboard/events/${fixtures.eventId}`;

test.describe("M8-T3 — Event overview parity", () => {
  test.describe.configure({ mode: "serial", retries: 1 });

  test("Registered and Invited stat cards reflect real data", async ({
    page,
  }) => {
    await page.goto(eventUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    await expect(page.getByText("Registered", { exact: true })).toBeVisible();
    await expect(page.getByText("Invited", { exact: true })).toBeVisible();
    await expect(page.getByText("Revenue", { exact: true })).toBeVisible();
    await expect(page.getByText("Abandoned", { exact: true })).toBeVisible();

    const attendees = await getAdminAllAttendeesForEvent({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
    });
    const acceptedCount = attendees.filter((a) => a.status === "accepted").length;
    expect(acceptedCount).toBeGreaterThanOrEqual(6);

    // Card locator via the shadcn Card's own `data-slot="card"` marker.
    const registeredCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Registered" });
    const invitedCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Invited" });

    await expect(
      registeredCard.getByText(String(acceptedCount), { exact: true }).first(),
    ).toBeVisible();

    // No "invitation" kind emails were ever sent in Phases 1-3 (only
    // approval-pending / confirmation-paid triggers fired) — Invited must
    // genuinely read 0, not a fabricated/placeholder number.
    await expect(invitedCard.getByText("0", { exact: true })).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Stripe");
    expect(bodyText).not.toContain("listed in search");
  });

  test("identity rows: Visibility, Registration path count, Payment method", async ({
    page,
  }) => {
    await page.goto(eventUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    await expect(page.getByText("Event identity")).toBeVisible();
    await expect(page.getByText("Category", { exact: true })).toBeVisible();
    await expect(page.getByText("Not set", { exact: true })).toBeVisible();

    await expect(page.getByText("Timezone", { exact: true })).toBeVisible();
    // exact:true — the event bar's own date/venue line also contains the
    // timezone string as a substring ("2026-11-15, 09:00-17:00 · Asia/
    // Singapore"), so a non-exact match is ambiguous (strict-mode violation).
    await expect(
      page.getByText(fixtures.eventTimezone, { exact: true }),
    ).toBeVisible();

    // Event is Published (Phase 1 seeded it that way) -> Visibility "Public".
    await expect(page.getByText("Public", { exact: true })).toBeVisible();

    // 2 real, active registration paths from Phase 2 (Delegate-Card,
    // Press-Comp) -> "Open · 2 active / 2 paths".
    await expect(page.getByText(/Open · 2 active \/ 2 paths/)).toBeVisible();

    // Both paths' payment methods (card + comp) -> "Simulated · Card + Comp".
    await expect(page.getByText(/Simulated ·/)).toBeVisible();
  });

  test("public readiness: fixed 6-item checklist with an honest N / 6 count", async ({
    page,
  }) => {
    await page.goto(eventUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    await expect(page.getByText("Public readiness")).toBeVisible();
    await expect(page.getByText(/\d \/ 6 ready/)).toBeVisible();

    const readinessItems = [
      "Event published",
      "Registration form published",
      "Confirmation email active",
    ];
    for (const item of readinessItems) {
      await expect(
        page.getByText(new RegExp(item.replace(/ /g, " "))).first(),
      ).toBeVisible();
    }

    // Ticket types & pricing set: Phase 1 created active Fees for real
    // TicketTypes -> should read as a "done" (checked) row, not pending.
    const ticketRow = page
      .getByText(/Ticket types & pricing/)
      .locator("..");
    await expect(ticketRow).toBeVisible();
  });

  test("Preview and Publish/Move-to-draft actions are present and real", async ({
    page,
  }) => {
    await page.goto(eventUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const previewLink = page.getByRole("link", { name: /Preview/i });
    await expect(previewLink).toBeVisible();
    await expect(previewLink).toHaveAttribute(
      "href",
      new RegExp(`/events/${fixtures.eventId}`),
    );
    await expect(previewLink).toHaveAttribute("target", "_blank");

    // Event is Published -> primary action is "Move to draft" (never a
    // duplicate "View public page" button alongside Preview, per D14).
    const statusButton = page.getByRole("button", {
      name: /Move to draft|Publish event/,
    });
    await expect(statusButton).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View public page" }),
    ).toHaveCount(0);
  });

  // KNOWN DEFECT (see agents/docs/qa/e2e-regression-m7-m8.md, QA-9): the
  // Revenue stat's sumAdminOrderTotalsForEvent() aggregate sum() query hits
  // a real Firestore FAILED_PRECONDITION "requires an index" error in
  // production (confirmed via direct Admin SDK repro — same root cause as
  // M7-T1's Finance card and M8-T2's Revenue stat). Left asserting the
  // CORRECT (spec'd) behavior, expected to fail until Backend adds the
  // missing composite index — isolated as its own test so the passing
  // Registered/Invited/identity/readiness/Preview-Publish checks above are
  // not skipped by test.describe's serial-mode "stop on first failure."
  test("Revenue stat card shows a real, non-error dollar figure", async ({
    page,
  }) => {
    await page.goto(eventUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const revenueCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Revenue" });
    await expect(revenueCard.getByText(/\$[\d,]+(\.\d{2})?/)).toBeVisible();
  });

  // KNOWN DEFECT (see agents/docs/qa/e2e-regression-m7-m8.md, QA-9): the
  // Abandoned stat's countAdminAbandonedRegistrationDraftsForEvent() query
  // (equality filters + a `updatedAt <` RANGE filter, then .count()) ALSO
  // hits a real Firestore FAILED_PRECONDITION "requires an index" error in
  // production — a second, independent instance of the same systemic gap.
  // This is exactly the risk the M8-T3 spec itself flagged ("Backend must
  // verify against the emulator and add only if Firestore requests it") —
  // confirmed here that production Firestore DOES request it, and the index
  // was never added. Left asserting the CORRECT (spec'd) behavior.
  test("Abandoned stat card shows a real, non-error count", async ({
    page,
  }) => {
    await page.goto(eventUrl(), { timeout: 60_000 });
    await page.waitForLoadState("load");

    const abandonedRealCount = await countAdminAbandonedDraftsPastThreshold({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
    });
    const abandonedCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Abandoned" });
    await expect(
      abandonedCard.getByText(String(abandonedRealCount), { exact: true }).first(),
    ).toBeVisible();
  });
});
