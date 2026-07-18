# Code Review — M8-T4 Coverage & Regression Backfill

Code Reviewer, 2026-07-19. Scope: the complete uncommitted M8-T4 diff: seven
new test files and the three promoted production fixes. Reviewed against
`agents/docs/qa/m8-t4-coverage-plan.md`, including every P0/P1 proof and both
dispatch scopes.

## Verdict — CHANGES REQUESTED

The suite is green at the claimed 182 files / 2,002 tests / 0 todo, and the
`organizationPath` pin does not break legitimate edits of legacy-spelling Event
documents. Changes are nevertheless required because the event update route
still lets a writer replace `formPath`, and that pointer can make Org A's public
event render and submit against Org B's published Form. In addition, one new
route test encodes the obsolete partial-apply behavior that the promoted DAL
fix deliberately removed, and several P0 handlers do not have their required
direct authentication/permission proofs.

## Tenancy adjudications

### `organizationPath` legacy-spelling comparison — safe, not a Blocker

The exact-string comparison at
`src/app/api/dashboard/events/[eventId]/route.ts:63-68` is compatible with all
five stored spellings. `eventFormSchema` accepts any non-empty trimmed string
(`src/features/event/schema.ts:74-85`); it does not canonicalize it. More
importantly, the edit page passes the stored value unchanged into the workspace
at `src/app/dashboard/(event)/events/[eventId]/edit/page.tsx:35-43`, and the
workspace uses that initial value at
`src/features/event/create-event-workspace.tsx:120-129`. Thus an event stored as
any of `Organization/{id}`, `organization/{id}`, `/organization/{id}`,
`organizations/{id}`, or `/organizations/{id}` submits that same spelling and
saves normally. The promoted regression at
`src/__tests__/m8-t4-fullstack-event-assets-settings-routes.test.ts:64-70`
also meaningfully proves 403 plus no write for changed attribution.

One caveat is UI robustness, not a present Blocker: the workspace effect at
`src/features/event/create-event-workspace.tsx:180-191` may replace the initial
stored spelling with the canonical default if React Hook Form still reports the
field untouched. The initial-value precedence and current render ordering make
the stored value the submitted default, but adding a five-spelling edit test
would lock this assumption down.

### `formPath` / `eventPagePath` / `invoicePath` — Security finding

- **`formPath` is tenant-sensitive and exploitable.** The route spreads the
  entire parsed client body into the Event update at
  `src/app/api/dashboard/events/[eventId]/route.ts:70-73`. On the public path,
  `loadPublicRegistrationContext` passes that pointer to
  `getAdminPublishedFormForPublicEvent`
  (`src/features/public-registration/server/context.ts:54-67`). Its pointer
  fallback loads the nominated Form by ID at
  `src/lib/db/adminForm.ts:103-125`; normalization preserves the loaded Form's
  own `eventId` and `organizationId`
  (`src/features/form/utils.ts:307-317`), but the public getter never compares
  either value with the requested event/org before returning it. Therefore an
  Org A event whose writer submits `Form/{org-b-form}` can render Org B's
  published form and use it across the public registration routes. This is a
  **Security Blocker**. Make the route preserve/server-own `formPath`, and also
  harden the fallback getter to require both event and organization equality.
- **`eventPagePath` is client-overwritable but its consumer is tenant-safe.**
  `getAdminEventPageForEvent` accepts the pointer shortcut only after exact
  `eventId`, `organizationId`, and `pageKey` checks at
  `src/lib/db/adminEventPage.ts:55-77`, then falls back to an event query with
  organization filtering at `:81-95`. It should still be server-owned to avoid
  pointer corruption/availability regressions, but no cross-tenant render was
  found.
- **`invoicePath` is currently inert.** Its only runtime uses are schema,
  workspace defaults, and edit-page round-tripping; no reader/render consumer
  exists. It is not presently a tenancy vector, though it too should not remain
  a client-owned server pointer.

## Blockers

1. **A writer can point a public event at another tenant's Form.**
   `src/app/api/dashboard/events/[eventId]/route.ts:70-73` accepts client
   `formPath`; `src/lib/db/adminForm.ts:103-125` returns the nominated published
   Form without matching its `eventId`/`organizationId`. The complete render
   trace and bounded fix are in the Security adjudication above. Add a promoted
   two-org regression that attempts the pointer overwrite and proves no Event
   write, plus a DAL/public-context defense-in-depth test for a pre-existing bad
   pointer.

## Should-fix

1. **The apply-to-events route test asserts the old partial-write contract.**
   `src/__tests__/m8-t4-backend-promotion-routes.test.ts:59-67` implements a
   hand-written mock that updates owned rows while collecting missing/foreign
   rows, and `:167-175` expects `{ updated: 1 }` for mixed owned/foreign input.
   Production now correctly performs full-list validation and returns
   `{ updated: 0, skippedCustom: [], skippedMissing }` before any batch. The real
   DAL pin at `src/__tests__/m8-t4-backend-promotion-dal.test.ts:71-79` proves
   the owned promotion and write log remain untouched, but the route test is
   misleading and would conceal a wiring regression. Make its mock atomic and
   assert the preserved rejection shape/no owned mutation at the route boundary.

2. **Required P0 auth/permission proofs are incomplete.** The plan requires
   authentication and exact permission proof for every P0 route, but
   `src/__tests__/m8-t4-fullstack-event-assets-settings-routes.test.ts:43-112`
   has no 401 proof for event update, assets, logo, or avatar, no denied
   `write:organization` proof for logo, and no unauthenticated avatar proof.
   Similarly, `src/__tests__/m8-t4-backend-promotion-routes.test.ts:116-176`
   does not directly prove auth/exact permission for the promotion item,
   template item, or apply-to-events handlers, and
   `src/__tests__/m8-t4-backend-form-template-routes.test.ts:59-84` does not do
   so for each template item/apply handler. Shared route helpers do not replace
   direct handler assertions.

3. **Form-template propagation does not validate the target Event invariant
   named by the plan.** `src/lib/db/adminForm.ts:214-228` correctly reloads all
   Forms, validates existence, Form organization, template link, and detached
   state before any write, and its sole caller supplies the scoped linked set at
   `src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:49-79`.
   This closes caller-supplied stale/foreign Form races, and
   `src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:46-61` proves no
   partial write. However neither caller nor DAL reloads each `form.eventId` as
   an Event owned by the active organization, despite the authoritative P0
   proof requiring every target form/event to be in-org. Either add that
   validation or explicitly narrow the plan with evidence that Form ownership
   is the intended complete invariant.

## Nits

- `src/lib/db/adminForm.ts:232-234` retains an unreachable `if (!form) continue`
  after the preceding `some(!form)` rejection. Removing it would make the
  validated-all-before-write invariant clearer to both TypeScript and readers.
- The mixed invalid-form test at
  `src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:46-61` checks only
  the eligible Form after rejection. The fake-store write behavior makes the
  assertion meaningful, but asserting every supplied document and/or the write
  log is unchanged would state the no-partial-write proof more completely.

## Production-fix caller/contract verification

- `applyAdminTemplateToForms` has one production caller, the form-template
  apply route. The caller's scoped query and detached filtering remain
  compatible; the DAL reload protects against deletion, tenant/link changes,
  or detachment between list and write, and throws an ordinary typed `Error`
  before the write loop.
- `applyTemplateToSpecificEvents` has one production caller, the
  apply-to-events route at
  `src/app/api/dashboard/promotions/templates/[templateId]/apply-to-events/route.ts:71-87`.
  It forwards the DAL result without reshaping it. No other caller depends on
  partial application. Production preserves the declared result shape and the
  promoted DAL test proves mixed input leaves owned promotions untouched.
- Across the seven new files, the DAL happy paths generally assert concrete
  fake-store effects rather than placeholders. The primary tautological mock is
  the contradictory apply-to-events route case identified above. The sampled
  form/event/promotion P0 routes otherwise include real status, scoped-call,
  no-write, server-derived identity, validation, and happy-path effect checks;
  the missing direct auth matrix remains an acceptance gap.

## Independent verification

- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  pre-existing errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No M8-T4
  file produced an error.
- `npm test -- --run` — PASS: **182 test files / 2,002 tests / 0 todo**. Existing
  React ref/`act` and development-secret/default-sender warnings were emitted;
  there were no failures.
- Read-only `git status`, tracked diff, untracked-file inventory, call-site
  searches, and numbered source reads confirm the M8-T4 executable diff is
  exactly seven new `m8-t4-*` test files plus the three stated production
  targets. Other uncommitted process/unrelated paths exist (`HANDOVER.md`,
  `.claude/settings.json`, `CLAUDE.md`, the QA plan, and `memory/`) but are not
  executable M8-T4 modifications and were not changed by this reviewer.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-t4-coverage-backfill.md`.
