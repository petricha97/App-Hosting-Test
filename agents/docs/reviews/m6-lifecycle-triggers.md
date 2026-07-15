# Code Review — M6-T3 Lifecycle triggers & audience segmentation

Code Reviewer, 2026-07-16. Scope: all uncommitted changes in the working
tree relative to `prototype` that belong to M6-T3 — new
`src/lib/email/lifecycle/**` (13 files: `types`, `dedupe-keys`,
`definition-enabled`, `qr`, `event-schedule`, `audience-queries`,
`paged-trigger-runner`, `evaluate-abandoned`, `evaluate-unpaid-offsets`,
`evaluate-scheduled`, `evaluate-event`, `run-sweep`, `evaluator-auth`), new
`src/app/api/internal/email-triggers/evaluate/route.ts`, new
`src/features/emails/server/{fire-on-accept-email,fire-on-submit-email,resolve-definition}.ts`,
new `src/app/api/dashboard/events/[eventId]/drafts/email-all/route.ts`,
modified `src/features/responses/on-submission-accepted.ts`, both on-submit
routes (`register/route.ts`, `registration/finalize/route.ts`),
`src/lib/db/{adminOrder,adminFormData,adminRegistrationDraft,adminEvent}.ts`,
`firestore.indexes.json`, `apphosting.yaml`, `src/features/emails/components/trigger-cell.tsx`,
`src/features/attendees/components/abandoned-tab.tsx`,
`src/features/emails/default-definitions.ts`, `src/features/emails/utils.ts`,
`src/__tests__/helpers/fake-admin-db.ts`, and 16 new/modified test files.
Reviewed against `agents/docs/specs/m6-lifecycle-triggers.md`,
`agents/docs/data-models/m6-lifecycle-triggers.md`, and `agents/AGENT_LOOP.md`'s
Code Reviewer checklist. (`HANDOVER.md`, `agents/docs/BACKLOG.md`, `memory/`
excluded — orchestration bookkeeping, not code, matching prior review
precedent.)

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the same 4
  **pre-existing, unrelated** errors seen at the prior M6-T2 baseline
  (`attendees-roster.test.ts:106/160/221`, `event-org-scoping.test.ts:152-154`)
  plus `register-route.test.ts:62` — this is the *same* pre-existing
  `overrides.key` narrowing error the M6-T2 review logged at line 51; the
  M6-T3 diff added 13 lines earlier in that file (new mock wiring for
  `fireApprovalPendingEmail`), shifting the error's line number without
  changing its cause. Verified by direct read (`register-route.test.ts:58-68`)
  — not a new defect.
- `npm run build` — PASS, exit 0; `/api/internal/email-triggers/evaluate`,
  `/api/dashboard/events/[eventId]/drafts/email-all`, and every other
  existing route appear correctly in the route manifest.
- `npm test -- --run` — PASS, **109 files / 1309 tests**. One run hit 3
  "failed to start forks worker" / timeout errors from the Vitest pool
  scheduler on `responses-download.test.ts`, `registration-utils.test.ts`,
  `pricing-schemas.test.ts` (unrelated pre-existing files, no import of
  anything touched by this diff) under machine load; re-running those 3
  files in isolation passed cleanly (3 files / 54 tests) — this was test-
  runner infra flakiness in the sandbox, not a real regression. Combined:
  109 files / 1309 tests passing, matching the Orchestrator's reported
  numbers exactly.

---

## Mandatory-check results

1. **DAL boundary — PASS.** `grep -rn "firebase-admin/firestore\|firebase/firestore"` across
   `src/lib/email/lifecycle/**`, `src/app/api/internal/**`,
   `src/features/emails/server/**`, and the new `drafts/email-all` route
   returns zero hits. Every new Firestore-touching function lives in
   `src/lib/db/{adminOrder,adminFormData,adminRegistrationDraft,adminEvent}.ts`
   (all pre-existing DAL files, extended). A broader repo-wide grep for
   `firebase-admin`/`firebase/firestore` outside `src/lib/db/`/
   `src/lib/firebase.ts` turns up only pre-existing files untouched by this
   diff, plus `src/app/api/events/[eventId]/register/route.ts`'s `FieldValue`
   import — confirmed via `git diff` that this import predates M6-T3 (used
   for `submittedAt: FieldValue.serverTimestamp()`, unrelated to the new
   on-submit trigger code added a few lines below it). Every lifecycle
   module (`audience-queries.ts`, `paged-trigger-runner.ts`, `run-sweep.ts`,
   etc.) calls into the DAL only.

2. **Dedupe-key correctness — PASS, verified against the spec's tables by
   direct code read, not trusted from the data-model doc.**
   - `on-submit`: `dedupeKey = submissionId`
     (`src/features/emails/server/fire-on-submit-email.ts:68`) — matches
     spec §1 exactly.
   - `on-accept`: `dedupeKey = attendeeId` (`fire-on-accept-email.ts:102`,
     `input.attendee.id`) — matches spec §2.
   - `abandoned-24h` / "Email all": both use `dedupeKey = draftId` —
     `abandonedReminderDedupeKey` (`dedupe-keys.ts:21-23`, returns the raw
     `draftId`) feeding `evaluate-abandoned.ts:53-55`, and the "Email all"
     route independently constructs `dedupeKey: draft.id`
     (`drafts/email-all/route.ts:101`) — **identical value for the identical
     draft**, and (per send-service's contract) identical `kind`
     (`"abandoned-reminder"`, hardcoded the same string constant on both
     sides) and identical recipient email (`draft.email`, unmasked, on both
     sides — never the tab's masked display value). Since T1's outbox id is
     derived from `(org, event, kind, recipientEmail, dedupeKey)`, this
     triple match is what makes the automation and the manual button share
     one row per draft, confirmed by a real cross-path test
     (`email-all-route-dedupe.test.ts:164-195`: a row pre-seeded exactly as
     the "automation" would create it is skipped by the route, 1 sent + 1
     already-emailed, never 2 new rows).
   - `unpaid-offsets`: `dedupeKey = orderId:offsetDays`
     (`unpaidOffsetDedupeKey`, `dedupe-keys.ts:29-34`), three independent
     values per order sharing the single `kind: "payment-reminder"`. Verified
     `dueOffsetDedupeKeys` (`evaluate-unpaid-offsets.ts:46-63`) returns only
     offsets where `daysSinceOrder >= offsetDays` — correctly returns
     multiple keys at once when an evaluator first runs well past day 21
     (locked by `lifecycle-evaluate-unpaid-offsets.test.ts:161-176`, "returns
     all THREE due offsets when evaluated well past day 21") — this is a
     deliberate, spec-consistent catch-up behavior (§4 does not forbid
     multiple offsets firing in one tick), not a bug.
   - `scheduled`: `dedupeKey = definitionId:recipientKey`
     (`scheduledDedupeKey`, `dedupe-keys.ts:41-46`), `recipientKey` sourced
     per-audience from `audience-queries.ts` (attendeeId / submissionId /
     draftId per the §6 table) — matches spec §5.
   - All three periodic formulas are centralized in the single pure module
     `dedupe-keys.ts` and imported by every evaluator — no inline template
     re-derivation anywhere (confirmed by grep: `orderId.*offsetDays`,
     `definitionId.*recipientKey`, `draftId` template strings appear only in
     that one file plus the "Email all" route's independent-but-matching
     literal).

3. **Accept-hook failure isolation — PASS, verified at all THREE layers, not
   just the outermost comment.**
   - `fire-on-accept-email.ts:49-130`: the entire function body (order
     lookup, definition resolve, event lookup, QR mint, `sendEventEmail`
     call) is wrapped in one `try/catch`; the catch logs and returns,
     never rethrows.
   - `on-submission-accepted.ts:154-166`: `onSubmissionAccepted` calls
     `fireOnAcceptConfirmationEmail` inside its OWN `try/catch` — explicit
     defense-in-depth on top of #1 — **and** this call happens at step 5,
     strictly AFTER step 4's `markAdminFormDataAttendeeCreated` (line 142),
     so `attendeeCreated` has already flipped `true` in Firestore before the
     email code path is ever reached, regardless of what it does.
   - `adminFormData.ts:432-446` (`transitionAdminFormDataStatus`): the
     accept-transaction's own post-commit hook invocation is ALSO
     `try/catch`-wrapped — a third independent layer — and on a hook throw
     returns `{ ...result, acceptHookFailed: true }` while the underlying
     `status: "accepted"` transaction result (`result.ok === true`) is
     already committed and returned regardless. A throw from deep inside the
     email path can therefore reach at most this outer catch; it can never
     surface as `INVALID_TRANSITION`, never un-accept, and never touch
     `attendeeCreated`.
   - Verified end-to-end (not just per-module) by
     `on-submission-accepted-email-wiring.test.ts:155-184` ("a throw from the
     email hook never un-accepts and never blocks attendeeCreated"): asserts
     `result.acceptHookFailed` is `undefined` (i.e., this specific failure
     mode is invisible at the transaction-result layer, exactly because the
     email hook's own try/catch already absorbed it), `status === "accepted"`,
     `attendeeCreated === true`, and the Attendee doc exists — genuinely
     exercises the full call chain, not a mocked shortcut.
   - Same pattern independently verified for the on-submit hooks
     (`register/route.ts:81-94`, `finalize/route.ts:224-239`): both wrap
     `fireApprovalPendingEmail` in `try/catch` after the FormData write has
     already committed, and `register-route.test.ts`'s new "M6-T3 on-submit
     trigger" describe block (an email-hook crash never fails the
     registration response) exercises this at the route level.

4. **`enabled` re-check discipline — PASS, matches the data-model doc's
   claimed granularity exactly, verified by test, not just by reading the
   comment.** Real-time hooks (`fire-on-submit-email.ts:45-50`,
   `fire-on-accept-email.ts:63-68`) call `resolveEffectiveEmailDefinition`
   fresh on every invocation — no caching across the request. The periodic
   evaluator's `runPagedLifecycleTrigger` (`paged-trigger-runner.ts:96-106`)
   re-reads `isDefinitionCurrentlyEnabled` at the **start of every processed
   page**, before that page's `fetchPage`/`sendEventEmailBatch` call — not
   once per tick, not once per recipient. Directly tested
   (`lifecycle-paged-trigger-runner.test.ts:126-158`): a definition flipped
   to `enabled:false` mid-tick (between page 1's fetch and page 2's fetch)
   stops page 2 from ever being fetched (`stoppedReason: "disabled"`,
   `call` count proves `fetchPage` for page 2 was never invoked) while page
   1's already-enqueued send stands. This matches spec §8's exact
   requirement ("re-read... at the start of each processed page/chunk...
   not once per recipient").

5. **Internal entrypoint auth (`/api/internal/email-triggers/evaluate`) —
   PASS, genuinely fail-closed, verified by test.**
   `evaluator-auth.ts:23-45` (`resolveSecret`): in production, an unset
   `EMAIL_TRIGGER_EVALUATOR_SECRET` returns `null` and `verifyEvaluatorRequestSecret`
   then unconditionally returns `false` (`:60`) — every request rejected,
   never a fallback to the dev secret in `NODE_ENV === "production"`.
   Constant-time comparison (`constantTimeStringEqual`, reused from
   `draft-token.ts`) guards against timing side-channels on the secret
   itself. The route's 401 response body is deliberately generic ("Unauthorized.")
   regardless of missing-header vs. wrong-secret vs. server-misconfigured —
   no oracle for a probing caller (`evaluate/route.ts:56-61`). Locked by
   `lifecycle-evaluator-auth.test.ts` (dev fallback + one-time warn vs.
   prod fail-closed, both directions) and `email-trigger-evaluate-route.test.ts`
   ("rejects a missing header with 401 and never touches Firestore" —
   asserts `fake.writes` has length 0, i.e., the auth check genuinely
   short-circuits before any DAL call). Every DAL call downstream carries
   BOTH `organizationId` and `eventId` (never a bare eventId) — the request
   schema's `.refine` enforces `eventId`/`organizationId` are supplied
   together (`evaluate/route.ts:40-42`), and the cross-org isolation test
   (`email-trigger-evaluate-route.test.ts:154-201`) proves a targeted call
   for org A never reads org B's data even when org B has a colliding
   eventId string, and an IDOR-shaped probe (org A + org B's real eventId)
   is a `0`-events no-op via `getAdminEventForOrganization`'s existing
   tenancy check, never an error that leaks existence.

6. **Paging/volume safety — PASS.** Every §6 audience query is bounded +
   cursor-paginated (`audience-queries.ts`, `LIFECYCLE_AUDIENCE_PAGE_SIZE = 100`
   default). `runPagedLifecycleTrigger` never hands `sendEventEmailBatch` an
   unbounded array — one page's worth of pre-validated recipients per call,
   capped at `maxPages` (default 20) per trigger per event per invocation,
   and `run-sweep.ts` further caps events per invocation
   (`DEFAULT_LIFECYCLE_SWEEP_MAX_EVENTS = 25`, itself a bounded/cursor-paged
   `listAdminPublishedEventsPage` query, never the legacy unbounded
   `getAdminPublishedEvents()`). Resumability is dedupeKey-backed, not
   cursor-persisted across ticks (an explicitly documented, non-blocking
   scope decision in the data-model doc, §6/§7) — directly tested
   (`lifecycle-paged-trigger-runner.test.ts:182-238`): an "interrupted" run
   (budget covers 4 of 7 candidates) followed by a from-scratch "resumed"
   run produces exactly 7 total `EmailMessage` rows, zero duplicate
   transport calls, with the interrupted run's 4 already-sent candidates
   correctly collapsing as `duplicate` on the second run. The
   Order-first-traversal join for `accepted-paid`/`accepted-invoice`
   (`audience-queries.ts:210-265`) adds one bounded extra `Attendee` GET per
   Order in a page (≤ page size) — never unbounded, as documented.

7. **"Email all" / automatic-trigger dedupe sharing — PASS**, see finding 2
   above; independently re-confirmed against the REAL DAL (not mocked
   Firestore calls) by `email-all-route-dedupe.test.ts`, which runs the
   actual `createAdminEmailMessageIfAbsent` transaction against
   `fake-admin-db` for both the pre-seeded "automation already sent" row and
   the route's own send, proving the create-if-absent collision is real,
   not asserted by mock-call-count alone.

8. **Route permission gating — PASS.** The new "Email all" route
   (`drafts/email-all/route.ts:39-46`) uses the same
   `resolveRegistrationRouteScope` (session → org → `write:events` →
   `getAdminEventForOrganization`, 404 cross-org) every other M1–M5 mutating
   route uses, plus rate-limiting (`checkRateLimit`, limit 10). It correctly
   gates on the definition's live `enabled` flag (409, typed refusal,
   `:67-72`) independent of the automation's own firing state, per spec §7's
   explicit requirement that "Email all" not bypass an organizer's toggle.

9. **Types / structure / duplication — PASS.** No unjustified `any` found
   (`grep -rn ": any\b\|as any\b"` across `src/lib/email/lifecycle/**` and
   the new route/server files returns nothing). Every new lifecycle module
   is under ~310 lines (`audience-queries.ts` is the largest at 309), well
   under the repo's 800-line cap, and each has a single clear responsibility
   (types, dedupe formulas, one query dispatcher, one generic paged engine,
   one evaluator per trigger type, one orchestrator, one sweep, one auth
   module) — a genuinely "many small files" decomposition, not a monolith.
   `firstPeriodDate` is correctly exported (not forked) from
   `default-definitions.ts` for `event-schedule.ts`'s reuse; `qr.ts`'s
   `mintAttendeeQrSvg` is a small, explicitly-documented narrow duplication
   of T2's `sample-context.ts` helper (same deterministic-token + SVG
   pattern) rather than a cross-feature import — a reasonable, documented
   tradeoff, not an accidental fork.

10. **Tests assert real behavior — PASS.** Every new/extended suite
    reviewed (`lifecycle-dedupe-keys`, `lifecycle-evaluator-auth`,
    `lifecycle-audience-queries`, `lifecycle-paged-trigger-runner`,
    `lifecycle-evaluate-abandoned`, `lifecycle-evaluate-unpaid-offsets`,
    `lifecycle-evaluate-scheduled`, `email-trigger-evaluate-route`,
    `admin-order-payment-status`, `email-lifecycle-on-submit`,
    `email-lifecycle-on-accept`, `on-submission-accepted-email-wiring`,
    `email-all-route`, `email-all-route-dedupe`, `abandoned-tab-email-all`,
    plus the modified `attendees-register-route`,
    `public-registration-finalize-route`, `register-route`,
    `email-lifecycle-tab-interactions`, `email-utils`) asserts stored
    Firestore-row state, dedupe-collision counts, HTTP status codes, and
    response bodies against real fakes — not snapshots of nothing. The
    Orchestrator-flagged mechanical fixes (jest-dom matcher swap in
    `abandoned-tab-email-all.test.tsx`; type-fixes in
    `email-lifecycle-on-accept.test.ts` / `on-submission-accepted-email-wiring.test.ts`)
    were reviewed directly — both files are internally consistent,
    correctly typed, and assert the same behavior the data-model doc
    describes; no test-infrastructure regression found.

**Data-model doc vs. code:** accurate throughout — scheduling-mechanism
choice, module layout, dedupeKey formulas, audience-query traversal (Order-
first, not Attendee-first), denormalization deferral rationale, paged-engine
design, sweep fairness tradeoff, auth posture, and the day-level (not
minute-level) catch-up cutoff all match the code exactly on direct read.

---

## Findings

### Blockers

None.

### Should-fix (fix in this ticket or immediately after)

None found rising to Should-fix. Two Nits below are worth picking up
opportunistically but do not gate approval.

### Nits (optional)

- **N-1 — On-submit response latency is coupled to the email pipeline.**
  Both `register/route.ts:81-94` and `finalize/route.ts:224-239` `await`
  `fireApprovalPendingEmail` before returning the HTTP response to the
  registrant. Under the current dev outbox transport (synchronous, zero
  network I/O) this is unmeasurable, but once a real provider (T1 OQ-1) is
  wired in, every public registration submission will block on an outbound
  email round-trip before the confirmation response returns — worth a
  follow-up (fire-and-forget with an explicit "don't await" comment, or a
  deferred/queued dispatch) when a real transport lands, not blocking this
  ticket's dev-transport-only scope.
- **N-2 — "Email all" doesn't refresh the tab's row list after a successful
  send.** `abandoned-tab.tsx`'s `emailAll` only toasts a result; it never
  calls `router.refresh()` (unlike the tab's existing per-row delete/retry
  paths, which do). Not a correctness issue — the button remains safely
  re-clickable and the server-side dedupe is the real backstop regardless —
  but an organizer who clicks "Email all" twice in a row with a genuinely
  new abandonment in between won't see the count update without a manual
  page refresh. Cosmetic, optional.
- **N-3 — the internal evaluator route has no rate-limiting**, unlike every
  session-authenticated mutating route in this codebase (including the
  sibling "Email all" route, which calls `checkRateLimit`). The shared
  secret is the sole gate; there is no cap on how often (or how
  concurrently) a caller who holds a valid secret can invoke a full sweep.
  Low risk in practice (the caller is meant to be a single trusted Cloud
  Scheduler job, not a public surface, and the request schema already caps
  `maxEvents`/`pageSize`/`maxPagesPerTrigger` per call), but worth a
  deliberate decision (rather than an oversight) on whether a per-secret
  rate limit is warranted before this becomes a real Cloud Scheduler target
  — flagging for Security Agent's specific attention per the ticket brief's
  own framing of this route as a new auth pattern worth extra scrutiny.
- **N-4 — `run-sweep.ts`'s "no persisted cross-tick cursor" (event-level)
  and the pre-existing repo-wide "no tiebreaker id on cursor pagination"
  edge case are both honestly documented in the data-model doc rather than
  hidden, and are explicitly out of this ticket's scope** (fairness/
  throughput at real scale, not correctness — every send stays dedupeKey-
  safe regardless). Noting only so QA doesn't need to re-discover and
  re-litigate what Backend already flagged; no action requested here.

---

## Verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M6-T3 — Lifecycle triggers & audience segmentation | **APPROVED** | No blockers, no required should-fix items. Dedupe-key correctness verified formula-by-formula against the spec's tables (submissionId / attendeeId / draftId shared identically between the automatic 24h sweep and "Email all" / orderId:offsetDays / definitionId:recipientKey); accept-hook failure isolation verified at all three defense-in-depth layers with a real end-to-end test proving a thrown email error never surfaces as an un-accept or blocks `attendeeCreated`; the `enabled` re-check granularity matches the data-model doc's claim (per-page, not per-tick or per-recipient) with a test that proves the exact page boundary; the new internal, non-session-authenticated entrypoint is genuinely fail-closed in production (verified by test, not by comment) and every downstream DAL call stays tenant-scoped even under an IDOR-shaped probe; paging/volume safety is bounded end-to-end with a real interrupted-then-resumed test proving zero duplicate transport calls. Three Nits are optional polish, not gating. |

Overall: **APPROVED** — hands off to the Security Agent. Per this loop's
convention and the ticket brief's own framing (first unattended/automated
email-sending logic in this app), Security should pay particular attention
to: (1) the `evaluator-auth.ts` fail-closed posture under real Secret
Manager provisioning (this review only verifies the code's behavior when
the env var is absent/present in-process, not the operational step of
actually setting `emailTriggerEvaluatorSecret` before prod deploy — a human
task per the data-model doc, not code); (2) whether the generic 401 body
and the internal route's complete absence of rate-limiting (unlike the
session-authenticated "Email all" route, which does rate-limit) is an
acceptable posture for an endpoint reachable by anyone who obtains or
guesses the shared secret header value.
