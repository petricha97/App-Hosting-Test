# Code Review + QA — M8-T7 Export Rate Limits

Code Reviewer, 2026-07-19. Scope: the complete uncommitted M8-T7 diff: all
eight dashboard CSV export routes, the report export handler refactor required
to put rate limiting between scope resolution and loading, and
`src/__tests__/m8-t7-export-rate-limits.test.ts`. Process-only and unrelated
working-tree files were excluded. This review also serves as the ticket's QA
gate.

## Verdict — CHANGES REQUESTED

All eight export handlers are rate-limited in the correctness-critical
scope -> rate limit -> load order, and the parametrized suite genuinely drives
every handler through ten successful CSV responses and then the real in-memory
limiter's 429 response. However, the workspace responses export is keyed only
by organization plus the constant `workspace`; it has no authenticated actor
identifier. Thus two users in one organization share and can exhaust each
other's budget, contrary to the ticket's required per-tenant/per-actor design.
The isolation tests do not catch this because their two-user case exercises
only attendees. The 429-per-route coverage is complete, but QA is **not signed
off** until workspace per-user isolation is implemented and proven.

## All eight routes covered (grep confirmation)

`find src/app/api/dashboard -path '*/export/route.ts'` returned exactly eight
files, and `rg 'checkRateLimit\('` returned one call in every one:

1. `events/[eventId]/attendees/export` — `export-attendees`
2. `events/[eventId]/responses/export` — `export-responses-event`
3. `responses/export` — `export-responses-workspace`
4. `events/[eventId]/reports/registration-overview/export` —
   `export-report-registration-overview`
5. `events/[eventId]/reports/order-transactions/export` —
   `export-report-order-transactions`
6. `events/[eventId]/reports/abandoned-registrations/export` —
   `export-report-abandoned-registrations`
7. `events/[eventId]/reports/checkin-history/export` —
   `export-report-checkin-history`
8. `events/[eventId]/reports/email-overview/export` —
   `export-report-email-overview`

No dashboard CSV export route was missed.

## Per-route ordering verdict

All eight routes have the correct ordering by direct numbered read:

- Attendees: scope at `route.ts:25-28`, rate at `:30-42`, first DAL load at
  `:47-52`.
- Event responses: scope at `route.ts:30-33`, rate at `:35-47`, first DAL load
  at `:52-57`.
- Workspace responses: scope at `route.ts:31-34`, rate at `:36-48`, optional
  event ownership load at `:54-58`, and response loads at `:64-75`.
- Registration overview, order transactions, check-in history, and email
  overview reports: scope at each route's `:19-24`, rate at `:25-34`, then
  entry into the shared export loader at `:35-41`.
- Abandoned registrations report: scope at `route.ts:20-25`, rate at `:26-35`,
  then entry into the shared export loader at `:36-42`.

The report refactor moves the pre-existing write scope check from
`handleReportExportRequest` into each wrapper, then passes the resolved
organization into the handler. The handler's first operation remains its row
load (`src/features/reports/server/report-run-handler.ts:60-64`). Consequently
unauthenticated/unauthorized requests still resolve to 401/403 (and foreign or
missing events to 404) before consuming a bucket, while limited requests stop
before export DAL amplification and CSV construction.

## Key distinctness and tenant/actor verdict

The eight route types have distinct prefixes, so different export types do not
starve one another. All event-scoped keys include organization, authenticated
`userId`, and event ID. The five report prefixes are individually distinct.

The workspace key is the exception:
`export-responses-workspace:${scope.organizationId}:workspace` at
`src/app/api/dashboard/responses/export/route.ts:36-38`. Its scope type exposes
only `organizationId` (`src/features/responses/server/route-scope.ts:26-28`),
even though the helper has already decoded the authenticated email at `:43-48`.
This is a real organization-wide bucket, not a per-actor bucket.

All handlers use the conventional JSON 429 shape with `{ error }`, status 429,
and a string `Retry-After` header. The fixed limit of 10 per minute per export
type/org/user is sane for an expensive, bounded CSV operation: it permits
ordinary re-exports while materially dampening repeated DAL amplification.

## Test quality / QA verdict

`src/__tests__/m8-t7-export-rate-limits.test.ts:74-83,110-125` parametrizes all
eight real route handlers. For each route it asserts ten under-limit 200
responses with `text/csv`, then an eleventh 429 with numeric `Retry-After` and
the exact JSON error. `checkRateLimit` is not mocked; the test imports only
`resetRateLimits` from the production limiter and resets it in every
`beforeEach` (`:85-87`). Sample tracing attendees and registration overview
confirmed that each repeated handler call reaches the production limiter and
that the mocked DAL only supplies cheap rows after allowance. These are real
429 assertions, not route-name tautologies.

The route-prefix isolation test genuinely exhausts attendees and proves event
responses remain at 200 (`:127-131`). The organization and user tests genuinely
change scope identities after exhausting attendees (`:133-158`). However,
those tests prove isolation for one event route only. They cannot prove the
workspace requirement: `responsesOrgScope` is mocked without a `userId` at
`:96`, matching the deficient production scope, and no workspace two-user test
exists. Therefore **429-per-route coverage is complete**, route and tenant
isolation have representative real coverage, but required actor isolation is
incomplete and false for workspace exports. QA is not signed off.

The over-limit test title says "before loading" but does not assert loader call
counts. Ordering is nevertheless established by direct source read for every
route; adding a loader-count assertion for representative handlers would make
that regression intent executable.

## Blockers

1. **Workspace exports are not isolated per authenticated actor.**
   `src/app/api/dashboard/responses/export/route.ts:36-38` keys the bucket with
   organization plus the literal `workspace`, so any user can consume all ten
   exports and force 429s for every other writer in that organization. Extend
   the successful workspace scope to return the decoded, normalized user ID
   (`src/features/responses/server/route-scope.ts:26-28,33-58,90-104`), include
   it in the key, and add a workspace-specific two-user isolation assertion in
   `src/__tests__/m8-t7-export-rate-limits.test.ts:85-158`.

## Should-fix

1. **Make the claimed pre-load behavior executable in the QA suite.**
   `src/__tests__/m8-t7-export-rate-limits.test.ts:110-124` proves the response
   switches to 429 but does not assert that the relevant loader's call count
   stays at ten. Add representative assertions for at least one direct export
   and one report export so a future refactor cannot move the limiter after an
   expensive load while leaving this suite green.

## Nits

None.

## No-regression review

The attendees and both responses routes add imports and the scope-adjacent
rate-limit block only; filters, limits, DAL arguments, row serialization, CSV
builders, filenames, escaping, and response headers are unchanged. The five
report wrappers add scope/rate handling and pass the already-resolved
organization to the shared handler. The shared handler removes only its now
duplicated scope resolution; loader inputs, columns, CSV construction,
filenames, row limits implemented by the loaders, and response headers remain
unchanged. Existing export-route regression suites and the full suite pass.

## Independent re-run results

- `npm run lint` — PASS, exit 0, no ESLint warnings or errors. Next.js emitted
  only its deprecation/workspace-root notices.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T7 file produced an error.
- `npm test -- --run` — PASS, **186 test files / 2049 tests**. The M8-T7 file
  passed 11 tests. Existing React ref and development-secret warnings were
  emitted; there were no failures.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-export-rate-limits.md`.
