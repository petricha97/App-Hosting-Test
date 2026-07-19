# Security Review — M8-T6 Generic Accept-Hook Repair Path

Security Agent, 2026-07-19. Scope: the complete uncommitted M8-T6 diff,
including the new mutating retry endpoint, the generic status-route repair
path, UI/serialization changes, and all new and modified tests. Reviewed
against the ticket spec and post-fix Code Review.

## Gate result — PASS

**PASS — 0 Critical / 0 High / 0 Medium / 0 Low findings.**

No reachable Critical or High issue was found: the retry mutation is
server-side `write:events` gated before repair, response lookup is constrained
by URL event plus server-derived organization, and a non-accepted response
cannot be implicitly accepted.

## Findings

| Severity | Count | Finding |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

## 1. Retry-route authorization

**No finding.** The new POST route invokes the same vetted
`resolveRegistrationRouteScope(eventId)` helper used by the sibling status and
email-retry mutations at
`src/app/api/dashboard/events/[eventId]/responses/[responseId]/retry-attendee-creation/route.ts:16`.
It does not opt out of the helper's default write requirement. The exact
permission enforcement is
**`src/features/registration/server/route-scope.ts:76-81`**: a server-loaded
user lacking `write:events` receives 403. Scope resolution and its failure
return occur at retry-route lines 16-19, before request parsing, rate limiting,
or the first repair call at lines 47-51.

The route test at
`src/__tests__/responses-retry-attendee-creation-route.test.ts:104-113`
supplies a Viewer-like user with only `view:events`, asserts HTTP 403, and
asserts the production hook spy was not called. Authorization is therefore a
server boundary, not merely UI hiding.

## 2. IDOR and tenant isolation

**No finding.** No request field can provide an organization ID. The body
schema is strict-empty (retry route lines 8 and 21-31), and the test at
`responses-retry-attendee-creation-route.test.ts:235-239` confirms an injected
`organizationId` is rejected before the hook. The only organization supplied
to repair is `scope.organizationId` at retry-route line 50, derived through
verified session, server-loaded membership, and the org-owned event lookup in
`route-scope.ts:45-86`.

The shared helper passes all three constraints to
`getAdminFormDataForEvent(input)` at
`src/features/responses/server/repair-attendee-creation.ts:21`; a missing or
mismatched response becomes the single `RESPONSE_NOT_FOUND` result at lines
22-23 and the same fixed 404 body at retry-route lines 60-64. Thus URL
`responseId`/`eventId` cannot heal across an organization or event, and the
endpoint does not distinguish foreign existence from absence.

The tests substantively prove the matrix:

- cross-org seeds a real org-2 FormData record, resolves org-1 scope, gets the
  fixed 404, observes no hook call, and verifies its marker remains false
  (`responses-retry-attendee-creation-route.test.ts:115-125`);
- missing ID gets the identical body and no hook
  (`responses-retry-attendee-creation-route.test.ts:127-135`);
- wrong event seeds a same-org record owned by `evt-other`, gets the identical
  body, and observes no hook (`responses-retry-attendee-creation-route.test.ts:137-146`).

## 3. Accept-workflow bypass and mutation semantics

**No finding.** The helper checks `submission.status !== "accepted"` before
the completion marker or hook and returns `RESPONSE_NOT_ACCEPTED`
(`repair-attendee-creation.ts:25-26`); the route maps it to 409 at lines 66-73.
The negative test seeds `reviewed`, receives 409, observes no hook and no
Attendee document (`responses-retry-attendee-creation-route.test.ts:168-176`).

Neither the retry route nor repair helper imports or calls
`transitionAdminFormDataStatus`, so the endpoint cannot accept a response,
rewrite `acceptedAt`, or re-run the status transition. The status-route repair
branch reuses the already-authorized scope and performs only one scoped helper
call (`status/route.ts:61-66`). Accepted pending and complete replay tests
preserve the pre-seeded `acceptedAt` and assert an empty status write set
(`responses-status-route.test.ts:245-288`). Other invalid transitions retain
409 behavior.

## 4. Email non-resend on repeated repair

**No finding; the corrected test genuinely proves the real chain.** The test
does not mock the hook module. It imports the production module and uses
`vi.spyOn` while leaving the real implementation active
(`responses-retry-attendee-creation-route.test.ts:30-35`). It invokes the POST
once, resets only the FormData completion marker to simulate stale/pending
repair, and invokes POST again (`:205-219`). It then asserts:

- exactly one deterministic Attendee and unchanged original attendee data
  (`:207-221`);
- exactly one EmailMessage whose `attendeeId` and `dedupeKey` are the same
  attendee ID (`:222-230`);
- exactly one real transport send and a restored `attendeeCreated:true`
  (`:231-232`).

This exercises the production hook's create-if-absent attendee path
(`src/features/responses/on-submission-accepted.ts:126-145`) and production
email invocation (`:154-160`), whose send input sets
`dedupeKey: input.attendee.id` at
`src/features/emails/server/fire-on-accept-email.ts:118`.

## 5. Rate-limit adequacy and retry storms

**No finding.** The explicit endpoint keys the limiter by canonical
organization, authenticated actor, and response at retry-route lines 33-36,
with limit 30. The 31st-request test proves 429 plus `Retry-After` without hook
invocation (`responses-retry-attendee-creation-route.test.ts:193-202`). The
threshold matches the nearest authenticated email-retry precedent, which also
uses 30 (`src/app/api/dashboard/events/[eventId]/emails/messages/[messageId]/retry/route.ts:25-33`).

The response component means a write-authorized caller can distribute requests
over guessed or known response IDs. Guesses incur only the scoped read and 404;
hook work requires an existing accepted response whose marker is not true.
Distributing across many genuine orphan IDs can invoke repair per orphan, but
that is the authorized operation, each hook is data-idempotent, and the UI does
not auto-retry. The generic accepted-replay PATCH path is not covered by this
new endpoint limiter, but it retains the pre-existing write-scoped mutation
authority and makes only one scoped, idempotent repair attempt per request.
This is acceptable defense in depth for the ticket; an actor-global limiter
could be future hardening if operational telemetry shows abuse.

## 6. Error and information leakage

**No finding.** The structured 500 contains fixed text, a fixed code, the URL
response ID, and `attendeeCreated:false` only (retry-route lines 80-89). It
does not serialize the exception, submission fields, email, QR token/hash, or
tenant material. The corresponding test injects `Error("private failure")`
and confirms that text is absent from the exact response body
(`responses-retry-attendee-creation-route.test.ts:178-190`).

The two new `console.error` paths log a fixed message, response ID, and the
exception only (`retry-attendee-creation/route.ts:76-79` and
`status/route.ts:74-78`). They do not log the loaded submission or QR data.
Exceptions could contain downstream SDK diagnostics, as with existing server
error logging, but this diff does not construct an error containing submission
PII or QR material.

## 7. Status-route authorization and scoped repair

**No finding.** The modified PATCH still resolves
`resolveRegistrationRouteScope(eventId)` and returns failures at
`status/route.ts:33-36` before parsing, transition, or repair. Consequently its
new one-attempt repair branch is not unauthenticated and inherits the same
`write:events`, membership, and org-owned-event checks as the original
transition. It passes the URL response/event IDs and the same server-derived
organization into the helper (`:61-66`). `acceptHookFailed` is consumed only
after the original scoped transition result (`:47-59`); it is not exposed as a
client-controlled or persisted authorization signal.

## 8. Firestore, dependency, and secrets surface

**No finding.** `git diff HEAD -- firestore.rules firestore.indexes.json` was
empty: this ticket adds no rules or index surface. `git diff HEAD --
package.json package-lock.json` was also empty, establishing zero dependency
and npm-audit delta from M8-T6; no live audit result is claimed or needed for
an unchanged graph.

A scoped secrets scan of the new route, helper, and tests found no API key,
password, bearer credential, private key, service-account data, or new secret.
The QR hash and submission values present in test fixtures are synthetic test
data and are neither returned nor logged by production code.

## Commands run and results

- Read-only `git status`, complete production/test diff inspection, numbered
  source reads, sibling-route/helper traces, and scoped authorization,
  tenancy, logging, and secret searches — completed.
- `git diff HEAD -- firestore.rules firestore.indexes.json package.json
  package-lock.json` — empty.
- `npm run lint` — **PASS**, exit 0, no ESLint warnings or errors (existing
  Next.js deprecation/workspace-root notices only).
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected **7
  baseline errors**: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T6 file produced an error.
- `npm test -- --run` — **PASS, 184 test files / 2,037 tests**. Existing React
  test warnings, development-secret warnings, and expected exercised error
  logs were emitted; no test failed.
- `npm audit` — not rerun because manifests and lockfile are unchanged; ticket
  dependency/audit delta is zero.

## Report-file confirmation

This report was written as the sole workspace modification made by the
Security Agent at `agents/docs/security/m8-accept-hook-repair.md`.
