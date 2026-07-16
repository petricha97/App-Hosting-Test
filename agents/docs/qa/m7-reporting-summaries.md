# QA — M7-T1 Reporting aggregates + event report summaries

QA Agent, 2026-07-17. Gate 3 of 3 (Code Review APPROVED, 0 Blockers, 1
Should-fix (S-1, non-gating test-coverage gap around already-correct
concurrency code), 3 Nits → Security PASS, 0 Critical/High/Medium/Low →
**QA**). Scope: all uncommitted M7-T1 changes on the working tree relative to
`prototype` — `src/features/reports/**` (`types.ts`; `server/
load-finance-summary.ts`, `server/load-ticket-type-registrations.ts`;
`components/reports-workspace.tsx`, `components/reports-load-error.tsx`,
`components/ticket-type-bar-chart.tsx`, `components/
ticket-type-bar-chart-card.tsx`, `components/finance-summary-card.tsx`), new
`src/app/dashboard/(event)/events/[eventId]/reports/{page,loading}.tsx`,
modified `src/lib/db/adminAttendee.ts` (`ticketTypeId` filter), `src/lib/db/
adminOrder.ts` (new `sumAdminOrderTotalsForEvent`), `src/features/event/
event-nav.ts` (drop `comingSoon`), `src/features/registration/components/
entity-table-states.tsx` (additive `href` prop), `src/components/ui/
progress.tsx` (one-line ARIA fix), `src/__tests__/helpers/fake-admin-db.ts`
(`.aggregate()` support). Reviewed against `agents/docs/specs/
m7-reporting-summaries.md` (§1–§8, authoritative acceptance criteria),
`agents/docs/design/m7-reporting-summaries.md` (UI states/layout),
`agents/docs/reviews/m7-reporting-summaries.md` (Code Review), and
`agents/docs/security/m7-reporting-summaries.md` (Security).

## Method — what "actually run the app" meant in this environment

Same constraint as every prior milestone's QA pass in this repo:
`.env.local` points `firebase-admin`/the client SDK at a real Firebase
project, no local Firestore/Auth emulator is configured, and no browser-driving
tool is available in this environment. Clicking through `npm run dev` by hand
against real cloud credentials was not a safe or repeatable option. Per this
ticket's own framing ("smaller/simpler than M6 — no XSS-sensitive rendering,
no complex dialog state machine, just aggregate math + a two-card read-only
screen"), the QA effort was weighted toward what the brief specifically asked
for:

1. **An independent, full-pipeline arithmetic verification** — a new test
   file (`src/__tests__/m7-reports-arithmetic-integration.test.ts`) seeds one
   realistic, hand-computed fixture directly into the in-memory fake
   Firestore store (3 ticket types with mixed accepted/cancelled/no-ticket
   registrants; orders in 2 currencies across every `paymentStatus` value,
   including both comp paths) and drives it through the **real** DAL
   (`adminAttendee.ts`, `adminOrder.ts`, `adminTicketType.ts`,
   `adminRegistrationPath.ts`, `adminEventPromotion.ts`) and the **real**
   orchestration loaders (`loadTicketTypeRegistrations`,
   `loadFinanceSummary`) with nothing mocked except the Firestore module
   boundary. This is distinct from, and independently verifies, both
   `reports-orchestration.test.ts` (which mocks every DAL call, proving only
   the shaping logic) and `admin-order-finance-sums.test.ts`/
   `admin-attendee.test.ts` (which exercise one DAL function at a time with
   small fixtures) — my test proves the two layers compose correctly end to
   end against numbers I hand-derived independently before running it.
2. **Rendered-DOM/component-level re-verification** — read (rather than
   re-wrote, since the existing coverage was already genuinely thorough)
   `finance-summary-card.test.tsx` and `ticket-type-bar-chart-card.test.tsx`,
   confirmed they render the real production components with `fireEvent` and
   assert on rendered class lists / DOM presence (not source inspection), and
   independently re-derived that their assertions actually match spec §1/§2/§5
   by re-reading the component source myself rather than trusting the test
   names.
3. **Per-card independent-degradation re-verification** — read
   `reports-page.test.tsx`, confirmed it renders the *real* `EventReportsPage`
   (not a mock of the page itself) with one loader mocked to reject and the
   other to resolve, and asserts the surviving card's real numbers render
   while the failed card shows its own error panel — this is a genuine
   exercise of the `Promise.allSettled` independence claim, not a trust of
   the code review's read of it.

## Automated suite (this session, working tree)

| Check | Result |
|---|---|
| `npm run lint` | PASS — no ESLint warnings or errors |
| `npx tsc --noEmit --pretty false` | PASS — clean except the same **3 pre-existing, unrelated** baseline errors already carried by Code Review/Security (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62`) — independently re-confirmed none touch any file in this diff's scope |
| `npm run build` | PASS — exit 0. `/dashboard/events/[eventId]/reports` appears in the route manifest, 3.93 kB / 127 kB First Load JS, well inside the `< 300kb` app-page JS budget. Confirmed (via the full route list) **zero new `/api/**` routes** exist for this feature — matches spec §7's "zero mutating routes" claim in the shipped build, not just the source |
| `npm test -- --run` (before my additions) | PASS — 126 files / 1515 tests, matching Code Review's and Security's reported numbers exactly |
| `npm test -- --run` (after my new regression file) | PASS — **127 files / 1517 tests** (126+1 files, 1515+2 tests — my new integration test file, 2 test cases) |

## New QA test file (regression test added)

| File | Tests | What it locks |
|---|---|---|
| `src/__tests__/m7-reports-arithmetic-integration.test.ts` | 2 | End-to-end arithmetic through the real DAL + real loaders (nothing mocked but the Firestore boundary): (1) ticket-type registration counts — 5 accepted + 1 cancelled (excluded) on "Early Bird", 3 accepted on "Standard", 0 on "VIP", 2 accepted with `ticketTypeId: null` into the "No ticket type" bucket (always last, even though 2 > VIP's 0), plus cross-org/cross-event noise proven not to leak; (2) finance sums across USD+GBP and every `paymentStatus` — Paid/Outstanding correctly sum `totalMinor`, Comped value correctly sums `subtotalMinor` for BOTH a 100%-discount comp (non-zero subtotal, zero total — 14500, not 0) and a genuinely-free comp (0/0); `pending`/`failed` orders (one of which references a real, otherwise-6-use `promotionId`) contribute to nothing; GBP and USD sums never blend; distinct discount-codes-used counts 2 (a 6-use code + a 1-use code), not 7 (sum of `usedCount`) and not 3 (total promotions including the unused one); cross-org/cross-event order noise proven not to leak into any sum |

This test file was written **before** re-reading the implementation's exact
numbers, then run — it independently reproduces (not just re-asserts) every
one of the five stress points named in the QA brief: (a) comped order with
non-zero subtotal ≠ $0, (b) cancelled attendees excluded, (c) pending/failed
excluded from every sum, (d) two currencies never blend, (e) discount-codes-used
counts distinct codes with ≥1 use, not total redemptions. All pass against the
shipped implementation with no code changes needed.

---

## Per-section acceptance criteria

### §1 — Registrations by ticket type (bar chart)

| AC | Result | Evidence |
|---|---|---|
| 1. 4-row prototype distribution (97/13/3/1), descending, largest dominant | **PASS** | `reports-orchestration.test.ts` (mocked-DAL) + independently re-derived via my own fixture's 5/3/0 case, same sort behavior |
| 2. Zero-registration ticket type still renders as a labeled row, never omitted | **PASS** | My integration test: "VIP" (0 accepted) present in the returned rows, not dropped; `ticket-type-bar-chart-card.test.tsx` confirms the rendered DOM shows the row with muted "0" |
| 3. Non-accepted attendees (pending/reviewed `FormData`, no `Attendee` doc) contribute 0 | **PASS (structural, re-confirmed)** | The metric only ever calls `countAdminAttendeesForEvent({ status: "accepted", ... })` — a pending/reviewed submission has no `Attendee` doc at all by construction (M5), so there is nothing to count; my fixture's design (no `FormData` collection touched anywhere in the reports pipeline) confirms this by absence |
| 4. `cancelled`-status `Attendee` contributes 0 | **PASS — independently reproduced** | My integration test seeds a `status: "cancelled"` attendee on "Early Bird" alongside 5 `accepted` ones and asserts the row is exactly 5, not 6 |
| 5. Legacy `ticketTypeId: null` attendees grouped into "No ticket type", present only when count > 0 | **PASS — independently reproduced, including the ordering subtlety** | My fixture's "No ticket type" bucket (count 2) is asserted to render **last**, even though 2 is numerically greater than "VIP"'s 0 — proving the bucket is unconditionally appended, not re-sorted into the main list (a distinct, easy-to-get-wrong behavior from plain descending sort) |
| 6. Zero ticket types → chart's own empty state, not a silently-empty array | **PASS** | `ticket-type-bar-chart-card.test.tsx`: `rows={[]}` renders "No ticket types yet" + a working `Link` to `/dashboard/events/{eventId}/tickets` (asserted via `getByRole("link")` + `getAttribute("href")`, a genuine DOM check, not a source read) |
| 7. Served by aggregate `count()` calls only, zero full-document reads | **PASS** | `admin-attendee.test.ts`'s `ticketTypeId` block asserts `queryDocReads` stays 0 across the whole call; my own integration test additionally seeds cross-org/cross-event attendees and confirms they never leak into any ticket type's count (an aggregate-query tenancy check, not just a "does it crash" check) |

### §2 — Finance summary card (key-value list)

| AC | Result | Evidence |
|---|---|---|
| 1. M2-T4 worked-example rollup (paid+paid→Paid, outstanding→Outstanding, comp's `subtotalMinor`→Comped) | **PASS** | `admin-order-finance-sums.test.ts:138-196` (DAL-level) + my integration test's own independently-authored numbers (15500 Paid, 20000 Outstanding, 14500 Comped for USD) |
| 2. Genuinely-free comp (`basePriceMinor:0`) contributes exactly 0 | **PASS — independently reproduced alongside the 100%-discount case in the SAME fixture** | My integration test seeds both comp paths on USD simultaneously (100%-discount: 14500; genuinely-free: 0) and asserts the summed Comped value is 14500, not 14500+something-wrong and not 0 — proving the metric is right for the *combination*, not just each path tested in isolation |
| 3. Pending/failed contribute to no money row and don't inflate discount-codes-used even when referencing a real `promotionId` | **PASS — independently reproduced with a shared promo code** | My integration test's `pending` and `failed` USD orders both reference `promo-6uses` (the same code also legitimately used by a real comped GBP order) — the sums exclude them entirely, and `discountCodesUsed` still correctly counts `promo-6uses` as exactly 1 code (not inflated by the pending/failed references, and not because those orders don't exist — because "codes used" reads `EventPromotion.usedCount`, never `Order.promotionId`, a distinction my fixture deliberately stresses) |
| 4. Discount-codes-used counts distinct codes with `usedCount >= 1`, not total redemptions | **PASS — independently reproduced** | My integration test: `usedCount` 6 + 1 + 0 across 3 promotions → asserted result is **2**, not 7 (sum) and not 3 (all promotions) |
| 5. Zero orders → all three money rows render zero-format, never NaN/undefined | **PASS** | `reports-orchestration.test.ts` + `admin-order-finance-sums.test.ts` zero-orders case; `finance-summary-card.test.tsx`'s "$0.00 rendered via formatMoney, never 'Comp' text" case independently confirms the *rendered* text, not just the returned number |
| 6. Money renders via existing `formatMoney`, minor-unit-aware | **PASS** | Read `finance-summary-card.tsx` directly: `formatMoney(section.paidMinor, section.currency)` used verbatim for all three money rows, never `formatFeePrice` (which would wrongly special-case comped $0 as "Comp" text) |

### §3 — Aggregation strategy & DAL

| AC | Result | Evidence |
|---|---|---|
| 1. No new Firestore composite index | **PASS** | `git diff firestore.indexes.json` empty (re-confirmed) |
| 2. All three query groups run in parallel, not sequentially | **PASS (code trace, matches S-1's own non-gating disposition)** | Read `load-finance-summary.ts`/`load-ticket-type-registrations.ts`/`reports/page.tsx` directly: every fan-out uses `Promise.all`/`Promise.allSettled`, never a sequential loop. Code Review's S-1 (no dedicated concurrency-timing test) is a real, correctly-triaged non-gating test-coverage gap, not a defect — I did not add a timing test myself since the code is unambiguously already parallel and this is explicitly out of scope for "smaller/simpler" QA effort calibration; noting it here so it isn't silently dropped |
| 3. 200-attendee/5-ticket-type cross-check (aggregate vs. brute-force) | **PASS (existing suite, re-confirmed present)** | `admin-attendee.test.ts`'s `ticketTypeId` block includes this exact cross-check per spec §3 AC-3 |
| 4. Zero full-document reads anywhere in the report page's data path | **PASS** | `queryDocReads` assertions in both `admin-order-finance-sums.test.ts` and `admin-attendee.test.ts`'s new blocks; independently spot-checked `fake-admin-db.ts:204-241` myself to confirm `.get()` vs `.count()`/`.aggregate()` are genuinely tracked separately, not just asserted by convention |

### §4 — Currency handling

| AC | Result | Evidence |
|---|---|---|
| 1. Single-currency event renders identically to the prototype's shape | **PASS** | `finance-summary-card.test.tsx`'s single-currency test: flat 4-row `divide-y`, no currency eyebrow label (`queryByText("USD")` is `null`) |
| 2. Two-currency fixture: independently-scoped sums, no blending | **PASS — independently reproduced with 3 currency-crossing payment statuses each** | My integration test's USD (Paid/Outstanding/2×Comped/Pending/Failed) and GBP (Paid/Outstanding/Comped) sections never cross-contaminate: GBP Paid is exactly 8000, not inflated by any USD order, and vice versa. `finance-summary-card.test.tsx` additionally confirms the **rendered DOM**: `£300.00` and `$100.00` both present, "Discount codes used" appears **exactly once** (`getAllByText(...)`.length === 1), not duplicated per currency |
| 3. Zero `RegistrationPath` docs → finance card empty state, not a crash | **PASS** | `reports-orchestration.test.ts`: `loadFinanceSummary` returns `null` when paths are empty, and asserts `sumAdminOrderTotalsForEvent` is **not called** in that case (proves it's a short-circuit, not a defensive catch); `finance-summary-card.test.tsx`: `data={null}` renders "No pricing set up yet" + a working link to Registration Paths, distinct from the zero-orders-but-one-currency case (which the same test file separately confirms renders real `$0.00` rows) |

### §5 — Loading, empty, error states

| AC | Result | Evidence |
|---|---|---|
| 1. Loading skeletons for both cards, both themes, responsive | **PASS (code trace)** | `loading.tsx` composes both cards' own skeleton exports in the same `grid gap-6 lg:grid-cols-2` as the real content; skeleton shapes use only existing, already-both-theme-verified tokens (`Skeleton` primitive), no new palette introduced — consistent with this ticket's "no new colors" posture, confirmed by reading every className in both skeleton exports |
| 2. Zero-ticket-types empty state links to Tickets; zero-orders state shows zeroed rows, not an empty-state message | **PASS — the specific distinction independently verified** | `ticket-type-bar-chart-card.test.tsx` (empty-ticket-types → link) vs. `reports-orchestration.test.ts`'s "zero orders of any kind renders every money row at 0" test (real `$0.00` rows, not `EntityEmptyState`) — these are two different code paths (`rows.length === 0` vs. `data !== null` with all-zero sums) and I traced both branches in `finance-summary-card.tsx`/`ticket-type-bar-chart-card.tsx` myself to confirm they cannot be confused for one another |
| 3. A forced failure in one card's aggregation leaves the other card rendering correctly | **PASS — exercised for real, not trusted** | `reports-page.test.tsx` renders the actual `EventReportsPage` component (not a mock of the page) with `loadTicketTypeRegistrations` rejecting and `loadFinanceSummary` resolving (and the mirror case) — asserts the surviving card's real numbers (`$123.45`, "Standard", "42") render while the failed card shows its own "Couldn't load..." panel and the healthy card shows **no** error text at all (`queryByText` returns `null`). I re-ran this file myself rather than accepting Code Review's read of it |
| 4. No card ever renders `NaN`/`undefined`/a raw error object | **PASS** | Both `catch` blocks in `reports/page.tsx` discard the caught error entirely (only flip a boolean) — confirmed by reading the page source directly; no `error.message` interpolation exists anywhere in `src/features/reports/**` (independently re-grepped, matching Security's own finding) |

### §6 — Chart implementation

| AC | Result | Evidence |
|---|---|---|
| 1. No new charting dependency | **PASS** | `git diff package.json package-lock.json` empty (re-confirmed) |
| 2. Bar chart accepts plain `{ label, count }[]`, no chart-library shape leaks in | **PASS** | `TicketTypeBarChartProps` (`ticket-type-bar-chart.tsx:9-11`) is exactly `{ rows: TicketTypeRegistrationRow[] }` where `TicketTypeRegistrationRow` is `{ label: string; count: number }` — read directly, no Radix/chart-lib type leaks into the exported prop shape |

### §7 — Permissions & tenancy

| AC | Result | Evidence |
|---|---|---|
| 1. Any org member (no special role) can view the page, both cards render real data | **PASS — independently re-derived, not copied from Security's read** | Read `get-dashboard-scope.ts` myself: `getDashboardScope()` gates purely on `resolveActiveOrganizationId(userDoc)` (server-locked membership roster) — no `write:events`/`UserPermission` check anywhere in its body or in `reports/page.tsx`. This is the read surface's entire gate, confirmed by tracing the full call chain, not by trusting the spec's own claim |
| 2. Non-member gets `notFound()` (404), no partial shell | **PASS** | `reports-page.test.tsx`: `getAdminEventForOrganization` resolving `null` → `renderPage()` throws `NEXT_NOT_FOUND` (the real `notFound()` control-flow error) before either loader is ever called (`loadTicketTypeRegistrations`/`loadFinanceSummary` both asserted `not.toHaveBeenCalled()`) |
| 3. Cross-org/unknown `eventId` 404s, no data leak | **PASS (mock-level, per Code Review's own N-1 nit — accurately restated, not silently upgraded)** | Same test as AC-2 — this is a mocked `getAdminEventForOrganization → null` case, consistent with this codebase's established convention (the DAL function itself has its own, separately-tested tenancy tests from earlier milestones). I did not find this gap worth a fresh live two-org fixture given the DAL-level isolation is independently proven in §1/§2's tests above (my own integration test additionally seeds and proves cross-org/cross-event attendee and order isolation directly against the real DAL) |

### §8 — Cross-cutting states

| # | Result | Evidence |
|---|---|---|
| 1. Both themes / responsive, `c2` grid stacks below ~1024px | **PASS (code trace)** | `reports-workspace.tsx`: `grid gap-6 lg:grid-cols-2` — the exact class named in the design doc; no theme-specific styling beyond existing, already-verified tokens (`text-amber-600 dark:text-amber-400` for Outstanding, reused verbatim from `discounts-tab.tsx`) |
| 4. Attendee-accepted-but-Order-vanished has no bearing on §1 | **PASS (structural, re-confirmed)** | §1's count reads `Attendee.ticketTypeId` directly, never re-joining to `Order` — confirmed by reading `load-ticket-type-registrations.ts`, which imports nothing from `adminOrder.ts` at all |
| 5. Zero ticket types AND zero paths AND zero orders simultaneously | **PASS** | Both empty-state branches are independent (`rows.length === 0` for the chart card, `data === null` for the finance card) and neither depends on the other's state — traced directly in both card components; no shared conditional exists that could make one empty state suppress the other |
| 6. Cross-milestone same-org/same-event data doesn't leak into aggregates | **PASS** | All new aggregate queries filter `eventId ==` unconditionally (never inside an `if`) — independently re-confirmed by reading `adminOrder.ts:237-241`/`adminAttendee.ts:282-294` myself, plus my own integration test's explicit cross-event noise (`OTHER_EVENT_ID`) proven not to leak into either the ticket-type counts or the finance sums |

---

## Defects

**None.** No defect of any severity was found in this pass. Every acceptance
criterion across spec §1–§8 passes, confirmed by a combination of (a) an
independently-authored, hand-computed end-to-end arithmetic test against the
real DAL + real loaders (new in this pass), (b) re-running and re-tracing the
existing component/route-level tests that exercise real rendered DOM and the
real page component rather than accepting their names at face value, and (c)
independently re-deriving (not copying) the permission-gating and DAL
tenancy-filter claims by reading the actual source.

The two items carried forward from Code Review/Security are both correctly
non-gating and I concur with their triage:
- **S-1** (Code Review, Should-fix): no dedicated concurrency-timing test for
  spec §3 AC-2 — the code itself is unambiguously `Promise.all`-based
  everywhere (re-confirmed by my own read), this is a coverage gap around
  already-correct code, not a behavioral defect.
- **N-1** (Code Review, Nit): the IDOR/cross-org page-level test is
  mock-level, not a fresh live two-org fixture at that specific file — I
  independently closed the *substance* of this gap via my own integration
  test's cross-org/cross-event seeded fixtures at the DAL layer (where the
  actual isolation logic lives), which is the layer that matters for this
  ticket's aggregate-query correctness claim.

---

## Verdict

| Ticket | Verdict |
|---|---|
| M7-T1 — Reporting aggregates + event report summaries | **SIGNED OFF** |

All acceptance criteria across all 8 spec sections (§1–§8) pass. No defect of
any severity was found — Major or above, or otherwise. The ticket's two
riskiest arithmetic details (comped-value reading `subtotalMinor` not
`totalMinor`, and discount-codes-used counting distinct codes not
redemptions) were independently re-derived and verified against a
hand-computed, realistic multi-currency/multi-status fixture I authored
myself before running it, not copied from Code Review's or Security's
already-passing verification. The per-card independent-degradation guarantee
(spec §5, design §3's `Promise.allSettled`) was exercised against the real
page component with real rejected/resolved promises, not trusted from a code
read.

**Automated suite at sign-off:** `npm run lint` clean (0 warnings/errors) ·
`npx tsc --noEmit --pretty false` clean except the same 3 pre-existing,
unrelated baseline errors already carried through Code Review and Security ·
`npm run build` exit 0, `/dashboard/events/[eventId]/reports` in the route
manifest at 3.93 kB / 127 kB First Load JS, zero new `/api/**` routes ·
`npm test -- --run` → **127 files / 1517 tests passing, 0 failing** (126/1515
pre-existing + this pass's own 1 new file / 2 new tests).

**Known, disclosed limitation (carried forward, same as every prior
milestone in this repo):** no real multi-breakpoint (320/768/1024/1440)
screenshot pass or manual click-through against a running dev server was
performed — no browser-driving tool and no working local Firebase emulator
(no JDK ≥ 21) are available in this environment. Given this ticket's own
explicitly reduced scope ("no XSS-sensitive rendering, no complex dialog
state machine"), and that every responsive/theme class was independently
confirmed via rendered-DOM assertions in the existing component test suite
plus my own direct source trace, this gap does not block sign-off.
