// M8-T2 — Workspace dashboard real metrics. See
// agents/docs/specs/m8-dashboard-metrics.md. The ORG-level dashboard
// (/dashboard), not the per-event overview — verifies real draft/published
// event counts, org-wide registrations, and revenue reflect this event's
// real activity (there is only one event in this dedicated test org, so the
// org-wide numbers are directly comparable to the per-event ones Phase
// 1-3/M7-T1 already established).
import { test, expect } from "@playwright/test";

import {
  getAdminAllAttendeesForEvent,
  getAdminAllOrdersForEvent,
} from "./fixtures/admin-live";
import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

test.describe("M8-T2 — Workspace dashboard real metrics", () => {
  test.describe.configure({ mode: "serial", retries: 1 });

  test("Draft/Published event counts and Registrations reflect real org-wide data", async ({
    page,
  }) => {
    await page.goto("/dashboard", { timeout: 60_000 });
    await page.waitForLoadState("load");

    await expect(page.getByText("Draft Events", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Published Events", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Registrations", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Revenue (paid)", { exact: true }),
    ).toBeVisible();

    // Card locator via the shadcn Card's own `data-slot="card"` marker — far
    // more robust than walking `..` ancestors through an unstable DOM shape.
    const draftCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Draft Events" });
    const publishedCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Published Events" });
    const registrationsCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Registrations" });

    // This dedicated org has exactly 1 event (Published, per Phase 1 setup).
    await expect(draftCard.getByText("00", { exact: true })).toBeVisible();
    await expect(publishedCard.getByText("01", { exact: true })).toBeVisible();

    const attendees = await getAdminAllAttendeesForEvent({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
    });
    const acceptedCount = attendees.filter((a) => a.status === "accepted").length;
    expect(acceptedCount).toBeGreaterThanOrEqual(6);

    await expect(
      registrationsCard.getByText(String(acceptedCount), { exact: true }),
    ).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("TBD");
  });

  test("Quick actions deep-link into the real, most-recently-updated event", async ({
    page,
  }) => {
    await page.goto("/dashboard", { timeout: 60_000 });
    await page.waitForLoadState("load");

    const openLink = page.getByRole("link", {
      name: new RegExp(`Open "${fixtures.eventName}"`),
    });
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute(
      "href",
      `/dashboard/events/${fixtures.eventId}`,
    );

    await expect(
      page.getByRole("link", { name: "Add ticket types" }),
    ).toHaveAttribute("href", `/dashboard/events/${fixtures.eventId}/tickets`);
    await expect(
      page.getByRole("link", { name: "Set pricing & discounts" }),
    ).toHaveAttribute("href", `/dashboard/events/${fixtures.eventId}/pricing`);
  });

  test("Setup notes card is static (no links, no per-org dynamic state)", async ({
    page,
  }) => {
    await page.goto("/dashboard", { timeout: 60_000 });
    await page.waitForLoadState("load");

    const setupCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Setup notes" });
    await expect(setupCard.locator("a")).toHaveCount(0);
  });

  // KNOWN DEFECT (see agents/docs/qa/e2e-regression-m7-m8.md, QA-9): the
  // Revenue stat card's sumAdminOrderTotalsForOrganization() aggregate sum()
  // query hits a real Firestore FAILED_PRECONDITION "requires an index"
  // error in production (confirmed via direct Admin SDK repro — same root
  // cause as M7-T1's Finance card). This test asserts the CORRECT (spec'd)
  // behavior and is expected to fail until Backend adds the missing
  // composite index — left failing/documented, not softened, per this
  // loop's established convention (Phase 1's QA-6). Isolated as its own,
  // final test so the Draft/Published/Registrations/Quick-actions/Setup-notes
  // checks above (all real, all passing) are not skipped by test.describe's
  // serial-mode "stop on first failure" behavior.
  test("Revenue (paid) stat card shows a real, non-error dollar figure", async ({
    page,
  }) => {
    await page.goto("/dashboard", { timeout: 60_000 });
    await page.waitForLoadState("load");

    const orders = await getAdminAllOrdersForEvent({
      organizationId: fixtures.organizationId,
      eventId: fixtures.eventId,
    });
    const paidOrders = orders.filter((o) => o.paymentStatus === "paid");
    expect(paidOrders.length).toBeGreaterThan(0);

    const revenueCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Revenue (paid)" });
    await expect(revenueCard.getByText(/\$[\d,]+(\.\d{2})?/)).toBeVisible();
  });
});
