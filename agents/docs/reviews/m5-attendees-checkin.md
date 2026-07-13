# Code Review — M5 Attendees & Check-in (M5-T1..T5)

Code Reviewer, 2026-07-13. Scope: `git diff e561d4e..HEAD` on `feat/m5-attendees-checkin`
(commits `2148ce8`, `ce57f19`). Reviewed against `agents/docs/specs/m5-attendees-checkin.md`,
`agents/docs/design/m5-attendees-checkin.md`, `agents/docs/data-models/m5-attendees-checkin.md`,
and the Sprint 5 plan in `agents/docs/BACKLOG.md`.

Checks executed this session: `npm run lint` ✅ (no warnings/errors), `npm run build` ✅ (exit 0),
`npm test -- --run` ✅ (72 files / 959 tests, all passing — matches the handover baseline; the
M5 suites are included in that count).

---

## Mandatory-check results

1. **DAL boundary — PASS.** Every `firebase-admin/firestore` import added by this diff lives in
   `src/lib/db/` (`adminAttendee.ts`, `adminCheckinConfig.ts`, `adminCheckinTeamMember.ts`) or in
   tests. `src/lib/qr/*` and `src/lib/db/attendeeId.ts` are pure `node:crypto` modules. No route or
   feature module touches Firestore directly.
2. **Transactional consistency — PASS with one Should-fix (S-1 below).**
   - Accept hook: deterministic attendee id (`src/lib/db/attendeeId.ts`), `tx.create()`
     create-if-absent (`src/lib/db/adminAttendee.ts:80-132`), replay = zero writes — race-tested
     (`src/__tests__/admin-attendee.test.ts:170`, `on-submission-accepted.test.ts:257,273`).
   - Manual registration: single pipeline `placeOrder` (idempotency key `manual:<requestId>`) →
     `createAdminFormDataForDraft` (create-if-absent at the deterministic id) → transition to
     accepted; replay returns the same refs (`attendees-register-route.test.ts:443`). placeOrder
     only persists an order on success, so a SOLD_OUT attempt does not burn the key.
   - Check-in flip: transactional, idempotent, never-overwriting (`adminAttendee.ts:319-376`);
     duplicate confirm returns the ORIGINAL `checkedInAt`/`checkedInBy` with zero writes
     (`admin-attendee.test.ts:420,449`; `checkin-confirm-route.test.ts:197`).
   - The one gap is the hook-failure replay path — see **S-1**.
3. **firestore.indexes.json — PASS.** Four new composites exactly match the new query shapes:
   `Attendee (eventId, organizationId, createdAt DESC)`, `+status`, `+checkInState`, and
   `CheckinTeamMember (eventId, organizationId, createdAt DESC)`. Aggregate counts, the
   access-code exchange and the QR-hash lookup are equality-only (index merging, no composite
   needed). The unsupported combined `status`+`checkInState` list shape is guarded by an explicit
   throw (`adminAttendee.ts:226-231`) and tested (`admin-attendee.test.ts:336`). No query in the
   diff can hit a missing-index error. `firestore.rules` adds deny-all for all three collections
   (T1 AC-10).
4. **Type safety / error handling / structure — PASS** (nits below). No new `any`; typed wire
   contracts in `scan-types.ts`/`roster.ts`; Zod at every route boundary with unknown-key
   stripping; DAL re-checks the allow-list (`adminCheckinConfig.ts:62-71`). All client fetches
   have catch + user-facing error states. Feature-module layout matches the design spec's
   component tree exactly; no oversized files (largest component 432 lines, well factored).
5. **Tests — PASS.** New logic has behavior-asserting tests: token binding/tamper/fail-closed
   (`qr-token.test.ts`, `scanner-session.test.ts`), idempotency races, IDOR scoping, no-oracle
   access-code exchange, rate limits (429 on the 61st resolve), PII masking ("never emits the
   local part"), schema assertions that only hashes are persisted, and route-level 401/403/404
   gates for every new endpoint.
6. **Date/timezone — PASS with nits (N-1, N-2).** Check-in timestamps are serverTimestamp in the
   transaction and serialized to ISO; abandonment reuses the M3 DAL's `isAbandoned`
   (`ABANDONED_AFTER_MS` imported, never copied — `src/features/attendees/abandoned.ts:47-55`).

---

## Findings

### Blockers

None.

### Should-fix

- **S-1 (M5-T1 / M5-T2) — Hook failure leaves an invisible registrant; the manual-registration
  replay returns success without healing it.**
  `transitionAdminFormDataStatus` awaits the accept hook unguarded after the commit
  (`src/lib/db/adminFormData.ts:396-399`), so a hook crash 500s the caller while the submission
  is already `accepted` with `attendeeCreated:false`. That submission then appears NOWHERE on the
  roster: it is filtered out of pending rows (`src/features/attendees/roster.ts:92`) and has no
  Attendee doc — and no repair route ships in M5 (spec-documented gap for the generic accept
  path, so not a Blocker). The sharp edge is the manual-registration route: a retry with the same
  `requestId` hits `INVALID_TRANSITION`, which the route treats as success
  (`src/app/api/dashboard/events/[eventId]/attendees/register/route.ts:265-273`) and returns 200
  **without an Attendee ever being created** — the organizer sees "Attendee registered" for a
  registrant who never appears (undercuts T2 AC-6's intent: exactly one
  order/submission/attendee). Cheap fix within this ticket: when the transition returns
  `INVALID_TRANSITION` (or after any accept in this route), check `attendeeCreated` and directly
  re-invoke the exported `onSubmissionAccepted` (it is exported for exactly this healing purpose,
  and every step is idempotent). Add a regression test for the crash-then-replay sequence.

### Nits

- **N-1 (M5-T4)** — `isEventStartInFuture` parses `` `${date}T${time}` `` in the server's local
  timezone (`src/features/checkin/utils.ts:23`); on App Hosting (UTC) the "event not started"
  caption can be off by the venue's UTC offset near the boundary. Consistent with the existing
  pattern in `src/features/event/utils.ts:17,24` and cosmetic/fail-quiet only — fine for M5, but
  worth a shared event-timezone helper when M7 reports need real event-time math.
- **N-2 (M5-T2/T3/T5)** — Three near-duplicate time/date formatters with inconsistent locale
  strategy: `formatCheckInTime` (forced `en-GB`, `src/features/attendees/roster.ts:126`),
  `formatCheckedInTime` (viewer locale, `src/features/checkin/scan-types.ts:116`), and
  `formatDate` (forced `en-SG`, `src/features/attendees/components/abandoned-table.tsx:39`).
  Consolidate and pick one locale policy (DRY).
- **N-3 (M5-T1)** — `getAdminAttendeeByQrTokenHash` (`src/lib/db/adminAttendee.ts:185-206`) has
  no production caller — resolve goes through the deterministic doc get. It is test-covered and
  documented as the secondary/revocation seam, but as shipped it is dead code; either wire it or
  drop it until needed.
- **N-4 (M5-T2)** — `zodResolver(submissionSchema) as never`
  (`src/features/attendees/components/register-attendee-dialog.tsx:123`). Matches two
  pre-existing occurrences (`personal-info-step.tsx:50`, `event-registration-form-card.tsx:110`),
  so accepted as repo precedent — but it is a type-safety escape hatch worth a shared typed
  helper someday.
- **N-5 (repo hygiene, commit `ce57f19`)** — `.gitignore` dropped the global `*.md` ignore while
  the comment two lines below still reads "exempt from *.md ignore" (stale), and the commit swept
  many non-M5 documents (`docs/*-plan.md`, `prototype/docs/`, `HANDOVER.md`, `.claude/agents/`)
  into the milestone branch — diff noise, no code impact.
- **N-6 (M5-T2)** — "Load more" appends each merged page after the previous rows, so global
  newest-first ordering can interleave across page boundaries, and cursors are shared across
  filter switches (`attendee-list-tab.tsx:125-162`). Harmless under the bounded-list convention;
  noting for the M8 server-search ticket. Similarly the CSV export caps at 1000 rows per source
  with no truncation marker in the file (matches the M3-T4 precedent).
- **N-7 (M5-T5)** — The `CHECKED_IN` response approximates `checkedInAt` with route time
  (`.../checkin/confirm/route.ts:113`, both variants) since the real value is a transaction
  serverTimestamp — commented and display-only ("at HH:mm"); fine.
- **N-8 (M5-T1)** — `adminFormData` ⇄ `on-submission-accepted` is a real ESM import cycle,
  intentional and documented (data model "ESM note"), references only inside function bodies,
  exercised by tests. Keep an eye on it if either module grows.

---

## Initial verdict (2026-07-13, superseded — see Re-review below)

| Ticket | Verdict | Notes |
|---|---|---|
| M5-T1 — Attendee entity + QR identity | CHANGES REQUESTED | S-1 (unguarded hook await is the root; healing contract has no shipped caller). N-3, N-8. |
| M5-T2 — Attendee roster screen | CHANGES REQUESTED | S-1 (register-route replay returns 200 without an attendee). N-2, N-4, N-6. |
| M5-T3 — Abandoned tab UI | **APPROVED** | PII masking server-side, boundary semantics inherited from the M3 DAL, all states covered. N-2 only. |
| M5-T4 — Check-in configuration screen | **APPROVED** | Lazy config, allow-list PATCH, one-time code contract all correct and tested. N-1 only. |
| M5-T5 — Check-in scan flow | **APPROVED** | Five result states, no-oracle gates, revocation re-check, idempotent confirm all verified. N-7 only. |

Overall (initial): CHANGES REQUESTED — S-1 returned M5-T1/M5-T2 to the Full-Stack Developer.

---

## Re-review — S-1 fix diff (2026-07-13, working tree on `feat/m5-attendees-checkin`)

Scope: uncommitted fix diff only — `src/lib/db/adminFormData.ts`,
`src/app/api/dashboard/events/[eventId]/attendees/register/route.ts`,
`src/features/responses/on-submission-accepted.ts` (comment-only change), plus tests in
`form-data-status.test.ts`, `attendees-register-route.test.ts`, `on-submission-accepted.test.ts`.

Checks re-executed this session: `npm run lint` ✅ (no warnings/errors), `npm run build` ✅
(exit 0), `npm test -- --run` ✅ **72 files / 965 tests passing** (baseline 959 + 6 net-new).

**S-1 is resolved.** All three consequences are addressed:

1. **Guarded hook** — `transitionAdminFormDataStatus` now wraps the post-commit accept hook in
   try/catch (`src/lib/db/adminFormData.ts:398-416`): the crash is logged with the submission id
   and cause (never silently swallowed) and surfaced to the caller as
   `acceptHookFailed?: boolean` on the ok result variant. A committed accept never propagates a
   hook throw. Asserted by `src/__tests__/form-data-status.test.ts:216` ("logs a crashing accept
   hook and returns ok + acceptHookFailed — the accept commit stands"), the healthy-path
   no-flag test, and the updated hook-failure contract test in
   `src/__tests__/on-submission-accepted.test.ts:307`.
2. **No false 200** — the register route treats "accepted" as success only once the Attendee
   actually exists (`src/app/api/dashboard/events/[eventId]/attendees/register/route.ts:293-329`):
   on replay (`INVALID_TRANSITION`) or `acceptHookFailed` it re-reads the submission via
   `getAdminFormDataForEvent`; a heal failure returns a truthful `500 ATTENDEE_CREATION_FAILED`
   with a logged cause, and a failed verification re-read also 500s. Asserted by
   `src/__tests__/attendees-register-route.test.ts:553` ("NEVER returns 200 while the attendee
   still cannot be created — truthful 500 + log") and `:574` ("500s (not a fake success) when the
   submission cannot be re-read").
3. **Shipped repair path** — the orphan shape (`status:"accepted"` + `attendeeCreated:false`) is
   healed by directly re-invoking the exported idempotent `onSubmissionAccepted`, covering both a
   fresh in-call hook crash (`acceptHookFailed`) and a replay retrying an earlier crash. The
   exact regression from the initial review is a named test
   (`attendees-register-route.test.ts:523`, "replay after a hook crash re-invokes
   onSubmissionAccepted and only then reports success (regression: was a false 200)"). The
   healthy accept performs zero extra reads — asserted (`getAdminFormDataForEvent` and the direct
   hook are not called on a clean accept, `:391-394`).

Notes (accepted, non-gating):
- The generic responses accept route now returns 200 on a hook crash (`acceptHookFailed` ignored
  there) — correct per spec T1 ("hook failure must not un-accept"); the loud DAL log provides
  observability, and the spec-documented M5 gap (no generic repair route) is unchanged.
- The remaining hunks in `adminFormData.ts` are formatting-only re-wraps — verified no logic
  change inside the transaction body.
- Prior nits N-1..N-8 stand as optional; no new findings in the fix diff.

### Final verdict

| Ticket | Verdict |
|---|---|
| M5-T1 — Attendee entity + QR identity | **APPROVED** |
| M5-T2 — Attendee roster screen | **APPROVED** |
| M5-T3 — Abandoned tab UI | **APPROVED** |
| M5-T4 — Check-in configuration screen | **APPROVED** |
| M5-T5 — Check-in scan flow | **APPROVED** |

**Overall: APPROVED.** No open Blockers or Should-fixes; all nits are optional. M5-T1..T5 hand
off to the Security Agent.

---

## M5-F1 (QA D-1) fix re-review (2026-07-13, working tree on `feat/m5-attendees-checkin`)

Scope: fix diff only — `src/app/api/dashboard/events/[eventId]/attendees/register/route.ts` and
`src/__tests__/attendees-register-route.test.ts`. Defect reference:
`agents/docs/qa/m5-attendees-checkin.md` D-1 (Minor, Orchestrator-ruled must-fix before merge):
the route's `selection.soldOut` precheck 409'd BEFORE `placeOrder`'s idempotency-replay lookup,
so at exact capacity (a) a retry of an already-successful registration got a false SOLD_OUT
instead of the same-refs 200, and (b) a crashed-hook orphan retry never reached the S-1
self-heal block.

**Fix verified correct:**

- The precheck is dropped entirely (`.../attendees/register/route.ts:214-218` is now a comment
  documenting why there is deliberately no precheck). `placeOrder` is the single capacity
  authority: its idempotency lookup runs before any capacity check
  (`src/lib/orders/place-order.ts:141-146`), and `mapPlaceOrderError` already maps
  SOLD_OUT/TYPE_FULL to the same 409 dialog error.
- **Public-finalize parity confirmed:** the public finalize route has no sold-out precheck
  either (`src/app/api/events/[eventId]/registration/finalize/route.ts` — grep shows only the
  SOLD_OUT case in its error mapper). The read-time `soldOut` check that remains in
  `src/app/api/events/[eventId]/registration/draft/route.ts:248` is the pre-payment step-2
  selection UX and is correctly untouched; `validateTicketSelection` is still called for
  eligibility × open × priced, which it must be.
- **T2 AC-5 coverage genuinely preserved:** the rewritten test
  (`attendees-register-route.test.ts:358`, "routes a sold-out selection through placeOrder (no
  precheck, D-1) — a FRESH registration still 409s SOLD_OUT") asserts the fresh-at-capacity 409
  with `code: SOLD_OUT` and that no FormData/transition runs; the original placeOrder-level
  AC-5 test (":467", SOLD_OUT → 409, no FormData, no transition) is unchanged. Capacity refusal
  is covered at both layers.
- **Promoted regression tests fail against the pre-fix route — verified empirically:** I
  temporarily restored the HEAD route and ran the "QA D-1" describe block: both tests fail
  ("replays an already-successful registration at full capacity: same refs, not SOLD_OUT" and
  "heals a crashed-hook orphan on retry even when the ticket now reads sold out"), then restored
  the fixed file (diff intact, suite green 21/21). The tests genuinely pin the defect.

Checks re-executed this session: `npm run lint` ✅ (no warnings/errors), `npm run build` ✅
(exit 0), `npm test -- --run` ✅ **72 files / 967 tests passing** (965 + 2 promoted D-1
regressions). No new findings; the working tree also contains a Research Lead spec amendment
(`agents/docs/specs/m5-attendees-checkin.md`, SEC L-4 reconciliation) which is documentation,
not code, and outside this re-review's scope.

### M5-F1 verdict

**APPROVED.** The D-1 fix is correct, minimal, matches the public-finalize convention, and both
QA regression scenarios are pinned by tests that demonstrably fail pre-fix. The prior overall
M5 approval stands: **all of M5-T1..T5 + M5-F1 APPROVED** — ready to proceed (Security review
of the S-1/M5-F1 fix diffs per loop rules, then merge).
