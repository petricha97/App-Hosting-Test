import { test as setup, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  createDedicatedOrganization,
  inventoryOrganizationsForUser,
  type OrganizationInventoryItem,
} from "./fixtures/admin-live";
import {
  AUTH_STORAGE_STATE,
  EVENT_END_DATE,
  EVENT_NAME,
  EVENT_START_DATE,
  EVENT_TIMEZONE,
  FIXTURES_FILE,
  ORG_NAME_BASE,
  ORG_RESERVATION_FILE,
  REAL_ACCOUNT_RUN_MARKER,
  REGISTRATION_END_DATE,
  REGISTRATION_START_DATE,
  type SeededFixtures,
} from "./fixtures/test-data";

interface OrgReservation {
  runMarker: typeof REAL_ACCOUNT_RUN_MARKER;
  organizationName: string;
  organizationId?: string;
  preexistingOrganizations: OrganizationInventoryItem[];
}

function requiredCredential(name: "E2E_EMAIL" | "E2E_PASSWORD"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required. The authoritative live E2E run never hardcodes credentials.`,
    );
  }
  return value;
}

function readReservation(): OrgReservation | null {
  if (!fs.existsSync(ORG_RESERVATION_FILE)) return null;
  const parsed = JSON.parse(
    fs.readFileSync(ORG_RESERVATION_FILE, "utf-8"),
  ) as OrgReservation;
  return parsed.runMarker === REAL_ACCOUNT_RUN_MARKER ? parsed : null;
}

function writeReservation(reservation: OrgReservation): void {
  fs.mkdirSync(path.dirname(ORG_RESERVATION_FILE), { recursive: true });
  fs.writeFileSync(
    ORG_RESERVATION_FILE,
    JSON.stringify(reservation, null, 2),
  );
}

function chooseUniqueOrganizationName(
  existing: OrganizationInventoryItem[],
): string {
  const names = new Set(existing.map((item) => item.name));
  if (!names.has(ORG_NAME_BASE)) return ORG_NAME_BASE;

  let version = 3;
  while (names.has(`E2E QA Org 2026-07-26 v${version}`)) version += 1;
  return `E2E QA Org 2026-07-26 v${version}`;
}

async function performRealLogin(page: Page): Promise<void> {
  const email = requiredCredential("E2E_EMAIL");
  const password = requiredCredential("E2E_PASSWORD");

  await page.goto("/login");
  await page.waitForLoadState("load");

  const alreadyLoggedInCard = page.getByRole("heading", {
    name: "You're already logged in",
  });
  if (await alreadyLoggedInCard.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
  }

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const loginButton = page.getByRole("button", {
    name: "Login",
    exact: true,
  });
  await expect(loginButton).toBeEnabled({ timeout: 10_000 });
  await loginButton.click();
  const loginFailed = page.getByRole("alert").filter({
    hasText: /login failed/i,
  });
  const outcome = await Promise.race([
    page
      .waitForURL(/\/dashboard/, { timeout: 20_000 })
      .then(() => "dashboard" as const),
    loginFailed
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => "failed" as const),
  ]);
  if (outcome === "failed") {
    await page.getByLabel("Password", { exact: true }).fill("");
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const firebaseErrorCode = apiKey
      ? await page.evaluate(
          async (input) => {
            const response = await fetch(
              `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(input.apiKey)}`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  email: input.email,
                  password: input.password,
                  returnSecureToken: true,
                }),
              },
            );
            const body = (await response.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;
            return response.ok
              ? "UI_LOGIN_FAILED_BUT_REST_CREDENTIALS_VALID"
              : (body?.error?.message ?? `HTTP_${response.status}`);
          },
          { apiKey, email, password },
        )
      : "NEXT_PUBLIC_FIREBASE_API_KEY_MISSING";
    throw new Error(
      `Live Firebase login failed (${firebaseErrorCode})`,
    );
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

// DEFECT WORKAROUND (see agents/docs/qa/e2e-regression-m0-m1-m2.md,
// "AuthContext org-loading race can hang initializing=true forever"):
// src/contexts/AuthContext.tsx's onAuthStateChanged callback sets
// `organization`/`organizationId` and then unconditionally
// `setInitializing(false)` at the end of one async function body — but on a
// meaningful fraction of full page loads (observed ~2 of 5 runs against the
// real project this session) that callback appears to hang before reaching
// setInitializing(false): server-rendered, session-cookie-derived content on
// the SAME page (e.g. the Overview page's "Published Events" count) reflects
// the correct organization-scoped data, while the client-only
// workspaceLabel/orgName badge (sourced purely from AuthContext state) stays
// on "Loading workspace..." indefinitely. A single client-side reload
// reliably recovers it (re-runs onAuthStateChanged from scratch), so this
// helper waits once, then reloads at most once, before failing for real.
async function waitForActiveOrgBadge(page: Page, organizationName: string) {
  const orgText = page.getByText(organizationName, { exact: true }).first();
  const firstWait = await orgText
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (firstWait) return;

  await page.reload();
  await expect(orgText).toBeVisible({ timeout: 20_000 });
}

async function findEventIdByName(page: Page): Promise<string | null> {
  await page.goto("/dashboard/events");
  await page.waitForLoadState("load");
  const heading = page.getByRole("heading", {
    name: EVENT_NAME,
    exact: true,
  });
  if (!(await heading.first().isVisible().catch(() => false))) return null;

  const eventCard = page.locator("article").filter({ has: heading }).first();
  const scopedOpen = eventCard.getByRole("link", { name: "Open" });
  if (await scopedOpen.isVisible().catch(() => false)) {
    await scopedOpen.click();
  } else {
    await page.getByRole("link", { name: "Open" }).first().click();
  }
  await page.waitForURL(/\/dashboard\/events\/[^/]+$/);
  return new URL(page.url()).pathname.split("/").pop() ?? null;
}

setup("login, inventory account, then seed one dedicated org/event", async ({
  page,
}) => {
  const email = requiredCredential("E2E_EMAIL");

  // 1. Login first. No signup fallback is allowed against the real account.
  await performRealLogin(page);

  // 2. Read every organization membership before any live mutation.
  const inventoryAtStart = await inventoryOrganizationsForUser(email);
  let reservation = readReservation();
  if (!reservation) {
    reservation = {
      runMarker: REAL_ACCOUNT_RUN_MARKER,
      organizationName: chooseUniqueOrganizationName(inventoryAtStart),
      preexistingOrganizations: inventoryAtStart,
    };
    // Persist intent before Firestore creation so a mid-transaction/test crash
    // cannot cause a rerun to choose and create a second QA organization.
    writeReservation(reservation);
  }

  // 3. Create exactly one isolated org, or safely reuse the reserved org on
  // a rerun of this same authoritative phase.
  const currentInventory = await inventoryOrganizationsForUser(email);
  const reservedExisting = currentInventory.find(
    (item) =>
      item.id === reservation?.organizationId ||
      item.name === reservation?.organizationName,
  );
  const organizationId =
    reservedExisting?.id ??
    (await createDedicatedOrganization({
      email,
      name: reservation.organizationName,
    }));
  reservation.organizationId = organizationId;
  writeReservation(reservation);

  // Force a fresh Server Component request after the active-org mirror moved.
  await page.goto("/dashboard");
  await waitForActiveOrgBadge(page, reservation.organizationName);

  // 4. Create exactly one persistent event inside the dedicated org.
  let eventId = await findEventIdByName(page);
  if (!eventId) {
    await page.goto("/dashboard/events/new");
    // DEFECT WORKAROUND (see agents/docs/qa/e2e-regression-m0-m1-m2.md,
    // "create-event form submits before the client AuthContext resolves
    // organizationId"): this route's client AuthContext refetches
    // organizationId/organization from scratch on every full page load, and
    // the create-event form's organizationPath field (required, min length 1
    // per src/features/event/schema.ts) is only populated once that resolves.
    // The submit button is never disabled while this is in flight, so a fast
    // fill+submit (automated or a fast human) can hit client-side Zod
    // validation failure with no visible error, silently no-op the button.
    // Wait for the "Active workspace" card to show the real org name (proof
    // organizationPath has been populated) before touching any field.
    await waitForActiveOrgBadge(page, reservation.organizationName);
    await page.getByLabel("Event name").fill(EVENT_NAME);
    await page
      .getByLabel("Description")
      .fill(
        "Dedicated persistent Playwright E2E event for the 2026-07-26 four-phase regression. Do not delete; later phases depend on it.",
      );
    await page.getByLabel("Capacity").fill("500");
    await page.getByLabel("Expected guests").fill("300");
    await page
      .getByLabel("Registration start date")
      .fill(REGISTRATION_START_DATE);
    await page.getByLabel("Registration start time").fill("00:00");
    await page
      .getByLabel("Registration end date")
      .fill(REGISTRATION_END_DATE);
    await page.getByLabel("Registration end time").fill("23:59");
    await page
      .getByLabel("Start date", { exact: true })
      .fill(EVENT_START_DATE);
    await page.getByLabel("Start time", { exact: true }).fill("09:00");
    await page
      .getByLabel("End date", { exact: true })
      .fill(EVENT_END_DATE);
    await page.getByLabel("End time", { exact: true }).fill("17:00");
    await page.getByLabel("Timezone").fill(EVENT_TIMEZONE);
    await page.getByLabel("Status").selectOption("Published");
    await page
      .getByRole("button", { name: "Create published event" })
      .click();

    const navigated = await page
      .waitForURL(
        (url) =>
          /\/dashboard\/events\/[^/]+$/.test(url.pathname) &&
          !url.pathname.endsWith("/new"),
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false);
    eventId = navigated
      ? (new URL(page.url()).pathname.split("/").pop() ?? null)
      : await findEventIdByName(page);
  }

  expect(eventId, "the dedicated event should exist after setup").toBeTruthy();

  fs.mkdirSync(path.dirname(AUTH_STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: AUTH_STORAGE_STATE });

  const fixtures: SeededFixtures = {
    runMarker: REAL_ACCOUNT_RUN_MARKER,
    organizationId,
    organizationName: reservation.organizationName,
    eventId: eventId as string,
    eventName: EVENT_NAME,
    eventDashboardUrl: `/dashboard/events/${eventId}`,
    eventTimezone: EVENT_TIMEZONE,
    eventStartDate: EVENT_START_DATE,
    eventEndDate: EVENT_END_DATE,
    registrationStartDate: REGISTRATION_START_DATE,
    registrationEndDate: REGISTRATION_END_DATE,
    preexistingOrganizations: reservation.preexistingOrganizations,
  };
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
});
