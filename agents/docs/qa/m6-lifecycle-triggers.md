# QA — M6-T3 Lifecycle triggers & audience segmentation

QA Agent, 2026-07-16. Gate 3 of 3 (Code Review APPROVED → Security PASS,
1 Medium + 1 Low finding, both fixed in the working tree and independently
re-verified by the Orchestrator → **QA**). Scope: all uncommitted M6-T3
changes on the working tree relative to `prototype` — new
`src/lib/email/lifecycle/**` (13 files), new
`src/app/api/internal/email-triggers/evaluate/route.ts`, new
`src/features/emails/server/{fire-on-accept-email,fire-on-submit-email,
resolve-definition}.ts`, new
`src/app/api/dashboard/events/[eventId]/drafts/email-all/route.ts`, modified
`src/features/responses/on-submission-accepted.ts`, both on-submit routes
(`register/route.ts`, `registration/finalize/route.ts`), `src/lib/db/
{adminOrder,adminFormData,adminRegistrationDraft,adminEvent}.ts`,
`firestore.indexes.json`, `apphosting.yaml`,
`src/features/emails/components/trigger-cell.tsx`,
`src/features/attendees/components/abandoned-tab.tsx`,
`src/features/emails/default-definitions.ts`, `src/features/emails/utils.ts`,
and 16 new/modified test files. Reviewed against
`agents/docs/specs/m6-lifecycle-triggers.md` (authoritative acceptance
criteria, §1–§9), `agents/docs/reviews/m6-lifecycle-triggers.md` (Code
Review: APPROVED, no blockers), and `agents/docs/security/
m6-lifecycle-triggers.md` (Security: PASS — Finding 2/N-3 Medium and
Finding 5/L-3 Low, both since fixed in the working tree, confirmed below by
direct read, not trusted from the review docs alone).

This is the first unattended/automated email-sending logic in the app — a
dedupe bug here means either double-emailing real people or silently never
emailing them, so this pass traced every dedupeKey formula and every
enabled/failure-isolation boundary against real code and real (fake-DB,
not-mocked-DAL) tests, not just against Code Review/Security's prose claims.

## Method

Same constraint as the M6-T2 pass: no local Firestore/Auth emulator (JDK ≥
21 not present), `.env.local` points at a real Firebase project, so
`npm run dev` click-through was not a safe option. This ticket's own spec
explicitly has **no new UI** (§ Non-goals: "no new screens or UI
components" — only the trigger-cell tooltip removal and the pre-built
"Email all" button enable, both already covered by Full-Stack's own
interaction tests), so this pass's center of gravity is different from a
UI-heavy ticket: **direct source verification of every dedupeKey formula,
every `enabled` re-check site, and every failure-isolation boundary**,
cross-checked against the exhaustive existing test suite (all real
`fake-admin-db`-backed tests, not mocked-DAL tautologies), plus:

1. **Line-by-line trace of every §1–§9 acceptance criterion against the
   actual shipped module**, not against the Code Review/Security docs'
   summaries — `fire-on-submit-email.ts`, `fire-on-accept-email.ts`,
   `on-submission-accepted.ts`, `audience-queries.ts`,
   `paged-trigger-runner.ts`, `evaluate-abandoned.ts`,
   `evaluate-unpaid-offsets.ts`, `evaluate-scheduled.ts`,
   `evaluate-event.ts`, `run-sweep.ts`, `evaluator-auth.ts`,
   `dedupe-keys.ts`, `definition-enabled.ts`, `event-schedule.ts`, both
   on-submit route call sites, the "Email all" route, and the internal
   evaluator route were all read in full, not sampled.
2. **Independent re-verification that the two post-Security fixes are
   real, not just claimed** — read `evaluate/route.ts`'s rate-limit
   (`checkRateLimit`, 6/min, keyed `email-trigger-evaluate:global`) and
   tightened Zod ceilings (50/200/40, down from 200/500/200) directly in
   the source, and read `drafts/email-all/route.ts`'s pre-split
   `emailRecipientSchema` validation + count-only (no raw email) 400
   response directly in the source — both match what the security review's
   remediation asked for, confirmed by reading the code, not the review.
3. **Spot-audit of the existing test suite for tautology** — for every
   trigger type, opened the actual `.test.ts` file and confirmed each
   assertion drives real behavior through a real `fake-admin-db` instance
   (Firestore transaction semantics via `createAdminEmailMessageIfAbsent`
   genuinely run) rather than asserting a mock was "called with" an
   already-known value.
4. **Automated suite** run fresh in this session (not copied from Code
   Review/Security's reported numbers).

## Automated suite (this session, working tree)

| Check | Result |
|---|---|
| `npm run lint` | PASS — `✔ No ESLint warnings or errors` |
| `npx tsc --noEmit --pretty false` | PASS — clean except the same **7 pre-existing, unrelated** errors already carried through Code Review/Security (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62`) — confirmed by direct read these are all outside the M6-T3 diff (unrelated `Timestamp`/`Record<string,unknown>` narrowing issues in pre-existing fixtures) |
| `npm run build` | PASS — exit 0; `/api/internal/email-triggers/evaluate`, `/api/dashboard/events/[eventId]/drafts/email-all`, and `/dashboard/events/[eventId]/emails` all compile and appear in the route manifest |
| `npm test -- --run` | PASS — **109 files / 1317 tests passing**, 0 failing, 0 `it.todo` — matches the Code Reviewer's/Security's reported counts exactly, single clean run, no flake this session |

No regression tests were added by this QA pass — no defect of any severity
was found that required one (see Verdict).

## Per-section acceptance criteria

### §1 — Real-time trigger `on-submit` (`approval-pending`)

| AC | Result | Evidence |
|---|---|---|
| 1. Fires exactly once on submit; a network-retried finalize (`created:false`) fires zero | **PASS** | `finalize/route.ts:224` gates the fire call on `formDataResult.created` exactly (only the two on-submit call sites fire; the guard is a real `if`, not a comment) — locked by `public-registration-finalize-route.test.ts` "a network-retried finalize (createFormData returns created:false) fires ZERO emails (replay safety, AC-1)" and the happy-path sibling asserting exactly-once with `submissionId` as dedupeKey |
| 2. Admin manual-registration route fires zero | **PASS** | Direct read: `attendees/register/route.ts` has zero import of `fire-on-submit-email`/`fireApprovalPendingEmail` anywhere — the route creates `FormData` at `status:"accepted"` directly, never `"new"`. Locked by a source-grep regression test (`attendees-register-route.test.ts`, "the route source never imports the on-submit email hook") that reads the actual file content, not a mock assertion |
| 3. Disabled definition skip, `enabled` read fresh at fire time | **PASS** | `fire-on-submit-email.ts:45-50` re-reads `resolveEffectiveEmailDefinition` on every call, no caching — locked by `email-lifecycle-on-submit.test.ts` ("skips silently... when disabled" + "re-reads enabled fresh on every call — never cached across calls", which flips the mock between two calls and proves the second call's outcome is independent of the first) |
| 4. Blank-email typed rejection, zero write, zero crash | **PASS** | `sendEventEmail`'s `emailRecipientSchema` (T1, unmodified) rejects an empty `email` as `INVALID_RECIPIENT` — `fire-on-submit-email.ts`'s own try/catch plus the typed-rejection branch means this never throws; confirmed via `email-lifecycle-on-submit.test.ts`'s "never throws when a typed rejection/failed outcome comes back" |
| 5. Two submissions, distinct `submissionId`s, each get their own row | **PASS** | `dedupeKey = submissionId` (`fire-on-submit-email.ts:68`) is trivially per-submission by construction — locked directly by `email-lifecycle-on-submit.test.ts` "two distinct submissions each get their own dedupeKey (never per-visitor)" |

### §2 — Real-time trigger `on-accept` (`confirmation-paid`/`confirmation-payment-due`)

| AC | Result | Evidence |
|---|---|---|
| 1/2. Correct kind selection: paid→paid, invoice→payment-due, comped→paid (not payment-due) | **PASS** | `fire-on-accept-email.ts:58-61`: `order?.paymentStatus === "outstanding" ? PAYMENT_DUE : PAID` — comped and paid both fall through to `PAID` (never a positive check for "outstanding" being excluded elsewhere), exactly matching the Shared-decisions discriminator. Locked by `email-lifecycle-on-accept.test.ts`'s 4-case kind-selection describe block (paid/comped/outstanding/orderId-null), each asserting the real `sendEventEmail` call args |
| 3. `enabled` gates the SELECTED kind only, no cross-kind fallback | **PASS** | `fire-on-accept-email.ts:63-68` resolves `enabled` for the already-selected `kind` only — there is no code path that re-tries the sibling kind. Locked by `email-lifecycle-on-accept.test.ts` "disabling the SELECTED kind sends zero emails, even though the sibling kind stays enabled" (mocks `getAdminEmailDefinitionByKind` to return `enabled:false` for `confirmation-paid` and `enabled:true` for `confirmation-payment-due`, asserts `sendEventEmail` is never called) |
| 4. Re-invoking the healing path (M5-T1 S-1) produces zero additional rows | **PASS** | `dedupeKey = attendeeId`, and the healing re-invoke replays onto the SAME deterministic `attendeeId` — locked by `on-submission-accepted-email-wiring.test.ts` "a healing re-invoke (M5-T1 S-1 path) calls it again with the SAME attendeeId (replay-safe by construction)", which exercises the real `transitionAdminFormDataStatus` → `onSubmissionAccepted` chain against `fake-admin-db`, not a mocked shortcut |
| 5. `orderId: null` fires `confirmation-paid`, never crashes | **PASS** | `fire-on-accept-email.ts:50-56`: `order` is `null` when `attendee.orderId` is `null` (no DAL call made at all), and `order?.paymentStatus` short-circuits to `undefined !== "outstanding"` → `PAID`. Locked by both `email-lifecycle-on-accept.test.ts`'s "orderId: null → confirmation-paid" (asserts `getAdminOrderForEvent` is never called) AND its sibling "an unresolvable orderId (order doc gone) also falls back to confirmation-paid" (order lookup returns `null`) |
| 6. Accept-hook throw never un-accepts, never blocks `attendeeCreated` | **PASS** | Verified at all three layers by direct read: `fire-on-accept-email.ts`'s own try/catch (never rethrows), `on-submission-accepted.ts:154-166`'s independent try/catch AFTER `markAdminFormDataAttendeeCreated` (step 4) has already committed, and `transitionAdminFormDataStatus`'s own outer try/catch. End-to-end proof (not per-module mocking): `on-submission-accepted-email-wiring.test.ts` "a throw from the email hook never un-accepts and never blocks attendeeCreated (spec §2 AC-6)" runs the real accept transaction against `fake-admin-db`, injects a rejected `fireOnAcceptConfirmationEmail`, and asserts `status:"accepted"`, `attendeeCreated:true`, and a real `Attendee` doc all still landed |

### §3 — Periodic trigger `abandoned-24h` (`abandoned-reminder`)

| AC | Result | Evidence |
|---|---|---|
| 1. 24h boundary correct (23h59m doesn't fire, 24h01m fires) | **PASS** | `isAbandoned = nowMs - updatedAtMs > ABANDONED_AFTER_MS` (strict `>`, `adminRegistrationDraft.ts:258`) — reuses the exact M3-T5 constant, never re-derived. Locked by `lifecycle-evaluate-abandoned.test.ts` "a draft that has not yet crossed the abandoned threshold never fires" and the audience-level `lifecycle-audience-queries.test.ts` "only returns isAbandoned drafts — never a fresh (not-yet-24h) draft" |
| 2. Re-evaluation on every subsequent tick produces zero additional rows | **PASS** | `dedupeKey = draftId` — locked by `lifecycle-evaluate-abandoned.test.ts` "dedupeKey = draftId: re-evaluating the same abandoned draft on later ticks sends zero more" (asserts `transport.send` called exactly once across two evaluator invocations, one `EmailMessage` row total) |
| 3. Sent to the REAL unmasked email, never the masked display value | **PASS** | `audience-queries.ts:69` reads `draft.email` (the raw denorm) directly, never through any masking helper — locked by `lifecycle-evaluate-abandoned.test.ts` "sends to the FULL email, never a masked display value" with a distinctive local-part asserted directly on the transport call's `to.address` |
| 4. Empty-email drafts: typed rejection, zero row, zero crash, tick continues | **PASS** | `paged-trigger-runner.ts`'s pre-split (invalid candidates routed individually through `sendEventEmail`, never poisoning the batch) — locked by `lifecycle-evaluate-abandoned.test.ts` "an empty email produces a typed rejection — zero row, zero crash, tick continues" (seeds one empty-email draft + one valid draft in the same page, asserts `rejected:1, enqueued:1`) |
| 5. Abandon→resume→complete→re-abandon under a NEW draft is a fresh eligible instance | **PASS (by construction + code trace)** | A completed draft is deleted (finalize's step 3, confirmed at `finalize/route.ts:242`); a fresh abandonment necessarily mints a new `draftId`, hence a new, independent `dedupeKey` — no code path anywhere reuses a deleted draft's id. Not given its own dedicated integration test under this exact narrative, but the mechanism (`dedupeKey = draftId`, drafts are create-once/delete-once) makes this true by construction, and `lifecycle-evaluate-abandoned.test.ts`'s "two distinct abandoned drafts each get their own row" directly proves the per-draft independence this scenario relies on |
| 6. Disabling mid-cycle stops new sends; re-enabling resumes for still-eligible drafts | **PASS** | `paged-trigger-runner.ts:98-106` re-reads `isDefinitionCurrentlyEnabled` at the start of every page — locked by `lifecycle-paged-trigger-runner.test.ts` "stops chunk 2 (and later) when disabled between pages, while chunk 1's sends stand" (definition flipped to `enabled:false` mid-run via the runner's own `fetchPage` callback, asserts the never-reached page 2's `fetchPage` was never invoked) |

### §4 — Periodic trigger `unpaid-offsets` (`payment-reminder`)

| AC | Result | Evidence |
|---|---|---|
| 1. Day-7 fires (and only that); 14/21 fire on schedule if still outstanding | **PASS** | `dueOffsetDedupeKeys` (`evaluate-unpaid-offsets.ts:46-63`) returns only offsets where `daysSinceOrder >= offsetDays` — locked by `lifecycle-evaluate-unpaid-offsets.test.ts` "fires ONLY the day-7 reminder for an order exactly 7 days old" and "fires the day-14 reminder on a LATER tick, as a NEW row (three distinct rows, one kind)" |
| 2. An order paid between day 7 and 14 fires only day-7 | **PASS** | The two-condition eligibility (`accepted-invoice` audience) is re-queried fresh every tick — an order flipped to `paid` simply stops appearing in the audience. Locked by `lifecycle-evaluate-unpaid-offsets.test.ts` "an order paid between day 7 and day 14 fires ONLY day-7" — flips `paymentStatus` on the fake store between two evaluator calls, asserts `enqueued:0, duplicates:0` on the later tick (the order "never even surfaces in the audience", not merely deduped) |
| 3. An outstanding order with no Attendee (never accepted) fires zero, even past day 21 | **PASS** | `queryOrderJoinedAcceptedAudiencePage` excludes any order whose resolved attendee is missing or not `accepted` (`audience-queries.ts:236`) — locked by `lifecycle-evaluate-unpaid-offsets.test.ts` "an outstanding order whose submission is still pending (no Attendee) fires ZERO reminders, even past day 21" AND independently by `lifecycle-audience-queries.test.ts`'s dedicated two-condition-eligibility fixture set (order-with-no-attendee, order-with-cancelled-attendee, paid-order-with-accepted-attendee all correctly excluded, only the truly-eligible one included) |
| 4. Re-evaluating an already-fired offset produces zero additional rows for that pair | **PASS** | `dedupeKey = orderId:offsetDays` collapses via `createAdminEmailMessageIfAbsent` — same evidence as AC-1/2 above (the "day-14 on a later tick" test asserts `duplicates:1` for the day-7 key on the later run) |
| 5. Three distinct rows, one shared kind, distinct `dedupeKey`s | **PASS** | `unpaidOffsetDedupeKey` (`dedupe-keys.ts:29-34`) is the single source of the `orderId:offsetDays` formula, imported only here — locked by `lifecycle-evaluate-unpaid-offsets.test.ts`'s `dueOffsetDedupeKeys` pure-function test "returns all THREE due offsets when evaluated well past day 21" (`["order-1:7","order-1:14","order-1:21"]`) and the evaluator-level test asserting all rows share `kind:"payment-reminder"` |
| 6. Disabling mid-cycle stops all three offsets from firing; re-enabling resumes | **PASS** | Same generic per-page `enabled` re-check as §3 AC-6 (`paged-trigger-runner.ts`, shared by every periodic trigger) — no `unpaid-offsets`-specific carve-out exists that could diverge |

### §5 — Periodic trigger `scheduled`

| AC | Result | Evidence |
|---|---|---|
| 1. Fires for the current audience at first `now >= trigger.at`; a later same-hour tick sends zero more | **PASS** | `evaluate-scheduled.ts:51` gates on `nowMs < atMs` → `"not-due"`; once due, delegates to the generic paged runner (dedupeKey-gated). Locked by `lifecycle-evaluate-scheduled.test.ts` "fires for the current audience once due; a later tick with no new members sends zero more" |
| 2. Catch-up: an attendee accepted 2 days after the nominal moment (before event start) receives it on the next tick | **PASS** | The evaluator re-queries the audience fresh on every due tick (no "already evaluated" snapshot) — locked by `lifecycle-evaluate-scheduled.test.ts` "catch-up: an attendee accepted after the nominal moment still receives it on a later tick" (seeds the new attendee only between two evaluator calls) |
| 3. Cutoff: an attendee accepted after the event's first period start never receives it | **PASS** | `resolveEventFirstPeriodStartMs` (event-schedule.ts) computes midnight-event-local on the first period's date; `evaluate-scheduled.ts:68-78` skips the QUERY entirely (not just a per-candidate filter) once `nowMs >= cutoffMs` — locked by `lifecycle-evaluate-scheduled.test.ts` "the catch-up window CLOSES at the event's first period start — no query even runs past it" (`pagesProcessed:0`, transport never called, even with an eligible attendee seeded) |
| 4. `all-invitees` custom scheduled definition fires zero recipients, documented no-op | **PASS on the no-op behavior; see Observation 1 below for the "logs/flags" half of this AC** | `audience-queries.ts:281-282` hardcodes `{candidates:[], hasMore:false}` — zero query, zero error. Locked by `lifecycle-evaluate-scheduled.test.ts` "a custom definition with audience all-invitees fires for zero recipients, no error" |
| 5. `pending-approval` scheduled custom def fires for every pending submission, `submissionId` dedupe, catches up to the same cutoff | **PASS (composed from independently-verified pieces, not one dedicated end-to-end test)** | `queryPendingApprovalAudiencePage` (`pending-approval`'s status-IN-[new,pending,reviewed] query, `submissionId` recipientKey) is independently verified correct by `lifecycle-audience-queries.test.ts`; the generic `evaluateScheduledDefinitionTrigger` is audience-agnostic (dispatches via `queryAudiencePage`, same catch-up/cutoff logic regardless of audience) and is verified against `accepted-all` in `lifecycle-evaluate-scheduled.test.ts`. No test seeds a `scheduled`+`pending-approval` combination through the evaluator directly, but the two halves (audience correctness, evaluator catch-up/cutoff mechanics) are each independently proven and the evaluator has zero audience-specific branching that could make them compose incorrectly (confirmed by direct read — `evaluate-scheduled.ts` never special-cases `audience`) |
| 6. Clearing `trigger.at` to null after some sends doesn't affect sent status, halts future firing | **PASS (code trace)** | `evaluate-scheduled.ts:51` re-reads `definition.atMs` fresh every invocation (sourced from the merged live definition in `evaluate-event.ts:146`, never cached) — `atMs:null` unconditionally returns `"not-due"` before any query runs; prior `EmailMessage` rows are immutable per T1's outbox contract (unchanged, not touched by this ticket) |

### §6 — Audience segment definitions

| Audience | Result | Evidence |
|---|---|---|
| `all-invitees` | **PASS** | Hardcoded zero-candidate literal, no query at all — `lifecycle-audience-queries.test.ts` "is a documented no-op: zero candidates, zero query" seeds a real accepted attendee first to prove the query truly never runs |
| `abandoned` | **PASS** | `getAdminRegistrationDraftsForEvent` + `isAbandoned` filter, `draftId` recipientKey — verified above (§3) |
| `pending-approval` | **PASS, spot-checked per the ticket's ask** | `listAdminFormDataForEventByStatuses` with `status IN ["new","pending","reviewed"]` — direct read confirms it reuses the existing `eventId+organizationId+status+submittedAt DESC` composite (no new index needed, confirmed against `firestore.indexes.json`'s unchanged FormData composite list). Locked by `lifecycle-audience-queries.test.ts` "matches status IN [new, pending, reviewed] only — never accepted" (4 statuses seeded, only 3 returned) |
| `accepted-all` | **PASS** | `Attendee.status === "accepted"`, no Order join — locked by `lifecycle-audience-queries.test.ts` "matches Attendee.status === accepted only, no Order join" |
| `accepted-paid`/`accepted-invoice`, spot-checked per the ticket's ask | **PASS — the Order-join two-condition eligibility is correctly Order-first, not Attendee-first** | `queryOrderJoinedAcceptedAudiencePage` (`audience-queries.ts:210-265`) queries Orders by `paymentStatus` first, then resolves each order's linked `Attendee` via the deterministic `attendeeIdFromSubmissionId` derivation and requires `status === "accepted"` — an outstanding order with no Attendee, or with a cancelled Attendee, is correctly excluded. `accepted-paid` correctly includes BOTH `paid` and `comped`, never `outstanding`. This is the single most safety-critical query in the ticket (feeds §4's debt-chase) and got the most thorough test fixture of the whole suite (`lifecycle-audience-queries.test.ts`'s "accepted-paid / accepted-invoice — two-condition eligibility" describe block: 4 distinct order/attendee combinations seeded in one test, only the genuinely-eligible one returned) |
| Bounded + paginated | **PASS** | Every non-`all-invitees` case threads `limit`/cursor through to its DAL call — locked by `lifecycle-audience-queries.test.ts` "pagination" describe block, which pages a 5-item `accepted-all` set at `limit:2` across 3 pages and confirms zero overlap/omission |

### §7 — Manual "Email all" wiring

| AC | Result | Evidence |
|---|---|---|
| 1. N abandoned drafts, none previously emailed → exactly N new rows | **PASS — against the REAL DAL, not mocked** | `email-all-route-dedupe.test.ts` "N abandoned drafts, none previously emailed → exactly N new EmailMessage rows" runs the real route handler against a shared `fake-admin-db` with `RegistrationDraft`/`EmailDefinition`/`EmailMessage` all genuinely unmocked |
| 2. Clicking again immediately produces zero new rows | **PASS** | `email-all-route-dedupe.test.ts` "clicking again immediately produces ZERO new rows — every entry resolves as a duplicate" (2 drafts, POST twice, `emailMessageCount()` stays at 2) |
| 3. A draft the automatic sweep already emailed is excluded from "Email all"'s new-row count | **PASS — same DAL, same dedupeKey, proven via a genuine cross-path collision** | `email-all-route-dedupe.test.ts` "a draft the automatic sweep already emailed (pre-seeded row, SAME dedupeKey scheme) is skipped on first click" pre-seeds a row via the real `createAdminEmailMessageIfAbsent` (standing in for the automation) with `dedupeKey:"d1"`, then calls the route and asserts `d1` resolves as a duplicate while `d2` sends new (1 sent + 1 already-emailed, never 3 total rows for 2 drafts) |
| 4. Disabling `abandoned-reminder` refuses with a typed error, no partial send | **PASS** | `drafts/email-all/route.ts:71-76` returns 409 before any draft is even read when `!definition.enabled` — locked by `email-all-route.test.ts` "refuses with a typed 409 and never calls sendEventEmailBatch" |
| 5. Double-click safety: client in-flight guard + server dedupe, N rows not 2N | **PASS on the mechanism; see Observation 2 below on test rigor** | Client: `abandoned-tab.tsx`'s `emailingAll` state disables the button and short-circuits `emailAll()` while a request is in flight (`if (emailingAll) return;`). Server: the same `createAdminEmailMessageIfAbsent` transaction is the real backstop. The delivered regression test (`email-all-route-dedupe.test.ts`'s "clicking again immediately" test) exercises this with two **sequential** calls rather than a genuine `Promise.all`-raced pair — see Observation 2, non-blocking |
| 6. `write:events` gate, 404 cross-org, rate-limited | **PASS** | `email-all-route.test.ts`'s permission-matrix describe block (403 without `write:events`, 404 on `getAdminEventForOrganization` returning null) + its rate-limit describe block (10/min/user/event, 11th call 429) — both drive the real route handler |

### §8 — Scheduling mechanism + rate/volume safety

| AC | Result | Evidence |
|---|---|---|
| 1. A 5,000-attendee event never triggers an unbounded query or an unbounded batch call | **PASS** | Every audience query is `limit`-bounded (§6); `paged-trigger-runner.ts` never hands `sendEventEmailBatch` more than one page's worth (`LIFECYCLE_AUDIENCE_PAGE_SIZE = 100` default, `maxPages` cap). No test literally seeds 5,000 attendees (impractical), but the boundedness is structural (every DAL call in `audience-queries.ts` passes a `limit`, confirmed by direct read — none omit it) and the paging discipline is directly tested (below) |
| 2. Interrupting mid-run and resuming produces the correct total, zero duplicates | **PASS — with a genuine interrupt+resume simulation** | `lifecycle-paged-trigger-runner.test.ts` "never calls the transport more than once per unique dedupeKey across an interrupted-then-resumed run": a `maxPages:2` "interrupted" run processes 4 of 7 candidates, then a from-scratch `maxPages:20` "later invocation" run against the SAME candidate set sends only the remaining 3 (4 collapse as duplicates) — 7 total `EmailMessage` rows across both runs, never more, `transport.send` called exactly 7 times total across both runs combined |
| 3. A definition disabled between chunk 1 and chunk 2 stops chunk 2+, chunk 1's sends stand | **PASS** | Same evidence as §3 AC-6 above — `lifecycle-paged-trigger-runner.test.ts`'s "stops chunk 2 (and later)..." test is the direct proof, with `fetchPage`'s page-2 branch instrumented to fail the test if ever reached |
| 4. No mechanism-specific test required beyond "the evaluator can be invoked and produces the documented behavior" | **N/A — spec explicitly scopes this out** | `email-trigger-evaluate-route.test.ts` exercises the actual HTTP entrypoint (auth, validation, rate limit, cross-org isolation) end-to-end; real Cloud Scheduler wiring is out of this ticket's own acceptance criteria by its own text |

**Security-fix verification (Finding 2/N-3, Medium) — done independently, not trusted from the security doc:**
`evaluate/route.ts:88-97` calls `checkRateLimit(RATE_LIMIT_KEY, {limit: 6})`
BEFORE the audience sweep runs, keyed on a fixed global string (no
per-caller identity exists on this bearer-secret route) — 429 with a
`Retry-After` header past the 6th call/minute. The Zod ceiling tightening
(`maxEvents` 200→50, `pageSize` 500→200, `maxPagesPerTrigger` 200→40) is
present in the schema exactly as the security review's remediation asked.
Both are locked by `email-trigger-evaluate-route.test.ts`'s "rate limiting
(Security Agent Finding 2 / N-3)" describe block (6 calls succeed, 7th
429s; a bare/unauthenticated call never consumes the rate-limit bucket —
auth is checked strictly before the limiter) and its "request validation"
describe block (400 one-above each tightened ceiling, 200 exactly-at each
ceiling).

### §9 — Permissions, tenancy

| AC | Result | Evidence |
|---|---|---|
| Internal evaluator route: fail-closed shared-secret auth | **PASS, independently re-verified** | `evaluator-auth.ts:23-45`: an unset secret in `NODE_ENV==="production"` returns `null`, and `verifyEvaluatorRequestSecret` unconditionally returns `false` for a `null` expected value — every request rejected, no fallback. `constantTimeStringEqual` (SHA-256-then-`timingSafeEqual`, reused from `draft-token.ts`) avoids both a value AND a length timing oracle. Response body is the identical generic `{error:"Unauthorized."}` for missing-header/wrong-secret/misconfigured-prod, confirmed by reading the single `if` branch. Locked by `email-trigger-evaluate-route.test.ts`'s "rejects a missing header with 401 and never touches Firestore" (`fake.writes` asserted length 0 — the auth check genuinely short-circuits before any DAL call, not merely before a *successful* one) |
| Internal route: every DAL call carries both organizationId and eventId | **PASS** | `EvaluateRequestSchema`'s `.refine` enforces `eventId`/`organizationId` supplied together; `run-sweep.ts`'s targeted path resolves via `getAdminEventForOrganization` (the same IDOR-safe getter used everywhere else). Locked by `email-trigger-evaluate-route.test.ts`'s cross-org describe block: a targeted call for (org A, event A) never reads org B's same-named event's data (1 EmailMessage row total, org A's only), and an IDOR-shaped probe (org A's id + org B's real eventId) is a `0`-events no-op, not an error |
| "Email all" route: normal `write:events` session gate, 404 cross-org | **PASS** | `resolveRegistrationRouteScope` — same M1–M5 convention. Locked by `email-all-route.test.ts`'s permission-matrix tests |
| Cross-org isolation on every new DAL path | **PASS** | Every new/extended DAL function read in full (`listAdminOrdersForEventByPaymentStatus`, `listAdminFormDataForEventByStatuses`, `getAdminAttendeeBySubmissionId`, `listAdminPublishedEventsPage`, `getAdminRegistrationDraftsForEvent`'s cursor addition) filters on `organizationId`/`eventId` (or a deterministic id already derived from both) in every query — no bare single-id lookup found anywhere in the new lifecycle module tree, confirmed by direct read of each function, not by grep alone |

**Security-fix verification (Finding 5/L-3, Low) — done independently:**
`drafts/email-all/route.ts:101-133` now pre-splits each draft through
`emailRecipientSchema.safeParse` BEFORE batching (same pattern
`paged-trigger-runner.ts` already used) — an invalid entry is counted
(`skippedInvalidEmail`) and excluded, never sent individually or batched,
and the 400 fallback response returns `invalidCount` only, never
`result.invalid`'s raw email array. Locked by `email-all-route-dedupe.test.ts`
"a malformed draft email is skipped (no EmailMessage row) without blocking
the other valid drafts (Security L-3)" (asserts
`JSON.stringify(body)` does not contain the malformed literal) and
`email-all-route.test.ts`'s matching unit test (asserts the response body
contains neither the malformed address nor any of the *valid* addresses
either — count-only, full stop).

## Observations (non-gating, not filed as defects)

**Observation 1 — §5 AC-4's "evaluator logs/flags this outcome for
organizer visibility" half is not implemented; the "zero recipients,
documented no-op" half is.** `TriggerEvalOutcome` (`types.ts`) has no field
distinguishing "an `all-invitees` scheduled definition legitimately fired
zero recipients" from any other zero-candidate outcome, and no log
statement exists anywhere in `audience-queries.ts`/`evaluate-scheduled.ts`
for this specific case (`lifecycle-evaluate-scheduled.test.ts`'s own
"all-invitees" test only asserts `enqueued:0, stoppedReason:"exhausted"` —
indistinguishable from any other empty audience). This reads as a literal
gap against §5 AC-4's exact wording. However, the spec's own §9 ("Gap
surfaced, not fixed here... Recorded as an open question... for UX/FS to
pick up as a small polish item, **not blocking this ticket**") and Open
Question OQ-1 explicitly classify this exact gap as accepted, non-blocking,
deferred product/UX scope — the spec's own authoritative framing
supersedes the more casually-worded AC bullet. Not filed as a QA defect;
flagged here so the Orchestrator has it on record rather than silently
dropped, consistent with this loop's "disclose gaps honestly" convention.

**Observation 2 — §7 AC-5's "two concurrent identical batch calls" is
tested sequentially, not with genuine `Promise.all` concurrency.** The
delivered regression test's own comment
(`email-all-route-dedupe.test.ts:14-19`) explicitly says the sequential
double-call "stands in for" the concurrency requirement "without needing
genuine concurrency." This is an honest disclosure, not a hidden shortcut,
and the underlying safety mechanism (`createAdminEmailMessageIfAbsent`'s
real `adminDb.runTransaction` create-if-absent, T1, unmodified) is
atomic-by-construction at the real Firestore layer regardless of caller
ordering — a property of Firestore transactions, not something a
single-threaded in-memory fake could meaningfully race-test any more
convincingly than sequential calls onto the same deterministic id already
do. Not filed as a defect: no behavioral risk identified, and this is the
same test-rigor tradeoff already implicitly accepted for the identical
`createAdminEmailMessageIfAbsent` mechanism back in T1's own review.

**Observation 3 (carried, not re-litigated) — Code Review's N-1/N-2/N-4
nits** (on-submit route latency coupled to the email pipeline under a
future real transport; "Email all" doesn't `router.refresh()` after a
successful send; sweep fairness has no persisted cross-tick cursor) are
optional polish, already correctly triaged non-gating by Code Review, and
unchanged by this QA pass — not re-verified line-by-line here since they
carry no correctness risk and Code Review's read of them was already
independently sound.

## Defects

**None found at Major severity or above.** No regression test was added by
this QA pass — this loop's convention is to write one only when a defect is
found, and none was.

## Verdict

| Ticket | Verdict |
|---|---|
| M6-T3 — Lifecycle triggers & audience segmentation | **SIGNED OFF** |

All acceptance criteria across all 9 spec sections (§1–§9) pass, verified
by direct source read against the actual shipped modules (not by trusting
Code Review/Security's summaries) and cross-checked against a test suite
that genuinely exercises real behavior (real Firestore-transaction dedupe
via `fake-admin-db`, real route handlers, real component interactions)
rather than mocked-DAL tautologies. Both of Security's findings (Finding
2/N-3 Medium — internal evaluator route rate limiting + tightened Zod
ceilings; Finding 5/L-3 Low — "Email all" pre-split validation + no raw
email in error responses) are independently confirmed fixed in the working
tree, with real regression tests locking each fix. Two non-gating
observations are disclosed above (Observation 1: §5 AC-4's "logs/flags"
half is unimplemented but explicitly deferred/accepted by the spec's own
§9/OQ-1; Observation 2: §7 AC-5's concurrency test is sequential rather
than genuinely raced, honestly disclosed in the test's own comment, with
no identified behavioral risk given Firestore transaction semantics). No
defect of any severity — Major, Critical, or otherwise — is open from this
QA pass.

**Automated suite at sign-off:** `npm run lint` clean · `npx tsc --noEmit`
clean except the same 7 pre-existing baseline errors already carried
through Code Review and Security (confirmed outside the M6-T3 diff) ·
`npm run build` exit 0, all new routes present in the manifest · `npm test
-- run` → **109 files / 1317 tests passing, 0 failing, 0 `it.todo`**.

Cleared to close the ticket and merge to `prototype`.
