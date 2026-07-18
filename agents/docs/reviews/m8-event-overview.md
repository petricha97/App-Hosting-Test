# Code Review — M8-T3 Event Overview Parity

Code Reviewer, 2026-07-19. Scope: the complete uncommitted Backend and
Full-Stack M8-T3 working-tree diff listed in the dispatch. Reviewed against
`agents/docs/specs/m8-event-overview.md`,
`agents/docs/design/m8-event-overview.md`, and
`agents/docs/data-models/m8-event-overview.md`. Process-only files named in the
dispatch were excluded.

## Verdict — CHANGES REQUESTED

No data-correctness, tenant-isolation, or cross-currency Blocker was found. The
new aggregates are correctly scoped, the loader preserves independent failure
states, and the six readiness rules match the authoritative definitions.
Changes are requested because the Publish action does not occupy the reserved
event-bar slot required by D14, and the ticket's highest-risk refactor is not
protected by a meaningful preserved-behavior regression test; direct comparison
also found that one diagnostics value was changed rather than preserved.

## Disclosed-deviation adjudications

- **D-A — Should-fix.** Placing Publish in a detached, right-aligned row at
  `src/features/dashboard/components/organization-event-detail.tsx:38-42` is
  usable, but it does not satisfy the design intent: Preview and the primary
  status action are separated by the sticky event bar/body boundary, and on a
  long page Publish scrolls away while Preview remains sticky. The bounded
  follow-up is to add/render a status-action slot at
  `src/features/event/components/event-bar.tsx:22-29,118-130`, pass it through
  `src/features/event/components/event-shell.tsx:39-46,81-96`, construct it
  from the already-resolved event and permission at
  `src/app/dashboard/(event)/events/[eventId]/layout.tsx:22-45`, and remove the
  body-level action/now-redundant permission prop at
  `src/features/dashboard/components/organization-event-detail.tsx:13-23,38-42`
  plus `src/app/dashboard/(event)/events/[eventId]/page.tsx:28-35`.
- **D-B — Accepted.** The dispatch's explicit preserved-behavior requirement is
  the later, task-specific instruction and wins over Design §0's removal
  proposal. Keeping diagnostics and the registration-form card after the new
  parity overview is coherent: the prototype hierarchy remains first,
  Promotions retains `#promotions`, and the legacy management/detail surfaces
  are clearly lower-priority. This acceptance does not excuse changing their
  existing behavior; that separate regression is called out below.

## Blockers

None.

## Should-fix

1. **Move the status action into the event bar.**
   `src/features/dashboard/components/organization-event-detail.tsx:38-42`
   renders the control immediately above the overview instead of beside Preview
   in the reserved slot. This is D-A above; the exact bounded file/line path is
   specified there. Keep the existing `canWriteEvents` omission behavior and
   the unchanged `EventStatusActions` mutation component when moving it.

2. **The diagnostics surface was not behaviorally preserved.**
   `src/features/dashboard/components/organization-event-detail.tsx:48` now
   displays only the capitalized page-mode enum. Before the refactor, redirect
   mode displayed `Redirect to {redirectUrl || "missing URL"}` and custom/default
   modes displayed explanatory state (`HEAD` lines 415-420). This loses useful
   configuration information and conflicts with the dispatch's explicit
   preserved-behavior constraint that justifies D-B. Restore the former
   mode-aware value in this row (semantic-token restyling is fine).

3. **The preserved-behavior regression test asserts placeholders, not the
   preserved wiring or behavior.** `src/__tests__/m8-event-overview-page.test.tsx:17-19,37-43`
   replaces Promotions, registration-form management, and status mutation with
   components that ignore every prop, then merely checks their hard-coded text.
   It would pass if the page supplied the wrong event ID, form, promotions,
   templates, status, or permission; it also does not test any diagnostics
   value or navigation href. Replace these mocks with prop-recording mocks (or
   render the real lightweight boundaries) and assert: exact promotion/form
   props, `#promotions`, all retained diagnostics values including every page
   mode, the five Quick-action hrefs, writer/viewer action visibility, and the
   status component's event/status props. Add focused real
   `EventStatusActions` tests for Draft/Published labels, POST payload, saving
   disablement, success refresh/toast, failure state/toast, and absence of the
   removed duplicate public-page link; Spec §13 item 11 explicitly requires
   those mutation regressions and no existing test covers them.

## Nits

- `src/features/event/overview/event-overview-loader.ts:1-314` is below the
  repository's 800-line cap but above Design §10's approximate 200-250-line
  target. The revenue and confirmation-readiness helpers are cohesive and the
  file remains readable, so this is not approval-blocking; extracting the two
  derivation helpers would make the orchestration easier to scan.
- `src/__tests__/m8-event-overview-loader.test.ts:147-170` covers the aggregate
  false state but does not independently exercise an archived/dangling Fee or
  assert which confirmation kinds are requested for card-only, invoice-only,
  mixed, and zero-active-path inputs. Production is correct by inspection, but
  these focused truth-table cases would better lock Spec §13 items 8-9.

## What I independently verified

### Commands run

- `git status --short`, `git diff --stat HEAD`, and full numbered reads/diffs
  for every scoped tracked and untracked M8-T3 file. The ignored process files
  were not treated as implementation.
- `rg -n 'firebase-admin/firestore|firebase/firestore|adminDb|\.collection\('
  src/features/event/overview` — no direct Firestore access in the loader or
  overview components; the loader calls DAL/server-definition functions only.
- `rg -n 'reduce\(|sum\(|totalMinor|paidMinor' src/features/event/overview
  src/__tests__/m8-event-overview-*` — no reduction or sum over a currency
  union. Revenue fans out one paid aggregate per sorted currency and the UI
  renders sorted, stacked lines.
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  pre-existing errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No M8-T3
  file produced a TypeScript error.
- `npm test -- --run` — PASS, **173 test files / 1937 tests**. Existing React
  ref/`act` and development-secret warnings were emitted, with no failures.
- Scoped line counts and `console.log` grep — all scoped files are below 800
  lines (largest M8-T3 file is the 314-line loader), with no `console.log` hit.
  `event-status-actions.tsx:56` retains the pre-existing `console.error` failure
  reporting, which is appropriate and preserves shipped behavior.

### Claims traced directly to source

- **Abandoned lifecycle and boundary:**
  `src/lib/db/adminRegistrationDraft.ts:269-282` uses event/org equality filters
  plus `updatedAt < cutoff`; exactly 24 hours is excluded. The finalization flow
  creates/recovers the Order, then FormData, and only then calls
  `deleteAdminRegistrationDraft` at
  `src/app/api/events/[eventId]/registration/finalize/route.ts:186-242`.
  Completed drafts therefore do not persist in the successful lifecycle. The
  DAL tests seed exactly-boundary, older, other-org, and other-event rows and
  assert the owned count; their two-org assertions are genuine. The
  "completed" test is lifecycle-by-absence rather than an independent finalize
  integration, so the production trace above is the decisive evidence.
- **Tenancy:** both new DALs re-check the canonical tenant. The abandoned query
  has both equality predicates (`adminRegistrationDraft.ts:275-277`), and the
  deterministic CheckinConfig read returns true only for a stored matching
  `organizationId` (`adminCheckinConfig.ts:83-95`), so it does not leak cross-org
  existence. Reused attendee, message, order, path, ticket, and fee DALs all
  include event and organization scope; form/page deterministic shortcuts also
  validate the returned event/org before use.
- **Invited:** `event-overview-loader.ts:150-156` passes the owned event/org plus
  `kind: "invitation"` and `status: "sent"` to the aggregate. The underlying
  `countAdminEmailMessagesForEvent` applies both tenant predicates and both
  optional equality filters at `adminEmailMessage.ts:380-398`. No Attendee or
  pending-registration proxy is used.
- **Loader contract/degradation:** `event-overview-types.ts:7-56` defines the
  count, Revenue, path, and readiness variants. The loader uses one
  `Promise.allSettled` across metrics and readiness prerequisites at
  `event-overview-loader.ts:142-187`; path rejection propagates to Revenue,
  identity paths, and confirmation readiness without becoming an empty path
  list. The UI explicitly handles both count/path variants, all three Revenue
  variants, and all three readiness states. Forced-rejection tests prove
  section isolation and whole-Revenue failure on one currency fan-out failure.
- **Six readiness rules:** (1) Published is the exact status check at
  `event-overview-loader.ts:202,235-243`; (2) custom requires a published page
  while default/redirect are done as not required at `:203-209,244-257`; (3)
  form requires `status === "published"` at `:258-271`; (4) a returned ticket ID
  must be referenced by an active returned Fee at `:211-232`; (5) active
  card/comp/none requires `confirmation-paid`, invoice requires
  `confirmation-payment-due`, and no active methods requires both at `:99-130`;
  (6) saved tenant-matching CheckinConfig existence drives `:287-296`. The
  array is fixed and ordered at `:235-297`, and all pending/unknown deep links
  match Design §3.
- **Identity/metrics presentation:** the UI renders Registered, Invited,
  Revenue, Abandoned in order; successful zero is ordinary `0`; no-currency is
  unconfigured rather than `$0`; multiple currencies are visibly stacked and
  never combined. Identity renders the fixed five rows, derives active/total
  path state and stable payment methods, and turns a path failure into two
  `Unable to load` values with Retry rather than plausible configuration.
- **Status-action diff:** `src/features/dashboard/components/event-status-actions.tsx`
  changes only responsive wrapping and removes the duplicate public-page link.
  Its inverse-status POST, payload, disabled saving state, success/error toasts,
  and refresh remain unchanged; no new mutation flow was introduced. The page
  now omits the control for users without `write:events`, matching AC8.
- **Refactor safety by direct comparison:** Promotions retains the same manager,
  event ID, promotion/template inputs, and `#promotions` anchor; the registration
  form card retains event ID/name/form; organization-path and overlap diagnostics
  retain their data; obsolete generic cards/header links are intentionally
  replaced by the specified Quick actions. The page-mode diagnostic is the one
  behavioral regression identified above. The submitted regression test does
  not genuinely prove these claims, which is why its strengthening is a
  Should-fix rather than relying on the current green suite.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-event-overview.md`.
