# Code Review — M8-T6 Generic Accept-Hook Repair Path

Code Reviewer, 2026-07-19. Scope: the complete uncommitted M8-T6 diff listed
in the dispatch, reviewed against
`agents/docs/specs/m8-accept-hook-repair.md`. Process-only files were excluded.

## Verdict — CHANGES REQUESTED

The production implementation uses the exported accept hook, closes the silent
200 path, preserves tenant/event scoping, and gates the UI correctly. No
production correctness or authorization Blocker was found. Changes are
requested because the ticket's core safety regression is tested with a mock
that reimplements the exact attendee/email idempotency being claimed, and the
accepted-replay test does not prove the required pending heal or preservation
of `acceptedAt`. The UI test also does not exercise the retry request or its
success/failure feedback.

## Hook reuse and email non-resend

- **Production hook reuse confirmed.** `src/features/responses/server/repair-attendee-creation.ts:3,32-34`
  imports and directly awaits the exported `onSubmissionAccepted(submission)`.
  It does not duplicate attendee, QR, marker, or email logic.
- **Production idempotency chain confirmed by source.** The hook calls
  `createAdminAttendeeIfAbsent` at
  `src/features/responses/on-submission-accepted.ts:126-139`. The DAL derives a
  deterministic attendee ID and transactionally returns the existing document
  untouched or uses `tx.create` at `src/lib/db/adminAttendee.ts:83-97,124-131`.
  The hook then reapplies the completion marker at
  `src/features/responses/on-submission-accepted.ts:141-145`.
- **Production email dedupe confirmed by source.** The same hook calls the
  confirmation helper after attendee/marker completion at
  `src/features/responses/on-submission-accepted.ts:147-160`; the email helper
  passes `dedupeKey: input.attendee.id` to the send service. Re-entry therefore
  evaluates email again against the same deterministic attendee/outbox
  identity rather than creating a second logical send.
- **The new replay test does not genuinely prove this chain.**
  `src/__tests__/responses-retry-attendee-creation-route.test.ts:29-31` mocks the
  exported production hook. Its default implementation at `:81-91` then
  hand-writes a deterministic attendee and hand-dedupes a counter with a Set.
  The assertion at `:183-193` proves that this purpose-built mock behaves as it
  was written; it would still pass if the real hook stopped using
  `createAdminAttendeeIfAbsent`, changed its attendee identity, or stopped
  supplying `dedupeKey: attendeeId`.

## No-silent-200 confirmation

- **Initial accept:** `src/app/api/dashboard/events/[eventId]/responses/[responseId]/status/route.ts:53-87`
  consumes `acceptHookFailed`, makes exactly one scoped helper call, and returns
  structured HTTP 500 `ATTENDEE_CREATION_FAILED` when that repair still throws.
  It no longer falls through to the former bare success response.
- **Accepted replay:** the same route recognizes only an
  `INVALID_TRANSITION` for requested `accepted`, then performs the scoped
  reread/repair. A complete accepted response becomes idempotent 200; a pending
  accepted response invokes the hook. The repair helper never calls
  `transitionAdminFormDataStatus`, so it does not recursively rerun the status
  transaction or rewrite `acceptedAt`.
- **Explicit retry:**
  `src/app/api/dashboard/events/[eventId]/responses/[responseId]/retry-attendee-creation/route.ts`
  implements the exact POST path and all five required outcomes: repaired 200,
  already-complete 200, non-accepted 409, continued-failure 500, and rate-limit
  429. Empty/absent bodies are accepted; non-empty bodies are rejected. It
  never transitions status and therefore cannot implicitly accept a response.

## Retry-route authorization and tenancy verdict

**Correct.** The retry route calls the same default
`resolveRegistrationRouteScope(eventId)` used by sibling dashboard mutations.
That helper validates the session, canonical active-organization membership,
`write:events`, and an event owned by that organization at
`src/features/registration/server/route-scope.ts:40-86`. The repair helper then
calls `getAdminFormDataForEvent` with the URL response ID, URL event ID, and
server-derived organization ID at
`src/features/responses/server/repair-attendee-creation.ts:16-23`; missing,
cross-event, and cross-org records collapse to `RESPONSE_NOT_FOUND`. The rate
key includes canonical organization, actor, and response, and the limit of 30
matches the closest email-retry mutation precedent. The 31st-request test
proves the hook is not invoked.

The two-org route test is substantive: it seeds an org-2 FormData document in
the fake store, resolves org-1 scope, receives the same 404 contract, observes
no hook call, and confirms the marker remains false. It is not a name-only or
fully mocked DAL assertion.

## UI gating correctness

The production UI is correctly gated. Serialization normalizes only literal
`true` to complete at `src/features/responses/utils.ts:84-86`, so legacy missing
markers remain actionable. `src/features/responses/components/responses-table.tsx:196-204,214-221`
shows both the warning badge and retry state only when status is `accepted` and
`attendeeCreated === false`. Healthy accepted rows retain the ordinary badge
and terminal em dash; non-accepted rows retain their normal forward actions.
The action calls the exact encoded retry endpoint, disables the row trigger
while pending, emits the existing success/error toasts, refreshes on success,
and does not automatically retry 500/429 responses.

## Blockers

None in production code.

## Should-fix

1. **Replace the tautological replay/email test with a real-hook integration.**
   `src/__tests__/responses-retry-attendee-creation-route.test.ts:29-31,81-91,183-193`
   must exercise the actual exported `onSubmissionAccepted`, real attendee DAL,
   marker DAL, and real deterministic email-message/outbox dedupe boundary
   against the fake store. Invoke repair twice (including the stale-marker
   replay seam) and assert one Attendee document, the original attendee data
   unchanged, one confirmation EmailMessage/outbox identity, one transport
   send, and `attendeeCreated:true`. This is the core M6-T3 safety concern and
   Spec AC6/AC10; separate older unit tests of each layer do not prove this new
   repair route remains wired through them.

2. **Prove the accepted-replay contract rather than only the completed no-op.**
   `src/__tests__/responses-status-route.test.ts:245-254` covers only a response
   completed by the immediately preceding call and does not seed/assert a
   stable `acceptedAt`. Add an already-accepted, `attendeeCreated:false` case
   that heals, plus pending and already-complete replay assertions that the
   exact pre-seeded `acceptedAt` value is unchanged and that no status write is
   performed. This directly locks the spec's historical-orphan seam and
   no-second-transition constraint.

3. **Exercise the retry UI behavior and negative action gating.**
   `src/__tests__/responses-table-attendee-repair.test.tsx:35-52` proves the
   positive warning/action and only the warning's negative cases. It never
   asserts that complete/non-accepted rows lack `Retry attendee creation`, nor
   does it click Retry and inspect the URL/body, pending disablement, success
   toast/refresh, structured 500 message, or 429 guidance. Add these assertions
   so Spec AC4/AC9 and the user-visible false-success regression are protected.

4. **Complete the explicit endpoint's IDOR matrix.**
   `src/__tests__/responses-retry-attendee-creation-route.test.ts:113-123`
   genuinely covers cross-org, but the new endpoint has no direct missing-ID
   or other-event case. Add both and assert the identical 404 body and no hook
   invocation, as required by Spec §11 items 8-9.

## Nits

- `src/app/api/dashboard/events/[eventId]/responses/[responseId]/status/route.ts:1-13`
  still says accepted replay 409s and the hook is reachable at most once. That
  header now contradicts the implemented repair/replay behavior and should be
  refreshed.
- The scoped files are all well below the repository's 800-line cap (largest:
  288 lines). No `console.log` was added. The two intentional `console.error`
  calls occur only on structured 500 paths and log response IDs plus exceptions,
  not submission PII or QR material.

## Why `responses-csv.test.ts` changed

The change is legitimate and behavior-neutral. Adding required
`attendeeCreated:boolean` to `SerializedResponse` makes the test's explicitly
typed fixture incomplete, so `src/__tests__/responses-csv.test.ts:142-155` adds
`attendeeCreated:false` solely to satisfy the expanded serialized model. The
CSV projection does not export this internal repair marker, and no expected CSV
columns or values changed.

## Independent re-run results

- `npm run lint` — **PASS**, exit 0, no ESLint warnings or errors. Next.js
  emitted its existing deprecation/workspace-root notices.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No M8-T6
  file produced a TypeScript error.
- `npm test -- --run` — **PASS, 184 test files / 2031 tests**. Existing React
  ref and development-secret warnings were emitted; there were no failures.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-accept-hook-repair.md`.
