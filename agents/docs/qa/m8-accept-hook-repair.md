# QA Report — M8-T6 Generic accept-hook repair path

QA Agent, 2026-07-19. Authoritative spec: `agents/docs/specs/m8-accept-hook-repair.md`. Code Review was consumed as APPROVED-after-fixes and Security as PASS. This pass built on those gates and concentrated on complete acceptance-criteria traceability, the named orphan-heal lifecycle, UI state behavior, negative paths, and regression safety.

## Verdict

| Ticket | Verdict |
|---|---|
| M8-T6 — Generic accept-hook repair path | **SIGNED OFF** |

All ten numbered outcome ACs and the twelve-item Spec §11 test matrix are traceable. The named orphan-heal E2E now exercises the real status route, DAL transition, retry route, repair helper, production accept hook, attendee DAL, marker write, and confirmation email/outbox path against the fake store. No defects were found.

## Command results

| Check | Result |
|---|---|
| New focused QA suite | PASS — 1 file / 1 test |
| `npm run lint` | PASS — no ESLint warnings or errors; existing Next.js deprecation/workspace-root notices only |
| `npx tsc --noEmit --pretty false` | Expected non-zero — exactly **7 baseline diagnostics**: `attendees-roster.test.ts` (3), `event-org-scoping.test.ts` (3), `register-route.test.ts` (1); **0 M8-T6/QA diagnostics** |
| `npm test -- --run` | PASS — **185 files / 2,038 tests**, 0 failed, 0 todo |
| Delta from supplied baseline 184 / 2,037 | **+1 file / +1 test**, exactly this QA pass |

## Acceptance-criteria traceability

| AC | Result and evidence |
|---|---|
| 1. Failed first accept hook gets one immediate repair; success only when complete, otherwise structured non-2xx | PASS — `responses-status-route.test.ts`: “immediately repairs a failed accept hook before returning success” and “returns structured 500 when the initial hook and one repair both fail.” The new QA lifecycle also proves the failure response after a real DAL acceptance commit. Route branching is at `status/route.ts:54-88`. |
| 2. Accepted replay detects pending repair, complete replay is idempotent, and `acceptedAt`/status transaction are untouched | PASS — `responses-status-route.test.ts`: “accepted/pending replay heals without rewriting acceptedAt or status” and “accepted/complete replay preserves acceptedAt with no hook or status write.” |
| 3. Dedicated scoped, `write:events`-gated admin retry | PASS — `responses-retry-attendee-creation-route.test.ts`: 401, 403, cross-org 404, missing 404, wrong-event 404, and repair success tests. Scope precedes body/rate/repair at `retry-attendee-creation/route.ts:14-19`; scoped helper read is at `repair-attendee-creation.ts:16-23`. |
| 4. Only Accepted + incomplete rows show warning and Retry; healthy Accepted stays ordinary | PASS — `responses-table-attendee-repair.test.tsx`: “shows the warning and retry action only for accepted incomplete rows” and parameterized “hides…for accepted and complete / not accepted.” Serialization maps absent/false to false at `utils.ts:76-89`, so both shared response-table consumers receive the state. |
| 5. Every heal invokes existing `onSubmissionAccepted` | PASS — helper imports and calls the sole hook at `repair-attendee-creation.ts:3,32-34`. `responses-retry-attendee-creation-route.test.ts`: “real-hook replay preserves…” leaves the real implementation active. The new orphan-heal E2E restores and invokes that production implementation on retry. |
| 6. Existing attendee retry is non-destructive and email-deduped | PASS — `responses-retry-attendee-creation-route.test.ts`: “real-hook replay preserves one attendee and one confirmation send/outbox” asserts one deterministic Attendee, unchanged data, one EmailMessage/dedupe identity, and one transport send. |
| 7. Non-accepted is structured 409; missing/cross-tenant is indistinguishable 404 | PASS — retry-route tests “rejects a non-accepted response without writes,” cross-org, missing, and wrong-event cases assert no hook/heal. |
| 8. Email failure after attendee creation is not an orphan and is not attendee-repaired | PASS — `on-submission-accepted-email-wiring.test.ts`: “a throw from the email hook never un-accepts and never blocks attendeeCreated”; retry-route “returns already_complete without invoking the hook” pins the endpoint behavior for any accepted marker-complete record. |
| 9. UI never falsely succeeds on failed repair; warning/action remains and server error is shown | PASS — `responses-table-attendee-repair.test.tsx`: structured 500 test asserts error toast, no success toast, and no refresh; the row remains rendered from unchanged props. The 429 test asserts guidance and no refresh. |
| 10. Route/E2E matrix coverage | PASS — healthy acceptance, immediate heal, failed heal, replay heal/no-op, explicit retry, non-accepted, tenant isolation, rate limit, viewer denial, UI states, real-hook idempotency/email dedupe, and the full orphan lifecycle are covered by the cited suites. |

## Named orphan-heal E2E

`src/__tests__/m8-t6-qa-orphan-heal-e2e.test.ts:89` — **“creates a genuine orphan through the status route, surfaces failure, then heals it through the retry route with the real hook.”**

The test seeds a reviewed submission, sends `PATCH {to:"accepted"}` through the real route and DAL, forces the initial post-commit hook and the route's one immediate repair to fail, asserts structured HTTP 500 plus persisted `status:"accepted"`, `attendeeCreated:false`, no Attendee, and a captured `acceptedAt`, then invokes the real retry route. That retry executes the unmodified production `onSubmissionAccepted`, and the test asserts HTTP 200 `repaired`, exactly one Attendee, `attendeeCreated:true`, the same `acceptedAt`, exactly one confirmation EmailMessage whose `attendeeId` and `dedupeKey` equal the sole attendee identity, and exactly one transport send.

## Spec §11 edge and UI matrix

| Area | Trace |
|---|---|
| Healthy accept / immediate heal / terminal failure | `responses-status-route.test.ts` accept-side-effect tests. |
| Terminal replay pending / complete | `responses-status-route.test.ts` accepted replay tests, including preserved `acceptedAt` and empty status write set. |
| Explicit pending / complete / non-accepted | `responses-retry-attendee-creation-route.test.ts` repaired, already-complete, and 409 tests. |
| Still-failing hook | Retry-route structured-500 test plus UI structured-500 test; marker remains false because the hook is stubbed before writes, and the new lifecycle independently proves the persisted orphan state after route failure. |
| Rate limit | Retry-route 31st-request test asserts 429, `Retry-After`, and no hook; UI 429 test asserts guidance and no refresh/loop. |
| Two-org / wrong-event IDOR | Retry-route cross-org and same-org-other-event tests assert identical 404 and no heal. |
| Viewer denied | Retry-route 403 test asserts no hook. |
| Badge/action visibility | UI visible test plus complete/non-accepted hidden parameterized cases. Legacy missing marker is covered by `response.attendeeCreated === true` serialization at `utils.ts:88`, producing false. |
| Click contract / pending / success | UI URL test asserts encoded endpoint, `{}` body, disabled action, success toast, and refresh. |
| Failure UI | UI 500 and 429 tests assert correct errors, no success, and no refresh; therefore no automatic retry and the persisted warning remains actionable. |
| Email-only failure | `on-submission-accepted-email-wiring.test.ts` pins marker true despite email throw; complete retry no-op prevents email resend. |

## Tests added

`src/__tests__/m8-t6-qa-orphan-heal-e2e.test.ts` — **1 test**: full real-route/DAL/hook orphan creation and explicit healing lifecycle against the repository fake store.

No existing test or application file was modified by QA.

## Defects

**None found at any severity.** The missing named lifecycle was a test-coverage gap and is now green. No `it.todo` defect pin was necessary.

## Verified versus not verifiable

Verified executable behavior: real status and retry route handlers; real status DAL transaction; real shared repair helper; production accept hook on healing; attendee creation/marker persistence; confirmation outbox identity and single transport invocation; accepted timestamp preservation; structured failure; permission, tenant/event, non-accepted, already-complete, rate-limit, serialization, badge/action, pending, toast, and refresh behaviors; lint; expected TypeScript baseline; full regression suite.

Not verifiable in this environment:

- No interactive browser/pixel QA: table layout, theme contrast, focus appearance, dropdown positioning, and pointer behavior were covered structurally and with jsdom, not a real browser.
- No live Firebase emulator or production Firestore/index execution; persistence and transaction behavior used the repository's in-memory Admin Firestore fake.
- No live Auth session, organization switching, network stack, email provider, or deployed rate-limit behavior; server boundaries and transport behavior were exercised with controlled test doubles while the scoped route/DAL/hook chain remained real.

## Final sign-off

**SIGNED OFF.** All numbered ACs are traced, the backlog's orphan-heal E2E explicitly drives the real hook after producing a genuine accepted orphan, the negative/UI matrix is covered, no defect was found, lint is clean, TypeScript contains only the seven disclosed baseline diagnostics, and the full suite passes at 185 files / 2,038 tests.

## Report-file confirmation

This report is `agents/docs/qa/m8-accept-hook-repair.md`. QA modified only this report and the permitted new `src/__tests__/m8-t6-qa-orphan-heal-e2e.test.ts` file.
