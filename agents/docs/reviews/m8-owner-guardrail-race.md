# Code Review / QA Gate — M8-T8 Last-Owner Race Coverage

Code Reviewer, 2026-07-19. Scope: the complete uncommitted M8-T8 diff in
`src/__tests__/helpers/fake-admin-db.ts` and
`src/__tests__/admin-user-organization-iam.test.ts`, reviewed against
`agents/docs/BACKLOG.md` M8-T8 and the M-1 finding in
`agents/docs/security/m8-real-iam.md`. This is the QA gate for this test-only
ticket.

## Verdict — CHANGES REQUESTED

The production last-Owner guardrail is unchanged, the opt-in fake transaction
path correctly forces the submitted race to retry, and the real race test proves
that one removal succeeds while the other returns `LAST_OWNER`. However, the
mutation proof does **not** faithfully reproduce the ticket's named regression:
it hoists the non-transactional count outside `runTransaction`, whereas swapping
the production helper would leave the call inside the transaction callback. A
retry re-runs that callback and therefore re-executes an inside-callback
non-transactional count. The submitted proof reaches zero only by introducing a
stronger/different regression (a count stale across every retry), so it does not
genuinely demonstrate failure against the stated non-transactional helper-swap
regression. That is the ticket's core acceptance criterion and is approval
blocking.

## Production-unchanged confirmation

Confirmed. `git diff --name-only` lists `HANDOVER.md` and the two test files
above; no `src/lib/db/` or other production `src/` file changed. A scoped
`git diff -- src/lib/db src/app src/features src/components` is empty. Direct
source inspection also confirms both production guards still call
`countAdminOrganizationOwnersInTransaction` inside their transaction callbacks
at `src/lib/db/adminUserOrganization.ts:695-703,777-785`.

## Fake DB backward compatibility and conflict simulation

### Hookless path — compatible

When no hook is registered, `runTransaction` returns `fn(tx)` directly at
`src/__tests__/helpers/fake-admin-db.ts:540-542`. That is the original
single-execution transaction object at `:400-433`: reads retain the same ref/query
snapshot shapes, writes remain immediate and ordered, write-log entries remain
immediate, transform resolution is unchanged, and thrown callback/write errors
propagate as before. The new version map is updated by the store wrapper but is
not consulted on this path, so it cannot change hookless outcomes. `reset()` also
clears versions and the pending hook at `:546-551`.

### Opt-in conflict path — correct for the submitted race

- Ref reads and each document returned by a query are recorded by path and
  observed revision at `:437-456`. The interleave hook is captured/cleared and
  runs once, after the first callback body and before conflict check/commit, at
  `:505-518`.
- A changed recorded path discards that attempt's local `pendingWrites` and
  continues the loop at `:520-529`. The next iteration constructs fresh read and
  write sets and calls `fn` again at `:512-516`, so it genuinely re-runs the body
  and re-reads current state; it does not replay stale snapshots.
- Aborted writes are staged only in `pendingWrites` at `:458-470`; only a
  conflict-free attempt reaches `commitTransactionWrites` at `:475-497,531`.
  They therefore cannot leak or double-apply across retry.
- Attempts are bounded at five and exhaustion throws an `ABORTED`-prefixed error
  at `:510-535`. No time, timers, wall-clock checks, or randomness participate,
  so the simulation is deterministic.

The query tracker models revisions of returned documents rather than general
query-phantom changes. That is sufficient for this exact removal race because
owner2 is returned by the first owner query and its deletion changes the tracked
path. I do not treat the narrower model as an M8-T8 defect.

## Race-test discrimination verdict

The real race test at
`src/__tests__/admin-user-organization-iam.test.ts:660-691` is meaningful. The
first callback reads owner1 and an owner query returning owner1+owner2, then
stages owner1's removal. The one-shot hook removes owner2 at `:667-671`, changing
a document path recorded by the owner query. The fake must reject the first
attempt, discard its staged writes, and re-run production `removeAdminMember`;
the second owner query returns only owner1 and production returns `LAST_OWNER`.

Its assertions establish that the concurrent removal succeeded, owner count is
one, owner1 remains, owner2 is gone, the guarded removal failed with the exact
code, and exactly one of the two removals succeeded (`:679-690`). Without the
transactional query read, this submitted interleave would not produce the
expected guarded result. The test is reset independently by the file-level
`beforeEach` at `:133-135`.

## Mutation-proof genuineness verdict

**Not genuine for the stated regression.** It does call the real exported
`countAdminOrganizationOwners` at
`src/__tests__/admin-user-organization-iam.test.ts:701`, and its final assertion
really proves that its deliberately stale harness reaches zero Owners at
`:734-735`. Those are useful properties, not tautologies.

The decisive divergence is placement and retry behavior. The harness computes
`staleOwnerCount` before calling `fake.db.runTransaction` (`:701` versus
`:706`). Production currently calls the transactional helper from inside the
callback at `src/lib/db/adminUserOrganization.ts:777-781`; a direct swap to
`countAdminOrganizationOwners` would naturally remain at that location. Since
the callback is re-run, that swapped call would run again on retry rather than
remain stale as this harness assumes. The harness also omits the real
caller/target resolution and hierarchy shape, although the count placement is
the material weakness. Thus the current proof shows that a count hoisted outside
the entire retrying operation is unsafe; it does not prove that the named
non-transactional-helper substitution is caught.

## Findings

### Blockers

None.

### Should-fix

1. **Replace the mutation proof with a faithful regression mutant.**
   `src/__tests__/admin-user-organization-iam.test.ts:698-707` must model the
   actual proposed regression shape rather than precomputing a value outside
   `runTransaction`. Keep the real exported non-transactional count, but invoke
   it where a helper swap would live and design an interleave that exposes the
   non-transactional read's missing conflict dependency (for example, a
   concurrent owner demotion that changes the counted reverse-index owner row
   without changing a document otherwise read by the buggy transaction). Mirror
   the real removal guard/hierarchy/read-write shape closely enough that only the
   count-read mechanism differs, and assert the mutant reaches zero while the
   production path preserves one Owner. This must fail against the
   non-transactional regression named by M8-T8.

### Nits

None.

## Independent re-run results

- `npm run lint` — PASS, exit 0, no ESLint warnings or errors. Next.js emitted
  only its deprecation/workspace-root notices.
- `npx tsc --noEmit --pretty false` — expected exit 1 with exactly seven
  pre-existing errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No M8-T8
  file produced an error.
- `npm test -- --run` — PASS, **186 test files / 2052 tests**. Existing React
  ref/`act` and development-secret/logging warnings were emitted; no test failed.
- `git diff --check` — PASS.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-owner-guardrail-race.md`.
