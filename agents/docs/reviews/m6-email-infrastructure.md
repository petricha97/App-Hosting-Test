# Code Review — M6-T1 Email Infrastructure (provider + outbox DAL)

Code Reviewer, 2026-07-14. Scope: all uncommitted changes on `feat/m6-t1-email-infrastructure`
relative to `prototype` — tracked diffs to `firestore.indexes.json`, `firestore.rules`,
`src/types/collection.ts`, plus the new `src/lib/email/{transport,dev-outbox-transport,
send-service,sender-identity,merge-tags,merge-context,schemas}.ts`,
`src/lib/db/{adminEmailMessage,adminEmailSettings,emailMessageId}.ts`, six test files, and
`agents/docs/data-models/m6-email-infrastructure.md`. Reviewed against
`agents/docs/specs/m6-email-infrastructure.md` (authoritative) and the data-model doc.
(HANDOVER.md and `memory/` excluded per review instructions.)

Checks executed this session:
- `npm run lint` ✅ (exit 0, no warnings or errors)
- `npm run build` ✅ (exit 0, production build clean)
- `npm run test -- --run` ✅ 78 files / 1050 tests, all passing — matches the implementer's
  reported baseline; the six new M6 suites are included in that count.

---

## Mandatory-check results

1. **DAL boundary — PASS.** The only new `firebase-admin/firestore` / `@/app/lib/firestore`
   imports live in `src/lib/db/adminEmailMessage.ts` and `src/lib/db/adminEmailSettings.ts`.
   `src/lib/db/emailMessageId.ts` is pure `node:crypto` (same family as `attendeeId.ts` /
   `formDataId.ts`). `src/lib/email/*` calls only exported DAL functions
   (`send-service.ts:21-26`, `sender-identity.ts:19`). The import-boundary test
   (`src/__tests__/email-import-boundary.test.ts`) genuinely enforces all three claims: every
   `src/lib/email/*.ts` module carries `import "server-only"` (:40-49), a repo-wide walk of
   `src/` asserts `transport.ts` is the **only** production importer of the concrete dev-outbox
   transport (:51-62, exact-array assertion, tests excluded), and no `src/lib/email` module may
   import `firebase-admin/firestore` or `@/app/lib/firestore` (:64-72). Pre-existing
   firebase-admin imports in `src/app/api/**` routes predate this diff and are untouched.

2. **Dedupe correctness — PASS.**
   - Deterministic id: `emailMessageId.ts:25-41` hashes the JSON tuple
     `["EmailMessage", org, event, kind, recipientEmailLower, dedupeKey]` — domain-prefixed,
     separator-unambiguous, recipient lowercased (matches the stored form,
     `adminEmailMessage.ts:124`). Tested including separator-ambiguity and cross-family
     collision checks (`email-message-id.test.ts:64-85`).
   - Create-if-absent: `adminEmailMessage.ts:106-154` — transactional read + `tx.create`, so
     the read-check race loses to `ALREADY_EXISTS` and replays as `created:false`. The send
     service never invokes the transport for `created:false` (`send-service.ts:277-284`), giving
     at most one transport call per logical send. Race coverage is the sequential
     "first-then-duplicate, zero extra writes" shape (`admin-email-message.test.ts:105-114`;
     duplicate-with-one-transport-call at `email-send-service.test.ts:184-198`) — the same rigor
     as the M5-T1 attendee precedent the spec cites (`admin-attendee.test.ts:449`).
   - Status machine: `queued→sent` (`adminEmailMessage.ts:171-195`), `queued→failed` (:199-226),
     `failed→queued` retry only (:243-278); every guard is inside the transaction, invalid
     transitions are typed no-ops with zero writes, `sent` is terminal — all asserted with
     write-count checks (`admin-email-message.test.ts:159-331`). Snapshot immutability (AC-8) is
     regression-tested by inspecting every transition's update keys (:218-242).

3. **Merge renderer — PASS** (one defense-in-depth Should-fix, S-3).
   - HTML escaping: all five entities, `&` first (`merge-tags.ts:105-112`); applied to every
     merged value in `bodyHtml` (:198); XSS-tested (`email-merge-tags.test.ts:118-136`).
   - Header injection: `stripControlChars` removes the full C0 range + DEL from values merged
     into `subject` (`schemas.ts:17-21`, `merge-tags.ts:199`); SEC-tested with a
     `\r\nBcc:` payload (`email-merge-tags.test.ts:138-146`). from/replyTo are never
     merge-rendered (they come from `sender-identity.ts` and are schema-validated).
   - `{qr_code}`: raw markup in `bodyHtml` only, `""` in subject/bodyText, raw token asserted
     absent from all rendered text (`merge-tags.ts:192-196`;
     `email-merge-tags.test.ts:179-209`, with a mint/verify round-trip against the M5 token).
   - Missing → `""` + `missingTags`; unknown → literal + `unknownTags`; `{}`/`{unclosed}`/
     `{Upper}` untouched and unreported (`merge-tags.ts:141,177-189`; tests :149-176, :254-267).
   - Gap found: the renderer strips control characters from merged **values** only — a control
     character already present in the **template's** subject string passes through untouched
     (see S-3).

4. **Indexes & rules — PASS.**
   - `firestore.indexes.json` adds exactly the three §2 composites:
     `EmailMessage (eventId ASC, organizationId ASC, createdAt DESC)`, `+status ASC`, and
     `+kind ASC` — a one-to-one match with the three list shapes
     `listAdminEmailMessagesForEvent` can produce (`adminEmailMessage.ts:328-348`). The
     unsupported `status`+`kind` combination throws before building the query (:321-326) and is
     tested (`admin-email-message.test.ts:445-452`). `countAdminEmailMessagesForEvent` is
     equality-only aggregate `count()` (:356-375) — served by index merging, no composite needed
     (M5 convention). `getAdminEmailMessageForEvent` / EmailSettings are doc-id gets. No query
     in the diff can hit a missing-index error.
   - `firestore.rules` adds explicit deny-all matches for `/EmailMessage/{messageId}` and
     `/EmailSettings/{eventId}` with the rationale documented in-file (§5 AC-1, §2 AC-7).
   - §5 AC-3 (no API route in T1): confirmed — the diff touches nothing under `src/app/`.

5. **Types / error handling / structure — PASS** (S-1, S-2, nits below). No `any` anywhere in
   the new code; the only casts are the standard `snap.data() as XDoc` DAL reads and typed test
   narrowings. All fallible operations return typed unions
   (`SendEventEmailResult`, `EmailMessageTransitionResult`, `RetryFailedEmailMessageResult`,
   `UpsertAdminEmailSettingsResult`); the transport throw path is caught and landed as a
   `failed` row (`send-service.ts:165-171`); `errorMessage()` narrows `unknown` correctly
   (:115-117). PaymentProvider mirror claim verified: `transport.ts` matches the
   `src/lib/payments/payment-provider.ts` shape (narrow interface + result type + factory;
   env-selected, fail-closed). Deterministic-id, create-if-absent, aggregate-count, lazy-1:1
   config, cursor and limit conventions all match the M3/M5 DAL patterns byte-for-byte (e.g.
   `startAfter(Timestamp.fromMillis(...))` + `limit ?? 50` exactly as `adminAttendee.ts:245-251`).
   Files are all well under 800 lines; no dead code found (every export has a production or
   test consumer).

6. **Tests assert real behavior — PASS.** Every suite asserts stored document state and
   write-counts against the shared `fake-admin-db`, not snapshots: zero-write guarantees are
   checked via `fake.writes.length`, dedupe via store size + transport-call counts, no-network
   via a rejecting `fetch` spy (`email-send-service.test.ts:86-112`), fail-closed env posture via
   `vi.stubEnv` + module reset (`admin-email-settings.test.ts:233-254`), and the data-model doc's
   attemptCount arithmetic (`enqueue→failed→retry→sent` reads 2) is asserted end-to-end
   (`admin-email-message.test.ts:253-271`, `email-send-service.test.ts:496-525`).

**Data-model doc vs code:** accurate throughout (collections, id derivation, status machine,
send-service order of operations, failure taxonomy, batch semantics, env table, index table)
— with one overstatement, S-1 below.

---

## Findings

### Blockers

None.

### Should-fix (fix in this ticket)

- **S-1 — `markAdminEmailMessageSent` / `markAdminEmailMessageFailed` have no tenancy guard,
  contradicting the data-model doc.** `agents/docs/data-models/m6-email-infrastructure.md:42`
  claims "missing and cross-org docs both answer `NOT_FOUND` (IDOR-safe)" for the status
  machine, but only `retryFailedEmailMessage` re-checks `eventId`/`organizationId`
  (`adminEmailMessage.ts:255-261`); `markAdminEmailMessageSent` (:171-195) and
  `markAdminEmailMessageFailed` (:199-226) accept a bare `messageId` and will transition any
  org's doc. Unreachable today (both are called only by the send service on an id it just
  created), but they are exported DAL functions a T2/T3 route could call with a client-supplied
  id. Either add the same `{eventId, organizationId}` guard retry has, or correct the doc and
  add a loud "internal — id must come from createAdminEmailMessageIfAbsent" comment. Guard
  preferred (M5 check-in-flip precedent scopes its transition).
- **S-2 — `deliverQueuedMessage` silently discards the transition results.**
  `send-service.ts:174-178` and :182-185 `await` `markAdminEmailMessageSent` /
  `markAdminEmailMessageFailed` but ignore the returned
  `EmailMessageTransitionResult` — if the transition ever answers `NOT_FOUND`/`INVALID_STATUS`,
  the caller is still told `outcome:"sent"` while the doc did not move. Currently unreachable in
  practice (the row was created `queued` in the same call and duplicates never reach delivery),
  but it is a swallowed typed error in the one module whose contract is "callers always get a
  typed result". Check the result and surface a `failed`-style outcome (or at minimum a
  server-side error log) when the transition does not land.
- **S-3 — rendered subject is not checked for control characters originating in the template
  itself.** §3's header-injection rule is implemented for merged values
  (`merge-tags.ts:199`), but a subject **template** containing `\r\n` flows through rendering,
  passes `validateRenderedEmailContent` (`schemas.ts:102-120`, size-only), is stored, and is
  handed to the transport (`send-service.ts:161`). Harmless under the never-delivering dev
  outbox, but T2 makes templates organizer-authored and the send service is the chokepoint every
  future caller shares. Cheap fix: reject (or strip) control characters in `rendered.subject`
  inside `validateRenderedEmailContent` alongside the length check.

### Nits (optional)

- **N-1** — `src/types/collection.ts` diff includes unrelated cosmetic reflow of the
  `FormFieldType`, `PaymentStatus` and `RegistrationDraftStep` unions (multi-line → single-line).
  Pure formatter churn; keep M6 diffs to M6 lines.
- **N-2** — Stuck-queued seam: a process crash between `createAdminEmailMessageIfAbsent` and the
  transport call leaves a `queued` row that is neither retryable (`retry` is `failed→queued`
  only, `adminEmailMessage.ts:263-265`) nor re-sendable (duplicate enqueue returns early,
  `send-service.ts:277-284`). Spec-conformant for T1 (no `sending` state, synchronous dev
  transport) — worth an explicit line in the data-model doc's T3 notes so the scheduler ticket
  owns `queued`-age recovery.
- **N-3** — `attemptCount` increments on attempt **completion** (sent/failed transitions) rather
  than at retry as the spec's §2 wording implies. Net counter is equivalent under every path and
  the divergence is documented (data-model doc :43) and tested; no action needed, noting for
  spec traceability.
- **N-4** — `sendEventEmailBatch` resolves the sender identity once **per recipient**
  (`send-service.ts:401-415` → :238) — one `EmailSettings` read per row. Fine at T1 scale;
  resolve once per batch before T3's "Email all" ships.
- **N-5** — `RenderReport` (`send-service.ts:74-78`) widens `usedTags`/`missingTags` to
  `string[]` where `EmailMergeTag[]` is available from the renderer. Slight, deliberate-looking
  loosening (unknownTags is genuinely `string[]`); typed arrays would be strictly better.

---

## Verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M6-T1 — Email infrastructure (transport, outbox DAL, merge renderer, sender identity) | **APPROVED** | No blockers. S-1/S-2/S-3 are contained hardening items to land in this ticket before Security review; none invalidates the shipped behavior, all current ACs are met and race-/SEC-/boundary-tested. |

Overall: **APPROVED** — hand off to the Security Agent once S-1..S-3 are addressed (S-1 also
requires a one-line data-model doc correction if the guard route is not taken).

---

## S-1/S-2/S-3 fix re-review

Code Reviewer, 2026-07-14 (same session). Scope: the developer's fix diff on
`src/lib/db/adminEmailMessage.ts`, `src/lib/email/send-service.ts`, `src/lib/email/schemas.ts`,
the two updated test suites, and `agents/docs/data-models/m6-email-infrastructure.md`.

Checks re-executed after the fixes:
- `npm run lint` ✅ (exit 0, no warnings or errors)
- `npm run build` ✅ (exit 0)
- `npm run test -- --run` ✅ 78 files / **1054** tests passing (1050 + the 4 new tests, as
  reported)

**S-1 — RESOLVED.** `markAdminEmailMessageSent` and `markAdminEmailMessageFailed` now take
`{ messageId, eventId, organizationId, ... }` and re-check both fields inside the transaction
before the status guard, answering `NOT_FOUND` with zero writes for cross-tenant ids — the exact
guard `retryFailedEmailMessage` already had (`adminEmailMessage.ts:186-192`, :226-232). The send
service passes scope at every call site: `deliverQueuedMessage` derives it from the message
snapshot (`send-service.ts:163-167` — `Pick` widened to include `organizationId`/`eventId`,
:148-158), and the identity-failure paths pass the caller's ids (:337-342, :524-529). New tests
assert missing / cross-org / cross-event → `NOT_FOUND` with zero writes and an untouched doc for
both functions (`admin-email-message.test.ts:236-271`, :273-309). The data-model doc's IDOR
claim (:42) is now true of the code.

**S-2 — RESOLVED.** Both transition results are now checked. A sent-transition that does not
land returns a typed `{ ok: false, reason }` with the transition code plus a `console.error` —
the caller is never told "sent" over a doc that says otherwise (`send-service.ts:207-225`).
Failed-transition misses go through the shared `markMessageFailedChecked` helper (:123-141),
used at all four failure call sites (factory throw :177, transport-failed :228, enqueue-time
identity failure :337, retry-time identity failure :524). New test forces the miss by deleting
the row between the transport call and the transition, and asserts the `failed` outcome with the
`(NOT_FOUND)` reason and exactly one `console.error` (`email-send-service.test.ts:182-205`).
`console.error` for a server-side should-never-happen condition is consistent with the repo's
existing error-logging posture; fine.

**S-3 — RESOLVED.** `validateRenderedEmailContent` now strips C0/DEL control characters from the
rendered subject and returns the sanitized content on `ok` (`schemas.ts:112-145`); the length
check runs against the sanitized subject (correct — the limit applies to what is stored). The
send service persists and delivers `contentCheck.content`, never the raw render
(`send-service.ts:270-279`, :319-321). The strip-vs-reject choice is documented in-code with the
rationale (subject is display prose; contrast the rejecting `emailAddressSchema`). New test
plants `\r\n` + a NUL escape in the subject **template** and asserts the neutralized subject in
both the stored doc and the transport payload (`email-send-service.test.ts:324-345`); the raw
NUL byte in the test source was repaired to a `\u0000` escape. Data-model doc updated to
describe the chokepoint behavior (:85, :109).

No regressions or new issues introduced by the fix diff; nits N-1..N-5 remain optional and
unchanged.

### Final verdict

| Ticket | Verdict |
|---|---|
| M6-T1 — Email infrastructure | **APPROVED** |

**APPROVED** — S-1, S-2 and S-3 are genuinely resolved with real failure-scenario tests; lint,
build and the full suite are green. The ticket hands off to the Security Agent.
