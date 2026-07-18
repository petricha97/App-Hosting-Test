# QA Report — M8-T2 Workspace dashboard real metrics

QA Agent, 2026-07-19. Authoritative spec: `agents/docs/specs/m8-dashboard-metrics.md`. Code Review status consumed: APPROVED-after-fixes (0 Blockers; all 5 Should-fix items verified fixed). Security status consumed: PASS (0 findings). This pass did not repeat those gates; it tested the acceptance behavior and closed genuine regression-coverage gaps.

## Verdict

| Ticket | Verdict |
|---|---|
| M8-T2 — Workspace dashboard real metrics | **SIGNED OFF** |

All numbered acceptance criteria in spec §§1–8 are traceable to an automated test or, where browser/emulator behavior cannot be executed in this environment, to an explicit structural source check. The full suite is green. No defects were found.

## Method and command results

| Check | Result |
|---|---|
| Focused new QA suite | PASS — 1 file / 5 tests |
| `npm run lint` | PASS — no warnings or errors |
| `npx tsc --noEmit --pretty false` | Expected non-zero — exactly **7 pre-existing baseline errors**: 3 in `attendees-roster.test.ts`, 3 in `event-org-scoping.test.ts`, 1 in `register-route.test.ts`; **0 new errors** |
| `npm test -- --run` | PASS — **169 files / 1922 tests**, 0 failing, 0 todo |
| Delta from supplied baseline (168 / 1917) | **+1 file / +5 tests**, exactly this QA pass |

## AC traceability

### §1 — Stat cards

| AC | Result | Evidence |
|---|---|---|
| 1. 3-event fixture renders Draft 02 / Published 01 in required card set/order | PASS | `m8-dashboard-overview-component.test.tsx` — “renders the four prototype cards in order with real values”; `m8-dashboard-orchestration.test.ts` — “returns the exact single-currency UI contract shape” |
| 2. 40 accepted attendees across events renders Registrations 40 | PASS | Same two tests above; DAL scope is independently pinned by `m8-dashboard-dal.test.ts` — “cross-checks 200 accepted attendees across six events without leakage” |
| 3. Non-accepted records contribute zero | PASS | `m8-dashboard-dal.test.ts` 200-attendee cross-check includes a cancelled attendee; FormData is never queried by `countAdminAttendeesForOrganization`, structurally confirmed in `adminAttendee.ts` |
| 4. Paid USD orders sum org-wide and format correctly | PASS | `m8-dashboard-dal.test.ts` — “sums paid orders across events without cross-tenant or non-paid leakage”; new `m8-dashboard-qa-integration.test.tsx` — “renders hand-computed metrics from seeded two-event Firestore fixtures” asserts $1,000.00 from 12,345 + 87,655 minor units |
| 5. pending/failed/outstanding/comped excluded | PASS | `m8-dashboard-dal.test.ts` paid-order sum test seeds and excludes all four statuses; new page integration also excludes a pending order |
| 6. Brand-new/zero state renders 00, 00, 0, $0 | PASS | `m8-dashboard-overview-component.test.tsx` — “renders zero-padded event counts but plain registrations and zero-currency revenue”; zero-event CTA coverage in the same file |
| 7. No raw error, NaN, undefined, or TBD | PASS | Component tests cover every revenue/error shape and explicitly exclude `TBD`; error values are closed discriminated unions rendered as `—`/“Couldn't load,” not exception text |

### §2 — Quick actions

| AC | Result | Evidence |
|---|---|---|
| 1. Two events target first (most-recently-updated) event | PASS | `m8-dashboard-overview-component.test.tsx` — “renders event-scoped quick actions for the selected event”; new QA test — “targets the sole event at one event and the first sorted result at multiple events” |
| 2. Five links target shipped routes | PASS | Component test asserts all five exact hrefs; route existence is structurally pinned by `src/features/event/event-nav.ts` and the existing app route tree. No live HTTP/dev-server smoke test was available (limitation disclosed below). |
| 3. Zero events renders exactly one create CTA | PASS | `m8-dashboard-overview-component.test.tsx` — “collapses quick actions to one create CTA when there are zero events” |
| 4. Viewer can reach targets; no page-level write gate | PASS | Structural regression check: `page.tsx` calls membership-only `getDashboardScope`; quick actions contain no permission branch. Existing M8-T1 route/page permission suites remain green. Browser click-through was not available. |

### §3 — Setup notes

| AC | Result | Evidence |
|---|---|---|
| 1. Copy is byte-identical across zero/high-data states | PASS | `m8-dashboard-overview-component.test.tsx` — “renders byte-identical static non-linked setup notes copy” |
| 2. No link inside card | PASS | Same test scopes `queryByRole("link")` to the Setup notes card |
| 3. Copy covers M1–M7 feature set | PASS | Same test asserts ticket types, pricing/discounts, registration paths, lifecycle emails, check-in/QR, and reports |

### §4 — Aggregation strategy / DAL

| AC | Result | Evidence |
|---|---|---|
| 1. Index requirement empirically documented | PASS | `agents/docs/data-models/m8-dashboard-metrics.md` records the implementation check; Code Review and Security already verified the equality-only query shapes. QA did not rerun a live emulator. |
| 2. 200-attendee aggregate equals brute-force reduction | PASS | `m8-dashboard-dal.test.ts` — “cross-checks 200 accepted attendees across six events without leakage” |
| 3. No full-document Attendee/Order reads | PASS | DAL tests assert `fake.queryDocReads === 0` for count and sum aggregate paths |
| 4. Two-org aggregate isolation | PASS | DAL attendee and order tests seed Org B records and assert Org A totals exclude them |

### §5 — Currency handling

| AC | Result | Evidence |
|---|---|---|
| 1. Single currency produces one formatted headline | PASS | Orchestration single-currency test + overview revenue-shapes test + new real-DAL page happy path |
| 2. Multi-currency primary chosen by path count; totals not blended | PASS | `m8-dashboard-orchestration.test.ts` primary/tie tests; overview test asserts primary headline and secondary currency treatment, and explicitly rejects a blended value |
| 3. No paths produces literal `$0` | PASS | Orchestration zero-currency test and overview zero-state test |
| Paid order in currency with no path (requested edge) | PASS | New QA test — “excludes a paid order whose currency has no registration path.” Per D5, currencies are enumerated exclusively from RegistrationPath docs, so an orphan-currency order is not included or fabricated into the tile. |

### §6 — Loading, empty, error states

| AC | Result | Evidence |
|---|---|---|
| 1. Four stat skeletons plus two lower card shells; theme/responsive classes | PASS with visual limitation | `loading.tsx` structurally renders 4 `WorkspaceStatCardSkeleton`s, Quick actions and Setup notes shells, semantic theme tokens, and `sm`/`xl` grid breakpoints. No pixel/browser verification. |
| 2. Independent registration/revenue failures | PASS | Orchestration tests cover each failure independently; overview tests assert unaffected revenue and local registration error; new QA test pins **both failures together** while counts, quick actions, and setup notes remain rendered |
| 3. Initial event/scope failure uses whole-page error; redirect preserved | PASS | `m8-dashboard-page.test.tsx` — event-list failure renders `WorkspaceLoadError`; scope redirect is rethrown and neither event loader nor summary loader runs |
| 4. Forbidden raw values never render | PASS | Same evidence as §1 AC-7 across success, zero, single/multi-currency, and both local error states |

### §7 — Permissions and tenancy

| AC | Result | Evidence |
|---|---|---|
| 1. All member roles see identical content | PASS (structural + prior IAM regression) | No role/permission prop or branch exists in page/overview. Existing M8-T1 role suites pass in the full run. |
| 2. Non-member redirects before loader | PASS | `m8-dashboard-page.test.tsx` — “rethrows the original dashboard-scope redirect” asserts event and summary loaders are never called |
| 3. Aggregate calls use only roster-derived `scope.organizationId` | PASS | Page wiring test asserts `org-1`; new real-DAL page test asserts `org-qa`; no client organization-id input exists |

### §8 — Cross-cutting edge cases

| AC | Result | Evidence |
|---|---|---|
| 1. Theme/responsive at named widths | Structurally traceable; not pixel-verified | Semantic Tailwind tokens and responsive grid classes in overview, stat/error, and loading components; no browser viewport run available |
| 2. `formatMoney` reused; integer minor units throughout | PASS | Overview imports the existing pricing formatter; new seeded page test hand-checks exact integer sum/format result; no float aggregation path exists |
| 3. Events with no paths/fees → real counts, 0, $0 | PASS | New QA test — “renders real non-zero event counts with zero registrations, paths, and orders” |
| 4. Draft-only org → Published 00; actions target draft | PASS | Same new QA test asserts Published 00 and the sole Draft event link |
| 5. Overlapping two-org tenancy | PASS at aggregate/page trust boundary | DAL isolation tests seed both orgs; page test proves scope-derived org id is the only id forwarded. Actual org-switcher/browser transition was not available. |
| 6. Viewer sees all, mutates nothing here | PASS (structural + prior IAM regression) | Read-only dashboard has no mutation control or role branch; existing M8-T1 permission suites remain green |

## Regression tests added this pass

- `src/__tests__/m8-dashboard-qa-integration.test.tsx` — **5 tests**:
  1. Two-event seeded fake-Firestore → real DAL → real orchestrator → real page render, with exact hand-computed values.
  2. One Draft event with zero registrations/paths/orders.
  3. Paid order in a currency absent from RegistrationPath enumeration.
  4. Exactly-one versus multiple-event quick-action selection.
  5. Both independent aggregate failures while unaffected UI remains usable.

No existing test or application file was modified.

## Defects

**None found at any severity.** All investigated gaps were regression-coverage gaps; the implementation behaved correctly. No `it.todo` defect pins were necessary.

## Verified versus not verifiable

Verified with executable tests: real fake-Firestore aggregate behavior, org isolation, no full-document aggregate reads, orchestration settlement, exact page-rendered values, money formatting, single/multi/zero currency behavior, zero/draft-only states, quick-action selection/hrefs, independent and simultaneous card failures, whole-page error behavior, redirect-before-loader behavior, and the complete repository regression suite.

Not verifiable in this environment:

- No live Firebase emulator/service run, so production index acceptance and SDK/network behavior were not independently re-executed by QA; the implementation data-model report and earlier gates cover that evidence.
- No dev server/in-app browser screenshots, so route navigation, 404 smoke behavior, focus interaction, light/dark pixels, and responsive layouts at 320/768/1024/1440 were structurally inspected rather than visually exercised.
- No real Auth/org-switcher browser session; tenancy at page level was tested through the roster-derived scope boundary and real fake-Firestore DAL, not a live identity transition.

## Final sign-off

**SIGNED OFF.** Every numbered AC in §§1–8 is traceable, all genuine executable coverage gaps identified by this pass were closed with 5 green regression tests, no defect was found, lint is clean, TypeScript has only the 7 disclosed baseline errors, and the full suite passes at 169 files / 1922 tests.
