# M6-T3 Data Model — Lifecycle Trigger Evaluator (Periodic Triggers & Audience Segmentation)

Backend Agent, 2026-07-15. Implements the Backend slice of `agents/docs/specs/m6-lifecycle-triggers.md` (M6-T3 §3/§4/§5/§6/§8/§9) under `baseline.md` / `m1`–`m6-emails-admin.md` / `m6-email-infrastructure.md` conventions. Source of truth: the spec above + `src/types/collection.ts` (`EmailDefinitionDoc`, `AttendeeDoc`, `OrderDoc`, `FormDataDoc`, `RegistrationDraftDoc`) + `src/lib/db/{adminOrder,adminFormData,adminRegistrationDraft,adminAttendee,adminEmailDefinition,adminEvent}.ts` + `src/lib/email/lifecycle/*` + `firestore.indexes.json`.

**This slice ships the periodic evaluator engine, its DAL additions, and the internal scheduler entrypoint.** It does NOT touch the real-time `on-submit`/`on-accept` hooks (§1/§2), the "Email all" route (§7), or any UI (`trigger-cell.tsx`, `abandoned-tab.tsx`) — those are the Full-Stack Developer's parallel slice on the same ticket.

## 1 — Scheduling mechanism decision (spec §8 OQ-2)

**Chosen: option 1 — Cloud Scheduler → an internal authenticated Next.js API route** (`POST /api/internal/email-triggers/evaluate`), matching the spec's own non-binding recommendation.

Rationale:
- This repo is 100% Next.js/Firestore today — zero existing Cloud Functions codebase, zero second deploy artifact anywhere in the tree. Introducing Cloud Functions (option 2) would be the FIRST second-runtime deployable in this project, doubling the deploy/secrets surface for a milestone that doesn't need it yet.
- The evaluator needs the exact same DAL (`src/lib/db/*`), the exact same `server-only` module graph, and the exact same `EmailDefinition`/`default-definitions.ts` merge logic T2 already built. Reusing it in-process (option 1) means zero duplication and zero risk of the evaluator's idea of "what's enabled" ever drifting from what the Emails screen shows. A Cloud Functions codebase (option 2) would need either a duplicated copy of that logic or an extracted shared package — neither exists today and both are real new infrastructure.
- Option 3 (opportunistic evaluation piggybacked on dashboard traffic) is explicitly not recommended by the spec itself and was rejected for the same reason: an event nobody's dashboard visits would never fire its debt-chase emails, which defeats the entire point of "the org has stopped checking, nudge them anyway."
- The real downside — Cloud Scheduler is provisioned outside this repo — is accepted as a deliberate, documented **human/ops task**, exactly like `DRAFT_TOKEN_SECRET` / `QR_TOKEN_SECRET` / `SCANNER_SESSION_SECRET` already are in `apphosting.yaml` and `HANDOVER.md`. This ticket does **not** provision real Cloud Scheduler infrastructure — see §9 below for exactly what remains a human task.

**What ships in this repo vs. what's a human task:**

| Item | Status |
|---|---|
| `POST /api/internal/email-triggers/evaluate` route, auth, sweep logic | Shipped, this ticket |
| `EMAIL_TRIGGER_EVALUATOR_SECRET` wired into `apphosting.yaml` (as a `secret:` reference) | Shipped, this ticket |
| The actual `emailTriggerEvaluatorSecret` secret VALUE in Secret Manager | **Human task** — `firebase apphosting:secrets:set emailTriggerEvaluatorSecret` before prod deploy |
| Cloud Scheduler job (cadence, target URL, header) | **Human task** — a `gcloud scheduler jobs create http ...` (or console) step, 15–30 minute cadence, header `x-email-trigger-secret: <secret value>` |

## 2 — Module layout (`src/lib/email/lifecycle/`)

Chosen location: **`src/lib/email/lifecycle/`**, a new subdirectory alongside `send-service.ts`/`transport.ts`/`merge-tags.ts` — not `src/features/emails/server/` (which is the Full-Stack Developer's T2 slice, actively being edited in parallel by the same dispatch that owns §1/§2/§7). The evaluator is genuinely cross-cutting infra (reads Attendee/Order/FormData/RegistrationDraft/EmailDefinition, drives sends) with no UI pairing, matching `send-service.ts`'s own precedent — not a feature-specific server helper.

```
src/lib/email/lifecycle/
  types.ts                    # AudienceCandidate, AudiencePageResult, TriggerEvalOutcome
  dedupe-keys.ts               # the 3 dedupeKey formulas — PURE, single source of truth
  definition-enabled.ts        # fresh per-page `enabled` re-check
  qr.ts                        # QR-SVG minting for {qr_code}-using templates (qr-ready)
  event-schedule.ts            # §5 catch-up cutoff (event's first period start)
  audience-queries.ts          # the 6 §6 segment queries, bounded + cursor-paginated
  paged-trigger-runner.ts      # generic paged-send engine (shared by all 3 triggers)
  evaluate-abandoned.ts        # §3 abandoned-24h
  evaluate-unpaid-offsets.ts   # §4 unpaid-offsets
  evaluate-scheduled.ts        # §5 scheduled (per-definition)
  evaluate-event.ts            # per-event orchestrator (ties §3/§4/§5 together)
  run-sweep.ts                 # top-level: iterate Published events, call evaluate-event
  evaluator-auth.ts            # shared-secret auth for the internal route
```

`src/app/api/internal/email-triggers/evaluate/route.ts` is the one new API route, calling `run-sweep.ts`.

## 3 — dedupeKey formulas (`dedupe-keys.ts`) — the safety-critical part

Exactly the three formulas the spec's tables specify, and nothing else:

```ts
abandonedReminderDedupeKey(draftId)                    → draftId
unpaidOffsetDedupeKey(orderId, offsetDays)              → `${orderId}:${offsetDays}`
scheduledDedupeKey(definitionId, recipientKey)          → `${definitionId}:${recipientKey}`
```

Every trigger evaluator imports these — no inline template ever reappears at a second call site. Combined with T1's `createAdminEmailMessageIfAbsent` (create-if-absent transaction at the deterministic id derived from `(org, event, kind, recipientEmail, dedupeKey)`), this is the **entire** double-send prevention mechanism — no new "already sent" marker collection exists or was added.

## 4 — Audience segment queries (`audience-queries.ts`, spec §6)

| Audience | Source traversal | Recipient key | Bounded/paginated via |
|---|---|---|---|
| `all-invitees` | none — always `{candidates:[], hasMore:false}` | n/a | n/a (Shared decisions: no Invitee entity exists) |
| `abandoned` | `getAdminRegistrationDraftsForEvent` (extended with a `startAfterUpdatedAtMs` cursor, additive) | `draftId` | RegistrationDraft `eventId+organizationId+updatedAt` composite (existing) |
| `pending-approval` | `listAdminFormDataForEventByStatuses` (NEW), `status IN ["new","pending","reviewed"]` | `submissionId` (= FormData doc id) | FormData `eventId+organizationId+status+submittedAt` composite (existing — `in` served by the same composite, no new index) |
| `accepted-all` | `listAdminAttendeesForEvent({status:"accepted"})` (existing, unchanged) | `attendeeId` | Attendee `eventId+organizationId+status+createdAt` composite (existing) — **no Order join, cheapest segment** |
| `accepted-paid` | Order-first traversal (below), `paymentStatus IN ["paid","comped"]` | `attendeeId` | Order `eventId+organizationId+paymentStatus+createdAt` composite (**NEW**) |
| `accepted-invoice` | Order-first traversal (below), `paymentStatus == "outstanding"` | `attendeeId` | same NEW composite |

**The Order-first traversal (`queryOrderJoinedAcceptedAudiencePage`) is the DAL gap this ticket closes** (spec §6/§9: "`getAdminOrdersForEvent` today is unfiltered"). Design decision: page the event's **Orders** filtered by `paymentStatus` (oldest-first, `createdAt ASC` — the longest-overdue orders matter most for debt-chase), then resolve the linked **Attendee** per order via `getAdminAttendeeBySubmissionId` (one extra doc GET per order in the page — bounded, not unbounded) and keep only `Attendee.status === "accepted"`. This is deliberately **Order-first, not Attendee-first-with-N+1-Order-reads**: starting from Order lets the query itself filter to `outstanding` (or `paid`/`comped`) directly via the new composite index, rather than paging every accepted Attendee (most of whom are irrelevant to debt-chase) and joining Order per row. The two-condition eligibility spec §4 requires — `Attendee.status === "accepted"` AND the Order's `paymentStatus` — falls straight out of this traversal: an outstanding order whose submission was never accepted has no matching Attendee and is silently excluded, never miscounted as eligible.

**New DAL method:** `listAdminOrdersForEventByPaymentStatus` (`src/lib/db/adminOrder.ts`) — `eventId==`, `organizationId==`, `paymentStatus == | in`, `orderBy createdAt asc`, bounded (`ORDER_LIST_LIMIT`, cursor-paginated via `startAfterCreatedAtMs`). A single status uses Firestore `==`; multiple (`["paid","comped"]`) uses `in`, served by the **same** composite index as an equality on that field (Firestore expands `in` into up to 30 disjunctive equality queries against the one registered composite — no second index needed).

**New index** (`firestore.indexes.json`): `Order: eventId ASC, organizationId ASC, paymentStatus ASC, createdAt ASC`.

**New DAL method (no new index):** `listAdminFormDataForEventByStatuses` (`src/lib/db/adminFormData.ts`) — `status IN [...]`, served by the existing `FormData eventId+organizationId+status+submittedAt` composite (M3-T4).

**Additive DAL change:** `getAdminRegistrationDraftsForEvent` (`src/lib/db/adminRegistrationDraft.ts`) gained an optional `startAfterUpdatedAtMs` cursor param (same "load more" convention as every other list) so the abandoned-24h trigger can page beyond the first `REGISTRATION_DRAFT_LIST_LIMIT` batch — backward-compatible, every existing caller (M5-T3 Abandoned tab) is unaffected since the param is optional and unused there.

**Additive DAL change:** `listAdminPublishedEventsPage` (`src/lib/db/adminEvent.ts`, NEW) — a bounded, cursor-paginated Published-events query (`status == "Published"`, `orderBy updatedAt desc`, `limit`), used ONLY by the sweep (§7 below). The existing `getAdminPublishedEvents()` (unbounded `findWhere`) is untouched — this is a new, additive method, not a replacement, so no existing caller's behavior changes.

**New index:** `Event: status ASC, updatedAt DESC`.

## 5 — Denormalization decision: Attendee.paymentStatus (spec §6 "recommended, your call")

**Deferred, not implemented in this ticket — documented, not silently dropped.**

The spec's own recommendation is to denormalize `paymentStatus` (or `hasBalanceDue: boolean`) onto `Attendee` **at accept time**, because the accept hook already holds the `Order` doc in memory for §2's on-accept kind-selection (zero extra read there). That write site is `src/features/responses/on-submission-accepted.ts` — **explicitly out of this dispatch's scope** (owned by the Full-Stack Developer, who is editing it concurrently for §2 in this same parallel dispatch). Adding a denorm write there is a real schema/behavior change to a file I was told not to touch.

Instead, this ticket closes the DAL gap the honest way available within scope: the Order-first traversal above (§4) gives the `accepted-paid`/`accepted-invoice` audiences a real, indexed, bounded query — never an unbounded scan, never N+1 over an *unfiltered* Attendee page. The remaining cost is one Attendee doc GET per Order in a page (bounded to page size, e.g. ≤100 extra reads per page), which is the honest N+1 the spec flagged, just bounded rather than unbounded.

**Follow-up (filed, not silently dropped):** once `on-submission-accepted.ts` is free of concurrent edits, add `paymentStatus: PaymentStatus | null` (or `hasBalanceDue: boolean`) to `AttendeeDoc`, stamp it in the accept hook alongside the existing Order read, and switch `accepted-paid`/`accepted-invoice` to a pure Attendee-only query (`Attendee.status=="accepted" AND Attendee.paymentStatus in [...]`) with its own composite index — eliminating the per-order Attendee GET entirely. The spec's own honesty note applies here too: there is no "mark order paid" transition anywhere in this codebase yet, so the denorm would also need that transition (if it's ever added) to patch the Attendee copy — another reason this is a real, separate, follow-up-shaped piece of work rather than a one-line addition to squeeze into this ticket.

## 6 — The generic paged-send engine (`paged-trigger-runner.ts`)

One engine, three trigger-specific callers (`evaluate-abandoned.ts` / `evaluate-unpaid-offsets.ts` / `evaluate-scheduled.ts`), each supplying only:
- `fetchPage(cursor) → AudiencePageResult` (their own audience/traversal),
- `buildDedupeKeys(candidate) → string[]` (zero entries = "not yet due, skip"; §4 unpaid-offsets can return up to 3 for one candidate).

Per-tick loop, bounded by `pageSize` (default 100) × `maxPages` (default 20 per trigger per event per invocation — ~2,000 candidates/tick, comfortably covering the spec's own 5,000-attendee worked example across 2–3 ticks, never in one unbounded shot):

1. **Re-read `enabled` FRESH** (`definition-enabled.ts`, a direct `getAdminEmailDefinitionByKind` read — a still-virtual default reads as `enabled:true`, matching the T2 merge rule) — at the **start of every processed page**, not once per tick, not once per recipient (spec §8's exact granularity). Disabled ⇒ stop immediately; every page already sent stands (T1: sent/failed rows are never un-sent).
2. Fetch one page of candidates.
3. **Split before batching**: run each candidate's recipient through `emailRecipientSchema` locally. Valid ones batch together via `sendEventEmailBatch` (one call per page, never unbounded); invalid ones are sent **individually** via `sendEventEmail` so each gets `send-service.ts`'s own typed `INVALID_RECIPIENT` rejection with **zero write**, without poisoning the rest of the page's batch. This is a deliberate strengthening of `sendEventEmailBatch`'s documented all-or-nothing recipient validation (T1 edge case 4, itself flagged as a "documented seam... may relax to partial-accept") — done entirely in this new module, **`send-service.ts` itself is unmodified**, so the M5-T3 "Email all" route (Full-Stack's parallel §7 slice, also calling `sendEventEmailBatch`) is unaffected by this change.
4. QR minting (`qr.ts`) only runs when the template actually contains `{qr_code}` (a cheap string check) — the debt-chase / abandoned-reminder / most-custom-definition paths never pay for it.
5. Advance the cursor; stop at `!hasMore`, or at the `maxPages` budget (`stoppedReason: "budget"`).

**Resumability across ticks (spec §8 AC-2), as actually implemented:** the cursor is **not persisted to Firestore** between HTTP invocations in this ticket — each scheduler tick starts a fresh sweep from page 1. This is safe and correct (never a duplicate) purely because every send is idempotent via its dedupeKey: a tick that only gets through page 1–2 of a very large audience before its budget runs out simply re-observes those same candidates as `duplicate` on the next tick and continues past them for free. The tests (`lifecycle-paged-trigger-runner.test.ts`) verify this literally: a "budget-interrupted" run followed by a "later, from-scratch invocation" produces the exact total EmailMessage row count with zero duplicate transport calls. A **persisted, fair round-robin cursor** (so an event that hasn't been re-swept in a while isn't perpetually starved by newer events at the front of the list) is a natural follow-up once real event/attendee volume warrants it — explicitly deferred, not a hidden gap (see §7 below).

## 7 — Per-event orchestration and the sweep (`evaluate-event.ts` / `run-sweep.ts`)

`evaluateEventLifecycleTriggers(organizationId, eventId, event, ...)`:
1. Loads `listAdminEmailDefinitionsForEvent` (stored docs) and merges with the virtual catalog via **`mergeEmailDefinitions`** (`src/features/emails/default-definitions.ts`, T2's own module — reused read-only, never forked) — guarantees this evaluator can never disagree with what the Emails screen displays as "enabled" / "scheduled for".
2. Runs `abandoned-24h` for the `abandoned-reminder` kind (always present, virtual-or-stored) and `unpaid-offsets` for `payment-reminder` (offsets read from the definition's own `trigger.offsetsDays`, never re-hardcoded — spec §4: "system definitions cannot edit `trigger.offsetsDays`", but the evaluator still reads the live value rather than assuming `[7,14,21]`, so a future catalog change needs no evaluator change).
3. Runs `scheduled` for **every** merged definition with `trigger.type === "scheduled"` — both system kinds (`one-week-to-go`, `qr-ready`) and any custom scheduled definition, exactly per spec §5.

`runLifecycleTriggerSweep(...)`:
- **Targeted mode** (`onlyEvent: {eventId, organizationId}`): loads exactly one event via `getAdminEventForOrganization` (the same IDOR-safe getter every other admin route uses — cross-org mismatch returns `null`, zero-event no-op, never a leak of "this event exists but belongs to someone else"). Every DAL call downstream carries both ids (spec §9 tenancy rule) — this is never a bare-eventId lookup.
- **Sweep mode** (default, no `onlyEvent`): pages `listAdminPublishedEventsPage` (bounded, §4 above), derives `organizationId` from each event's `organizationPath` (`extractOrganizationIdFromPath`, reused from `features/event/utils.ts`), and evaluates each.

**Sweep fairness — documented, deliberately modest scope decision:** `DEFAULT_LIFECYCLE_SWEEP_MAX_EVENTS = 25` events per invocation, newest-updated first, **no persisted cursor across ticks**. Because every send is idempotent, reprocessing the same 25 newest-updated events on every tick before an older, less-recently-touched event's turn comes up is safe (never a duplicate) but could, at real scale, be momentarily unfair to that older event's own debt-chase/abandoned timing. This repo has no meaningful multi-hundred-event volume today (mechanism-agnostic per spec §8, forward-looking note) — a persisted round-robin event cursor (a small new doc, e.g. `LifecycleSweepCursor`) is the natural follow-up once real event volume warrants it, explicitly filed here rather than silently omitted.

## 8 — The internal scheduler entrypoint (`POST /api/internal/email-triggers/evaluate`)

- **Auth:** `evaluator-auth.ts` — a plain shared-secret header (`x-email-trigger-secret`), constant-time compared (`constantTimeStringEqual`, reused from `draft-token.ts`), **fail-closed in production** when `EMAIL_TRIGGER_EVALUATOR_SECRET` is unset (every request rejected, never a silent unauthenticated pass-through), dev-only fallback secret + one-time warning otherwise — the identical posture to `QR_TOKEN_SECRET` / `DRAFT_TOKEN_SECRET`. This is **not** a session/cookie check (§9: "a new authentication pattern for this codebase... should be reviewed by Security Agent specifically for that reason").
- **Body (optional):** `{ eventId?, organizationId?, maxEvents?, pageSize?, maxPagesPerTrigger? }`, Zod-validated; `eventId`/`organizationId` must be supplied together (never a bare `eventId` that could cross tenants) — `.refine` enforces this before the sweep ever runs.
- **Response:** summary counts only (`eventsEvaluated`, per-event per-trigger `pagesProcessed`/`enqueued`/`duplicates`/`rejected`/`failed`/`stoppedReason`) — **never recipient PII**, since scheduler/proxy logs may capture response bodies.
- **Tenancy (§9):** every DAL call the sweep makes carries both `organizationId` and `eventId` — verified directly by the cross-org isolation tests (`email-trigger-evaluate-route.test.ts`): a targeted call for org A only ever reads/acts on org A's data, and an IDOR-shaped probe (org A's id + org B's real eventId) is a `0`-events no-op, never an error that leaks whether the event exists.

## 9 — Env / secrets (`apphosting.yaml`)

| Var | Default | Posture |
|---|---|---|
| `EMAIL_TRIGGER_EVALUATOR_SECRET` | dev-only fallback (test/dev) | **fails closed in production when unset** — every request to the internal route rejected, never an unauthenticated trigger-evaluation endpoint in prod |

Human task (unchanged posture from `DRAFT_TOKEN_SECRET`/`QR_TOKEN_SECRET`/`SCANNER_SESSION_SECRET`): create the real secret value (`firebase apphosting:secrets:set emailTriggerEvaluatorSecret`) and provision the actual Cloud Scheduler job before prod deploy — both are ops/deploy tasks explicitly out of this ticket's scope (per the ticket text itself: "Do NOT actually provision real Cloud Scheduler infrastructure outside this repo").

## 10 — Query patterns and indexes (summary)

| Query | Method | Index |
|---|---|---|
| Orders by paymentStatus, oldest first | `listAdminOrdersForEventByPaymentStatus` | **NEW**: `Order eventId ASC, organizationId ASC, paymentStatus ASC, createdAt ASC` |
| FormData by status IN [...] | `listAdminFormDataForEventByStatuses` | reuses existing `FormData eventId+organizationId+status+submittedAt` composite (no new index) |
| RegistrationDraft, cursor-paginated | `getAdminRegistrationDraftsForEvent` (+`startAfterUpdatedAtMs`) | reuses existing `RegistrationDraft eventId+organizationId+updatedAt` composite |
| Attendee accepted, cursor-paginated | `listAdminAttendeesForEvent` (unchanged) | reuses existing `Attendee eventId+organizationId+status+createdAt` composite |
| Published events, bounded + cursor | `listAdminPublishedEventsPage` (NEW) | **NEW**: `Event status ASC, updatedAt DESC` |
| Attendee by submissionId (join) | `getAdminAttendeeBySubmissionId` (unchanged) | doc-id derivation, no query |
| Definition enabled re-check | `getAdminEmailDefinitionByKind` (unchanged) | doc-id derivation, no query |

## 11 — Read/write access rules

No new collections, no new client repo pairs, no `firestore.rules` changes — every doc this evaluator reads/writes already has a server-only deny-all rule (`EmailMessage`/`EmailSettings`/`EmailDefinition` from T1/T2, `Order`/`FormData`/`RegistrationDraft`/`Attendee`/`Event` from M1–M5). The internal route is the **first** entrypoint in this codebase that is neither a session-authenticated dashboard route nor a signed-capability-token public route — flagged explicitly for Security Agent review per spec §9.

## 12 — Tests

| File | Covers |
|---|---|
| `admin-order-payment-status.test.ts` | new DAL method: single/`in` filtering, ordering, tenancy, bounds/pagination |
| `lifecycle-dedupe-keys.test.ts` | the 3 pure dedupeKey formulas, stability, non-collision |
| `lifecycle-audience-queries.test.ts` | all 6 segments, the accepted-invoice/paid two-condition eligibility (incl. the "outstanding order, no Attendee yet → zero" case), pagination |
| `lifecycle-paged-trigger-runner.test.ts` | per-page `enabled` re-check granularity, budget/interruption+resumption (zero duplicates), invalid-recipient isolation |
| `lifecycle-evaluate-abandoned.test.ts` | draftId dedupe, full (unmasked) email, empty-email typed rejection |
| `lifecycle-evaluate-unpaid-offsets.test.ts` | `dueOffsetDedupeKeys` pure function, day-7-only firing, day-14 as a new row, pay-off-between-offsets stopping later offsets, zero-Attendee zero-reminders, 3 distinct rows / 1 kind |
| `lifecycle-evaluate-scheduled.test.ts` | null `at` never fires, not-yet-due, catch-up sweep-in, catch-up cutoff at event start, `all-invitees` no-op |
| `email-trigger-evaluate-route.test.ts` | auth (missing/wrong/correct secret), request validation, cross-org isolation, IDOR-shaped probe |

## 13 — Deviations from the spec

- **Order-first traversal instead of the Attendee-paymentStatus denorm** for `accepted-paid`/`accepted-invoice` — the spec explicitly named this as optional/your-call; deferred with rationale in §5 above (blocked by the accept hook being out of this dispatch's file scope, not by difficulty).
- **`sendEventEmailBatch`'s all-or-nothing recipient validation is worked around, not changed** — the spec flagged partial-accept as a "documented seam... T3 may relax". Rather than editing shared `send-service.ts` mid-parallel-dispatch (risking the Full-Stack Developer's concurrent §7 "Email all" work, which also calls `sendEventEmailBatch`), this ticket achieves the same effect one layer up (`paged-trigger-runner.ts` pre-splits valid/invalid recipients before ever calling the batch). `send-service.ts` itself is byte-for-byte unmodified.
- **No persisted cross-tick cursor** (event-level or page-level) — see §6/§7 above. Correctness (zero duplicates) is unaffected; only fairness/throughput at real scale is deferred, documented as a named follow-up rather than silently dropped.
- **Catch-up cutoff is day-level, not minute-level:** the §5 cutoff ("the event's first period start") is computed as midnight event-local on the first period's date (`eventLocalDateToUtcMs(date, timeZone, "start")`), not a specific start-of-day clock time — `EventDoc.periods` entries do not reliably carry a start time across every legacy key spelling this codebase supports, and the spec's own wording ("first period start") is satisfied by the day boundary without inventing a new time-field lookup.
- **Cursor pagination is single-field (`startAfter(<timestampField>)`), no tiebreaker id** — every new cursor-paginated method here (`listAdminOrdersForEventByPaymentStatus`, `listAdminFormDataForEventByStatuses`, `getAdminRegistrationDraftsForEvent`'s new `startAfterUpdatedAtMs`, `listAdminPublishedEventsPage`) follows this repo's existing convention verbatim (`listAdminAttendeesForEvent`, `listAdminEmailMessagesForEvent`, the original `listAdminFormDataForEvent`, etc. all do the same). Flagged by an independent Codex review during this ticket: if two docs share the exact same millisecond-precision timestamp and a page boundary falls between them, `startAfter` skips both on the next page (a real, if narrow, correctness edge case). This is a **pre-existing, repo-wide DAL pattern**, not something newly introduced here — a fix (composite cursor on `(timestamp, docId)`) would touch every cursor-paginated list in the codebase, well beyond this ticket's scope. Documented here for Code Review/QA awareness rather than silently carried forward unremarked.
