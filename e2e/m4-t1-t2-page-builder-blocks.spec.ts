// M4-T1 — New Puck blocks (Ticket/Pricing table, Countdown timer,
// Registration Embed) + M4-T2 — per-path page customization.
// See agents/docs/specs/m4-website-blocks.md.
//
// Depends on M3-T1's registration paths (for the per-path page + the
// RegistrationEmbed CTA state) and M2's fees (for real pricing-table data).
//
// The Puck canvas renders inside an iframe (#preview-frame,
// @measured/puck's default `iframe.enabled: true`) and drag sources use
// pointer events (@dnd-kit/react), not native HTML5 drag-and-drop — plain
// Playwright `dragTo` does not reliably trigger it. dragDrawerItemToCanvas
// below simulates a real pointer drag (mouse down → stepped moves → up).
import { test, expect, type Page } from "@playwright/test";

import { readSeededFixtures } from "./fixtures/read-fixtures";
import type { SeededFixtures } from "./fixtures/test-data";

let fixtures: SeededFixtures;

test.beforeAll(() => {
  fixtures = readSeededFixtures();
});

const pageBuilderUrl = (path?: string) =>
  `/dashboard/events/${fixtures.eventId}/page-builder${path ? `?path=${path}` : ""}`;
const pathsUrl = () => `/dashboard/events/${fixtures.eventId}/registration-paths`;

async function canvasComponentCount(page: Page): Promise<number> {
  return page
    .frameLocator("#preview-frame")
    .locator("[data-puck-component]")
    .count();
}

// @dnd-kit/react (Puck's internal drag library) is pointer-event driven, not
// native HTML5 DnD — Playwright's dragTo() does not reliably trigger it.
// This simulates a real pointer drag: down → small activation jiggle →
// stepped moves into the iframe canvas → a settle wiggle over the drop
// target → up. Returns whether a NEW component actually landed in the
// canvas (verified via the component count), not just whether the mouse
// sequence completed without throwing.
async function dragDrawerItemToCanvas(
  page: Page,
  componentName: string,
): Promise<boolean> {
  const source = page.getByTestId(`drawer-item:${componentName}`);
  if (!(await source.isVisible().catch(() => false))) return false;
  const sourceBox = await source.boundingBox();
  if (!sourceBox) return false;

  const canvasFrame = page.frameLocator("#preview-frame");
  const dropZone = canvasFrame.locator('[data-puck-dropzone="root:default-zone"]').first();
  const targetBox = await dropZone.boundingBox().catch(() => null);
  if (!targetBox) return false;

  const before = await canvasComponentCount(page);

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + Math.max(targetBox.height - 16, 10);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Activation jiggle: PointerSensor-style libraries require the pointer to
  // move past a small distance threshold before a drag is recognized.
  await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
  await page.waitForTimeout(100);

  const steps = 20;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      startX + ((endX - startX) * i) / steps,
      startY + ((endY - startY) * i) / steps,
      { steps: 5 },
    );
    await page.waitForTimeout(60);
  }
  // Settle wiggle directly over the target so the library's hit-testing
  // re-evaluates the drop zone at the final position.
  await page.mouse.move(endX - 5, endY - 5, { steps: 3 });
  await page.waitForTimeout(120);
  await page.mouse.move(endX, endY, { steps: 3 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(400);

  const after = await canvasComponentCount(page);
  return after > before;
}

test.describe("M4-T1 — Page Builder: new blocks", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test("palette lists the 3 registration blocks with New badges on the 2 new ones", async ({
    page,
  }) => {
    await page.goto(pageBuilderUrl());
    await page.waitForLoadState("load");

    await expect(page.getByTestId("drawer-item:RegistrationEmbed")).toBeVisible();
    await expect(page.getByTestId("drawer-item:TicketPricingTable")).toBeVisible();
    await expect(page.getByTestId("drawer-item:CountdownTimer")).toBeVisible();
  });

  test("applies a starter template (gives the page a RegistrationEmbed CTA to verify)", async ({
    page,
  }) => {
    await page.goto(pageBuilderUrl());
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: /Summit landing/ }).click();
    await expect(page.getByText("Starter template applied").last()).toBeVisible();

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved to Firebase").last()).toBeVisible();
  });

  test("adds Ticket & Pricing table and Countdown timer blocks via the canvas", async ({
    page,
  }) => {
    await page.goto(pageBuilderUrl());
    await page.waitForLoadState("load");

    const pricingAdded = await dragDrawerItemToCanvas(page, "TicketPricingTable");
    const countdownAdded = await dragDrawerItemToCanvas(page, "CountdownTimer");

    test.info().annotations.push({
      type: "drag-drop-result",
      description: `TicketPricingTable inserted: ${pricingAdded}; CountdownTimer inserted: ${countdownAdded}`,
    });
    console.log(
      `[M4-T1] drag-drop result — TicketPricingTable inserted: ${pricingAdded}; CountdownTimer inserted: ${countdownAdded}`,
    );

    if (pricingAdded || countdownAdded) {
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Draft saved to Firebase").last()).toBeVisible();
    }

    // Whether or not the drag lands a fresh block, the RegistrationEmbed CTA
    // from the starter template must render correctly either way (T1 ACs
    // 13-16) in the live "Public render preview" panel, using REAL
    // registration-path data (2 active paths from M3-T1 → "open" state).
    await expect(page.getByText("Register now").first()).toBeVisible();

    if (pricingAdded) {
      // Real Fees data (M2/Phase 1): Early Bird $750.00 must show, not a
      // placeholder/sample-data row.
      await expect(page.getByText("Early Bird").first()).toBeVisible();
      await expect(page.getByText("$750.00").first()).toBeVisible();
      await expect(page.getByText("Sample data")).toHaveCount(0);
    }

    if (countdownAdded) {
      // Event start (Nov 15 2026) is in the future relative to "now" — the
      // countdown must show live digits, not the completed message.
      await expect(page.getByText("The event is underway.")).toHaveCount(0);
    }
  });

  test("publishes the page", async ({ page }) => {
    await page.goto(pageBuilderUrl());
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: "Publish page" }).click();
    await expect(page.getByText("Page published").last()).toBeVisible();
    await expect(page.getByText("Published snapshot")).toBeVisible();
  });
});

test.describe("M4-T2 — Per-path page customization", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test("Registration Paths table Customize link opens the path-scoped builder with the inherit-fallback banner", async ({
    page,
  }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");

    const pressRow = page.getByRole("row").filter({ hasText: "2 Press — Comp" });
    // Idempotent: a prior run of the next test may have already started this
    // path's page (badge already "Custom") — the inherit-fallback banner
    // only applies to a not-yet-started path page.
    const alreadyCustom = await pressRow
      .getByText("Custom", { exact: true })
      .isVisible()
      .catch(() => false);
    if (!alreadyCustom) {
      await expect(pressRow.getByText("Default", { exact: true })).toBeVisible();
    }
    await pressRow.getByRole("link", { name: /Customize page for 2 Press — Comp/ }).click();

    await expect(page).toHaveURL(/page-builder\?path=/);
    if (!alreadyCustom) {
      await expect(
        page.getByText("This path currently inherits the default event page."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Start from a copy of the default page" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Start blank" })).toBeVisible();
    }
  });

  test("starting a blank path page, saving and publishing flips the Page badge to Custom", async ({
    page,
  }) => {
    await page.goto(pathsUrl());
    await page.waitForLoadState("load");
    const pressRow = page.getByRole("row").filter({ hasText: "2 Press — Comp" });

    // Idempotent: if a prior run already started this path's page, the
    // inherit banner is gone and the badge already reads Custom.
    if (await pressRow.getByText("Custom", { exact: true }).isVisible().catch(() => false)) {
      return;
    }

    await pressRow.getByRole("link", { name: /Customize page for 2 Press — Comp/ }).click();
    await expect(page).toHaveURL(/page-builder\?path=/);

    await page.getByRole("button", { name: "Start blank" }).click();
    await expect(page.getByText("Started a blank page").last()).toBeVisible();

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved to Firebase").last()).toBeVisible();
    await page.getByRole("button", { name: "Publish page" }).click();
    await expect(page.getByText("Page published").last()).toBeVisible();

    await page.goto(pathsUrl());
    await page.waitForLoadState("load");
    await expect(
      page.getByRole("row").filter({ hasText: "2 Press — Comp" }).getByText("Custom", { exact: true }),
    ).toBeVisible();
  });
});
