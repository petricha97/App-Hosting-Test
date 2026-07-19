# M8-T6 — Generic accept-hook repair path

Research Lead, 2026-07-19. Source of truth for Implement, Code Review, Security, and QA. This is a behavioral specification only; no application-code change is part of the Research deliverable.

## 1. Outcome and acceptance criteria

An accepted response must not remain silently roster-invisible when its post-commit attendee hook fails. The generic response workflow must detect `status:"accepted"` plus `attendeeCreated !== true`, safely re-run the existing exported hook, and report a still-failed repair as a structured error. Administrators must also be able to see and explicitly retry an existing orphan without manufacturing another status transition.

Acceptance criteria:

1. A first generic PATCH to `accepted` that returns `acceptHookFailed:true` performs one immediate repair attempt before responding; it returns success only if attendee creation is complete, otherwise a structured non-2xx `ATTENDEE_CREATION_FAILED` response.
2. A replayed PATCH `{ "to": "accepted" }` against an already-accepted response is a repair detection seam: if `attendeeCreated !== true`, it attempts the same repair; if already true it is an idempotent success. It does not alter `acceptedAt` or run another status transaction.
3. A dedicated admin retry endpoint supports deliberate recovery of visible historical orphans and is tenant/event scoped and gated by `write:events`.
4. Accepted responses with `attendeeCreated !== true` are visibly distinguished in both response tables and expose `Retry attendee creation`; accepted healthy rows remain ordinary Accepted rows.
5. Every heal invokes the existing `onSubmissionAccepted(submission)` rather than duplicating attendee/QR/email logic.
6. A retry after the attendee already exists creates no second Attendee, does not replace its data, safely reapplies the FormData completion marker, and does not send a duplicate confirmation email.
7. A non-accepted response is never healable and returns a structured `409 RESPONSE_NOT_ACCEPTED`; a missing/cross-tenant response is indistinguishable and returns 404.
8. Email failure after attendee creation never produces or preserves the orphan signal and is not repaired through this endpoint.
9. The UI never shows a success toast for a repair that still failed; it preserves the warning/action and displays the server error.
10. Route and end-to-end tests cover healthy accept, initial-hook failure healed immediately, failed heal, terminal replay heal, explicit retry, already-healed no-op, non-accepted rejection, cross-org isolation, and email dedupe.

## 2. Existing hook contract

**D1 — The sole repair primitive remains the exported hook.** Its exact signature is:

```ts
export async function onSubmissionAccepted(
  submission: WithId<FormDataDoc>,
): Promise<void>
```

(`src/features/responses/on-submission-accepted.ts` 75–77). It takes the full identified FormData document and derives `eventId` and `organizationId` from it (75–78). Callers must therefore obtain that document through an event-and-organization-scoped read; the client never supplies tenant fields.

Re-invocation is safe for the attendee/marker pipeline:

- QR identity reuses a non-empty stored `qrTokenHash`; legacy records deterministically mint/hash from `eventId` and FormData id (80–88).
- The Attendee is created through `createAdminAttendeeIfAbsent` at the deterministic submission-derived identity (126–139). The DAL computes that identity, returns an existing document untouched, and uses a transaction/create for race safety (`src/lib/db/adminAttendee.ts` 67–97, 124–131).
- After the Attendee exists, the hook sets `attendeeCreated:true`; only a legacy missing hash is backfilled, while an existing hash is not overwritten (`src/features/responses/on-submission-accepted.ts` 141–145; `src/lib/db/adminFormData.ts` 317–331).
- Missing/deleted order denormalization deliberately degrades to null IDs/fallback labels rather than throwing (`src/features/responses/on-submission-accepted.ts` 33–36, 95–124).

The transition commits acceptance before invoking the hook (the transaction writes status/`acceptedAt` at `src/lib/db/adminFormData.ts` 411–430, then invokes at 432–435). A hook exception does not roll back acceptance: it is logged and returned as `acceptHookFailed:true`, leaving the response accepted and normally `attendeeCreated:false` (437–445). Thus the persisted repair predicate is `status === "accepted" && attendeeCreated !== true`; `acceptHookFailed` is a transient call result, not stored state.

**D2 — Attendee repair may re-enter email evaluation, but cannot duplicate the confirmation.** The hook flips `attendeeCreated:true` before calling the M6-T3 confirmation helper (`src/features/responses/on-submission-accepted.ts` 141–160). The email send uses `dedupeKey: attendee.id` (`src/features/emails/server/fire-on-accept-email.ts` 113–122), and the helper explicitly documents healing replay safety with the same attendee id (4–10, 19). Therefore a heal can evaluate/call email again, but the deterministic outbox identity collapses it rather than re-sending a second confirmation.

An email-only failure is separate. The email helper catches typed and thrown failures and never rethrows (`src/features/emails/server/fire-on-accept-email.ts` 131–146); the accept hook adds a second catch after attendee creation and marker commit (`src/features/responses/on-submission-accepted.ts` 147–166). Consequently a post-attendee email crash leaves `attendeeCreated:true` and never becomes `acceptHookFailed`. It is handled by the email/send-log retry surface, not this repair path.

## 3. Current generic-route gap

The generic endpoint is `PATCH /api/dashboard/events/{eventId}/responses/{responseId}/status` and accepts exactly `{ to: FormDataStatus }` under Zod validation (`src/app/api/dashboard/events/[eventId]/responses/[responseId]/status/route.ts` 1, 21–23, 36–43). It calls `transitionAdminFormDataStatus` with the URL response/event ids, the server-resolved organization, and requested target (45–50). The DAL permits forward skips, writes status/updated time, writes `acceptedAt` for acceptance, and rejects repeats/backwards/anything out of accepted (`src/lib/db/adminFormData.ts` 362–371, 402–428).

**Exact defect:** after handling only `!result.ok` at status-route lines 52–56, the route returns `200 { responseId, status }` at line 59. It never reads `result.acceptHookFailed`, even though the DAL returns that flag at `src/lib/db/adminFormData.ts` 338–345 and 445. The current response table treats every 2xx accept as `Response accepted` (`src/features/responses/components/responses-table.tsx` 65–82). This is the silent false-success gap.

Authentication and tenancy are already appropriate and must be reused. The route calls `resolveRegistrationRouteScope(eventId)` (`status/route.ts` 29–34); default scope resolution requires a session, canonical active organization membership, `write:events`, and an event owned by that organization (`src/features/registration/server/route-scope.ts` 40–86). The transition additionally verifies both stored `eventId` and `organizationId`, returning the same NOT_FOUND result for missing and cross-tenant records (`src/lib/db/adminFormData.ts` 375–399).

## 4. Existing manual-register repair precedent

**D3 — Generic repair copies the existing verification-and-reinvoke pattern.** Manual register uses the same scope helper and therefore the same `write:events` and org-owned-event gate (`src/app/api/dashboard/events/[eventId]/attendees/register/route.ts` 121–126). After its accept attempt, it treats either a terminal replay or `acceptHookFailed:true` as requiring verification (`route.ts` 270–294), re-reads the FormData with response id + event id + organization id (295–299), and directly invokes `onSubmissionAccepted` only when the persisted document is accepted and `attendeeCreated !== true` (306–312).

If that repair throws, manual register returns HTTP 500 with `{ error: "The registration was recorded but the attendee record could not be created. Please retry.", code: "ATTENDEE_CREATION_FAILED" }` (`route.ts` 310–324). Only then can it return success refs (329–333). M8-T6 generalizes this shipped pattern; it does not introduce a second attendee-creation algorithm.

## 5. Current admin visibility

There is no current orphan indicator or affordance:

- `SerializedResponse` has status/ticket/order fields but no `attendeeCreated` field, and `serializeResponses` drops it (`src/features/responses/utils.ts` 10–26, 68–90).
- Status utilities expose only the four status labels and legal forward transitions; accepted is terminal and yields no target (`src/features/responses/status-utils.ts` 13–29, 41–48).
- The action menu renders an em dash for accepted rows (`src/features/responses/components/response-actions-menu.tsx` 35–43).
- The table renders only its ordinary Status badge and gives the menu only status, not hook state (`src/features/responses/components/responses-table.tsx` 151–168).

Therefore an orphan looks exactly like any healthy Accepted response, and the admin cannot see or act on it in the shipped responses UI.

## 6. Repair trigger and route contract

**D4 — Ship BOTH automatic and explicit repair.** Automatic repair closes the false-200 window during the operation that caused it and makes a direct accepted replay useful. Explicit retry is still required because historical orphans are already terminal, accepted rows currently issue no status write, and relying on an unrelated future mutation is not an admin affordance. The combination is justified by the hook's deterministic attendee, idempotent marker, and email dedupe guarantees (§2) and by the manual route precedent (§4).

Automatic PATCH behavior:

1. For a successful transition to a target other than accepted, preserve the current response.
2. For a successful transition to accepted with no `acceptHookFailed`, return success normally (the hook has already set `attendeeCreated:true` before returning).
3. For a successful accept with `acceptHookFailed:true`, re-read the scoped response, verify the persisted predicate, and attempt one direct heal. Never recursively call the status route/DAL transition.
4. For an `INVALID_TRANSITION` caused by a requested `to:"accepted"`, re-read the scoped response. If it is already accepted, treat it as an idempotent detection/replay: heal when pending, otherwise return no-op success. Other invalid transitions remain 409.
5. One HTTP request performs at most one direct repair invocation after the transition attempt. There is no server loop.

**D5 — Add an explicit response-scoped action endpoint.** Exact contract:

```http
POST /api/dashboard/events/{eventId}/responses/{responseId}/retry-attendee-creation
Content-Type: application/json

{}
```

No client-provided status, event, organization, submission, or attendee payload is accepted. An absent body and `{}` are equivalent; non-empty/unknown fields should be rejected with 400 to keep the mutation narrow.

The route calls `resolveRegistrationRouteScope(eventId)` with its default write gate, so permission is exactly `write:events`; it then reads the response using `{ responseId, eventId, organizationId: scope.organizationId }`. Missing, cross-event, and cross-org all return `404 { error:"Response not found.", code:"RESPONSE_NOT_FOUND" }`. This mirrors the existing scope and DAL null-equivalence (`src/features/registration/server/route-scope.ts` 40–86; `src/lib/db/adminFormData.ts` 389–399).

Success response, including no-op:

```json
{
  "responseId": "…",
  "status": "accepted",
  "attendeeCreated": true,
  "outcome": "repaired" | "already_complete"
}
```

The implementation may determine `repaired` from the pre-invocation flag; correctness must rely on the post-invocation completion or successful hook return, not attendee creation count. Return HTTP 200 for both outcomes so repeated clicks/network retries converge.

Failure responses:

- 409 `{ "error":"Only accepted responses can create an attendee.", "code":"RESPONSE_NOT_ACCEPTED" }` when the scoped record exists but is not accepted.
- 500 `{ "error":"The response is accepted but the attendee record could not be created. Please retry.", "code":"ATTENDEE_CREATION_FAILED", "responseId":"…", "attendeeCreated":false }` when the hook still throws. Do not return 200 merely because acceptance remains committed.
- Existing scope failures retain 401/403/404 semantics.
- 429 uses the app's standard rate-limit response when the limiter rejects.

**D6 — Idempotency is primary; rate limiting is defense in depth.** Concurrent/repeated retries are safe at the data layer, but can still amplify Firestore, QR rendering, and email-definition work. Apply the repository's existing `checkRateLimit` authenticated-mutation convention; the closest semantic precedent is email-message retry, keyed by actor and limited to 30 (`src/app/api/dashboard/events/[eventId]/emails/messages/[messageId]/retry/route.ts` 12–30). For attendee repair, key by canonical organization + actor + endpoint/response and return 429 with `Retry-After`. Exact numeric threshold is an Implementation/SEC choice using that convention, not a new global policy. The client disables the row action while pending and must not automatically retry a 500/429. One user action equals one request.

## 7. Heal semantics and admin presentation

**D7 — Already complete is no-op success.** If `status:"accepted"` and `attendeeCreated === true`, do not call the hook; return `outcome:"already_complete"`. This prevents needless downstream work even though replay is data-safe.

**D8 — Non-accepted is a conflict, not implicit acceptance.** The retry endpoint never transitions status. Return `RESPONSE_NOT_ACCEPTED` 409. Acceptance remains exclusively the audited status workflow.

**D9 — A pending accepted response invokes the whole hook and is healthy only when the attendee marker completes.** Call `onSubmissionAccepted` once. Its ordering guarantees Attendee exists before the marker flips (`src/features/responses/on-submission-accepted.ts` 126–145). A thrown repair returns structured 500 and leaves the visible warning/action in place after refresh.

**D10 — Email failure is neither pending nor repaired here.** Because email runs after `attendeeCreated:true` and cannot throw through the helper/hook (`src/features/responses/on-submission-accepted.ts` 141–166; `src/features/emails/server/fire-on-accept-email.ts` 131–146), an email-failed record is already complete for this ticket. The endpoint returns `already_complete` and does not retry email. Email replay/transport retry remains the send-log concern.

**D11 — Surface only actionable persisted truth.** Extend the server serialization with `attendeeCreated: boolean` using `response.attendeeCreated === true`. For accepted rows where false, show a compact warning adjacent to Accepted (recommended copy: `Attendee not created`) and replace the terminal em dash with `Retry attendee creation`. Do not expose internal `acceptHookFailed`; it is not persisted. On success, show `Attendee created`, refresh, and remove the warning/action. On 500, show the structured server message and retain it; on 429, show retry guidance; on 401/403/404, use existing error handling/refresh conventions.

Legacy accepted documents with an absent marker are deliberately treated as pending (`!== true`), matching the hook contract (`src/features/responses/on-submission-accepted.ts` 24–31). Non-accepted rows do not display the warning even if their normal pre-accept marker is false.

## 8. Permissions, tenancy, and security invariants

**D12 — Repair has exactly the status route's authority.** Both automatic and explicit paths require `write:events`, not view-only access. `resolveRegistrationRouteScope` validates the session, derives canonical organization membership, checks the permission, and loads the org-owned event (`src/features/registration/server/route-scope.ts` 45–86). Every response read includes response id, URL event id, and server-derived organization id. Never trust FormData, organization, attendee, email, or QR values from the request.

The route must preserve IDOR-safe null equivalence: a guessed response from another event/org is 404, not 409 and not a state-revealing message. Logs may include the response id but must not log submission PII or QR material. CSRF posture matches the existing same-origin authenticated dashboard mutation routes; SEC should verify the final implementation has not weakened it.

## 9. Implementation boundary

Expected application changes after this Research handoff:

- Extract or add a small server repair helper shared by the generic PATCH and retry POST so predicate, scoped reread, hook invocation, and structured failure do not drift. The manual register route should adopt it if doing so preserves its existing public error contract; otherwise its already-correct block remains the behavioral reference.
- Update the generic status route to consume `acceptHookFailed` and recognize accepted replay.
- Add the retry route at the exact D5 path.
- Serialize the marker and add the accepted-row warning/action to both event and organization response tables through their shared components.
- Add route, helper, serialization/component, tenancy, concurrency/idempotency, and email-dedupe regressions.

No new Firestore collection, field, index, attendee algorithm, QR algorithm, email kind, or status-machine state is required.

## 10. Explicit non-goals

- No rollback/un-accept when attendee creation fails.
- No new Attendee creation implementation parallel to `onSubmissionAccepted`.
- No repair of orders, capacity, pricing, payment, or malformed submission content.
- No implicit accept from the retry endpoint and no reopening terminal status transitions generally.
- No email resend button, failed-email diagnosis, outbox-policy change, or confirmation dedupe change.
- No bulk orphan sweep/background job, cross-event retry, or organization-wide retry-all action.
- No exposure of submission PII, QR token/hash, raw exception text, or tenant existence in errors.
- No application-code changes in this Research task.

## 11. Test/QA acceptance matrix

1. Healthy new→accepted: one hook execution, attendee exists, marker true, PATCH 200, ordinary success toast.
2. Initial hook throws before marker; generic PATCH detects `acceptHookFailed`, scoped reread heals once, returns 200, exactly one Attendee.
3. Initial hook and direct heal both fail: acceptance remains committed, marker remains not true, PATCH returns structured 500 (never silent 200), warning appears after refresh.
4. PATCH accepted replay against accepted/pending heals without rewriting `acceptedAt`; against accepted/complete returns idempotent 200; other invalid transitions remain 409.
5. Explicit retry pending returns `repaired`; repeat/concurrent retries return repaired/already_complete while exactly one Attendee and one confirmation outbox identity exist.
6. Explicit retry accepted/complete does not invoke the hook and returns `already_complete`.
7. Explicit retry new/pending/reviewed returns `RESPONSE_NOT_ACCEPTED` and writes nothing.
8. Missing, other-event, and other-org response IDs all return indistinguishable 404; viewer without `write:events` gets 403; absent/invalid session gets 401.
9. Simulated attendee/marker failure returns `ATTENDEE_CREATION_FAILED` without raw exception/PII; UI retains warning and offers a user-controlled retry.
10. Simulated confirmation transport/helper failure still yields attendee + marker true and no attendee-repair warning; repairing a pre-email crash calls email evaluation but the same attendee dedupe key prevents an additional send/outbox row.
11. Legacy accepted record with absent `attendeeCreated` is visible and repairable; absent marker on a non-accepted row is not labeled orphaned.
12. Rate limit returns 429 without hook invocation; disabled/pending UI prevents double-click storms and does not auto-loop after failure.

## 12. Design recommendation and open questions

**D13 — Dedicated Design phase is skippable.** The core fix is a backend repair/helper plus a narrow extension to the existing shared row status/action pattern. The UI needs one warning phrase, one row action, pending disablement, and existing toast behavior; it does not introduce a new screen, dialog, navigation concept, or cross-cutting layout. Full-Stack can follow D11 and the existing table/menu primitives, with CR/QA checking accessibility, narrow-width behavior, and both themes.

There are no blocking Design questions.

**OQ-1 (Design, non-blocking only if Design elects to review):** choose whether `Attendee not created` renders as a secondary warning badge beside Accepted or as a short second line beneath it. Default: a secondary warning badge beside/below the existing status badge, preserving Accepted as the authoritative submission status and keeping the Retry action in the existing actions column.
