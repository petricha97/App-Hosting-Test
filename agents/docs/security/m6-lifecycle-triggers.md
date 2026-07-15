# Security Review — M6-T3 Lifecycle triggers & audience segmentation

Security Agent, 2026-07-16. Scope: all uncommitted M6-T3 changes relative to
`prototype` — new `src/lib/email/lifecycle/**` (13 files), new
`src/app/api/internal/email-triggers/evaluate/route.ts`, new
`src/features/emails/server/{fire-on-accept-email,fire-on-submit-email,resolve-definition}.ts`,
new `src/app/api/dashboard/events/[eventId]/drafts/email-all/route.ts`,
modified `src/features/responses/on-submission-accepted.ts`, both on-submit
routes (`register/route.ts`, `registration/finalize/route.ts`),
`src/lib/db/{adminOrder,adminFormData,adminRegistrationDraft,adminEvent}.ts`,
`firestore.indexes.json`, `apphosting.yaml`, and the associated UI/test
files. Reviewed against `agents/docs/specs/m6-lifecycle-triggers.md`,
`agents/docs/data-models/m6-lifecycle-triggers.md`,
`agents/docs/reviews/m6-lifecycle-triggers.md` (Code Review: APPROVED, this
ticket's own N-3 flagged for Security), and the M6-T2 security baseline
(`agents/docs/security/m6-emails-admin.md`) this ticket builds on.

Gate 2 of 3 (code review APPROVED → security → QA). This is the first
unattended/automated email-sending logic in the app and the first
non-session-authenticated API route — both get dedicated focus below.

## Checks executed

- `npm run lint` — clean, `✔ No ESLint warnings or errors`.
- `npm run build` — succeeds; `/api/internal/email-triggers/evaluate` and
  `/api/dashboard/events/[eventId]/drafts/email-all` both compile and appear
  in the route manifest, alongside every pre-existing route.
- `npm test -- --run` — **109 files / 1309 tests passing**, matching the
  Code Reviewer's reported count exactly (single clean run, no flake this
  session).
- `npm audit --audit-level=high` — same 23 pre-existing findings already
  flagged by the M6-T1/M6-T2 security reviews (firebase-admin/
  `@google-cloud/firestore` chain, vite, vitest); `git diff prototype --stat
  -- package.json package-lock.json` is empty — no new dependency surface.
- Manual line-by-line read of `evaluator-auth.ts`, `evaluate/route.ts`,
  `draft-token.ts` (the `constantTimeStringEqual` primitive it reuses),
  `drafts/email-all/route.ts`, `fire-on-submit-email.ts`,
  `fire-on-accept-email.ts`, `on-submission-accepted.ts`, both on-submit
  route diffs, `audience-queries.ts`, `paged-trigger-runner.ts`,
  `evaluate-event.ts`, `run-sweep.ts`, `evaluate-unpaid-offsets.ts`,
  `evaluate-scheduled.ts`, `qr.ts`, `send-service.ts`'s
  `sendEventEmail`/`sendEventEmailBatch` (T1, reused unmodified),
  `apphosting.yaml`'s diff, and a full `firestore.rules` diff (empty, as the
  data-model doc claims).

---

## Focus-area findings

### 1. Internal entrypoint auth mechanics (`evaluator-auth.ts`) — PASS

- **Fail-closed in production, verified by direct read, not by comment.**
  `resolveSecret()` (`src/lib/email/lifecycle/evaluator-auth.ts:23-45`):
  when `EMAIL_TRIGGER_EVALUATOR_SECRET` is unset/blank AND
  `NODE_ENV === "production"`, returns `null`; `verifyEvaluatorRequestSecret`
  (`:53-62`) unconditionally returns `false` when `expected === null` —
  every request rejected, never a silent pass-through and never a fallback
  to the dev secret in prod. The dev-only fallback path is gated behind an
  explicit `NODE_ENV !== "production"` check, identical structure to
  `QR_TOKEN_SECRET`/`DRAFT_TOKEN_SECRET`.
- **Constant-time comparison, and it does not leak length either.**
  `constantTimeStringEqual` (`src/lib/draft-token.ts:133-137`, reused
  verbatim) SHA-256-hashes *both* operands to a fixed-width digest before
  `timingSafeEqual` — so, unlike a naive `crypto.timingSafeEqual(bufA, bufB)`
  called directly on variable-length inputs (which throws/short-circuits on
  a length mismatch and would leak the secret's length), this construction
  gives no timing signal on the length of the guess either. Confirmed this
  is the actual function called (`evaluator-auth.ts:10,61`), not a
  parallel/forked comparison.
- **Generic response, no oracle.** `evaluate/route.ts:54-61` returns the
  identical `{ error: "Unauthorized." }` / 401 for a missing header, a wrong
  secret, and a server-misconfigured (unset-in-prod) secret — one code path,
  one message, confirmed by reading the literal branch (`if
  (!verifyEvaluatorRequestSecret(...))`), not three distinguishable ones.
- **Blast radius if the secret leaks, reasoned through explicitly (per the
  ticket brief's ask):** the secret is a bearer credential for exactly one
  route. It does not grant DB access, does not grant any other route's
  auth, and cannot be used to forge a session or a different capability
  token (`QR_TOKEN_SECRET`/`DRAFT_TOKEN_SECRET`/`SCANNER_SESSION_SECRET` are
  independent secrets). What it DOES grant a holder: (a) the ability to
  invoke a full multi-org sweep (or a targeted single-event sweep) on
  demand, repeatedly, with attacker-chosen `pageSize`/`maxPages`/`maxEvents`
  within the route's Zod bounds; (b) read access to aggregate per-event send
  counts (`eventId`, `enqueued`/`duplicates`/`rejected`/`failed`,
  `stoppedReason`) across every org's Published events in sweep mode — never
  recipient PII, but real cross-tenant metadata (which events exist, roughly
  how active their email traffic is). This second point is an *inherent,
  accepted* property of an ops-only endpoint whose entire job is
  cross-tenant orchestration — not a new problem, provided the secret is
  treated with the same operational care as the other three `apphosting.yaml`
  secrets. **It does NOT let a holder cause duplicate/extra sends beyond what
  the real audience already qualifies for** (every send is dedupeKey-gated
  regardless of how many times or how aggressively the route is invoked) —
  the real risk of a leaked secret is cost/availability (see Finding 2), not
  data corruption or double-sending.

**Verdict: auth mechanics are sound. No bypass, no timing oracle, no
response-based oracle.**

### 2. N-3 — Internal evaluator route has no rate limiting — MEDIUM, real verdict below

`src/app/api/internal/email-triggers/evaluate/route.ts` gates purely on
`verifyEvaluatorRequestSecret` (Finding 1) with **zero call to
`checkRateLimit`** anywhere in the file — confirmed by `grep -n
"checkRateLimit\|rate-limit" src/app/api/internal/email-triggers/evaluate/route.ts`
returning nothing. This is the only mutating/side-effecting route in the
entire codebase with no rate limit at all, including its own sibling
`drafts/email-all/route.ts` (`checkRateLimit`, limit 10/min,
`email-all/route.ts:44-46`).

**The direct question this ticket asks me to answer: is a fail-closed
shared secret sufficient on its own, or does this route need rate-limiting
anyway? My verdict: it needs rate-limiting anyway. Add it — this is a
should-fix, not an acceptable permanent posture.**

Reasoning, not a hedge:

- **The threat model isn't "can someone guess the secret"** (a
  high-entropy Secret-Manager-provisioned value is not brute-forceable
  online, and Finding 1 already confirms no timing oracle) — **it's "what
  backstops a caller who already has the secret through some means other
  than guessing it."** Realistic paths to that: (a) the secret leaking via
  a misconfigured log/proxy/CI variable dump (the exact scenario
  `DRAFT_TOKEN_SECRET`'s own commentary worries about — "a Firestore leak"
  analog here is "a logs/CI leak"); (b) a Cloud Scheduler misconfiguration —
  a bad retry policy, a duplicated job, or a cadence typo (15 seconds
  instead of 15 minutes) — firing this route far more often than the
  documented 15–30 minute cadence; (c) the job's own retry-on-5xx or
  retry-on-timeout behavior compounding with a slow tick, causing
  overlapping concurrent invocations. None of these require defeating the
  secret itself — they're exactly the class of failure rate-limiting exists
  to backstop, and every other route in this codebase (including this
  route's own sibling) is rate-limited precisely because "the auth check
  passed" and "this should be allowed to happen 1000 times a second" are
  different questions.
- **The blast radius is real, not theoretical, because of how generous the
  request schema's bounds are.** `evaluate/route.ts:32-42`'s
  `EvaluateRequestSchema` allows `maxEvents` up to 200, `pageSize` up to
  500, and `maxPagesPerTrigger` up to 200 per call — far above the
  documented defaults (`DEFAULT_LIFECYCLE_SWEEP_MAX_EVENTS = 25`,
  `DEFAULT_LIFECYCLE_PAGE_SIZE = 100`,
  `DEFAULT_LIFECYCLE_MAX_PAGES_PER_TRIGGER = 20`,
  `run-sweep.ts:34`/`evaluate-event.ts:35-36`). A single call at the Zod
  ceiling, across ~5 triggers/event (abandoned + payment-reminder + up to
  N scheduled definitions), is a very large number of bounded-but-numerous
  Firestore reads (Order/Attendee/FormData/RegistrationDraft queries) —
  this won't complete in one request before a platform timeout kills it, but
  the read/write cost is incurred regardless of whether the invocation
  finishes, and nothing stops a caller from repeating that same
  worst-case-bounds call in a tight loop. **A correctness bug cannot result**
  (dedupeKey makes every repeat a no-op duplicate for already-processed
  candidates), but a **Firestore cost/quota exhaustion and
  request-concurrency DoS against this app's own backend** absolutely can,
  and it would degrade every other tenant's dashboard traffic sharing the
  same Firestore project/App Hosting instances, not just email sending.
- **This is not a hypothetical "belt and suspenders" ask** — the ticket's
  own spec (§8) and the sibling "Email all" route both treat rate/volume
  safety as a first-class requirement for exactly this class of route, and
  the Code Reviewer's own N-3 explicitly asked for a "deliberate decision,
  not an oversight." My deliberate decision: fail-closed auth is necessary
  but not sufficient here, because it protects against unauthorized callers,
  not against a valid-secret caller invoked far more often than intended
  (misconfiguration) or an operator who wants a hard ceiling on Firestore
  spend regardless of cause.

**Remediation (routed to Backend Agent):** add a coarse `checkRateLimit`
call to `POST /api/internal/email-triggers/evaluate`, keyed on something
stable across all legitimate callers since there's no per-caller identity
here (e.g. a fixed key like `email-trigger-evaluate:global`, or
`email-trigger-evaluate:${eventId ?? "sweep"}` for the targeted-vs-sweep
split) at a limit generous enough for the documented 15–30 minute cadence
plus reasonable operator/test double-invocation (e.g. 6/min — 4x the
fastest documented legitimate cadence, cheap insurance, matches the
`checkRateLimit` utility already imported by the sibling route) — this is
the same copy-paste-level fix pattern as M6-T2's M-1. **Secondary,
lower-cost fix worth bundling:** tighten the Zod ceiling on
`maxEvents`/`pageSize`/`maxPagesPerTrigger` down closer to the documented
defaults (e.g. 2x rather than 5-10x the default), since no legitimate Cloud
Scheduler caller needs anywhere near 200×500×200 in one shot, and today the
schema permits a request body far more powerful than the route's own
documented safe defaults.

**Severity: Medium.** Does not block QA under this loop's Critical/High
gate (no data corruption, no double-send, no cross-tenant data exposure
results from this gap — only a cost/availability exposure conditioned on
already possessing a leaked secret or a scheduler misconfiguration), but
should be treated as should-fix-before-or-alongside-QA, consistent with how
M6-T2's M-1 was handled.

### 3. Mass-send authorization / IDOR — PASS

- **"Email all" route** (`src/app/api/dashboard/events/[eventId]/drafts/email-all/route.ts`)
  gates via `resolveRegistrationRouteScope(eventId)` (`:39-42`) — the same
  session → org membership → `write:events` → `getAdminEventForOrganization`
  (404 on cross-org) convention every M1–M5 mutating route uses. Every
  downstream DAL call (`getAdminRegistrationDraftsForEvent`,
  `resolveEffectiveEmailDefinition`) is passed `scope.organizationId`, never
  a client-supplied org id — a `write:events` holder for org A cannot cause
  org B's drafts to be read or emailed; a org-A-scoped call against org B's
  `eventId` 404s before any draft is ever read (same tenancy posture as the
  rest of this feature, unchanged).
- **Internal evaluator route.** `EvaluateRequestSchema`'s `.refine`
  (`evaluate/route.ts:40-42`) enforces `eventId` and `organizationId` are
  supplied together — never a bare `eventId` that could be paired with an
  attacker-chosen org. `runLifecycleTriggerSweep`'s targeted path
  (`run-sweep.ts:73-91`) resolves the event via
  `getAdminEventForOrganization(eventId, organizationId)` — the same
  IDOR-safe getter used everywhere else in this codebase; a mismatched
  org/event pair is a `0`-events no-op (`{ eventsEvaluated: 0, events: [] }`),
  never an error that discloses whether the event exists under a different
  org. This is the *only* input surface on this route (the secret is a
  bearer credential, not a session — there is no "caller's own org" to
  escalate beyond, since a valid secret already grants sweep access to every
  org by design).
- **Every periodic evaluator write carries both ids.** `evaluate-event.ts`,
  `audience-queries.ts`, and `paged-trigger-runner.ts` all thread
  `organizationId`/`eventId` through every DAL call
  (`listAdminEmailDefinitionsForEvent`, `listAdminOrdersForEventByPaymentStatus`,
  `getAdminAttendeeBySubmissionId`, `getAdminRegistrationDraftsForEvent`,
  `listAdminFormDataForEventByStatuses`) — confirmed by direct read, no bare
  single-id lookup exists anywhere in the new lifecycle module tree.

**Verdict: no path found for a caller (session-authenticated or
secret-authenticated) to trigger a send scoped to a different org/event than
the one they're authorized for (or, for the internal route, than the one
explicitly named in the request).**

### 4. Header injection / XSS in automated sends — PASS

Every new send call site was checked against whether it constructs email
content independently or reuses T1's safe pipeline
(`renderEmailTemplate` → `validateRenderedEmailContent` →
`createAdminEmailMessageIfAbsent`, `src/lib/email/send-service.ts`):

- `fire-on-submit-email.ts:63-78` → `sendEventEmail` — unmodified call
  shape, same as T2's test-send.
- `fire-on-accept-email.ts:97-113` → `sendEventEmail` — same.
- `paged-trigger-runner.ts:151-175` (invalid-recipient path) and `:179-192`
  (valid-recipient batch path) → `sendEventEmail` /
  `sendEventEmailBatch` respectively — same.
- `drafts/email-all/route.ts:113-125` → `sendEventEmailBatch` — same.
- `sendEventEmailBatch` itself (`send-service.ts:421-474`) is confirmed
  **unmodified** (byte-for-byte, per the data-model doc's own §6 claim,
  independently verified by reading it) and calls `sendEventEmail` once per
  recipient (`:450-464`) — so every one of the five new call sites in this
  ticket ultimately funnels through the exact same `sendEventEmail`
  function T1/T2's security review already verified: `escapeHtml`-before-
  substitution for the HTML body, independently-escaped merge values,
  control-character stripping on the fully rendered subject
  (`validateRenderedEmailContent`), and the sandboxed, script-free preview
  path (unrelated to these send paths, but confirming no parallel unsafe
  rendering path was introduced).
- No new call site builds a raw HTML string, a raw header string, or
  bypasses `validateRenderedEmailContent` — grep confirms `escapeHtml`,
  `renderEmailTemplate`, and `validateRenderedEmailContent` each have
  exactly one implementation (`merge-tags.ts` / `schemas.ts`), never
  shadowed or forked by any of the new `src/lib/email/lifecycle/**` or
  `src/features/emails/server/{fire-on-submit-email,fire-on-accept-email}.ts`
  files.

**Verdict: no exploitable XSS or header-injection path introduced by any of
the five new automated-send callers; all reuse T1/T2's already-hardened
pipeline unmodified.**

### 5. PII exposure (unmasked draft email) — PASS, with one Low finding

- **The full, unmasked draft email is used correctly and only where the
  spec authorizes it.** `evaluate-abandoned.ts` → `audience-queries.ts`'s
  `queryAbandonedAudiencePage` (`:49-102`) reads `draft.email` (the raw
  denorm), never a masked display value — matching spec §3's explicit
  carve-out. `drafts/email-all/route.ts:91-98` does the same
  independently. Both feed it only into `sendEventEmail`/
  `sendEventEmailBatch`'s `recipient.email` — i.e., into the actual send,
  never into a log line or an unrelated response field.
- **No console logging of email addresses anywhere in this diff.** `grep -rn
  "console\." src/lib/email/lifecycle/ src/features/emails/server/
  src/app/api/internal/ src/app/api/dashboard/events/\[eventId\]/drafts/`
  shows exactly 4 `console.error`/`console.warn` call sites
  (`fire-on-accept-email.ts:116,126`, `fire-on-submit-email.ts:81,90`,
  `evaluator-auth.ts:36`) — every one logs only `submissionId`/`attendeeId`/
  a static warning string, never `recipient.email`/`draft.email`. Confirmed
  by reading each call site directly, not by grepping for the word "email"
  (which would false-positive on the many non-PII "email" identifiers in
  this codebase).
- **The internal route's HTTP response is summary-only, per spec §8, and
  confirmed by direct read.** `evaluate/route.ts:87-103` returns
  `eventsEvaluated`/`eventId`/`kind`/count fields only — no `recipient`
  field, no `email` field, anywhere in the response shape. This is the
  response most likely to land in scheduler/proxy logs, and it is
  deliberately PII-free.

- **L-3 (Low) — the "Email all" route's failure path DOES echo raw,
  unmasked draft emails back to the caller's browser, and a single
  malformed entry fails the ENTIRE batch instead of being isolated.**
  `drafts/email-all/route.ts:86-89` filters out drafts with an *empty*
  email, but — unlike `paged-trigger-runner.ts`'s deliberate
  `emailRecipientSchema.safeParse` pre-split (`:117-147`, built specifically
  so "a single malformed recipient must never poison an otherwise-valid
  page") — it does **not** validate the email's *format* before handing the
  whole list to `sendEventEmailBatch`, which is documented as all-or-nothing
  on recipient validation (`send-service.ts:428-442`: any invalid entry ⇒
  `{ ok: false, code: "INVALID_RECIPIENTS", invalid: [...] }` for the WHOLE
  call, zero sends attempted for anyone). The route then returns that
  `invalid` array — which includes each failing entry's raw
  `recipient.email` (`send-service.ts:429-438`, `entry.recipient.email`) —
  directly in its 400 JSON response (`email-all/route.ts:127-132`):
  `NextResponse.json({ error: "Some recipients were invalid.", invalid:
  result.invalid }, { status: 400 })`.
  - **Reachability:** the public draft flow's non-required "email"-type
    form field is validated with a looser regex (`/\S+@\S+\.\S+/`,
    `src/features/form/schema.ts:228-230`) than the internal
    `emailAddressSchema` used by `emailRecipientSchema`
    (`src/lib/email/schemas.ts:35-42`, which also rejects control
    characters via `hasControlChars` and caps length at 254). `\S` matches
    most non-whitespace control characters, so a non-required email field
    could in principle store a value that clears the draft flow's own
    validation but fails `emailAddressSchema` at send time. The
    *mandatory* `email` field (present on every real form, per this
    ticket's own commentary) is normally `required`, which uses the
    stricter `.email()` validator — so the common path is unlikely to hit
    this, but the codebase does not guarantee the two validators can never
    diverge, and this route is the one place that divergence becomes
    both a functional footgun (one bad draft silently blocks "Email all"
    for every other legitimate recipient in the same click — the exact
    failure mode `paged-trigger-runner.ts` was explicitly built to avoid)
    and a data-exposure footgun (unmasked emails riding in a 400 body).
  - **Impact ceiling:** this is same-org data the calling `write:events`
    holder is already independently entitled to read (the draft doc itself,
    per M3-T5's own "full email available to write:events holders for
    legitimate follow-up" rule) — there is no cross-tenant or
    unauthorized-party exposure here. This is a robustness/consistency
    issue, not a confidentiality breach across a trust boundary.
  - **Remediation:** apply the same pre-split pattern
    `paged-trigger-runner.ts` already uses — validate each draft's
    `recipient` with `emailRecipientSchema` before batching, route invalid
    entries through individual `sendEventEmail` calls (typed rejection, zero
    write, no batch poisoning) exactly like the periodic evaluator does, and
    stop returning `result.invalid` verbatim in the client-visible response
    (surface a count, not the raw array, matching the internal route's own
    "summary counts only" posture). Route to the Full-Stack Developer —
    this is a same-file-tree, same-pattern fix, not a design question.

**Verdict: no PII exposure beyond the authorized send itself in logs or the
internal route's response; one Low finding on the "Email all" route's error
path echoing unmasked emails to an already-entitled caller and being
needlessly all-or-nothing.**

### 6. Rate/volume as a DoS vector (bounded paging) — PASS, ties into Finding 2

- Every §6 audience query is bounded and cursor-paginated
  (`LIFECYCLE_AUDIENCE_PAGE_SIZE = 100` default,
  `audience-queries.ts:27`) — confirmed no query in `audience-queries.ts`
  omits a `limit`.
  `paged-trigger-runner.ts:95` bounds the per-trigger loop at
  `input.maxPages` and never hands `sendEventEmailBatch` more than one
  page's worth of recipients per call (`:178-192`).
- A malformed/extreme audience segment cannot force an unbounded fetch: the
  `all-invitees` case is a hardcoded `{ candidates: [], hasMore: false }`
  literal (`audience-queries.ts:281-282`) with no query at all; every other
  case goes through a bounded, `limit`-respecting DAL call, and the
  exhaustive `switch` (`:280-307`) throws on any audience value it doesn't
  recognize rather than silently falling through to an unbounded default.
- **The one real gap here is the same one raised in Finding 2:** the
  request-body-supplied `pageSize`/`maxPages`/`maxEvents` ceilings (Zod max
  500/200/200) are far above the documented safe defaults
  (100/20/25) and there is no rate limit backstopping repeated worst-case
  calls. Bounded-per-call is necessary but, combined with "callable as many
  times as you like with no limiter," is not the same guarantee as
  "bounded in aggregate." See Finding 2's remediation (tighten the Zod
  ceilings + add rate limiting) — not filing this twice as a separate
  finding, since it's the same root cause and the same fix.

**Verdict: no unbounded query or send-burst possible from a single
malformed/extreme audience segment; the aggregate-volume gap is the same one
identified in Finding 2 (N-3), not a new one.**

### 7. Secrets hygiene (`EMAIL_TRIGGER_EVALUATOR_SECRET`) — PASS

- `apphosting.yaml:61-62` adds
  ```
  - variable: EMAIL_TRIGGER_EVALUATOR_SECRET
    secret: emailTriggerEvaluatorSecret
  ```
  — a `secret:` reference into Secret Manager, structurally identical to
  the existing `DRAFT_TOKEN_SECRET`/`QR_TOKEN_SECRET`/`SCANNER_SESSION_SECRET`
  entries in the same file (`:28-29`, `:37-38`, `:46-47`). No real secret
  value is present anywhere in the diff — `git diff prototype -- apphosting.yaml`
  shows only the variable/secret-reference pair plus explanatory comments.
- The data-model doc (§9) and the code's own comment
  (`evaluator-auth.ts:1-7`) both correctly document the actual secret
  VALUE and the Cloud Scheduler job itself as **human/ops tasks**
  (`firebase apphosting:secrets:set emailTriggerEvaluatorSecret`, a
  `gcloud scheduler jobs create` step) — not silently assumed to already
  exist, and not faked with a committed placeholder.
- The dev fallback (`DEV_FALLBACK_SECRET`,
  `evaluator-auth.ts:18-19`) is an obviously-named, obviously-non-secret
  string (`"dev-only-email-trigger-evaluator-secret-do-not-use-in-prod"`),
  used only when `NODE_ENV !== "production"`, with a loud one-time
  `console.warn` (`:34-43`) — same posture as the three prior secrets, no
  new risk pattern introduced.

**Verdict: secrets hygiene for this new secret matches the established,
already-reviewed pattern exactly. No hardcoded real value, no accidental
commit, human provisioning step explicitly documented.**

---

## Findings summary

| Severity | Count | Item |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 1 | Finding 2 (N-3) — internal evaluator route has no rate limiting; should be added (real verdict, not accepted as-is), plus tighten the Zod ceilings on `maxEvents`/`pageSize`/`maxPagesPerTrigger` |
| Low | 1 | Finding 5 (L-3) — "Email all" route's error path echoes unmasked draft emails in a 400 response and is all-or-nothing on a single malformed recipient, unlike the periodic evaluator's per-candidate isolation |

No Critical or High findings. Pre-existing `npm audit` findings (23,
unchanged) are carried forward per the M6-T1/M6-T2 baseline, not re-listed
as a new finding.

---

## Verdict

**PASS — cleared to proceed to QA**, with one Medium and one Low finding
that should be closed before this ticket is considered fully hardened but
do not, under this loop's severity policy, block the QA handoff (only
Critical/High findings block).

Explicit answers to the ticket's specific questions:

1. **N-3 (rate limiting):** the fail-closed shared secret is **not**
   sufficient on its own. Add `checkRateLimit` to
   `POST /api/internal/email-triggers/evaluate` (Finding 2) — the threat
   this closes is not "attacker guesses the secret" (already mitigated by
   Finding 1's fail-closed + constant-time posture) but "a caller who
   already has the secret, or a misconfigured/duplicated Cloud Scheduler
   job, invokes this route far more often or with far larger
   `pageSize`/`maxPages`/`maxEvents` than the documented safe defaults,
   with zero backstop" — a real Firestore cost/availability exposure, not a
   hypothetical one, given the Zod schema's generous ceilings. Recommend
   bundling a tightened Zod ceiling with the rate-limit fix. Routed to
   Backend Agent as should-fix-before-or-alongside-QA, same handling as
   M6-T2's M-1.
2. **Auth mechanics:** PASS, independently re-verified (fail-closed in
   production, constant-time + length-independent comparison, generic 401,
   blast radius reasoned through explicitly — a leaked secret grants sweep
   access and aggregate cross-org metadata by design, never data
   corruption, double-sends, or escalation to any other route/secret).
3. **Mass-send authorization / IDOR:** PASS, no cross-org send path found
   on either the internal route or "Email all."
4. **Header injection / XSS:** PASS, all five new send call sites reuse
   T1/T2's unmodified, already-hardened `sendEventEmail`/
   `sendEventEmailBatch` pipeline.
5. **PII exposure:** PASS overall, with one Low finding (L-3) on "Email
   all"'s error-path email echo + all-or-nothing batch behavior — same-org
   data already accessible to the caller, not a trust-boundary breach, but
   worth fixing for consistency with the periodic evaluator's own
   per-candidate isolation design.
6. **Rate/volume DoS via malformed segments:** PASS — bounded queries
   throughout; the only real gap is the aggregate-volume one already
   covered by Finding 2.
7. **Secrets hygiene:** PASS, matches the `QR_TOKEN_SECRET`/
   `DRAFT_TOKEN_SECRET` pattern exactly.

Recommend the Orchestrator route Finding 2 (Medium) to the Backend Agent and
Finding 5/L-3 (Low) to the Full-Stack Developer, both in parallel with QA,
consistent with how M6-T2's M-1 was handled.
