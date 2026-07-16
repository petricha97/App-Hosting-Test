# Merge Log — M7-T1 Reporting Aggregates + Event Report Summaries

- **Date:** 2026-07-17
- **Feature branch:** `feat/m7-t1-reporting-summaries`
- **Target branch:** `prototype`
- **Merge commit:** `28c7196` — `merge(m7-t1): reporting aggregates + event report summaries`
- **Merge base (origin/prototype before merge):** `dc0af2e`

## Branch provenance (deviation from standard flow)

All of M7-T1's implementation work (Research, Design, Backend DAL
extensions, Full-Stack orchestration + UI components, and both
independent verification passes) was carried out directly in the working
tree while already checked out on `prototype` — no
`feat/m7-t1-reporting-summaries` branch existed until the GitHub Agent
created one at merge time. This is the identical situation to every prior
M6 ticket (`agents/docs/git/m6-emails-admin.md`,
`agents/docs/git/m6-lifecycle-triggers.md`,
`agents/docs/git/m6-email-designer.md`) and is now the established
pattern carried into M7. `feat/m7-t1-reporting-summaries` was cut via
`git checkout -b feat/m7-t1-reporting-summaries` from that working-tree
state (`git status --porcelain` captured before and after the checkout —
byte-identical, confirming nothing was lost or altered), then the
ticket's work was staged and committed as a single commit on the new
branch. `HANDOVER.md`, `agents/docs/BACKLOG.md`, and `memory/` were
excluded from that commit (orchestration bookkeeping, same convention as
every prior ticket) and instead committed separately on `prototype` after
the merge (`memory/` left untracked entirely, per the loop convention of
not versioning agent scratch memory).

## Tickets landed

M7-T1 — first ticket of the M7 (Reporting) milestone: an event Reports
page composed of two independently-loading cards — a finance summary
card (gross, fees, refunds, net, outstanding, stacked per-currency
sections for multi-currency events, comped-order subtotal handling) and a
ticket-type registrations bar chart (reusing the existing shadcn
`Progress` primitive, no new charting dependency) — backed by new
server-side Firestore aggregate-query helpers
(`countAdminAttendeesForEvent` extended with a `ticketTypeId` filter,
`sumAdminOrderTotalsForEvent` with a `totalMinor`/`subtotalMinor`
selector). Zero fix cycles across Code Review, Security, and QA — the
first ticket in this loop to clear all three gates clean on the first
pass.

## M7-T1 commits

| Hash | Message |
|------|---------|
| `7dc5a40` | feat(reports): reporting aggregates + event report summaries (M7-T1) |
| `28c7196` | merge(m7-t1): reporting aggregates + event report summaries |
| `0e1aec5` | docs(loop): M7-T1 gate artifacts and handover update — first M7 ticket closed |

## Files (feature commit `7dc5a40`)

30 files changed, 3702 insertions(+), 20 deletions(-). Notable additions:

- Reports feature module: `src/features/reports/{types.ts,
  components/{finance-summary-card,reports-load-error,reports-workspace,
  ticket-type-bar-chart-card,ticket-type-bar-chart}.tsx,
  server/{load-finance-summary,load-ticket-type-registrations}.ts}` —
  independently-loading cards via `Promise.allSettled`, stacked
  per-currency finance sections (explicitly rejecting a tab switcher per
  the design doc, to avoid silently hiding a currency), comped-order
  subtotal handling enforced by a required non-defaulted DAL parameter
  (not just convention)
- Route wiring: `src/app/dashboard/(event)/events/[eventId]/reports/
  {page.tsx,loading.tsx}` (loading.tsx new), `src/features/event/
  event-nav.ts` (Reports nav entry)
- DAL extensions: `src/lib/db/adminAttendee.ts`
  (`countAdminAttendeesForEvent` gains a `ticketTypeId` filter),
  `src/lib/db/adminOrder.ts` (new `sumAdminOrderTotalsForEvent`,
  Firestore server-side `sum()`/`count()` aggregate queries,
  equality-only filters, zero new composite indexes — the nested-field
  `sum()` behavior was empirically confirmed against a real local
  Firestore emulator rather than assumed, per the Backend Agent's own
  verification note)
- Incidental a11y fix caught during implementation, confirmed
  zero-regression-risk (this ticket's bar chart is the only `<Progress>`
  caller in the codebase): `src/components/ui/progress.tsx` — `value` was
  destructured but never forwarded to Radix's `Root`, so it always
  rendered `data-state="indeterminate"` regardless of actual progress
- Small additive, backward-compatible prop: `src/features/registration/
  components/entity-table-states.tsx` — `EntityEmptyState` gains an
  optional `href` so empty-state CTAs can navigate to Tickets/Registration
  Paths (confirmed by Security as same-origin hardcoded templates only,
  not an open-redirect vector)
- Docs: `agents/docs/{specs,design,data-models,reviews,security,qa}/
  m7-reporting-summaries.md`
- Tests: 7 new test files (`admin-order-finance-sums`,
  `entity-empty-state-href`, `finance-summary-card`,
  `m7-reports-arithmetic-integration`, `reports-orchestration`,
  `reports-page`, `ticket-type-bar-chart-card`) + 2 modified
  (`admin-attendee.test.ts`, `helpers/fake-admin-db.ts`)

Excluded from this commit (committed separately on `prototype` in
`0e1aec5`, or left untracked): `HANDOVER.md`, `agents/docs/BACKLOG.md`,
`memory/`.

## Gate status at merge time

- **Code Review:** APPROVED. 0 Blockers, 1 Should-fix (non-gating —
  missing a dedicated concurrency-timing test around code already
  confirmed correct by direct read), 3 Nits. The two riskiest details
  both independently re-derived from source: comped-value sums
  `subtotalMinor` never `totalMinor` (enforced by a required,
  non-defaulted DAL parameter), and the `progress.tsx` fix confirmed a
  genuine narrow one-line bug fix with zero regression risk
  (`agents/docs/reviews/m7-reporting-summaries.md`).
- **Security:** PASS, 0 findings of any severity. Explicitly confirmed
  org-membership-only gating (no `write:events`) is correct, not an
  oversight — the build manifest shows literally zero `/api/**` routes
  added for this ticket, since it ships nothing to mutate. Cross-org
  isolation confirmed on both new DAL aggregate functions (unconditional
  `eventId`/`organizationId` equality filters, closed TS literal unions
  for `PaymentStatus`/`Currency`, no filter-widening path).
  `EntityEmptyState`'s new `href` prop confirmed not an open-redirect
  vector (hardcoded same-origin template literals only). No new
  dependencies; `npm audit` unchanged
  (`agents/docs/security/m7-reporting-summaries.md`).
- **QA:** SIGNED OFF, zero defects — no fix cycle needed. Hand-computed a
  realistic seeded fixture (3 ticket types, mixed attendee statuses, 2
  currencies × every payment status, 3 discount codes) through the real
  DAL and orchestration layers with nothing mocked but the Firestore
  boundary; every stress point (comped-order-with-real-subtotal,
  cancelled-attendee exclusion, pending/failed-order exclusion, currency
  non-blending, distinct-codes-not-redemptions counting) matched the hand
  computation exactly (`agents/docs/qa/m7-reporting-summaries.md`).
- **Checks (Orchestrator, final working tree):** lint clean, build exit
  0, `npm test -- --run` 127 files / 1517 tests passing.
- **Secret scan of staged diffs before commit:** clean — grepped
  `git diff --cached` for API key/secret/password/token/private-key
  patterns across all new/modified files (hits were only security-review
  prose discussing the absence of secrets, not actual secret material);
  confirmed no `.env*` file appeared in the staged diff or `git status`.

## Pre-merge smoke check (on `feat/m7-t1-reporting-summaries`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Post-merge smoke check (on `prototype`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Conflicts

None. Merge made by the `ort` strategy with no conflicts.

## M7 milestone status

This merge lands the first ticket of M7 (Reporting): M7-T1 (reporting
aggregates + event report summaries) — Done, merged to `prototype`. Next
up per `agents/docs/BACKLOG.md`: M7-T2 (report templates library, deps
M7-T1 + M3-T5 + M5-T5 + M6-T3), then M7-T3 (scheduled report delivery,
deps M7-T2 + M6-T1/T3).

## Push results

- `feat/m7-t1-reporting-summaries` pushed: new branch → `7dc5a40`
- `prototype` pushed: `dc0af2e..28c7196` (merge), then a follow-up push
  for `28c7196..0e1aec5` (docs bookkeeping commit)
- `main` untouched throughout (verified via `git branch --show-current`
  before every commit/merge/push; no git command targeted `main`).
