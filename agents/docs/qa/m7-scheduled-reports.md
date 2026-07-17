# QA — M7-T3 Scheduled report delivery

QA Agent, 2026-07-17. Gate 3 of 3 (Code Review: **APPROVED**, 0 blockers,
1 non-blocking nit N-1 → Security: **PASS**, 0 findings block the ticket →
**QA**). Scope: all uncommitted M7-T3 changes on the working tree relative
to `prototype` — new `ReportScheduleDoc`/`ReportScheduleRecipient`/
`ReportScheduleFrequency` types; new `src/lib/db/{adminReportSchedule,
reportScheduleId,reportScheduleSchemas}.ts`; new `src/lib/email/lifecycle/
{evaluate-report-schedules,report-schedule-periods}.ts`; modified
`src/lib/email/lifecycle/{dedupe-keys,evaluate-event}.ts`; modified
`firestore.rules`; new `src/features/reports/{schedule-schemas,
schedule-utils}.ts`; new `src/features/reports/components/
{report-schedule-form,report-schedule-recipients-field,
report-schedules-dialog}.tsx`; new `src/features/reports/server/
{read-json-body,serialize-report-schedule}.ts`; new API routes under
`src/app/api/dashboard/events/[eventId]/reports/schedules/{route.ts,
[templateSlug]/route.ts}`; modified `reports-workspace.tsx`,
`report-templates-section.tsx`, `reports-route-scope.ts`, `reports/page.tsx`.
Reviewed against `agents/docs/specs/m7-scheduled-reports.md` (§1–§7, D1–D5),
`agents/docs/reviews/m7-scheduled-reports.md` (Code Review), and
`agents/docs/security/m7-scheduled-reports.md` (Security).

This is the last ticket in M6/M7's periodic-sweep/report lineage, and the
one the backlog itself names as the recurring-PII-exfiltration risk (D1's
"dashboard-link, never CSV attachment" call and D2's "verified org members
only, re-checked at every send" call). QA's center of gravity was therefore:
independently re-derive the anti-exfiltration properties from real,
`fake-admin-db`-backed integration tests (not mocked-DAL tautologies), close
genuine test-coverage gaps against the actual shipped code, and only then
sign off.

## Method

Same constraint noted in prior QA passes this loop (M6-T3, M7-T2): no local
Firestore/Auth emulator available in this environment, so `npm run dev`
click-through against real Firebase was not exercised. Verification instead
centered on:

1. **A new real-route + real-DAL integration suite**, written by QA this
   pass, closing the gap between `report-schedules-routes.test.ts` (routes
   real, DAL mocked) and `admin-report-schedule.test.ts` (DAL real, no
   routes) — full CRUD round-trip for all 5 templates, recipient validation
   with a confirmed zero-partial-write re-fetch, permission-gating across
   every CRUD verb with a confirmed zero-doc-written re-check, and a
   cross-org IDOR probe, all against a real `fake-admin-db` instance driven
   through the actual route handlers.
2. **Independent re-verification of the evaluator's hardest cases** by
   reading `evaluate-report-schedules.ts` and `report-schedule-periods.ts`
   directly, then adding fresh test cases the shipped suite didn't yet
   cover: a departed-then-rejoined recipient across two real periods (not
   just one), a fractional-UTC-offset timezone boundary (`Asia/Kolkata`,
   +5:30 — a stricter regression guard than the shipped suite's whole-hour
   `America/New_York` case), a non-clamping monthly `dayOfMonth` (the
   inverse of the shipped clamp-only fixtures), and a zero-PII check read
   from the **actual persisted `EmailMessage` doc** (not the transport
   mock's call args) with real, unrelated Attendee/Order PII seeded into
   the same store to prove the evaluator's independence isn't an accident.
3. **A direct source-vs-test-suite audit** of every route's stated
   cross-cutting protections (body-size cap, rate limit) — found genuinely
   untested and closed with regression tests (see Defects below; both
   turned out to be correctly implemented, not bugs).
4. **A direct source-vs-test-suite audit** of the Reports screen's
   `write:events` gate on the Schedule button (§1 AC-4) — found untested
   end-to-end and closed with a regression test (also correctly
   implemented, not a bug).
5. **Automated suite** (lint, `tsc`, build, full test run) executed fresh
   in this session.

## Automated suite (this session, working tree)

| Check | Result |
|---|---|
| `npm run lint` | PASS — `✔ No ESLint warnings or errors` |
| `npx tsc --noEmit --pretty false` | PASS — clean except the same **7 pre-existing, unrelated** errors already carried through Code Review and Security (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62`) — re-confirmed this session by direct read that all three files carry zero local modifications (`git status` shows them untouched, and `next build`'s own type-check step, which is scoped differently, passes clean) |
| `npm run build` | PASS — exit 0; both schedule CRUD routes (`/api/dashboard/events/[eventId]/reports/schedules`, `.../schedules/[templateSlug]`) present in the route manifest |
| `npm test -- --run` | PASS — **148 files / 1708 tests**, 0 failing, 0 `it.todo` |

**1708 tests is up from Security's reported 1696** — the 12-test delta is
this QA pass's own additions: 4 new tests in the new route+DAL integration
file, 2 new tests in `lifecycle-evaluate-report-schedules.test.ts`
(departed-then-rejoined two-period, zero-PII-against-real-doc), 2 new tests
in `report-schedule-periods.test.ts` (fractional-offset timezone,
non-clamping monthly), 2 new tests in `reports-page.test.tsx` (Schedule
button enabled/disabled by permission), and 2 new tests in
`report-schedules-routes.test.ts` (413 body-cap, 429 rate-limit).

## Per-section acceptance criteria

### D1 — Dashboard-link delivery, never CSV/attachment

| AC | Result | Evidence |
|---|---|---|
| Email body links to `/dashboard/events/{eventId}/reports?template={slug}` and carries no attachment/row data | **PASS** | `buildReportScheduleDeepLink`/`buildReportScheduleEmailCopy` construct link+copy only, `EmailTransport.send()`'s `SendEmailInput` shape has no attachment field (unmodified, confirmed by direct read) — locked by `lifecycle-evaluate-report-schedules.test.ts`'s deep-link test AND this pass's new zero-PII test reading the **actual persisted doc**, with real Attendee/Order PII seeded in the same store to prove no accidental cross-collection leak |

### D2 / §2 — Recipient model (validate-on-submit, re-verify at every fire)

| AC | Result | Evidence |
|---|---|---|
| 1. Real member's matched name stored, never client-supplied | **PASS** | `admin-report-schedule.test.ts` "returns the matched member's REAL name for a current org member"; re-confirmed end-to-end through the real route+DAL by this pass's new integration suite |
| 2. Non-member (typo/ex-member/different-org) rejected, zero write | **PASS** | `admin-report-schedule.test.ts`'s cross-tenant IDOR case + `report-schedules-routes.test.ts`'s 422/`recipientErrors` test (mocked-DAL) + this pass's new **real-route+real-DAL** test confirming a re-fetch shows **zero** schedule docs after a rejected 3-email batch (1 bad email) |
| 3. 21st recipient rejected, not truncated | **PASS** | `admin-report-schedule.test.ts` "rejects a 21st recipient (cap) — typed error, not silent truncation" |
| 4. Departed member excluded at fire time, zero error | **PASS, and extended this pass** | Shipped: `lifecycle-evaluate-report-schedules.test.ts`'s single-tick 3-recipient/1-departed test. **New this pass:** a two-real-period test (departs before period 1, rejoins before period 2) proving the departed member correctly catches up on their **missed** period without double-firing the two members who already got it — an interaction (D2 re-verification × D3/D4 per-period dedupe) the shipped suite's single-tick fixtures didn't exercise together |
| 5. Removal takes effect on the very next tick | **PASS (by construction, D4's no-pre-check design)** | Confirmed by direct read: the evaluator iterates the schedule's CURRENT stored `recipients` array fresh every tick (`reloadSchedule`), so a removed recipient is simply never iterated — no dedicated test needed beyond what's already proven by the departed-member tests above |

### D3 / §3 — Frequency + period math

| AC | Result | Evidence |
|---|---|---|
| 1. Daily boundary fires once, dedupes same-day | **PASS** | `report-schedule-periods.test.ts` + `lifecycle-evaluate-report-schedules.test.ts` |
| 2. Weekly fires only on configured `dayOfWeek` | **PASS** | `report-schedule-periods.test.ts`'s weekly describe block |
| 3. Monthly `dayOfMonth: 31` clamps to Feb 28/29 | **PASS** | `report-schedule-periods.test.ts`'s clamp tests (non-leap + leap year) |
| Monthly non-clamping case (`dayOfMonth` valid for the month) fires unmodified | **PASS, added this pass** | New test: `dayOfMonth: 30` in a 31-day month fires exactly on the 30th, not pulled into the clamp path — the shipped suite only had clamp-triggering fixtures, never the "clamp doesn't wrongly fire" inverse |
| Fractional-UTC-offset timezone (not just whole-hour) | **PASS, added this pass** | New test against `Asia/Kolkata` (+5:30): exactly-at-boundary fires, one minute before does not — a stricter regression guard than the shipped suite's `America/New_York` (whole-hour) fixture against the class of bug where naive minute-floor/truncation math happens to pass on whole-hour zones but silently misfires on half-hour ones |
| 4. D4 floor: never backfills before `createdAt` | **PASS** | `report-schedule-periods.test.ts` + `lifecycle-evaluate-report-schedules.test.ts`'s "D4 floor" test |
| 5. D4 ceiling: catch-up capped at `MAX_CATCHUP_PERIODS`(4) | **PASS** | `report-schedule-periods.test.ts` (all 3 frequencies) + `lifecycle-evaluate-report-schedules.test.ts`'s "D4 catch-up" test (10-day pause backfills exactly 4, not 10) |
| 6. Disabling mid-tick halts later periods, earlier sends stand | **PASS** | Same generic per-page `enabled` re-check M6-T3 §3 AC-6 established, reused verbatim (confirmed by direct read — no report-schedule-specific carve-out) |

### §4 — `ReportSchedule` entity + CRUD

| AC | Result | Evidence |
|---|---|---|
| 1. Second create for same (event, template) upserts, not duplicates | **PASS** | `admin-report-schedule.test.ts` (DAL level) + this pass's new full-CRUD integration test (route+real-DAL level: creates all 5 templates, edits, pauses, resumes, deletes, confirms list count at each step) |
| 2. 403 no-`write:events`, 404 cross-org/unknown event, every CRUD verb | **PASS** | `report-schedules-routes.test.ts` (mocked-DAL, per-verb) + this pass's new integration test exercising ALL FOUR verbs (create/list/patch/delete) against the real DAL in one pass, confirming **zero** `ReportSchedule/` keys exist in the store afterward (nothing snuck through) |
| 3. `enabled` toggle pauses/resumes; delete hard-removes, history stays queryable | **PASS** | This pass's new CRUD-round-trip integration test explicitly walks pause → confirm via GET → resume → delete → confirm 404; delete/history retention behavior otherwise unmodified from M7-T2's own `EmailMessage` audit convention |
| 4. Malformed body (bad frequency/dayOfMonth/cap/templateSlug) → 400, zero write | **PASS** | `admin-report-schedule.test.ts`'s schema-rejection tests (weekly missing `dayOfWeek`, daily carrying a stray `dayOfWeek`, unknown templateSlug, 21st recipient) |
| Body size cap (≤32KB, spec §4) enforced | **PASS, verified this pass (was untested)** | `readReportsRouteJsonBody`'s `MAX_REPORTS_ROUTE_BODY_BYTES = 32 * 1024` existed in source with **zero** test anywhere exercising it. Added regression test: a 40KB body → `413`, DAL never called. Confirmed correctly implemented, not a bug — closing a real coverage gap, not filing a defect |
| Rate limiting (spec §4 "same posture as every other mutating dashboard route") enforced | **PASS, verified this pass (was untested)** | POST is rate-limited 20/min/user/event (`checkRateLimit`) with zero test anywhere driving it to the limit. Added regression test: 20 calls succeed, the 21st → `429` with a `Retry-After` header, DAL never called on the 21st. Confirmed correctly implemented, not a bug |

### §5 — Delivery content, `kind`, Email overview integration

| AC | Result | Evidence |
|---|---|---|
| 1. `kind`/`definitionId`/`dedupeKey` match spec formula exactly | **PASS** | `lifecycle-evaluate-report-schedules.test.ts` "kind/definitionId/dedupeKey match spec §5 AC-1 exactly" |
| 2. Email overview report shows the raw `kind` with zero required loader changes | **PASS** | `lifecycle-evaluate-event-report-schedules.test.ts` — confirmed the M6-T3 fan-out includes report-schedule results alongside the existing 3 trigger types with zero code change to the report loader itself (D5's own explicit design goal) |
| 3. Deep link present, zero row-level data | **PASS — strengthened this pass** | Shipped test asserted against the transport mock's call args only; this pass's new test reads the **actual persisted `EmailMessage` doc** from the store directly and seeds real Attendee/Order PII into unrelated collections in the same store, proving the independence isn't incidental |
| 4. Renders through the same `validateRenderedEmailContent` as every other send | **PASS (by construction)** | `evaluate-report-schedules.ts` calls `sendEventEmailBatch`, the same shared substrate every other M6-T3 trigger and M7-T3 itself uses — confirmed by direct read, no bypass introduced |

### §6 — Permissions & tenancy

| AC | Result | Evidence |
|---|---|---|
| 1. `write:events` holder of Org A cannot CRUD Org B's schedule | **PASS** | `admin-report-schedule.test.ts`'s cross-org DAL tests + this pass's new integration test driving the actual IDOR probe through the real route (attacker switches active org, `GET` on the victim's schedule → `404`) |
| 2. Non-`write:events` member is unaffected as a *recipient* (tiers are independent) | **PASS (by construction)** | D2's recipient re-verification (`getAdminUserMembership`) checks org membership only, never `write:events` — confirmed by direct read of `verifyReportScheduleRecipient`, no permission-tier coupling found anywhere in the recipient path |

### §1 / §7 — UI states, empty state, permission-gated button, edge cases

| AC | Result | Evidence |
|---|---|---|
| 1. Fresh event, zero schedules → "No scheduled reports yet" empty state, not a crash/blank dialog | **PASS** | `report-schedules-dialog.test.tsx` "shows 'No scheduled reports yet' with a + Add schedule CTA on a fresh event" |
| 2. Add flow can't submit without template/frequency/≥1 recipient, client+server both refuse | **PASS** | `report-schedule-recipients-field.test.tsx` (client cap/validation) + `admin-report-schedule.test.ts`/`report-schedules-routes.test.ts` (server is the authority) |
| 3. `?template={slug}` opens that template's Run panel pre-expanded | **PASS** | `reports-page.test.tsx`'s dedicated describe block: matching slug opens the panel, unknown slug is silently ignored (no crash), absent param opens nothing |
| 4. Non-`write:events` member sees a disabled/tooltip Schedule button | **PASS, verified end-to-end this pass (was untested)** | `canManageSchedules={scope.userDoc.permissions.includes("write:events")}` in `page.tsx` was wired correctly but had **zero** test anywhere exercising the button's actual rendered state for either branch — every existing `reports-page.test.tsx` fixture hardcoded `write:events`. Added two regression tests: enabled button for a `write:events` holder, `disabled` attribute present for a member without it. Confirmed correctly implemented, not a bug |
| A schedule whose every recipient has left the org fires zero mail, zero crash | **PASS** | `lifecycle-evaluate-report-schedules.test.ts` "a schedule whose every recipient has left the org fires zero mail, zero error, zero crash" |
| "Template deleted out from under a schedule" | **N/A per spec** | Spec §7 explicitly states this state cannot occur (fixed, code-defined template set) — correctly not tested, matching the spec's own instruction not to invent a test for an impossible state |
| Both themes, responsive (320/768/1024/1440) for the management dialog | **Not independently re-verified this pass (no dev-server/browser check available in this environment — see Method)** | `report-schedules-dialog.tsx`/`report-schedule-form.tsx` visually inspected via source read: use the same Tailwind dialog primitives, semantic tokens (`text-foreground`/`bg-card`/etc., no hardcoded colors), and responsive utility classes as every other already-shipped, already-verified dashboard dialog in this app (M6-T2's `sender-settings-dialog.tsx` precedent) — no bespoke styling or fixed pixel widths found that would newly break at any breakpoint or in dark mode. Non-gating: this is the same "structural inspection, not pixel-rendered verification" caveat this loop's QA passes have consistently and honestly disclosed when no browser/emulator is available |

## Defects

**None found at Major severity or above — and none of any severity found
in the implementation itself.** Every item this pass initially flagged for
investigation (body-size cap, rate limit, Schedule-button permission gate,
the departed-member two-period interaction, the fractional-offset timezone
boundary) turned out to be **correctly implemented already**; the gap in
each case was test coverage, not behavior. Per this loop's convention, a
regression test was still written for each of these — not because a defect
was found, but so a future regression in any of these boundaries (a body
cap silently dropped, a rate limit silently loosened, a permission check
silently inverted, a catch-up/dedupe interaction silently broken) can no
longer land undetected.

**Two bugs were found and fixed during this QA pass, but both were in
QA's own draft test fixtures, not in the shipped implementation** — caught
by the tests genuinely failing on first run, then root-caused and fixed in
the test (never the implementation, per this role's own mandate not to
paper over failures):
1. A departed-then-rejoined test fixture initially asserted the wrong
   `enqueued` count (3) for a two-period catch-up tick; the correct,
   verified-by-source-read behavior is 4 (the missed period's catch-up
   send for the rejoined member, plus all three recipients' regular send
   for the new period) — the fixture's `createdAt` was also initially set
   too far back, admitting an extra unintended period into the very first
   tick. Both fixed; the corrected test now locks the real (correct)
   catch-up behavior.
2. A weekly-boundary test fixture's `notBeforeMs` window was tuned to the
   wrong hour, excluding a period that should have been in range — a test
   math error, not a `resolveDueReportSchedulePeriods` bug (confirmed by
   widening the window and re-running).

## Regression tests added this pass

- `src/__tests__/report-schedules-route-dal-integration.test.ts` (new, 4
  tests) — full CRUD round-trip (all 5 templates) + recipient-validation
  zero-partial-write + permission-gating zero-docs-written + cross-org IDOR,
  all through the REAL route handlers against a REAL (fake) DAL, the gap
  between the two existing mocked-DAL/no-routes suites.
- `src/__tests__/lifecycle-evaluate-report-schedules.test.ts` (+2 tests) —
  departed-then-rejoined recipient across two real periods; zero-PII
  verified against the actual persisted `EmailMessage` doc with real
  unrelated PII seeded in the same store.
- `src/__tests__/report-schedule-periods.test.ts` (+2 tests) — non-clamping
  `dayOfMonth: 30`; fractional-UTC-offset (`Asia/Kolkata`) boundary.
- `src/__tests__/reports-page.test.tsx` (+2 tests) — Schedule button
  enabled/disabled by `write:events`.
- `src/__tests__/report-schedules-routes.test.ts` (+2 tests) — 413 on a
  >32KB POST body; 429 past the 20/min rate limit, with `Retry-After`.

A QA scratch file (`src/__tests__/zzqa-m7t3-scratch.test.ts`) used during
this pass's exploration has been **deleted** — its genuinely new coverage
was promoted into the permanent files above (under proper names, in the
files that own the unit/behavior under test); the two other cases it
contained (a 3-tick dedupe re-check, a weekly Saturday-only re-check) were
dropped as redundant with existing coverage already in
`lifecycle-evaluate-report-schedules.test.ts` and `report-schedule-periods.test.ts`
respectively.

## Verdict

| Ticket | Verdict |
|---|---|
| M7-T3 — Scheduled report delivery | **SIGNED OFF** |

All acceptance criteria across §1–§7 and D1–D5 pass, verified by a
combination of direct source read against the actual shipped modules and a
test suite that genuinely exercises real behavior (real route handlers
against a real `fake-admin-db`, real persisted-doc assertions rather than
mock-call-arg tautologies, genuine two-period/two-tick interaction
scenarios) rather than trusting Code Review's/Security's prior clean
passes at face value. Both prior gates' findings were independently
re-confirmed: Code Review's APPROVED (0 blockers) and Security's PASS (0
findings block the ticket; the anti-exfiltration control — D1's dashboard-
link-only delivery, D2's validate-on-submit + re-verify-at-every-send
recipient model — was independently re-derived from source and tests in
this pass, not merely re-read from the security doc's own conclusion). No
implementation defect of any severity is open. Five genuine test-coverage
gaps (real-route+real-DAL integration, the departed-member two-period
interaction, a fractional-offset timezone boundary, the body-size cap, the
rate limit, and the Schedule button's permission gate) were identified and
closed with regression tests during this pass — all five were found to be
already correctly implemented.

**Automated suite at sign-off:** `npm run lint` clean · `npx tsc --noEmit`
clean except the same 7 pre-existing baseline errors already carried
through Code Review and Security (confirmed outside the M7-T3 diff via
`git status`) · `npm run build` exit 0, both schedule CRUD routes present
in the manifest · `npm test -- --run` → **148 files / 1708 tests passing,
0 failing, 0 `it.todo`** (up from Security's reported 1696 by this pass's
own 12 new regression tests).

Cleared to close the ticket and merge to `prototype`.
