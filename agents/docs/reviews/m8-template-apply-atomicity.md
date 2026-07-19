# Code Review — M8-T9 Form-template Apply Atomicity

Code Reviewer, 2026-07-19. Scope: the complete uncommitted M8-T9 diff in
`src/lib/db/adminForm.ts`, the template-apply route, the shared fake Admin DB,
and the two changed test files. Reviewed against `agents/docs/BACKLOG.md` M8-T9
and the deferred M1 finding in
`agents/docs/security/m8-t4-coverage-backfill.md`. This was a reviewer-only pass;
the report is the reviewer's sole workspace modification.

## Verdict — CHANGES REQUESTED

The DAL closes M8-T4 M1 correctly: every update is staged in one WriteBatch,
one commit is awaited, and the failure-injection regression proves that a
mid-batch failure changes neither the store nor the write log. The complete
M8-T4 ownership/link/event validation remains intact and precedes batch
construction.

Changes are requested because the route applies the 501-row `mode: "all"`
discovery bound to `mode: "selected"` as well. Once a template has more than
501 linked rows, a requested eligible form outside Firestore's arbitrary first
501 results can be silently omitted while the endpoint returns 200. The tests
also do not exercise the real limited query, the DAL limit error, or route
handling of that typed error.

## Atomicity verdict

**PASS.** `src/lib/db/adminForm.ts:293-311` creates exactly one batch after all
validation, stages every eligible form through `batch.update`, and calls
`commit()` once after the loop. There is no sequential write await left.
`applyTemplateToLinkedForm` remains the sole propagation implementation at
`:296-300`; each staged write uses the same payload as the removed
`updateAdminForm` call: sanitized `next.fields`, `next.templateLink`, and a
server-generated `updatedAt` (`:302-306`). The return remains `string[]`, and
the route response remains `{ updatedCount, updatedIds }`.

The regression at
`src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:49-63` injects failure
at staged operation 1, asserts both stored forms equal their before images, and
asserts an empty write log. The happy-path test at `:32-47` proves both forms
receive the propagated version/fields, unrelated content survives, both writes
are recorded, and the returned IDs are unchanged. This is meaningful evidence
of all-or-nothing behavior in the fake model.

## M8-T4 validation intact

**PASS by direct source comparison.** For inputs within the new cap,
`src/lib/db/adminForm.ts:264-290` still reloads the complete supplied form list,
resolves each reloaded form's raw stored `eventId` through
`getAdminEventForOrganization` using the template organization, and rejects if
any form is missing, foreign, linked to another template, detached, or lacks an
owned target Event. Both `Promise.all` reads and the complete `some(...)`
validation finish before the batch is constructed at `:293`. None of these
checks was weakened, moved behind a write, or replaced with caller-normalized
data. The ineligible-form and foreign-event tests at
`src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:65-91` continue to
assert zero writes.

## Cap and bounded-query assessment

- The DAL enforces `MAX_TEMPLATE_APPLY_FORMS = 500` before reads at
  `src/lib/db/adminForm.ts:18,260-262` and throws the typed
  `TemplateApplyLimitError`. Five hundred is consistent with Firestore's
  documented maximum WriteBatch size; batched writes are documented as atomic
  by the [Firebase transactions and batched-writes guide](https://firebase.google.com/docs/firestore/manage-data/transactions)
  and the [JavaScript API reference](https://firebase.google.com/docs/reference/js/firestore_lite.writebatch).
- For `mode: "all"`, the route requests 501 rows at
  `src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:66-72`
  and returns the intended structured 422 at `:76-90`; its second check at
  `:97-108` ensures the DAL is not normally reached with more than 500 forms.
  However, the route does not import/catch `TemplateApplyLimitError`, so the
  typed DAL error itself is not surfaced as 422 if it is ever raised. That gap
  is covered under Should-fix.
- Checking `linkedForms.length` before the detached filter is conservative but
  defensible for apply-all: after reading only 501 linked rows, the route cannot
  know how many eligible rows exist later in the result set. Thus 501 linked
  rows with many detached rows may be rejected even when at most 500 would be
  updated, but it avoids falsely claiming that all eligible forms were applied.
  If the product wants an eligible-row cap instead, eligibility must be made a
  queryable bounded predicate or discovered with bounded pagination/counting;
  moving the current check after the filter would be incorrect.
- The optional `limit` parameter is additive. Omitting it follows the original
  query path unchanged; supplying it genuinely calls `query.limit(input.limit)`
  before `.get()` at `src/lib/db/adminForm.ts:181-215`.

## Fake DB compatibility

`src/__tests__/helpers/fake-admin-db.ts:542-566` stages updates without touching
the store or log, validates the whole pending set before mutation, and only
then applies every write. The opt-in failure is cleared when triggered and
`reset()` clears it; hookless/failure-less batches commit normally. Existing
collection and transaction behavior is unchanged. This accurately models the
atomic success/failure property under test, and the happy-path batch assertion
proves the new default path works.

## Blockers

1. **Selected-mode requests can silently skip requested forms beyond the first
   501 linked query results.**
   `src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:66-72`
   unconditionally limits discovery to 501, but only apply-all treats a full
   result as overflow at `:76-90`. Selected mode then intersects requested IDs
   with that truncated set at `:92-95`. With more than 501 linked rows, an
   eligible requested form outside the arbitrary returned window produces a
   successful response without updating that form. Apply the 501 discovery
   strategy only to apply-all and give selected mode a bounded-by-request-ID
   lookup/validation path (also cap `formIds` at 500), or reject selected mode
   whenever completeness cannot be established. Add a regression requesting a
   selected ID beyond the first 501 and assert either its update or a clean
   explicit rejection—never a 200 omission.

## Should-fix

1. **Surface the DAL's typed cap error as the same clean 422 contract.**
   `src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:110-113`
   awaits the DAL without catching `TemplateApplyLimitError`. Current local
   prechecks make the throw unreachable for the present arrays, but the task
   explicitly introduces a reusable DAL boundary and requires it not to become
   a 500 at this route. Catch only this typed error and map it to the existing
   structured 422; allow unrelated failures to propagate. Add a route test
   whose DAL mock throws the real-shaped typed limit error.

2. **The cap and query-bound tests do not exercise the production boundaries.**
   `src/__tests__/m8-t4-backend-form-template-routes.test.ts:14-22` mocks
   `getAdminLinkedFormsForTemplate` without accepting/applying `limit` and mocks
   an apply DAL that cannot throw `TemplateApplyLimitError`. Consequently the
   501 test at `:97-119` proves the route's length branch but not
   `query.limit(501)`, the DAL `>500` guard, or typed-error mapping. Add
   fake-Admin-DB DAL tests that assert 501 is the actual query result ceiling
   and that 501 direct DAL inputs reject before reads/writes, plus the route
   error test above.

## Nits

- `src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:56` stores the
  before images by reference. The current fake replaces documents rather than
  mutating them, so the assertion is valid; cloning the snapshots would make
  the test robust against future fake-store implementation changes.

## Independent re-run results

- `npm run lint` — **PASS**, exit 0, no ESLint warnings or errors. Next.js
  emitted only its deprecation/workspace-root notices.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No M8-T9
  file produced an error.
- `npm test -- --run` — **PASS**, **186 test files / 2,054 tests**. Existing
  React ref/`act` and development-secret warnings were emitted; no test failed.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-template-apply-atomicity.md`.
