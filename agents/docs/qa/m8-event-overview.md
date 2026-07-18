# QA Report — M8-T3 Event overview parity

QA Agent, 2026-07-19. Authoritative spec: `agents/docs/specs/m8-event-overview.md`; design contract: `agents/docs/design/m8-event-overview.md`. Code Review was consumed as APPROVED-after-fixes and Security as PASS. This pass built on those gates and targeted acceptance behavior, the review's two skipped truth-table Nits, real-loader fixtures, tenancy, and regression safety.

## Verdict

| Ticket | Verdict |
|---|---|
| M8-T3 — Event overview parity | **SIGNED OFF** |

All eight outcome ACs and all fourteen Spec §13 test requirements are traceable. The full suite is green. No defects were found.

## Command results

| Check | Result |
|---|---|
| New focused QA suite | PASS — 1 file / 7 tests |
| `npm run lint` | PASS — no warnings or errors |
| `npx tsc --noEmit --pretty false` | Expected non-zero — exactly **7 baseline diagnostics**: `attendees-roster.test.ts` (3), `event-org-scoping.test.ts` (3), `register-route.test.ts` (1); **0 QA/M8-T3 diagnostics** |
| `npm test -- --run` | PASS — **175 files / 1,950 tests**, 0 failed, 0 todo |
| Delta from supplied baseline 174 / 1,943 | **+1 file / +7 tests**, exactly this QA pass |

## Outcome AC traceability (§1)

| AC | Result and evidence |
|---|---|
| 1. Four ordered, truthful, independently degraded metrics | PASS — `m8-event-overview-component.test.tsx`: “renders four stat values in order…” and “renders revenue unconfigured and every stat-card error independently”; `m8-event-overview-loader.test.ts`: “degrades each failed section…”; new real-loader happy-path test asserts exact 2 Registered, 1 Invited, USD 12,345 minor, SGD 67,890 minor, and 1 Abandoned. |
| 2. Five Quick actions and exact routes | PASS — `m8-event-overview-page.test.tsx`: “retains the five Quick-action hrefs.” |
| 3. Five honest identity rows/fallbacks | PASS — `m8-event-overview-component.test.tsx`: “renders all five real identity rows and path degradation”; loader TRUE/FALSE tests cover configured and zero-path states. Stable method derivation for all combinations is fixed at `event-overview-loader.ts:24,190-199`; no Stripe/search-listing field or copy is introduced. |
| 4. Fixed six server-derived readiness concepts | PASS — loader TRUE/FALSE/unknown tests plus component six-row test; new real-DAL tests pin archived/dangling Fee rejection and each payment-method confirmation mix. |
| 5. Preview and status mutation behavior | PASS — `event-status-actions.test.tsx` covers labels, inverse POST, disabled saving, success/toast/refresh, failure/state retention, and no duplicate public link. Preview target/new-tab/safe rel and adjacent slot are structurally fixed at `event-bar.tsx:120-132`. |
| 6. Canonical event/org scope and honest failures | PASS — new two-org real-loader fixture proves foreign attendee, invitation, order, and abandoned draft cannot affect values; `m8-event-overview-dal.test.ts` covers event+org draft and check-in isolation; loader degradation tests prove failures do not become zero. Security already traced every reused DAL predicate. |
| 7. Ordinary zero and currency-safe money | PASS — component test asserts `0`, unconfigured Revenue, alphabetical stacked currencies; new real-loader render asserts SGD 678.90 and USD 123.45 remain separate and a foreign USD 5,000.00 is not blended. |
| 8. Viewer parity without mutation control | PASS — `m8-event-overview-page.test.tsx`: “omits the status action for viewers” proves server-side omission while overview remains route data; Security independently confirmed the unchanged POST route's `write:events` gate. Preview is unconditional in `event-bar.tsx:120-130`. |

## Spec §13 test/QA matrix

| # | Trace |
|---|---|
| 1 | Accepted/cancelled and successful zero: new real-loader fixture plus loader FALSE/zero test. |
| 2 | Sent invitation versus queued/unrelated kind: new real-loader fixture. |
| 3 | Paid/non-paid, two-currency separation: new real-loader fixture; loader currency fan-out failure test. Existing order DAL suites cover all remaining payment statuses. |
| 4 | Exact 24h versus 24h+1ms and deleted completion: `m8-event-overview-dal.test.ts`: “uses the strict 24-hour boundary and excludes completed/deleted drafts.” Not duplicated. |
| 5 | Zero/active/inactive counts and method combinations: loader zero/configured tests, new card/invoice/mixed/zero-active-path matrix, and stable `card, invoice, comp, none` projection at `event-overview-loader.ts:24,190-199`. |
| 6 | Every readiness row true/false/unknown; fixed `/ 6`; modes: loader TRUE, FALSE, degradation, and default/redirect tests plus component six-row summary test. |
| 7 | Custom-only page requirement: loader “marks custom-page readiness done…for default/redirect modes.” |
| 8 | Ticket plus active Fee referencing returned ticket: loader TRUE/FALSE tests and new “rejects archived and dangling Fee references…” real-DAL regression. |
| 9 | Virtual defaults, disabled overrides, method-required kinds: loader TRUE/FALSE tests exercise defaults/disabled results; new real-DAL `it.each` covers card-only, invoice-only, mixed, and zero-active-paths with a TRUE and FALSE outcome for each mix. |
| 10 | Check-in absent/saved/foreign: all three cases in `m8-event-overview-dal.test.ts`. |
| 11 | Publish lifecycle and duplicate Preview: all three `event-status-actions.test.tsx` tests; API permission denial remains covered by the existing route/IAM suite and Security's direct route verification. |
| 12 | Independent aggregate failures and event-not-found read avoidance: loader degradation/fan-out tests; page wiring and pre-existing canonical event-resolution path at `page.tsx:17-24`. |
| 13 | Tenant isolation across sections: new real-loader two-org fixture for every data-bearing metric/identity path and confirmation inputs; DAL tests cover check-in. Fixed event-derived identity/readiness values come only from the already organization-owned event. |
| 14 | Responsive/theme behavior: structurally traced to semantic tokens and `sm`/`xl` grids in overview components and `loading.tsx:7-15`; browser pixel/overflow checks remain environment-limited below. |

## Regression tests added

`src/__tests__/m8-event-overview-qa-integration.test.tsx` — **7 tests**:

1. Seeded real DAL → real loader → real overview render with hand-computed multi-currency metrics and two-org exclusion.
2. Archived Fee plus active dangling Fee cannot satisfy ticket/pricing readiness.
3. Card-only requires `confirmation-paid`, with passing and disabled/failing fixtures.
4. Invoice-only requires `confirmation-payment-due`, with passing and disabled/failing fixtures.
5. Mixed card/invoice requires both confirmation kinds, with passing and failing fixtures.
6. Zero active paths requires both confirmation kinds, with passing and failing fixtures.
7. A Pricing event screen renders through `EventShell` with no `statusAction`, retaining Preview and body content.

No existing test or application file was modified.

## Defects

**None found at any severity.** The investigated items were regression-coverage gaps and are now green. No `it.todo` pin was necessary.

## Verified versus not verifiable

Verified executable behavior: actual overview loader with actual DAL modules against seeded in-memory Firestore; exact metric definitions and formatted render values; two-currency non-combination; two-org isolation; archived/dangling Fee truth; all requested confirmation payment mixes with positive and negative outcomes; fixed readiness states; redirect diagnostics with and without URL; viewer server-side status-action omission; another event screen without the additive slot; abandoned boundary traceability; lint, TypeScript baseline, and full regression suite.

Not verifiable in this environment:

- Browser pixel parity, light/dark visual contrast, focus appearance, and no-overflow behavior at 320/768/1024/1440 were structurally inspected, not screenshot-tested.
- No live Firebase emulator or production Firestore/index run; DAL behavior was exercised with the repository-style in-memory Admin Firestore surface.
- No live Auth session, organization switch, or network-level permission-denial exercise; server omission and the route authorization boundary were covered by automated unit/integration tests and the Security gate.

## Final sign-off

**SIGNED OFF.** All numbered acceptance criteria are traced, the review's skipped truth-table cases are now pinned by real-loader/DAL tests, no defect was found, lint is clean, TypeScript contains only the seven disclosed baseline diagnostics, and the full suite passes at 175 files / 1,950 tests.

## Report-file confirmation

This report is `agents/docs/qa/m8-event-overview.md`. QA modified only this report and the new permitted `src/__tests__/m8-event-overview-qa-integration.test.tsx` file.
