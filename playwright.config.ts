import { defineConfig, devices } from '@playwright/test'
import { loadEnvConfig } from '@next/env'

// Playwright runs outside Next.js, so load the same local environment that
// the dev server uses. This makes E2E_EMAIL/E2E_PASSWORD and the Firebase
// Admin credentials available to the setup worker without hardcoding or
// printing any secret values.
loadEnvConfig(process.cwd())

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // This suite deliberately shares ONE dedicated org/event across every spec
  // file (see e2e/fixtures/test-data.ts) so later phases can build on the
  // same data — that makes the specs a stateful integration suite, not
  // isolated unit-style e2e tests. Running spec files concurrently races
  // multiple browser contexts against the same mutable Firestore rows
  // (duplicate-code checks, toast timing, dialog state), so this project
  // runs fully serial rather than Playwright's usual fullyParallel default.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Real Next.js dev server (no build step) — first navigation to a given
    // route compiles it on demand, which can be slow. Give actions/navigation
    // more headroom than the Playwright defaults.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // Launch Next directly so Playwright owns the actual server process on
    // Windows and can terminate it cleanly after the suite.
    command: 'node node_modules/next/dist/bin/next dev',
    // The app intentionally has no root page, so "/" returns 404 and cannot
    // be used as Playwright's readiness/reuse probe.
    url: 'http://127.0.0.1:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
