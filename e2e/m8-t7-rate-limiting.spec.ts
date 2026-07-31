// M8-T7 — CSV export rate-limiting. Spot-check: hit one export route
// rapidly in a tight loop and confirm a 429 eventually appears. The
// attendees export route (`src/app/api/dashboard/events/[eventId]/attendees/
// export/route.ts`) is limited to 10 requests/minute per
// (organizationId, userId, eventId) via `checkRateLimit` (`src/lib/
// rate-limit.ts`) — this test drives the REAL authenticated dev server, not
// a unit-level mock (the existing unit coverage is
// `src/__tests__/m8-t7-export-rate-limits.test.ts`).
import { test, expect } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

test.describe("M8-T7 — CSV export rate limiting", () => {
  test("hitting the attendees export route rapidly eventually returns 429 with Retry-After", async ({
    page,
  }) => {
    await page.goto(`/dashboard/events/${fixtures.eventId}/attendees`, { timeout: 60_000 });
    await page.waitForLoadState("load");

    const exportUrl = `/api/dashboard/events/${fixtures.eventId}/attendees/export`;

    // In-page fetch (guaranteed same-origin session cookie, matching how the
    // real Export button works) — 15 rapid requests against a 10/min limit.
    const results = (await page.evaluate(async (url) => {
      const statuses: number[] = [];
      for (let i = 0; i < 15; i += 1) {
        const response = await fetch(url);
        statuses.push(response.status);
      }
      return statuses;
    }, exportUrl)) as number[];

    const okCount = results.filter((status) => status === 200).length;
    const tooManyCount = results.filter((status) => status === 429).length;

    expect(okCount).toBeGreaterThan(0);
    expect(okCount).toBeLessThanOrEqual(10);
    expect(tooManyCount).toBeGreaterThan(0);

    // Confirm the 429 body/shape is well-formed (retryable, not a bare 500).
    const singleResponse = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      return {
        status: response.status,
        retryAfter: response.headers.get("Retry-After"),
        body,
      };
    }, exportUrl);

    if (singleResponse.status === 429) {
      expect(singleResponse.retryAfter).toBeTruthy();
      expect(singleResponse.body?.error).toMatch(/too many exports/i);
    }
  });

  test("a report template export route also enforces its own rate limit", async ({
    page,
  }) => {
    await page.goto(`/dashboard/events/${fixtures.eventId}/reports`, { timeout: 60_000 });
    await page.waitForLoadState("load");

    const exportUrl = `/api/dashboard/events/${fixtures.eventId}/reports/registration-overview/export`;

    const results = (await page.evaluate(async (url) => {
      const statuses: number[] = [];
      for (let i = 0; i < 15; i += 1) {
        const response = await fetch(url);
        statuses.push(response.status);
      }
      return statuses;
    }, exportUrl)) as number[];

    const tooManyCount = results.filter((status) => status === 429).length;
    const serverErrorCount = results.filter((status) => status >= 500).length;

    // This route has its own independent 10/min limiter, keyed separately
    // from the attendees export route (different bucket key prefix) — it
    // must never bare-500 under rapid legitimate traffic, and must itself
    // 429 once its own ceiling is crossed.
    expect(serverErrorCount).toBe(0);
    expect(tooManyCount).toBeGreaterThan(0);
  });
});
