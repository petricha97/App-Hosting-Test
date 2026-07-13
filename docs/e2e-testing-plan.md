# E2E Testing Plan

## Goal
Build a production-grade end-to-end testing strategy for the app without mixing concerns between:

- fast developer feedback
- reliable CI validation
- high-signal release confidence

This repo already has unit/component-style testing with `vitest`, but it does not yet have a real browser E2E layer. The plan below adds that layer in a way that fits the current stack:

- Next.js app router
- Firebase Auth
- Firestore
- Firebase Storage
- dashboard + public event flows

## Recommendation
Use **Playwright** as the primary E2E runner.

Why:

- strong support for production-grade browser automation
- first-class test isolation and retries
- screenshots, traces, video, and network debugging
- good CI ergonomics
- supports authenticated dashboard flows and public flows in the same suite

## Test Strategy
Do not use one giant test suite for everything.

Instead, split testing into three layers:

### 1. Unit and component tests
Keep using `vitest` for:

- pure utilities
- serializers and schema transforms
- form/document normalization
- Firestore payload shaping
- page-mode decision helpers

These stay fast and should catch low-level regressions before E2E runs.

### 2. Integration-style route and server tests
Add focused tests around:

- server route validation
- permission gates
- schema parsing
- event/form/page publish behavior

These can still be handled in the current JS test layer where practical.

### 3. Browser E2E tests
Use Playwright for the business-critical user journeys:

- dashboard auth and workspace flows
- event creation/editing
- form builder behavior
- public event discovery
- public registration submission
- custom event page visibility

This is the layer that verifies the actual happy path end-to-end.

## Environment Strategy
For production-grade confidence, use two E2E environments.

### Local and CI primary environment
Use **Firebase Emulators** for:

- Auth
- Firestore
- Storage

Why:

- deterministic seed data
- fast resets
- no cost risk
- no pollution of real data
- easier permission and edge-case testing

This should be the default E2E environment for developers and CI.

### Secondary smoke environment
Use a small smoke suite against a deployed staging or production-like environment.

Why:

- catches deployment/config mismatches
- validates Firebase service wiring outside the emulator
- ensures asset uploads, auth cookies, and public routes work in a real hosted context

Keep this suite intentionally tiny.

## Naming and Folder Structure
Recommended structure:

```text
e2e/
  fixtures/
    auth.ts
    seed.ts
    storage.ts
  helpers/
    event-data.ts
    form-data.ts
    page-builder-data.ts
  pages/
    dashboard-page.ts
    events-page.ts
    event-detail-page.ts
    form-builder-page.ts
    page-builder-page.ts
    public-events-page.ts
    public-event-page.ts
  specs/
    smoke/
      public-events-smoke.spec.ts
      dashboard-auth-smoke.spec.ts
    dashboard/
      event-create.spec.ts
      event-edit.spec.ts
      event-publish.spec.ts
      form-builder.spec.ts
      form-template.spec.ts
      page-builder.spec.ts
    public/
      public-events-list.spec.ts
      public-event-detail.spec.ts
      public-registration.spec.ts
  playwright.config.ts
```

## Naming Conventions
Use test names that describe behavior, not implementation.

Good examples:

- `event-create.spec.ts`
- `public-registration.spec.ts`
- `page-builder.spec.ts`

Good test titles:

- `creates a draft event with required schedule and registration period`
- `publishes an event and exposes it on the public events index`
- `renders the published registration form on the public event page`
- `falls back to the default event page when a custom page is not published`

Avoid vague names like:

- `event test`
- `form stuff`
- `works correctly`

## Test Data Strategy
Use factories and named fixtures instead of hand-building random objects inside each test.

Recommended seed helpers:

- `createOrgOwner()`
- `createDashboardUser()`
- `createDraftEvent()`
- `createPublishedEvent()`
- `createPublishedForm()`
- `createCustomEventPageDraft()`
- `createCustomEventPagePublished()`
- `createFormTemplate()`

Each helper should return stable, minimal data.

Important rule:
each E2E test should either:

- create its own data, or
- use a clearly named seeded fixture

Do not depend on leftovers from previous test runs.

## Authentication Strategy
For dashboard E2E:

- create a known seeded dashboard user
- log in through the real UI in at least one smoke test
- for broader suites, prefer Playwright storage state reuse after initial auth

Recommended split:

- one smoke test proves login works end-to-end
- most dashboard tests start from an authenticated state fixture

This keeps the suite fast without losing confidence in login.

## Core Happy Paths
These should be the first high-value browser tests.

### Dashboard happy path
1. User signs in
2. User creates an event
3. User edits the event
4. User sets page mode
5. User publishes the event
6. Event appears in dashboard list

### Form builder happy path
1. User opens event form builder
2. User starts from scratch
3. User adds a custom field
4. User publishes the form
5. Event detail checklist reflects the published form

### Template happy path
1. User creates a form template
2. User creates an event form from the template
3. Linked fields appear correctly
4. User updates the template
5. Update is applied to a linked event form

### Public event happy path
1. User publishes event
2. Event appears on `/events`
3. User opens `/events/[eventId]`
4. Public page renders correct mode:
   - default, or
   - redirect, or
   - custom published page

### Public registration happy path
1. Public user opens a published event
2. Registration form is visible
3. User submits the form
4. Submission is saved to `FormData`
5. Success confirmation is shown

### Custom page builder happy path
1. Organizer opens page builder
2. Uploads an image
3. Selects uploaded image in a supported block
4. Saves draft page
5. Publishes page
6. Public event page renders custom page instead of default

## Critical Edge Cases
After the happy paths, cover the highest-risk regressions.

### Event visibility
- draft events do not appear on public `/events`
- published events do appear
- unpublished custom pages fall back to default page

### Redirect mode
- redirect page mode sends public users to `redirectUrl`
- invalid or missing redirect URL should keep the event from being considered ready

### Form visibility
- draft forms do not render on public event pages
- published forms render correctly
- required fields enforce validation

### Template behavior
- template-linked forms do not duplicate mandatory fields
- detached forms remain editable
- template apply flow does not silently remove event-only fields

### Page builder behavior
- custom page publish is required before the public route switches over
- uploaded image remains selectable after refresh
- missing page asset list should not crash the builder

## Test Tags and Execution Groups
Use tags or directory-based grouping.

Recommended groups:

- `smoke`
- `dashboard`
- `public`
- `forms`
- `templates`
- `page-builder`

Suggested execution policy:

- pre-commit or quick local runs:
  - smoke
- pull request CI:
  - smoke
  - dashboard happy paths
  - public happy paths
- nightly:
  - full suite
  - edge cases
  - multi-browser if needed

## Reliability Rules
To keep E2E production-grade, avoid flaky patterns.

### Use stable selectors
Prefer:

- `getByRole`
- `getByLabel`
- `getByText` for user-facing content
- explicit `data-testid` only where the UI has no stable accessible handle

### Wait on outcomes, not time
Do not use arbitrary sleeps.

Prefer:

- URL changes
- visible status text
- toast content
- loaded card titles
- expected network/UI state

### Keep assertions user-visible
Assert things the user would observe:

- page title
- badges
- cards
- checklist state
- registration form presence

Only inspect internals when truly necessary.

## Reporting and Debugging
Enable Playwright artifacts by default for failed tests:

- trace
- screenshot
- video on retry

Recommended outputs:

- HTML report locally
- retained traces in CI artifacts

This matters a lot for complex flows like:

- Firebase auth/session bugs
- drag-and-drop builders
- page-builder publishing

## CI Workflow
Recommended CI sequence:

1. install dependencies
2. build app
3. start Firebase emulators
4. seed emulator data
5. start Next app against emulator env
6. run Playwright E2E
7. upload traces/reports on failure

Important:
the CI setup should use explicit environment files for emulator mode so the app does not accidentally hit real Firebase services.

## First Implementation Slice
Start small and production-minded.

### Phase 1
- add Playwright
- add Playwright config
- add emulator-friendly env setup
- add one seeded org owner
- add one smoke test:
  - login
  - open dashboard

### Phase 2
- add event create and publish happy path
- add public events list/detail happy path

### Phase 3
- add form builder and public registration happy path

### Phase 4
- add custom page builder happy path
- add image upload happy path

### Phase 5
- add template flows and edge-case suites

## Repo-Specific Priority Tests
Given the current codebase, these are the highest-value first tests:

1. `dashboard-auth-smoke.spec.ts`
2. `event-create.spec.ts`
3. `event-publish.spec.ts`
4. `public-events-list.spec.ts`
5. `public-registration.spec.ts`
6. `page-builder.spec.ts`
7. `form-template.spec.ts`

## Definition of Done
The E2E layer is in a good first production-grade state when:

- Playwright is installed and configured
- Firebase Emulator-driven E2E runs locally and in CI
- happy-path tests exist for dashboard, public events, forms, and custom pages
- smoke tests run fast and reliably
- failures produce usable traces and screenshots
- naming and folder structure are consistent and scalable
