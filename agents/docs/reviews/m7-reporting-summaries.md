# Code Review — M7-T1 Reporting aggregates + event report summaries

Code Reviewer, 2026-07-17. Scope: all uncommitted changes in the working tree
relative to `prototype` that belong to M7-T1 — new `src/features/reports/**`
(`types.ts`; `server/load-finance-summary.ts`,
`server/load-ticket-type-registrations.ts`; `components/reports-workspace.tsx`,
`components/reports-load-error.tsx`, `components/ticket-type-bar-chart.tsx`,
`components/ticket-type-bar-chart-card.tsx`, `components/finance-summary-card.tsx`),
new `src/app/dashboard/(event)/events/[eventId]/reports/loading.tsx`; modified
`src/lib/db/adminAttendee.ts` (`ticketTypeId` filter on
`countAdminAttendeesForEvent`), `src/lib/db/adminOrder.ts` (new
`sumAdminOrderTotalsForEvent`), `src/app/dashboard/(event)/events/[eventId]/reports/page.tsx`,
`src/features/event/event-nav.ts` (drop `comingSoon`),
`src/features/registration/components/entity-table-states.tsx` (additive `href`
prop on `EntityEmptyState`), `src/__tests__/helpers/fake-admin-db.ts` (new
`.aggregate()` support + `queryDocReads` counter); new test files
`admin-order-finance-sums.test.ts`, `reports-orchestration.test.ts`,
`reports-page.test.tsx`, `finance-summary-card.test.tsx`,
`ticket-type-bar-chart-card.test.tsx`, `entity-empty-state-href.test.tsx`; plus
extensions to `admin-attendee.test.ts`. Reviewed against
`agents/docs/specs/m7-reporting-summaries.md`,
`agents/docs/design/m7-reporting-summaries.md`,
`agents/docs/data-models/m7-reporting-summaries.md`, and `agents/AGENT_LOOP.md`'s
Code Reviewer checklist. (`HANDOVER.md`, `agents/docs/BACKLOG.md`, `memory/`
excluded — orchestration bookkeeping, not code, matching prior review
precedent.)

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the same
  **pre-existing, unrelated** baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62` (3 files,
  matching the Orchestrator's reported baseline exactly). None touch any
  file in this diff's scope.
- `npm run build` — PASS, exit 0. `/dashboard/events/[eventId]/reports` appears
  in the route manifest as a dynamic route, 3.93 kB / 127 kB First Load JS —
  comfortably inside the `< 300kb` app-page JS budget, no new chunk bloat.
- `npm test -- --run` — PASS, **126 files / 1515 tests**, matching the
  Orchestrator's reported numbers exactly. All 6 new M7-T1 test files plus
  the `admin-attendee.test.ts` extension pass.

---

## Mandatory-check results

1. **Metric correctness — the comped-value field selection (the one detail
   most likely to get silently flipped) — VERIFIED CORRECT.**
   `src/features/reports/server/load-finance-summary.ts:44-68`
   (`loadCurrencySection`) calls `sumAdminOrderTotalsForEvent` three times:
   `paymentStatus: "paid"` → `field: "totalMinor"`; `paymentStatus: "outstanding"`
   → `field: "totalMinor"`; `paymentStatus: "comped"` → `field: "subtotalMinor"`
   — exactly per spec §2's table, not reversed, not uniform across all three.
   The DAL itself (`src/lib/db/adminOrder.ts:230-246`) makes `field` a
   **required** parameter (`OrderAmountSumField = "totalMinor" | "subtotalMinor"`,
   no default), so no call site can silently omit the choice. Locked by a
   dedicated test (`admin-order-finance-sums.test.ts:138-196`) that seeds both
   comp paths (100%-discount comp: `subtotalMinor: 145000, totalMinor: 0`;
   genuinely-free comp: both 0) and asserts `field: "subtotalMinor"` returns
   145000/0 while the same order's `field: "totalMinor"` returns 0 — this is
   the exact regression the spec worried about, and it's asserted, not just
   commented.
2. **Pending/failed exclusion — VERIFIED, via equality filter, not an
   "everything except X" query.** `sumAdminOrderTotalsForEvent`
   (`adminOrder.ts:237-243`) filters `paymentStatus == input.paymentStatus`
   (equality); the report loader only ever passes `{"paid","outstanding","comped"}`
   as that value (`load-finance-summary.ts:48,55,64`) — `pending`/`failed`
   orders are excluded by construction (never requested), not by a negated
   filter. `admin-order-finance-sums.test.ts:198-226` seeds a `pending` and a
   `failed` order alongside a `paid` one and confirms neither pollutes any of
   the three sums.
3. **"Registered" = `Attendee.status === "accepted"`, not `TicketType.registeredCount`
   — VERIFIED.** `load-ticket-type-registrations.ts:40-53` calls
   `countAdminAttendeesForEvent` with `status: "accepted"` on every call (both
   per-ticket-type and the `ticketTypeId: null` bucket); `grep -rn
   "registeredCount" src/features/reports/` returns zero hits anywhere in the
   new feature code. Cancelled-attendee exclusion and not-yet-accepted
   `FormData` exclusion are structural (no `Attendee` doc exists in either
   case) and locked by `admin-attendee.test.ts`'s new `ticketTypeId` describe
   block (`:392-546`, including the 200-attendee/5-ticket-type brute-force
   cross-check per spec §3 AC-3, cross-org/cross-event isolation, and a
   zero-full-document-read assertion per spec §1 AC-7).
4. **DAL boundary — PASS.** `grep -rn "firebase/firestore\|firebase-admin"` across
   `src/features/reports/**` and the new `reports/page.tsx`/`loading.tsx`
   returns zero hits. Both server loaders
   (`load-finance-summary.ts`, `load-ticket-type-registrations.ts`) import only
   from `@/lib/db/*`. The two new/extended DAL surfaces
   (`sumAdminOrderTotalsForEvent`, `countAdminAttendeesForEvent`'s
   `ticketTypeId` extension) live in the correct existing DAL files.
5. **Cross-org/cross-event isolation — PASS for both new aggregate queries.**
   `sumAdminOrderTotalsForEvent` filters `eventId ==`, `organizationId ==`,
   `paymentStatus ==`, `currency ==` (`adminOrder.ts:237-241`);
   `countAdminAttendeesForEvent`'s `ticketTypeId` filter is additive to the
   pre-existing `eventId`/`organizationId` filters (`adminAttendee.ts:282-294`).
   Both are locked by dedicated cross-org/cross-event tests
   (`admin-order-finance-sums.test.ts:272-336`,
   `admin-attendee.test.ts` new block's "never leaks cross-org or cross-event
   attendees" case).
6. **Zero-currency vs. zero-orders distinction — VERIFIED correct and
   distinct.** `loadFinanceSummary` (`load-finance-summary.ts:80-100`) returns
   `null` **only** when `getAdminRegistrationPathsForEvent` yields zero distinct
   currencies (line 98-100) — triggering `finance-summary-card.tsx`'s
   `data === null` branch (its *only* true empty state, `:97-104`). A currency
   with configured paths but zero matching orders still produces a real
   `CurrencyFinanceSection` with `paidMinor: 0, outstandingMinor: 0, compedMinor: 0`
   (since `sumAdminOrderTotalsForEvent` sums to `0`, never `null`/`undefined`,
   confirmed both in the DAL doc comment and the "zero orders" test at
   `admin-order-finance-sums.test.ts:338-349`) — rendered as normal `$0.00` rows,
   not the empty state. Both paths are independently asserted:
   `reports-orchestration.test.ts:153-164` (null on zero paths, and
   `sumAdminOrderTotalsForEvent` is asserted **not called** in that case) and
   `:260-276` (zero-orders-but-one-currency renders a real zeroed section).
7. **Independent per-card error handling — PASS, `Promise.allSettled`, not
   `Promise.all` + one catch.** `reports/page.tsx:54-72` uses
   `Promise.allSettled` over the two loaders and sets two independent boolean
   flags (`ticketTypeLoadError`, `financeLoadError`) from each settled result's
   `.status`, so the two cards genuinely degrade independently while both
   underlying aggregate reads still run concurrently. Locked by
   `reports-page.test.tsx:52-96`: one test throws only the ticket-type loader
   and asserts the finance card renders its **real** numbers (not blanked, not
   erroring); the mirror test throws only the finance loader and asserts the
   ticket-type card's real content survives. This is exactly the behavior
   spec §5 and design §3 require, verified by an actual failing-loader test,
   not just code inspection.
8. **The `progress.tsx` fix — independently verified, genuine one-line bug fix,
   zero regression risk.** `git diff -- src/components/ui/progress.tsx` shows
   the substantive change is exactly one line, `value={value}` added to
   `ProgressPrimitive.Root`'s props (the rest of the diff is cosmetic
   semicolon/quote-style normalization from a formatter pass, not logic).
   Before this fix, `value` was destructured out of props but never forwarded
   to Radix's `Root`, so Radix received no `value` prop and defaulted to
   `data-state="indeterminate"` regardless of the caller's actual value — the
   `Indicator`'s inline `transform: translateX(-${100 - (value || 0)}%)` style
   still used the local `value` correctly, so the *visual* fill width was
   already correct before this fix, but the component's `role="progressbar"`
   ARIA state (`aria-valuenow` is set by Radix only when it receives a `value`
   prop) and `data-state` were wrong — a real, if narrow, accessibility bug,
   independent of this ticket's own new usage. Confirmed via a repo-wide grep
   (`grep -rn "<Progress"` across all `.tsx`) that
   `src/features/reports/components/ticket-type-bar-chart.tsx:47` is the
   **only** caller of `<Progress>` in the entire codebase — the claim of zero
   regression risk holds; there is no other call site whose existing behavior
   this change could have altered. No other prop's behavior changes (`className`,
   `...props` spread, and the `Indicator`'s transform math are all untouched).
9. **`EntityEmptyState`'s additive `href` prop — PASS, backward-compatible.**
   `entity-table-states.tsx:94-129`: `href` is optional, checked before the
   pre-existing `onAction` branch (`href` takes precedence per the code
   comment, only relevant if a caller somehow passes both), and every
   pre-existing caller (`ticket-types-workspace.tsx`,
   `registration-types-workspace.tsx`, `registration-paths-workspace.tsx`,
   `discounts-tab.tsx`, `fees-tab.tsx`, `taxes-tab.tsx`,
   `service-fees-tab.tsx`, `send-log-table.tsx`) keeps using `onAction`-only
   and is unaffected. Locked by `entity-empty-state-href.test.tsx`: href-mode
   renders a real `<a>`-backed link (not a button), the "both passed" case
   prefers `href`, and the two pre-existing modes (`onAction`-with-CTA,
   no-CTA-at-all) are re-verified unaffected in the same file.
10. **Structure / file size / naming — PASS.** All new files are small and
    single-purpose: largest is `ticket-type-bar-chart-card.tsx` at 79 lines,
    `finance-summary-card.tsx` at 151 lines — both well under the 800-line
    ceiling and the "many small files" convention. No dead code found. Naming
    matches the design doc's own file list exactly
    (`reports-workspace.tsx`, `reports-load-error.tsx`,
    `ticket-type-bar-chart(-card).tsx`, `finance-summary-card.tsx`,
    `load-finance-summary.ts`, `load-ticket-type-registrations.ts`).
11. **Aggregate-only read path — PASS, zero full-document reads.** The
    extended `fake-admin-db.ts` test double correctly distinguishes
    `.get()` (increments `queryDocReads`) from `.count().get()`/`.aggregate().get()`
    (neither increments it) — verified by direct read of
    `fake-admin-db.ts:204-241`. Both new DAL functions' "zero full-document
    reads" claims are locked by dedicated tests
    (`admin-order-finance-sums.test.ts:352-374`,
    `admin-attendee.test.ts`'s ticket-type-filter block) rather than merely
    asserted in comments.
12. **No new npm dependency, no new Firestore index — PASS.** `package.json`
    diff shows no new dependency (`Progress` reuses the already-installed
    `radix-ui` package). `git diff firestore.indexes.json` is empty, matching
    both the spec's AC-1 and the data-model doc's "empirically confirmed
    against a live Firestore emulator" claim — the DAL code comments cite
    that verification directly (`adminOrder.ts:210-220`,
    `adminAttendee.ts:263-274`).

---

## Findings

### Should-fix

- **S-1 — Spec §3 AC-2's "timing/call-order test... asserted by a
  timing/call-order test" is not independently exercised.** The code itself
  is correct: every fan-out (`load-finance-summary.ts:44-51` per-currency
  triple, `:102-110` per-currency sections, `load-ticket-type-registrations.ts:37-54`
  per-ticket-type counts, `reports/page.tsx:54-60` the two top-level loaders)
  uses `Promise.all`/`Promise.allSettled`, never a sequential `for`-`await`
  loop — reviewed line-by-line, no regression risk. But no test in this diff
  asserts *concurrency itself* (e.g., a mock that resolves out of call order,
  or records call timestamps, the way spec §3 AC-2 explicitly asks for
  "consistent with the pattern the attendees page already establishes for its
  own multi-source parallel load"). The correctness tests present
  (`reports-orchestration.test.ts`) prove the *shape* of the aggregated
  output is right, not that the underlying reads are issued in parallel
  rather than serially — a future regression to sequential `await`s (which
  would still pass every existing test, just slower) would go undetected.
  Low severity since the current code is unambiguously already using
  `Promise.all` throughout — flagging for a follow-up test, not blocking this
  ticket.

### Nits (optional)

- **N-1 — `reports-page.test.tsx`'s IDOR coverage (spec §7 AC-2/AC-3) is a
  mocked `getAdminEventForOrganization → null` case, not a real two-org
  fixture.** This matches the established convention elsewhere in this
  codebase (mocking the DAL call at the page-test layer, since
  `getAdminEventForOrganization` itself is pre-existing, unmodified, and
  already has its own tenancy tests from earlier milestones) — not a gap
  introduced by this ticket, just noting it's mock-level rather than a fresh
  live two-org Firestore-double fixture at this specific test file.
- **N-2 — the multi-currency finance card's per-currency sections have no
  explicit visual regression/breakpoint screenshot test**, per the design
  doc's own "responsive behavior" section (320/768/1024/1440). This is
  consistent with this repo's existing pattern (no Playwright visual suite
  wired into this ticket's scope) and is properly QA/E2E territory, not a
  gap in this diff specifically.
- **N-3 — `progress.tsx`'s diff includes an unrelated formatter pass**
  (quote-style/semicolon normalization across the whole file) bundled with
  the one-line functional fix. Harmless and correctly scoped to a single
  file with a single real behavior change, but a more surgical diff (fix only,
  no reformat) would have made the "one line" claim in Full-Stack's report
  trivially `git diff`-visible without needing to read past the noise, as
  this review had to do.

---

## Verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M7-T1 — Reporting aggregates + event report summaries | **APPROVED** | No blockers. One should-fix (S-1, missing concurrency-specific test for §3 AC-2) is a test-coverage gap around code that is already visibly correct, not a defect — does not block handoff. Three nits are optional polish. The ticket's two riskiest details are both independently re-derived from source and confirmed correct: (1) the comped-value sum reads `amounts.subtotalMinor`, never `amounts.totalMinor`, enforced by a required (non-defaulted) DAL parameter and locked by a dedicated regression test seeding both comp paths; (2) the `progress.tsx` fix is a genuine, narrowly-scoped one-line bug fix (`value={value}` now forwarded to Radix's `Root`) with zero regression risk, confirmed via a repo-wide grep showing this ticket's own `ticket-type-bar-chart.tsx` is the only `<Progress>` caller anywhere in the codebase. `npm run lint` (clean), `npx tsc --noEmit` (3-file pre-existing baseline, unchanged), `npm run build` (exit 0, reports route in the manifest at 3.93 kB / 127 kB First Load JS), and `npm test -- --run` (126 files / 1515 tests passing) all independently re-verified, not copied from the Orchestrator's report. |

Overall: **APPROVED** — hands off to the Security Agent. Given this is a
pure read surface with no mutating routes (spec §7's own framing), Security's
main angle here is narrower than prior milestones: (1) confirm the
org-membership-only gate (`getDashboardScope()`, no `write:events`) is
genuinely the intended, already-reviewed posture for this screen (it is, per
spec §7, and matches the M5/M6 precedent for read surfaces) rather than an
overlooked gate; (2) confirm the finance card's aggregate numbers (currency
sums, discount-code-used counts) don't indirectly leak more than the spec
intends to any org member regardless of role, since real Viewer-vs-Editor
enforcement is explicitly deferred to M8-T1 and this ticket's own posture is
"safe for any org member," not "safe for anyone."
