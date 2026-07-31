// M0 — Foundations: event workspace shell (M0-T1), starter-cruft cleanup
// (M0-T2), and a live-browser spot check for missing-index Firestore errors
// while exercising the M1/M2 list screens (M0-T3; M0-T4 is unit-test-only,
// out of scope here). See agents/docs/specs/m0-foundations.md.
import { test, expect } from "@playwright/test";

import { collectConsoleErrors, findMissingIndexErrors } from "./fixtures/console-errors";
import { readSeededFixtures } from "./fixtures/read-fixtures";

const fixtures = () => readSeededFixtures();

test.describe("M0-T2 — starter-cruft cleanup", () => {
  test("deleted routes return 404, not the app shell", async ({ request }) => {
    const chat = await request.get("/api/chat", { maxRedirects: 0 });
    expect(chat.status()).toBe(404);

    const todos = await request.get("/api/todos", { maxRedirects: 0 });
    expect(todos.status()).toBe(404);

    const todoPage = await request.get("/todo", { maxRedirects: 0 });
    expect(todoPage.status()).toBe(404);
  });
});

test.describe("M0-T1 — event workspace shell", () => {
  test("sidebar groups, event bar, and nav all render for a real event", async ({
    page,
  }) => {
    const consoleState = collectConsoleErrors(page);

    const seeded = fixtures();
    await page.goto(`/dashboard/events/${seeded.eventId}`);
    await page.waitForLoadState("load");

    // Event bar: breadcrumb, title, status badge, event code.
    await expect(
      page.getByRole("link", { name: "Events", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: seeded.eventName, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByLabel(`Event code ${seeded.eventId}`)).toBeVisible();

    // Sidebar nav groups from the design spec (agents/docs/design/m0-event-shell.md §3).
    const nav = page.getByRole("navigation", { name: "Event sections" });
    for (const group of ["Build", "Registration", "Engage & Manage"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible();
    }

    const liveItems = [
      "Overview",
      "Website / Pages",
      "Registration Form",
      "Ticket Types",
      "Pricing",
      "Registration Types",
      "Registration Paths",
      "Responses",
      "Emails",
      "Attendees",
      "Check-in",
      "Reports",
    ];
    for (const item of liveItems) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${item}`) })).toBeVisible();
    }

    // "← All events" returns to the org-scoped events list.
    await page.getByRole("link", { name: "All events" }).click();
    await expect(page).toHaveURL(/\/dashboard\/events$/);

    expect(
      findMissingIndexErrors(consoleState.errors),
      `Firestore missing-index errors found: ${JSON.stringify(consoleState.errors)}`,
    ).toEqual([]);
  });

  test("every nav section deep-links to a real, rendered page (no 404s)", async ({
    page,
  }) => {
    // TEST-AUTHORING FIX (see agents/docs/qa/e2e-regression-m0-m1-m2.md): this
    // walks 11 distinct routes against the real `next dev` server, each
    // needing its own on-demand first compile — that easily exceeds the
    // global 60s per-test timeout (playwright.config.ts) on a cold route
    // cache, even though every individual navigation succeeds. Give this one
    // test extra budget rather than loosening the global default.
    test.setTimeout(150_000);
    const seeded = fixtures();
    // NOTE: the M0 spec's original design assumed registration-paths/emails/
    // attendees/checkin/reports would still be ComingSoon placeholders at
    // this point in the backlog. Per this task's brief, M3-M8 have since
    // landed ("Every milestone ... is marked Done"), so these routes now
    // render their real screens — this check only verifies every nav deep
    // link is a live, non-404 route with real content, not a stale
    // "coming soon" assertion.
    for (const segment of [
      "page-builder",
      "form",
      "tickets",
      "pricing",
      "registration-types",
      "registration-paths",
      "responses",
      "emails",
      "attendees",
      "checkin",
      "reports",
    ]) {
      const response = await page.goto(
        `/dashboard/events/${seeded.eventId}/${segment}`,
      );
      expect(response?.status(), `${segment} should not 404`).toBeLessThan(400);
      await expect(page.getByRole("main")).not.toContainText(
        /application error|something went wrong/i,
      );
    }
  });

  test("event shell remains reachable in dark theme and at mobile width", async ({
    page,
  }) => {
    const seeded = fixtures();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/dashboard/events/${seeded.eventId}`);
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    });

    await expect(
      page.getByRole("heading", { name: seeded.eventName, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open event navigation" }).click();
    await expect(
      page.getByRole("navigation", { name: "Event sections" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Pricing/ }),
    ).toBeVisible();
  });

  test("cross-org access to an unknown event id does not leak data", async ({
    page,
  }) => {
    const response = await page.goto(
      "/dashboard/events/this-event-id-does-not-exist-12345",
    );
    // Not-found handling: either a 404 status or the app's not-found card —
    // never the real event bar/shell.
    const notFoundCard = page.getByText(/event not found/i);
    const cardVisible = await notFoundCard.isVisible().catch(() => false);
    expect(cardVisible || (response?.status() ?? 200) === 404).toBeTruthy();
  });
});

test.describe("M0-T3 — Firestore index audit spot check", () => {
  test("M1/M2 list screens load with no missing-index console errors", async ({
    page,
  }) => {
    const seeded = fixtures();
    const consoleState = collectConsoleErrors(page);

    for (const segment of ["registration-types", "tickets", "pricing"]) {
      await page.goto(`/dashboard/events/${seeded.eventId}/${segment}`);
      await page.waitForLoadState("load");
    }

    expect(
      findMissingIndexErrors(consoleState.errors),
      `Firestore missing-index errors found: ${JSON.stringify(consoleState.errors)}`,
    ).toEqual([]);
  });
});
