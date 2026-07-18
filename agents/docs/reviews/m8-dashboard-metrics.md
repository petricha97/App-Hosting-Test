# Code Review — M8-T2 Workspace Dashboard Real Metrics

Code Reviewer, 2026-07-19. Scope: the complete uncommitted Backend and
Full-Stack M8-T2 working-tree diff listed in the dispatch. Reviewed against
`agents/docs/specs/m8-dashboard-metrics.md`,
`agents/docs/design/m8-dashboard-metrics.md`, and
`agents/docs/data-models/m8-dashboard-metrics.md`. Process-only files named in
the dispatch were excluded.

## Verdict — CHANGES REQUESTED

No security/tenant-isolation Blocker was found. The DAL queries are genuinely
organization-scoped, the loader contract matches Design §11, and the UI handles
all specified result variants. Changes are still requested because the
multi-currency presenter performs a cross-currency arithmetic operation that
the ticket explicitly forbids, and several literal acceptance criteria are not
proved by the submitted tests.

## Blockers

None.

## Should-fix

1. **The multi-currency presenter still sums minor-unit amounts across different
   currencies.** `src/features/dashboard/components/workspace-stat-card.tsx:149-152`
   reduces every entry in `otherCurrencies` into `otherTotalMinor`. For two or
   more other currencies this computes (for example) EUR minor units + GBP minor
   units even though the resulting number is currently discarded by the
   `otherCurrencies.length === 1` branch at lines 157-159. That makes the code's
   financial invariant weaker than Design §4/D5 and the review requirement that
   sums are *never* taken across currencies; a later refactor could easily expose
   the already-blended value. The single-secondary-currency label should format
   that one entry directly, without a reduce over the union.

2. **The DAL tests do not implement the spec's required scale/cross-check proof.**
   `src/__tests__/m8-dashboard-dal.test.ts:116-135` seeds only two accepted
   attendees, while Spec §4 AC-2 requires 200 accepted attendees across six
   events and a comparison between the aggregate result and a brute-force
   reduction over the seeded documents. The existing assertion is behavioral,
   not tautological, but it does not prove the named acceptance criterion.

3. **Revenue exclusion coverage is incomplete.**
   `src/__tests__/m8-dashboard-dal.test.ts:137-190` proves that `pending` is
   excluded, but Spec §1 AC-5 explicitly requires `pending`, `failed`,
   `outstanding`, and `comped` orders all to contribute zero. The production DAL
   filter at `src/lib/db/adminOrder.ts:273-277` appears correct, but the required
   behavioral fixtures/assertions for three statuses are absent. The test also
   does not seed a paid order in another currency, so the currency filter is
   inferred from the query rather than independently proved.

4. **The page test does not protect the auth-redirect rethrow behavior.**
   `src/__tests__/m8-dashboard-page.test.tsx:51-90` covers success and an event
   list failure only. `src/app/dashboard/(workspace)/page.tsx:22-30` correctly
   rethrows an object whose digest starts with `NEXT_REDIRECT`, but this is a
   high-impact regression boundary: without a test, a future catch-all change
   can silently replace authentication redirects with `WorkspaceLoadError`.
   Add a rejection from `getDashboardScope` with a redirect digest and assert
   that the page promise rejects with that same object.

5. **The static Setup Notes acceptance criterion is only partially tested.**
   `src/__tests__/m8-dashboard-overview-component.test.tsx:243-257` proves the
   card has no links and contains the six refreshed labels, but Spec §3 AC-1
   also requires the copy to be byte-identical for a zero-event fixture and a
   40-registration fixture. The current test renders only one data state, so it
   would not catch a future conditional note/detail.

## Nits

- `src/__tests__/m8-dashboard-overview-component.test.tsx:129-191` exercises all
  four Revenue variants, but it does not open/focus the multi-currency tooltip
  and assert its per-currency, alphabetically sorted values. The production
  sort/map at `workspace-stat-card.tsx:146-168` is correct by inspection; a
  tooltip interaction assertion would make Design §4/§10 coverage stronger.
- The DAL boundary grep necessarily reports pre-existing direct Firestore SDK
  imports in routes and feature modules outside `src/lib/db/` (for example
  `src/app/api/events/[eventId]/register/route.ts:2` and
  `src/features/event/create-event-workspace.tsx:7`). None is introduced or
  consumed by the scoped M8-T2 loader/page/components, so this is not charged to
  this ticket, but the repository as a whole does not literally satisfy a
  context-free “zero imports outside `src/lib/db`” statement.

## What I independently verified

### Commands run

- `git status --porcelain` and `git diff HEAD -- <path>` for every tracked file
  in the dispatch; every untracked M8-T2 file was read in full with numbered
  lines. No process-bookkeeping file was reviewed as ticket code.
- `rg -n 'firebase-admin/firestore|firebase/firestore' src --glob
  '!src/lib/db/**'` — the scoped production loader/page/components have no
  Firestore SDK import or direct query. They call only the three new DAL helpers
  (plus the existing `getAdminEventsForOrganization`). The grep also exposed the
  pre-existing repository-wide hits noted above and type/test imports.
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected
  pre-existing seven errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No M8-T2
  file produced a TypeScript error.
- `npm test -- --run` — PASS, **168 test files / 1916 tests**. The run emitted
  existing React `act`/ref and development-secret warnings, but no failures.
- Line counts for all scoped files — all are below the 800-line cap (largest is
  `src/lib/db/adminOrder.ts` at 720 lines). A scoped `console.log` grep returned
  no production hits.

### Claims traced directly to source

- Cross-tenant isolation: all three new DAL query builders include
  `organizationId == input.organizationId`:
  `src/lib/db/adminAttendee.ts:303-314`,
  `src/lib/db/adminOrder.ts:267-280`, and
  `src/lib/db/adminRegistrationPath.ts:77-89`. The two-org tests use materially
  different out-of-tenant values and assert exact in-tenant counts/IDs at
  `m8-dashboard-dal.test.ts:117-134`, `:138-190`, and `:194-209`; these are real
  isolation assertions, not tautologies.
- Aggregate efficiency: attendee uses `count().get()` and order uses
  `aggregate(...).get()`; the tests assert `fake.queryDocReads === 0` for both.
  RegistrationPath is intentionally a bounded document enumeration, default
  limit 200, matching the data-model contract. The data-model's no-new-index
  conclusion is an equality-only-query inference backed here only by the fake
  DB tests; I did not independently run a live Firestore emulator.
- Data contract: `load-workspace-summary.ts:8-29` matches Design §11 exactly.
  The loader uses `Promise.allSettled` at lines 121-136, so attendee and revenue
  failures degrade independently. The forced-failure tests at
  `m8-dashboard-orchestration.test.ts:175-209` genuinely reject one mocked DAL
  promise while asserting the other result survives.
- Primary currency: the comparator at
  `load-workspace-summary.ts:49-52` sorts larger path counts first via
  `rightCount - leftCount`; when zero, `leftCurrency.localeCompare(rightCurrency)`
  puts the alphabetically earlier code first. The selected `[0]` therefore
  implements “most RegistrationPath documents wins, alphabetical tie-break.”
- UI trace: `organization-event-overview.tsx:132-159` renders exactly four cards
  in Draft Events, Published Events, Registrations, Revenue (paid) order; only
  the two event counts use `padStart(2, "0")`. The removed Total events, Active
  forms, and TBD labels have no production occurrences in the rewritten file.
  Lines 84-117 and 177-199 provide five event-scoped links or the single
  zero-event CTA. Lines 44-69 and 203-232 provide the refreshed, static,
  non-linked six-item Setup Notes list. Per-card retry uses `router.refresh()`;
  initial scope/event-list failure renders the whole-page error.
- Page/server boundary: `page.tsx:23-24` fetches the event list once, passes the
  same array to the loader at lines 33-36, serializes the full list and the
  loader-selected `quickActionEvent` at lines 40-46, and rethrows
  `NEXT_REDIRECT` at lines 25-28. No Firestore Timestamp crosses into the client
  component through those event props.
- Loading state: `(workspace)/loading.tsx:23-55` renders four stat skeletons and
  the Quick actions/Setup Notes shells (plus the retained lower event-region
  skeleton), satisfying D10.
- Revenue variants: the UI explicitly handles `loadError`, `zero-currency`,
  `single`, and `multi` at `workspace-stat-card.tsx:124-171`; the component test
  renders all four at `m8-dashboard-overview-component.test.tsx:129-191` and
  proves the primary headline is not replaced by a blended displayed total.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-dashboard-metrics.md`.
