# Security Review — M7-T3 Scheduled Report Delivery

Security Agent, 2026-07-17. Scope: all uncommitted changes in the working
tree belonging to M7-T3 — `src/types/collection.ts` additions
(`ReportScheduleDoc`, `ReportScheduleRecipient`, `ReportScheduleFrequency`);
new `src/lib/db/{adminReportSchedule,reportScheduleId,reportScheduleSchemas}.ts`;
new `src/lib/email/lifecycle/{evaluate-report-schedules,report-schedule-periods}.ts`;
modified `src/lib/email/lifecycle/{dedupe-keys,evaluate-event}.ts`; modified
`firestore.rules`; new `src/features/reports/{schedule-schemas,schedule-utils}.ts`;
new `src/features/reports/components/{report-schedule-form,
report-schedule-recipients-field,report-schedules-dialog}.tsx`; new
`src/features/reports/server/{read-json-body,serialize-report-schedule}.ts`;
new API routes under
`src/app/api/dashboard/events/[eventId]/reports/schedules/{route.ts,
[templateSlug]/route.ts}`; modified `reports-workspace.tsx`,
`report-templates-section.tsx`, `reports-route-scope.ts`, `reports/page.tsx`.
Reviewed against `agents/docs/specs/m7-scheduled-reports.md`,
`agents/docs/data-models/m7-scheduled-reports.md`, and Code Review's
`agents/docs/reviews/m7-scheduled-reports.md` (APPROVED, 0 blockers, 1 nit).
This is the last ticket in M6/M7's periodic-sweep/report lineage, and the
ticket the backlog itself flags as the recurring-PII-delivery exfiltration
concern — reviewed accordingly, independently re-deriving every claim rather
than trusting the two prior clean passes.

Checks executed this session:
- `npm run lint` — PASS, no warnings/errors.
- `npm run build` — PASS, full route tree compiles, both new schedule CRUD
  routes present in the manifest.
- `npm test -- --run` — PASS, **147 files / 1696 tests**.
- `git diff --stat HEAD -- package.json package-lock.json` — empty, no new
  dependency added by this ticket.
- `npm audit --production` — 15 pre-existing advisories (10 moderate/3
  high/2 critical), all transitive through `firebase-admin` →
  `@google-cloud/firestore` → `google-gax`/`teeny-request`/`uuid`, plus an
  unrelated `websocket-driver` dev-toolchain advisory — identical population
  to the baseline reported by every prior M6/M7 security review in this
  repo; nothing newly introduced or newly reachable by this ticket's code.

---

## 1. Recipient anti-exfiltration control — independently re-derived

**Adversarial question asked: can a `write:events` holder craft a request
that bypasses `verifyReportScheduleRecipient` and gets a free-text/
unverified email onto a schedule, or gets mail sent to one?** Answer: no,
for the following independently-verified reasons.

**(a) Write-time reject-all is real, not advisory.**
`upsertAdminReportSchedule` (`src/lib/db/adminReportSchedule.ts:205-256`)
parses the request body through `reportScheduleUpsertPatchSchema`
(`src/lib/db/reportScheduleSchemas.ts:51-94`), whose `recipients` field is
literally not defined in the schema — only `recipientEmails: string[]`
exists (`reportScheduleSchemas.ts:37-46,58`). Zod's default `z.object()`
behavior *strips* unrecognized keys rather than passing them through
(verified: no `.passthrough()`/`.strict()` override anywhere in this
schema), so a route handler that received a raw body containing a
client-supplied `recipients: [{email, name}]` array would have that field
silently discarded before it ever reaches `upsertAdminReportSchedule`'s
verification loop — there is no field name on the wire that can carry a
pre-resolved `{email, name}` pair past validation. Every candidate in
`patch.recipientEmails` is resolved via `verifyReportScheduleRecipient`
(`adminReportSchedule.ts:161-178`) **before** `adminDb.runTransaction` is
ever invoked (`:241-252`); one failing candidate rejects the *entire*
write (`NOT_A_MEMBER`, zero doc read or written). Independently confirmed
by re-reading the two CRUD routes
(`src/app/api/dashboard/events/[eventId]/reports/schedules/route.ts:82-101`,
`.../[templateSlug]/route.ts:103-117`) — both destructure `{ templateSlug,
...patch }` from the raw parsed JSON body and pass the **entire remaining
object** straight to `upsertAdminReportSchedule` as `patch: unknown`,
meaning the DAL's Zod schema is the actual authority over shape, not the
route. There is no second, route-level "trust this pre-verified list"
code path anywhere — grepped every file touching `ReportSchedule` writes
(`grep -rln "ReportSchedule" src --include="*.ts" --include="*.tsx"`) and
confirmed `reportScheduleCol().doc(...).create/.update` calls exist in
exactly one file (`adminReportSchedule.ts`), reached from exactly two
callers (the two CRUD routes), both `write:events`-gated.

**(b) Fire-time re-verification is genuinely fresh, not cached.**
`evaluateReportScheduleTrigger`
(`src/lib/email/lifecycle/evaluate-report-schedules.ts:127-252`) re-reads
the schedule doc at the top of **every period's** iteration
(`reloadSchedule`, `:117-125`, called at `:188`) and then, for that fresh
`recipients` array, calls `getAdminUserMembership(recipient.email,
organizationId)` per entry (`:201-208`) — a `null` result simply isn't
pushed into `verified`; no exception, no error result, no mutation of the
stored `recipients` array. `getAdminUserMembership`
(`src/lib/db/adminUserOrganization.ts:71-79`) reads the *authoritative*
`organizations[]` array embedded on that user's own live `User` doc — not
a cached/denormalized roster — so a departed member is excluded the very
next tick after their membership is revoked, and an all-departed period
correctly no-ops (`verified.length === 0` → `continue`, `:210-216`) rather
than sending to anyone.

**(c) No code path anywhere lets a free-text or unverified email receive a
scheduled report.** Traced every hop from "candidate email" to
"`sendEventEmailBatch` recipient": (i) add/edit — Zod strips unknown keys →
`verifyReportScheduleRecipient` all-or-nothing → stored `recipients` are
always `{email, name}` pairs where `name` is the *matched User doc's own
name*, never client-supplied (`adminReportSchedule.ts:174-177`); (ii) fire
— `evaluateReportScheduleTrigger` re-verifies every stored recipient fresh
before building the `sendEventEmailBatch` recipient list (`:201-208,226`)
and only ever passes recipients that passed that fresh check. No third
entry point exists: `ReportSchedule` is a server-only, no-client-repo-pair
entity (`firestore.rules:344-354`, `allow read, write: if false`), so there
is no Firestore-SDK write path from the client at all, and the two
`write:events`-gated HTTP routes are the only server-side callers of the
one write function. **Conclusion: the anti-exfiltration control cannot be
bypassed by any code path found in this diff or its dependencies.** This
matches Code Review's finding but was independently re-derived from the
Zod schema shape (strip-unknown-keys behavior), the route bodies, and a
full-repo grep for every write call site — not merely re-read from the
review's prose.

## 2. CRUD route permission gating and cross-org isolation

All four mutating/listing schedule routes call
`resolveReportsRouteScope(eventId, { requireWriteEvents: true })`:
`GET`/`POST` (`.../reports/schedules/route.ts:35-37,54-56`) and
`GET`/`PATCH`/`DELETE` (`.../schedules/[templateSlug]/route.ts:40-42,
68-70,152-154`). This differs correctly from M7-T2's Run routes (org-
membership-only) — every schedule route requires `write:events`
(`src/features/reports/server/reports-route-scope.ts:68-77`), matching the
spec's explicit instruction that schedule creation is export-adjacent, not
Run-adjacent. `resolveReportsRouteScope` further sources the tenant id from
`resolveActiveOrganizationId(userDoc)` — the server-locked
`organizations[]` roster, not the client-writable `organizationId` field
(consistent with the carried SEC M2 Finding 1 note at
`reports-route-scope.ts:57-60`) — and 404s via
`getAdminEventForOrganization` on a cross-org/unknown `eventId` before any
`ReportSchedule` lookup runs. The DAL adds a second, independent tenancy
check: `getAdminReportScheduleForEvent`
(`adminReportSchedule.ts:84-101`) re-verifies `organizationId`/`eventId`
against the fetched doc even though the deterministic id
(`reportScheduleId = sha256(["ReportSchedule", organizationId, eventId,
templateSlug])`) already encodes the tuple — genuine defense in depth, a
cross-org id guess (which would require a sha256 preimage attack to even
construct) still gets `NOT_FOUND`. `listAdminReportSchedulesForEvent`
filters on both fields directly in the query (`:138-142`).
`verifyReportScheduleRecipient` is always invoked with the *schedule's
own* `organizationId`, never a caller-suppliable value, closing the
adjacent "verify against org A but write to org B" shape. No gap found.

## 3. Zero-PII email body

`buildReportScheduleEmailCopy`
(`evaluate-report-schedules.ts:77-88`) takes exactly three string inputs —
`templateName`, `eventName`, `link` — and the enclosing
`evaluateReportScheduleTrigger` function has no query against `Attendee`,
`Order`, `FormData`, or any report-row-producing collection anywhere in its
body; the only DAL calls it makes are `getAdminReportScheduleForEvent`
(schedule config) and `getAdminUserMembership` (membership booleans) —
there is structurally nothing in scope to leak, not merely "currently
doesn't happen to be included." The body is a fixed three-line template
ending in an explicit "no report data is included" disclaimer
(`:83-86`). It renders through the unmodified T1 pipeline
(`deriveBodyForDefinition`, `src/features/emails/server/render.ts`) and
`validateRenderedEmailContent` still runs unconditionally inside
`sendEventEmailBatch`/`sendEventEmail` for this call site, same as every
other trigger. Confirmed by direct read, matching Code Review's finding.

## 4. Internal evaluator entrypoint (`/api/internal/email-triggers/evaluate`)

The route file itself (`src/app/api/internal/email-triggers/evaluate/
route.ts`) is **not present in this ticket's diff** — confirmed via `git
diff --stat` (only `evaluate-event.ts` and `dedupe-keys.ts` are touched
inside `src/lib/email/lifecycle/`). Read the route in full: the fail-closed
shared-secret check (`verifyEvaluatorRequestSecret`, `:80-86`) and the
6/min global rate limit (`:88-97`) are unchanged and still gate every call
before `runLifecycleTriggerSweep` runs. `evaluate-event.ts`'s new
report-schedule loop (`:180-206`) is a pure, additive `for` block appended
strictly after the three pre-existing M6-T3 trigger loops, pushing into the
same shared `results` array with no shared mutable state — it does not
touch the auth/rate-limit logic (which lives entirely in the route file,
one layer up) and introduces no new HTTP entry point: report-schedule
evaluation is only ever reachable through the same, single, already-
authenticated sweep. No way to trigger a schedule fire outside that sweep
was found.

## 5. Rate-limit ceiling inconsistency (Code Review N-1) — independently assessed

`POST`/`DELETE` use `{ limit: 20 }`
(`.../schedules/route.ts:61-64`, `.../[templateSlug]/route.ts:166-169`);
`PATCH` uses `{ limit: 60 }` (`.../[templateSlug]/route.ts:82-85`). All
three buckets are keyed per-user-per-event
(`` `reports-schedules-{verb}:${scope.userId}:${eventId}` ``) and are real,
non-zero, working limits — this is categorically different from M6-T3's
M-1 (a route with **zero** rate limiting). The 3x gap between 20 and 60 has
no attacker-relevant consequence here: the only sensitive action gated by
these routes is recipient-membership verification (§1 above), and that
check is a read against `User` docs (`getAdminUserByEmail`/
`getAdminUserMembership`), not a mutation of another tenant's data —
neither ceiling is high enough to meaningfully accelerate any exfiltration
or enumeration attempt (worst case, 60 upsert attempts/minute × ≤20
membership-probe reads per attempt = 1200 membership checks/minute against
the caller's *own* org, information the caller — a `write:events` holder —
already has full legitimate visibility into via other routes; there is no
cross-org enumeration primitive here since `verifyReportScheduleRecipient`
is always scoped to `scope.organizationId`, never caller-suppliable).
**Assessed independently as cosmetic, not a security finding** — concur
with Code Review's Nit classification, not an escalation to Low/Medium.

## 6. Header-trust / deep-link safety (third independent confirmation)

`buildReportScheduleDeepLink` (`evaluate-report-schedules.ts:65-72`)
consults exactly one input for the origin: `baseUrl`, itself the return
value of `resolveEmailBaseUrl()` (`src/lib/email/base-url.ts:33-52`,
**unmodified by this ticket** — confirmed not present in `git diff
--stat`). Re-read that function fresh: it reads `process.env
.NEXT_PUBLIC_APP_URL` only, validates it as a well-formed `http(s)`
absolute URL via `new URL()` + a protocol allowlist
(`SAFE_PROTOCOLS`), and returns `null` — never throws, never falls back to
any request-derived value — on any failure. No `Host`/`X-Forwarded-Host`
header, and no `Request`/`NextRequest` object of any kind, is passed into
or reachable from this function or its one call site
(`evaluate-report-schedules.ts:164`, called with zero arguments). This is
the same vulnerability class (header-trusted link-building in outbound
email → phishing) previously found and fixed in this app's history
(M6-T4 B-1, per the file's own header comment) — confirmed a third time,
independently, that the fix's invariant (env-var-only origin, fail closed
to a relative path) still holds and this ticket's one new call site
inherits it correctly rather than introducing a parallel, less-safe
mechanism.

## 7. Secrets / dependencies

No `.env`/service-account material referenced in any new file. No new npm
dependency (`package.json`/`package-lock.json` diff empty). `npm audit`
output is unchanged from the pre-existing baseline (transitive
`firebase-admin`/`@google-cloud/firestore` chain + an unrelated
`websocket-driver` dev advisory) — nothing newly introduced by this
ticket's code.

## Additional checks performed (not explicitly requested, done for completeness)

- Grepped `src/features/reports/` and the new evaluator/route files for
  `dangerouslySetInnerHTML` — none found; no new XSS surface introduced
  by the recipient-chip UI (`report-schedule-recipients-field.tsx`) or the
  schedule dialog, both of which render recipient data through normal JSX
  text interpolation (React-escaped).
- Verified the `?template=<slug>` deep-link read in `reports/page.tsx`
  validates the query param against `isReportTemplateId` (a fixed 5-value
  allowlist) before passing it down as `initialTemplate` — no open-
  redirect or unvalidated-value injection into client state.
- Grepped the new/modified files for `console.log`/`console.error`/
  `console.warn` — none found; the internal route's own response-body
  comment ("Summary counts only — never recipient PII in a response body")
  is unaffected since this ticket adds no new fields to that response.
- Confirmed `firestore.rules`'s new `ReportSchedule` block
  (`allow read, write: if false`) — the only Firestore-rules change in
  this diff — closes client SDK access entirely, consistent with every
  other server-only PII-adjacent entity in this codebase.

---

## Findings

**Critical: 0**
**High: 0**
**Medium: 0**
**Low: 0**

No findings block this ticket. The one item flagged by Code Review (N-1,
rate-limit ceiling inconsistency between POST/DELETE=20 and PATCH=60) was
independently re-assessed here and confirmed to be genuinely cosmetic —
all three ceilings are real, bounded, non-zero limits with no exploitable
consequence given the routes' actual sensitivity profile (§5 above); it
remains a nit, not elevated to a Low finding.

## Adversarial-thinking conclusion (explicit answer to the assigned question)

**Can the recipient anti-exfiltration control be bypassed by any code
path?** No. Independently traced both the write-time path (Zod schema
shape strips any client-supplied `recipients`/pre-verified-name field down
to bare `recipientEmails: string[]`, then all-or-nothing membership
verification runs before the Firestore transaction) and the fire-time path
(fresh per-period doc re-read + fresh per-recipient `getAdminUserMembership`
re-check, silent per-recipient drop, no persistence of the drop back onto
the schedule). Confirmed via full-repo grep that the DAL's
`upsertAdminReportSchedule`/`deleteAdminReportSchedule` are the only
functions that ever write a `ReportSchedule` doc, reached only from the two
`write:events`-gated CRUD routes, with `firestore.rules` denying all direct
client access. No route, DAL function, or evaluator code path was found
that can persist or send to an email address that has not passed
`verifyReportScheduleRecipient` (add-time) and/or `getAdminUserMembership`
(fire-time).

## Verdict: **PASS**

All six focus areas (recipient anti-exfiltration control, CRUD route
permission gating and cross-org isolation, zero-PII email body, internal
evaluator entrypoint integrity, rate-limit ceilings, deep-link header-trust
safety) were independently re-derived from the actual code — not taken on
trust from the Orchestrator's spot-check or Code Review's prior pass — and
all hold. No new dependency, no secret exposure, no new XSS/CSRF/IDOR
surface. `npm run lint`, `npm run build`, and `npm test -- --run` (147
files / 1696 tests) all pass. Cleared to proceed to the QA Agent.
