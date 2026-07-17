# Code Review — M7-T3 Scheduled report delivery

Code Reviewer, 2026-07-17. Scope: all uncommitted changes in the working tree
relative to `prototype` that belong to M7-T3 — new
`src/types/collection.ts` additions (`ReportScheduleDoc`,
`ReportScheduleRecipient`, `ReportScheduleFrequency`,
`REPORT_SCHEDULE_FREQUENCIES`); new `src/lib/db/{adminReportSchedule,
reportScheduleId,reportScheduleSchemas}.ts`; new
`src/lib/email/lifecycle/{evaluate-report-schedules,
report-schedule-periods}.ts`; modified
`src/lib/email/lifecycle/{dedupe-keys,evaluate-event}.ts`; modified
`firestore.rules`; new `src/features/reports/{schedule-schemas,
schedule-utils}.ts`; new
`src/features/reports/components/{report-schedule-form,
report-schedule-recipients-field,report-schedules-dialog}.tsx`; new
`src/features/reports/server/{read-json-body,serialize-report-schedule}.ts`;
new API routes under
`src/app/api/dashboard/events/[eventId]/reports/schedules/{route.ts,
[templateSlug]/route.ts}`; modified `reports-workspace.tsx`,
`report-templates-section.tsx`, `reports-route-scope.ts`,
`reports/page.tsx`, `src/features/reports/types.ts`; new test files
`admin-report-schedule.test.ts`,
`lifecycle-evaluate-report-schedules.test.ts`,
`lifecycle-evaluate-event-report-schedules.test.ts`,
`report-schedule-periods.test.ts`,
`report-schedule-recipients-field.test.tsx`,
`report-schedules-dialog.test.tsx`, `report-schedules-routes.test.ts`;
extended `lifecycle-dedupe-keys.test.ts`, `reports-page.test.tsx`,
`reports-route-scope.test.ts`. Reviewed against
`agents/docs/specs/m7-scheduled-reports.md`,
`agents/docs/data-models/m7-scheduled-reports.md`, and
`agents/AGENT_LOOP.md`'s Code Reviewer checklist. (`HANDOVER.md`,
`agents/docs/BACKLOG.md`, `memory/` excluded — orchestration bookkeeping,
not code, matching prior review precedent.)

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the same
  **pre-existing, unrelated** baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62` (3 files) —
  matches the Orchestrator's and every prior M7 ticket's reported baseline
  exactly. None touch any file in this diff's scope.
- `npm run build` — PASS, exit 0. `/dashboard/events/[eventId]/reports` and
  both new schedule CRUD routes
  (`/api/dashboard/events/[eventId]/reports/schedules`,
  `.../schedules/[templateSlug]`) appear in the route manifest as dynamic
  functions with no build errors.
- `npm test -- --run` — PASS, **147 files / 1696 tests** (up from the
  Backend-slice-only 144/1663 the Orchestrator reported, consistent with
  Full-Stack's UI/route test files landing on top of Backend's DAL/evaluator
  tests in the same working tree).

---

## Mandatory-check results

### 1. Recipient re-verification — write-time reject-all vs. fire-time drop-one (the ticket's central correctness requirement)

**Both behaviors are correctly and distinctly implemented. This is the most
important finding of this review, so it is stated up front and unambiguously:**

- **Write-time (`upsertAdminReportSchedule`,
  `src/lib/db/adminReportSchedule.ts:205-256`) is genuinely all-or-nothing.**
  Every candidate in `patch.recipientEmails` is resolved via
  `verifyReportScheduleRecipient` (`:161-178`) **before** the Firestore
  transaction begins (`:241-246`); if `notMembers.length > 0` the function
  returns `{ ok:false, code:"NOT_A_MEMBER", emails:[...] }` and **returns
  before `adminDb.runTransaction` is ever called** (`:250-252`) — zero doc is
  read or written. A schedule with 3 recipient candidates where 1 fails
  membership rejects the *entire* write, not just the bad entry. Verified by
  `admin-report-schedule.test.ts:190-215` ("rejects the whole write when ANY
  recipient is not a current org member — zero write") which asserts both the
  typed rejection *and* that `listAdminReportSchedulesForEvent` returns zero
  docs afterward — a real behavioral assertion, not a mocked return-value
  check.
- **Fire-time (`evaluateReportScheduleTrigger`,
  `src/lib/email/lifecycle/evaluate-report-schedules.ts:183-249`) silently
  drops exactly the departed recipient(s) from that one send, never errors
  the whole schedule.** For each due period, every **currently stored**
  recipient (freshly re-read via `reloadSchedule`, `:117-125`, at the top of
  the period loop) is re-checked via `getAdminUserMembership` (`:201-208`); a
  `null` membership simply isn't pushed into `verified` — no exception is
  thrown, no error result is returned, and critically the schedule's own
  `recipients` array on the stored doc is **never mutated** by this check.
  Verified by
  `lifecycle-evaluate-report-schedules.test.ts:167-199` ("fire-time
  re-verification: 3 recipients, 1 departed, sends to exactly 2 — no error,
  no crash"), which additionally re-reads the stored doc after the fire and
  asserts `stored.recipients` still has length 3 — proving the drop is
  scoped to that one send and never persisted back onto the schedule config,
  exactly as D2 requires. The "all recipients departed" edge case (§7) is
  separately covered (`:201-218`) and confirmed to `pagesProcessed: 1,
  enqueued: 0, transport.send not called` — a calm no-op, not a crash.

These are two independently-reviewed code paths using two different
functions (`upsertAdminReportSchedule`'s pre-transaction `Promise.all` loop
vs. `evaluateReportScheduleTrigger`'s per-period loop) with two deliberately
different failure semantics, and both match the spec's D2 language exactly
("zero write" at add-time vs. "silently excluded... no error surfaced" at
fire-time). No confusion between the two moments was found anywhere in the
diff.

### 2. Zero PII/data in the email body

`buildReportScheduleEmailCopy`
(`src/lib/email/lifecycle/evaluate-report-schedules.ts:77-88`) builds the
subject/body from exactly three inputs: `templateName`, `eventName`, and
`link` — no row data, no attendee identifiers, no dollar amounts, and the
function has no access to any report-row/Attendee/Order query result to leak
in the first place (the evaluator never queries those collections). The body
text is a fixed three-line template ending with an explicit disclaimer:
`"This is an automated notification — no report data is included in this
email."` Verified by
`lifecycle-evaluate-report-schedules.test.ts:285-303` (asserts the exact
deep link is present and `bodyText` does not match `/\$\d/`) — a genuine
fixture-based scan, matching spec §5 AC-3's own requirement. Confirmed the
render pipeline this content passes through
(`deriveBodyForDefinition`/`deriveBodyHtmlTemplate`,
`src/features/emails/server/render.ts:79-90,154-179`) is the **unmodified**
T1/T4 pipeline — HTML-escape then paragraph-wrap, no new templating surface
introduced for this call site — and that `validateRenderedEmailContent`
(`send-service.ts:270`) still runs unconditionally for every send including
this one (spec §5 AC-4), confirmed by direct read, not just by the module
comment's claim.

### 3. Deep-link fallback safety

`buildReportScheduleDeepLink`
(`evaluate-report-schedules.ts:65-72`) is a two-line pure function: with a
non-null `baseUrl` it prefixes the path; with `null` it returns the bare
site-relative path unchanged — no header/request-derived value is ever
consulted at this call site. The `baseUrl` itself comes from
`resolveEmailBaseUrl()` (`src/lib/email/base-url.ts:33-52`), independently
re-read this session: sourced **exclusively** from
`process.env.NEXT_PUBLIC_APP_URL`, validated as a well-formed `http(s)`
absolute URL via `new URL()` + a protocol allowlist, returning `null` on any
failure — the file's own header comment explains this is deliberate (Host/
X-Forwarded-Host headers are attacker-controlled and must never seed a link
embedded in outbound email). Confirmed the fallback case is exercised by a
real test
(`lifecycle-evaluate-report-schedules.test.ts:305-319`, "falls back to a
site-relative deep link when NEXT_PUBLIC_APP_URL is unset" — asserts
`bodyText` contains the bare path and does **not** contain `"http"`).
Additionally confirmed this relative link is never turned into a clickable
`<a href>` at this call site (plain-text body mode renders through
`deriveBodyHtmlTemplate`'s HTML-escape+wrap, never through the
`isEmailSafeUrl`-gated anchor renderers block-mode uses) — so
`isEmailSafeUrl`'s documented "rejects every relative path" behavior
(referenced in `base-url.ts`'s own comment) is not a relevant constraint
here; the fallback link is inert, visible text, not an anchor attribute, and
degrading to it does not risk being silently stripped or rejected by
`validateRenderedEmailContent`. Matches the Orchestrator's spot check.

### 4. Dedupe correctness

`reportScheduleDedupeKey(scheduleId, periodKey)`
(`src/lib/email/lifecycle/dedupe-keys.ts:59-64`) returns
`` `${scheduleId}:${periodKey}` `` with no recipient component. Independently
read `emailMessageId()` (`src/lib/db/emailMessageId.ts:25-41`) — confirmed
it hashes `(organizationId, eventId, kind, recipientEmail.toLowerCase(),
dedupeKey)` as five separate array elements in `JSON.stringify` before
hashing, so two recipients sharing one `dedupeKey` string genuinely produce
two different hash inputs (differing in the fifth vs. the recipientEmail
element, not overlapping in the string) and therefore two distinct doc ids.
This was independently verified, not just trusted from the comment. Also
confirmed by a new dedicated test group,
`lifecycle-dedupe-keys.test.ts` (`reportScheduleDedupeKey` describe block,
appended lines 73-102): formula shape, cross-schedule non-collision,
cross-period non-collision, and determinism — plus the integration-level
proof in `lifecycle-evaluate-report-schedules.test.ts:141-165` that a
second sweep tick for the *same* period produces zero additional enqueues
(the create-if-absent property in practice, not just in isolation).

### 5. `evaluate-event.ts` integration — pure addition, no regression to existing M6-T3 trigger types

Read the full diff of `evaluate-event.ts`. The report-schedule loop
(`:180-206`) is appended strictly **after** the existing
abandoned/unpaid-offsets/scheduled-definition loops, in its own `for`
block, pushing into the same shared `results` array — it does not touch any
line inside the three pre-existing loops, does not alter `mergeEmailDefinitions`
inputs/outputs, does not change `abandonedDefinition`/`paymentReminderDefinition`/
`scheduledDefinitions` derivation, and introduces no shared mutable state
between the new loop and the old ones (each loop's `outcome` is independently
scoped). `listAdminReportSchedulesForEvent` is a brand-new DAL call, not a
repurposing of any M6-T3 query. Confirmed with a dedicated regression test,
`lifecycle-evaluate-event-report-schedules.test.ts`, which asserts (a) a
due `ReportSchedule` produces a result entry alongside `abandoned-reminder`/
`payment-reminder` kinds still present in the same pass, and (b) a
zero-schedule event adds zero report-schedule result entries with no crash —
the exact "pure addition, additive-only" property this scrutiny required,
matching M6-T4's own extension precedent.

### 6. DAL boundary, cross-org isolation, naming, dead code, oversized files, test quality

- **DAL boundary:** grepped every modified/new file for `firebase-admin`/
  `firebase/firestore` imports outside `src/lib/db/`. The only hits outside
  that directory are (a) `src/types/collection.ts`'s existing, pre-M7-T3
  type-only `import type { Timestamp, FieldValue } from "firebase/firestore"`
  (already-established codebase convention for the pure-types module, not
  new), and (b) two new/extended test files
  (`lifecycle-evaluate-report-schedules.test.ts`,
  `lifecycle-evaluate-event-report-schedules.test.ts`) importing
  `Timestamp` from `firebase-admin/firestore` for fixture construction —
  matching 14 other pre-existing test files' identical pattern. No violation.
- **Cross-org isolation:** `getAdminReportScheduleForEvent` re-checks
  `organizationId`/`eventId` against the doc even though the deterministic id
  already encodes the tuple (defense in depth, matching every other admin
  DAL read in this codebase); `listAdminReportSchedulesForEvent` filters on
  both fields in the query itself; `verifyReportScheduleRecipient` is always
  called with the schedule's own `organizationId`, never a caller-suppliable
  value. Cross-org tests exist at every layer: DAL
  (`admin-report-schedule.test.ts:217-231,294-357,386-...`), evaluator
  (`lifecycle-evaluate-report-schedules.test.ts:248-263`), and routes
  (`report-schedules-routes.test.ts:167-179,221-229`).
- **Backend's self-reported cleanup verified:** re-read the full
  `collection.ts` diff — the `ReportSchedule` block is defined exactly once
  (`:886-963`), with a trailing comment (`:965-971`) documenting the removal
  of a Full-Stack-authored provisional duplicate; grepped the whole diff and
  found no second definition of `ReportScheduleDoc`/`ReportScheduleRecipient`/
  `ReportScheduleFrequency` anywhere, and no orphaned/dangling type left
  behind. Clean.
- **Naming/structure:** every new file follows the exact sibling-module
  precedent it claims to (`reportScheduleId.ts` mirrors
  `emailDefinitionId.ts`'s shape; `read-json-body.ts` mirrors
  `emails/server/read-json-body.ts`; `reports-route-scope.ts`'s new `userId`
  field mirrors `RegistrationRouteScope.userId` 1:1). No duplicated
  utility/helper logic found — the client-side `schedule-schemas.ts` is a
  deliberate, explicitly-commented mirror of the server-only
  `reportScheduleSchemas.ts` (client bundles cannot import a `server-only`
  module), the same pattern every other RHF dialog in this codebase already
  uses.
- **File sizes:** `adminReportSchedule.ts` 358 lines, `report-schedule-form.tsx`
  419 lines, `report-schedules-dialog.tsx` 355 lines,
  `evaluate-report-schedules.ts` 252 lines, `report-schedule-periods.ts` 174
  lines — all comfortably under the 800-line hard cap and close to the
  200-400-line typical range; no oversized file or function found (longest
  single function, `upsertAdminReportSchedule`, is ~50 lines of real logic
  once comments are excluded, split further into the read/verify/transact
  phases via early returns).
- **Test quality:** every new/extended test file asserts real behavioral
  outcomes (enqueued counts, exact dedupe keys, exact rejected-email lists,
  stored-doc mutation/non-mutation, rendered body content) rather than
  snapshotting empty renders or asserting only "no crash." Confirmed by
  direct read of `admin-report-schedule.test.ts`,
  `lifecycle-evaluate-report-schedules.test.ts`,
  `lifecycle-evaluate-event-report-schedules.test.ts`,
  `report-schedules-routes.test.ts`,
  `report-schedule-recipients-field.test.tsx`,
  `report-schedules-dialog.test.tsx`, `report-schedule-periods.test.ts`
  (leap/non-leap Feb clamping, catch-up ceiling, `notBeforeMs` floor).

### 7. Zod case-normalization ordering (a subtlety worth documenting, not a bug)

Independently verified — because it looked like a plausible bug on first
read — that `reportScheduleRecipientEmailsSchema`'s duplicate check
(`z.array(emailAddressSchema).refine(emails => new Set(emails).size ===
emails.length, ...)`, `src/lib/db/reportScheduleSchemas.ts:37-46`) runs
**after** each array element has already been through
`emailAddressSchema`'s own `.transform(v => v.toLowerCase())`
(`src/lib/email/schemas.ts:37-44`) — Zod applies the array's element schema
(transform included) before any array-level `.refine`, confirmed with a
standalone repro against this repo's actual `zod` version. So
`["A@x.com", "a@x.com"]` **is** correctly caught as a duplicate at the Zod
layer, before `verifyReportScheduleRecipient` or the recipient cap ever see
it — no case-variant duplicate-recipient gap exists.

---

## Findings

**Blockers: 0**

**Should-fix: 0**

**Nits: 1**

1. **N-1 (nit, `src/app/api/dashboard/events/[eventId]/reports/schedules/[templateSlug]/route.ts:82-94` vs. `route.ts:61-64`) — rate-limit ceilings are inconsistent across the three mutating verbs with no stated rationale:** `POST` (create) and `DELETE` both use `{ limit: 20 }` per bucket, while `PATCH` (edit/pause/resume) uses `{ limit: 60 }`. Functionally harmless (all three are real, working rate limits, not a missing-limit issue), and pause/resume plausibly needs a higher ceiling than create/delete given the "resend full config to toggle enabled" design (`report-schedules-dialog.tsx`'s `toggleEnabled`, itself a reasonable, spec-consistent choice given there's no lightweight toggle entrypoint). Worth a one-line comment explaining the differing ceiling the next time this file is touched, but not worth blocking on.

## Verdict: **APPROVED**

Both halves of the ticket's central correctness requirement — write-time
all-or-nothing recipient rejection (`upsertAdminReportSchedule`) and
fire-time silent per-recipient drop (`evaluateReportScheduleTrigger`) — are
independently, correctly implemented and each has a direct, behavior-level
test proving it. The zero-PII email-body requirement, the safe (non-header-
derived) deep-link fallback, the dedupe-key/`emailMessageId` interaction,
and the `evaluate-event.ts` extension's purity relative to the three
existing M6-T3 trigger types were all independently re-verified against the
actual code (not just the data-model doc's claims) and hold. DAL boundary,
cross-org isolation, and the reconciliation cleanup in `collection.ts` are
clean. `npm run lint`, `npx tsc --noEmit`, `npm run build`, and
`npm test -- --run` (147 files / 1696 tests) all pass, with `tsc`'s only
output being the pre-existing, unrelated 3-file baseline. Cleared to
proceed to the Security Agent.
