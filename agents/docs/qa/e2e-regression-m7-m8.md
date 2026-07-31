# E2E Regression — Phase 4 (M7 + M8), real-account run

Executor: `qa-agent` (Claude Code, via the Agent tool). Completed 2026-07-31 in
`App-Hosting-Test`, on branch `feat/m8-t9-template-apply-atomicity`. Builds
directly on Phase 1's org/event (`agents/docs/qa/e2e-regression-m0-m1-m2.md`),
Phase 2's entities (`agents/docs/qa/e2e-regression-m3-m4.md`), and Phase 3's
attendee/check-in/email activity (`agents/docs/qa/e2e-regression-m5-m6.md`).
No new org/event created. This is the **final** phase of the 4-phase plan
(`agents/docs/qa/e2e-test-plan.md`).

## Outcome

**PHASE COMPLETE — with one genuine, high-severity, live-confirmed defect
found and independently root-caused (QA-9).** 29 tests across 7 new spec
files: **25 passing, 3 tests left deliberately failing** (documenting the
same real defect from three different screens), **1 skipped** by
`test.describe`'s serial-mode stop-on-first-failure (its own defect instance
was independently proven via a direct Admin SDK repro, not just implied).
Every M7/M8 acceptance criterion this phase's brief called out as "verify the
real numbers" was checked against a live cross-reference (a direct,
read-only Firebase Admin SDK query), not just "does the card render." The
real Owner→Viewer→Editor permission matrix (M8-T1) was proven end-to-end
live, including a genuine unauthenticated second-identity signup and invite
acceptance with no real email delivery. Two harness bugs (test-authoring
issues, not product defects) were found and fixed during this session,
documented below for transparency.

**Headline finding:** three of this phase's own five tickets (M7-T1, M8-T2,
M8-T3) ship a "Revenue"/"Finance" money figure that is **completely
non-functional in real, production Firestore** — every prior sign-off for
these tickets was based on `fake-admin-db`-backed unit tests, which do not
enforce real Firestore's composite-index requirements. This is exactly the
class of gap this whole 4-phase live-browser regression effort exists to
catch, and it is the single most consequential finding across all four
phases.

## Environment note (read before re-running)

Partway through this session, the real Next.js dev server the suite talks
to (`http://127.0.0.1:3000`, started via Playwright's own `webServer` config)
became genuinely unresponsive (`curl` timed out with no response at all,
~10+ minutes) after two overlapping `npx playwright test` invocations were
accidentally run concurrently against it (an operator error this session
made and self-corrected — see Harness notes). This is **not** a repeat of
Phase 1's QA-1/QA-1b session-redirect-loop defect (confirmed: no `/login` ↔
`/dashboard` loop was observed; the server itself simply stopped answering
HTTP requests under concurrent load). Killing all Node processes and letting
Playwright's `webServer` restart a fresh `next dev` instance resolved it
completely; every real regression documented below was reproduced cleanly
against a healthy server afterward. If a future phase or re-run sees
mysterious `page.goto` timeouts with no other symptom, checking
`Get-Process node`/`curl http://127.0.0.1:3000/login` for a genuinely dead
server (not a redirect loop) is the first thing to check before assuming a
product defect.

## Entities used / created this phase

No new org/event. Reused verbatim: Org `E2E QA Org 2026-07-26 v2`
(`Z8i7pK5sAzSHDwLKXCZF`), Event `E2E QA Conference 2026 Phase 1`
(`2EKaIZZuik8ITwWqBHnA`).

- **New IAM entity (M8-T1):** a real second member, `e2e-qa-member@example.com`
  ("QA Second Member"), created via the app's own real signup flow (no real
  email delivery — the invite dialog's own "sent" view exposes the accept
  URL directly, per D8) and now an **active** member of the org. Verified in
  both roles this session: **Viewer** (cannot create a registration type,
  403) and **Editor** (can create one, 200) — the role was left at whichever
  state the last successful run's flow reached; a future phase re-running
  this spec will find it already active and self-normalizes back to Viewer
  before re-proving the matrix (see harness notes).
- **One real recurring report schedule (M7-T3):** "Order & transaction
  details," weekly cadence, at least one recipient — created and verified
  to persist across a page reload.
- **Two throwaway `RegistrationType` docs** created and deleted during the
  IAM permission-matrix proof (`QA Viewer Attempt` — never actually
  persisted, server-rejected; `QA Editor Attempt` — created then deleted in
  the same test, real cleanup). Codes are now timestamp-suffixed per run
  (`QAV<ts>`/`QAE<ts>`) to avoid colliding with a leftover row from an
  earlier interrupted run (see QA-10, a harness-only issue, not a product
  defect).
- **No new registrations/orders/emails were created this phase** — every
  number verified below reads Phases 1–3's existing real activity.

## Real numbers verified (cross-checked UI against a direct Admin SDK read)

| Metric | Real value (Admin SDK ground truth) | UI matched? |
|---|---|---|
| Total accepted attendees | 6 (4 Priya Kapoor — Early Bird/Delegate; 2 Noah Fischer — Press Pass/Press) | Yes — Registrations (workspace + event), Registered (event overview), Registration overview report |
| Registrations by ticket type | Early Bird 4, Press Pass 2, Standard 0 | Yes — M7-T1 bar chart, exact counts + aria-labels |
| Real `Order` rows | 5 paid Early Bird (USD, subtotal $750.00, discount $75.00 via QA10OFF, tax $59.91, total **$734.91** each) + 2 comped Press Pass (USD, $0.00) | Yes — Order & transaction details Run/export (M7-T2); **NOT reflected in the Finance/Revenue cards — see QA-9** |
| `QA10OFF` promotion `usedCount` | ≥5 (redemption count) | Real, confirmed via Admin SDK; "Discount codes used" (which should read the **distinct-code** count, i.e. **1**) is unverifiable via UI — the whole Finance card errors, QA-9 |
| `EmailMessage` rows for this event | 11 (6 `confirmation-paid` + 5 `approval-pending`), all `status: sent` | Yes — Email overview Run (11 rows) + export (11 data lines), zero `bodyHtml`/`bodyText` columns |
| Check-in state | 2 of Priya's 4 attendees `checked-in` | Yes — Badges printed (check-in history) Run + export show "Checked in" |
| Abandoned `RegistrationDraft` docs | 5 (Amara Osei), all ~20–21h old at test time — **under** the 24h threshold, so genuinely 0 abandoned right now | Confirmed via direct Admin SDK re-read at test time (real, not stale); Abandoned registration details report correctly shows its empty state; **the Abandoned stat card on the event overview cannot show this number at all — see QA-9** |
| Workspace Draft/Published events | 0 Draft, 1 Published | Yes |
| Invited (event overview) | 0 (no `invitation`-kind `EmailMessage` was ever sent in Phases 1–3) | Yes |
| Registration paths | 2 active / 2 total, payment methods Card + Comp | Yes — "Open · 2 active / 2 paths", "Simulated · Card + Comp" |
| Public readiness | 6/6 fixed items rendered, correct done/pending states (Ticket types & pricing read as done — Phase 1's active Fees exist) | Yes |
| Attendees export rate limit | 10 req/min per (org, user, event) | Yes — 15 rapid requests: ≤10 succeeded, ≥1 got 429 with `Retry-After` + `"Too many exports — wait a moment."` |
| Report export rate limit | 10 req/min, independently keyed | Yes — same shape, zero 500s |

## Ticket-by-ticket verdicts

| Ticket | Verdict | Notes |
|---|---|---|
| **M7-T1** Reporting summary cards | **PASS with 1 confirmed Blocker defect (QA-9)** | Registrations-by-ticket-type bar chart: **fully correct**, real Early Bird (4) / Press Pass (2) / Standard (0) counts, correct descending sort, correct aria-labels, no NaN/undefined anywhere on the page. Finance card: **completely broken** — `sumAdminOrderTotalsForEvent`'s `sum()` aggregate throws a real Firestore `FAILED_PRECONDITION` in production; the card always renders its generic "Couldn't load finance data" error panel instead of Paid/Outstanding/Comped/Discount-codes-used. Independent degradation (§5) does work correctly — the ticket-type chart renders fine while Finance errors, proving the two cards' error boundaries are genuinely independent, just that one of them always fires. |
| **M7-T2** Report templates library | **PASS — all 5 templates, Run + CSV export, real data** | Registration overview: Priya Kapoor + Noah Fischer real rows, CSV contains both names + Early Bird/Press Pass. Order & transaction details: real orders, `QA10OFF` promo code, `USD`, `Paid` status — **this template is unaffected by QA-9** because it lists raw `Order` docs via cursor pagination, never calls the broken `sum()` aggregate. Abandoned registration details: correctly empty right now (real drafts are <24h old), D4's masking invariant independently re-verified (raw local-part never appears in Run or CSV). Badges printed (check-in history): real "Checked in" state for Priya's checked-in attendees. Email overview: real 11-row send log, CSV `bodyHtml`/`bodyText` correctly absent. |
| **M7-T3** Scheduled report delivery | **PASS (light live check, as scoped)** | Opened the Schedule dialog, created a real weekly "Order & transaction details" schedule with a recipient, verified it persists across a full page reload and dialog reopen. Already shipped/signed-off from unit tests previously; this pass adds the first live-browser confirmation. |
| **M8-T1** Real IAM | **PASS — full live permission matrix proven, zero defects** | Invited a second real member (`e2e-qa-member@example.com`) as Viewer via the real Invite dialog — captured the real accept URL directly from the dialog's own "sent" view (D8: no real email delivery by design). In an isolated, unauthenticated browser context: signed up via `/signup?inviteToken=...`, the invite-token branch correctly skipped org creation, landed on `/invite/{token}`, and the accept flow correctly synced the session cookie and redirected to `/dashboard` as a real, active Viewer. **Viewer cannot create a registration type** — real server-side 403 ("Missing write:events permission"), dialog stays open, zero row created. Owner promoted the member to Editor via the real role-change dialog (D11 "next request" semantics). **Editor CAN create a registration type** — real 200, row appears, then deleted (Editor's `write:events` re-proven on the delete path too). |
| **M8-T2** Workspace dashboard real metrics | **PASS with 1 confirmed Blocker defect (QA-9, same root cause)** | Draft Events (00) / Published Events (01) / Registrations (real accepted-attendee count, org-wide) all correct. Quick actions deep-link to the real most-recently-updated event's real sub-screens (`Open "E2E QA Conference 2026 Phase 1"`, `/tickets`, `/pricing`). Setup notes card is genuinely static (zero `<a>` tags). **Revenue (paid) stat card: broken** — same `sumAdminOrderTotalsForOrganization` aggregate, same `FAILED_PRECONDITION`, confirmed via direct repro. |
| **M8-T3** Event overview parity | **PASS with 2 confirmed Blocker defect instances (QA-9, same root cause, two different queries)** | Registered (real accepted count) and Invited (real 0) stat cards correct. Identity rows correct: Timezone `Asia/Singapore`, Visibility `Public`, Registration `Open · 2 active / 2 paths`, Payment `Simulated · Card + Comp`, Category honestly `Not set`. Public readiness: all 6 fixed items render with correct done/pending state and an honest `N / 6 ready` count. Preview link (`target="_blank"`, correct href) and the real Publish/Move-to-draft status action both present, no duplicate "View public page" link. **Revenue stat card: broken** (same `sumAdminOrderTotalsForEvent` defect as M7-T1). **Abandoned stat card: also broken** — a *second*, independent instance: `countAdminAbandonedRegistrationDraftsForEvent`'s `count()` aggregate (equality filters + a `updatedAt <` range filter) also throws `FAILED_PRECONDITION` in production — this is exactly the risk the M8-T3 spec itself named ("Backend must verify against the emulator and add only if Firestore requests it") and the answer, confirmed here, is that production **does** request it. |
| **M8-T7** CSV export rate limiting | **PASS** | 15 rapid in-page `fetch()` calls against `attendees/export`: ≤10 succeeded (matching the real `checkRateLimit({ limit: 10 })` in `src/lib/rate-limit.ts`), ≥1 returned a real `429` with a `Retry-After` header and the exact `"Too many exports — wait a moment."` message. A second, independently-keyed export route (`reports/registration-overview/export`) was also spot-checked and confirmed to rate-limit correctly with zero bare-500s under the same rapid-fire load. |

## Defects found and confirmed live this session

### QA-9 — **Blocker** — Every new "sum a nested money field" or "count with a range filter" Firestore aggregate query this milestone's own tickets added throws `FAILED_PRECONDITION` in real production Firestore, breaking 3 signed-off features (M7-T1 Finance, M8-T2 Revenue, M8-T3 Revenue + Abandoned)

- **Repro (independently confirmed via a direct, read-only Firebase Admin SDK script against the real project, not just inferred from the UI's error panel):**
  ```js
  // sumAdminOrderTotalsForEvent's exact query shape (src/lib/db/adminOrder.ts ~246-262)
  await db.collection("Order")
    .where("eventId", "==", eventId)
    .where("organizationId", "==", organizationId)
    .where("paymentStatus", "==", "paid")
    .where("currency", "==", "USD")
    .aggregate({ total: AggregateField.sum("amounts.totalMinor") })
    .get();
  // => FAILED_PRECONDITION: The query requires an index. You can create it
  //    here: https://console.firebase.google.com/v1/r/project/ai-driven-app-hosting/
  //    firestore/indexes?create_composite=ClNwcm9qZWN0cy9haS1kcml2ZW4tYXBwLWhvc3Rpbmcv...
  ```
  Reproduced for **all three** real `paymentStatus` values in use (`paid`, `outstanding`, `comped`), for both `sumAdminOrderTotalsForEvent` (event-scoped, 4 equality filters) **and** `sumAdminOrderTotalsForOrganization` (org-scoped, 3 equality filters, M8-T2's own new method) — every combination fails identically. A second, independent query shape was also reproduced failing:
  ```js
  // countAdminAbandonedRegistrationDraftsForEvent's exact query shape
  // (src/lib/db/adminRegistrationDraft.ts ~266-280, M8-T3's own new method)
  await db.collection("RegistrationDraft")
    .where("eventId", "==", eventId)
    .where("organizationId", "==", organizationId)
    .where("updatedAt", "<", cutoffTimestamp)
    .count()
    .get();
  // => FAILED_PRECONDITION: The query requires an index...
  ```
- **What does and doesn't need an index (empirically confirmed this session, useful for Backend's fix):** plain equality-only aggregate queries with **no** nested-field `sum()` and **no** range filter — e.g. `countAdminAttendeesForEvent`/`countAdminAttendeesForOrganization` (M7-T1/M8-T2's own count aggregates, which worked correctly all session) — do **not** need a composite index in production, matching Firestore's documented automatic single-field-index-merging behavior for pure equality filters. The break is specifically: (a) any `sum()`/`average()` aggregate over a **nested** field path (`amounts.totalMinor`), even with only equality filters, and (b) any aggregate (`count()` included) combined with a **range** filter (`<`, `>`, etc.) on a different field. Both patterns need an explicit composite index registered in `firestore.indexes.json` — **neither exists there today.**
- **Root cause of why this shipped anyway:** all three affected DAL functions carry code comments explicitly claiming production-safety was already verified — e.g. `src/lib/db/adminOrder.ts`'s own comment on `sumAdminOrderTotalsForEvent`: *"Equality-only filters (eventId, organizationId, paymentStatus, currency): no new composite index required — confirmed empirically against a live Firestore emulator during Implement"* and *"The nested dotted field path... IS accepted by AggregateField.sum() in this firebase-admin version — same emulator confirmation, OQ-2 resolved positively."* This claim is **false against real production Firestore** — either the emulator genuinely behaves more permissively than production for this exact aggregate shape (a real, worth-escalating Firebase tooling gap if so), or the empirical check was never actually run and the comment overclaims. Either way, **every prior sign-off for M7-T1, M8-T2, and M8-T3 (all originally verified only against `fake-admin-db`, a unit-test double that has no concept of Firestore's real index requirements at all) never caught this** — this is precisely the class of defect this 4-phase live-E2E regression effort exists to find, and it is the single highest-value finding across all four phases.
- **Impact:** the Finance card (M7-T1, shipped), the workspace dashboard's Revenue stat (M8-T2, shipped), and the event overview's Revenue **and** Abandoned stats (M8-T3, shipped) are **100% non-functional today against the real production Firebase project** — every real org with any real order or any real abandoned draft will see the generic error panel/`—` instead of a number, unconditionally, on every page load. This is not an edge case or a rare currency/status combination — it reproduces for every payment status and every currency tested.
- **Severity: Blocker.** Three separate, previously-signed-off, customer-facing money/operational figures are completely broken against the only backend that matters (production Firestore — there is no emulator in this environment or, per the grounding, apparently in this feature's own original verification either). This should be fixed before any of M7-T1/M8-T2/M8-T3 can be considered genuinely done.
- **Fix (straightforward, scoped):** add 3 composite indexes to `firestore.indexes.json` (or fewer, if Firestore's index-suggestion URLs above can be collapsed) — `Order(currency ASC, eventId ASC, organizationId ASC, paymentStatus ASC, amounts.totalMinor ASC)` (or the exact fields Firestore's own `create_composite` link specifies) for the event-scoped sum, an analogous one without `eventId` for the org-scoped sum, one more for `subtotalMinor` (the Comped-value variant), and `RegistrationDraft(eventId ASC, organizationId ASC, updatedAt ASC)` for the abandoned-count range query. Firebase's own error message includes a direct "create it here" console link for each — the fastest fix is literally to open each link and click "Create Index," then commit the resulting `firestore.indexes.json` diff. No application code changes are needed.
- **Routing:** **backend-agent** (the fix is purely a `firestore.indexes.json` addition + deploying the indexes) — and **fullstack-developer**/**code-reviewer** should double-check the 3 affected DAL files' own code comments (they currently assert something false and should either be corrected once the index exists, or the "confirmed empirically" claims should be re-validated against a **real** project, not just an emulator, before being stated that confidently again in a future ticket).
- **Regression test recommendation for whoever fixes this:** none of this repo's existing unit tests can catch this class of bug (they all use `fake-admin-db`). Recommend either (a) a small integration test that runs against the Firebase emulator suite *with the actual `firestore.indexes.json` deployed to it* (the emulator can enforce index requirements if you tell it which indexes exist, unlike an ad hoc in-memory fake), or (b) at minimum, treating this live E2E suite's own now-passing-once-fixed assertions (`e2e/m7-t1-reporting-summaries.spec.ts`'s "finance card..." test, `e2e/m8-t2-dashboard-metrics.spec.ts`'s "Revenue (paid) stat card..." test, `e2e/m8-t3-event-overview.spec.ts`'s "Revenue stat card..."/"Abandoned stat card..." tests) as the acceptance gate for this fix — they are written to assert the **correct** behavior already and will go green the moment the indexes exist, with no test changes needed.

## Harness issues found and fixed this session (test-authoring, not product defects)

1. **Operator error, not a bug:** early in this session two `npx playwright test` invocations were accidentally left running concurrently against the same dev server (one launched via a shell background hack that outlived its own Bash tool call, the other via the proper `run_in_background` mechanism) — this caused real resource contention and, eventually, a genuinely unresponsive dev server (see "Environment note" above). Fixed by killing all stray Node processes and always using exactly one tracked background invocation going forward.
2. **QA-10 (harness-only, not a product defect) — a fixed registration-type code (`QAEDIT`) collided with a leftover row from an earlier interrupted run of this same spec, making a later run's "Editor CAN create a registration type" assertion misreport the real, correctly-granted permission as `"forbidden"`.** Root cause: the test's own duplicate-code 409 response (a real, correct server behavior) doesn't match either of the test's two expected toasts ("Registration type created" / "Missing write:events permission"), so the test's `Promise.race` timed out and defaulted to the wrong bucket. **Fixed** by suffixing both throwaway codes with `Date.now().toString(36)` so they can never collide across reruns, and by cleaning up the one leftover row this session's own earlier iterations left behind (`QA Editor Attempt` / `QAEDIT`, deleted via a one-off Admin SDK script, then removed).
3. Every new spec's `page.goto(...)` calls were given an explicit `{ timeout: 60_000 }` (up from the global 30s default) — first navigations to the brand-new-this-phase routes (`/dashboard/iam`, `/dashboard` root, `/dashboard/events/[eventId]/reports`) needed a cold on-demand Next.js dev-server compile, consistent with Phase 1's own documented precedent for this exact class of timing issue (`m0-foundations.spec.ts`'s `test.setTimeout(150_000)`).
4. `e2e/fixtures/admin-live.ts` gained 5 new read-only helpers this phase (`getAdminAllAttendeesForEvent`, `getAdminAllOrdersForEvent`, `getAdminEventPromotionsSummary`, `countAdminAbandonedDraftsPastThreshold`, `getAdminInvitationForEmail`) — all strictly read-only, mirroring Phase 3's own established pattern for ground-truth cross-checks.
5. No `src/` application code was modified this phase (per this task's brief — document, don't fix). No regression tests were added to `src/__tests__/` (out of scope for live E2E, same convention every prior phase followed). Several one-off Admin SDK verification/repro scripts (`_qa_repro_finance_sum.mjs`, `_qa_check_abandoned.mjs`, `_qa_check_abandoned_count.mjs`, `_qa_cleanup_regtypes.mjs`) were created at the repo root to directly reproduce QA-9 and clean up QA-10's leftover row, then deleted immediately after use — not part of the committed suite.

## New/modified files this phase

- `e2e/m7-t1-reporting-summaries.spec.ts` (new)
- `e2e/m7-t2-report-templates.spec.ts` (new)
- `e2e/m7-t3-scheduled-reports.spec.ts` (new)
- `e2e/m8-t1-real-iam.spec.ts` (new)
- `e2e/m8-t2-dashboard-metrics.spec.ts` (new)
- `e2e/m8-t3-event-overview.spec.ts` (new)
- `e2e/m8-t7-rate-limiting.spec.ts` (new)
- `e2e/fixtures/admin-live.ts` (extended — 5 new read-only helpers, see above)

## How to re-run

```bash
E2E_EMAIL=petricha98@gmail.com E2E_PASSWORD=<redacted> \
  npx playwright test \
    e2e/m7-t1-reporting-summaries.spec.ts \
    e2e/m7-t2-report-templates.spec.ts \
    e2e/m7-t3-scheduled-reports.spec.ts \
    e2e/m8-t1-real-iam.spec.ts \
    e2e/m8-t2-dashboard-metrics.spec.ts \
    e2e/m8-t3-event-overview.spec.ts \
    e2e/m8-t7-rate-limiting.spec.ts \
    --project=chromium --reporter=list
```

All 7 files are idempotent except where the app itself is inherently
non-idempotent (M7-T3's schedule create is upsert-safe; M8-T1's invite/role
tests self-detect an already-active member and normalize state rather than
erroring). **3 tests are expected to keep failing** until QA-9 is fixed
(`m7-t1-reporting-summaries.spec.ts`'s "finance card...", 
`m8-t2-dashboard-metrics.spec.ts`'s "Revenue (paid) stat card...",
`m8-t3-event-overview.spec.ts`'s "Revenue stat card..."/"Abandoned stat
card..." — the last of these may show as "did not run" rather than "failed"
in a given run, since `test.describe`'s serial mode stops after the first
failure in the same file; both of M8-T3's broken stats are independently
proven via the direct Admin SDK repro in QA-9 regardless of which one a
given run happens to reach first). This is intentional, matching Phase 1's
own established convention (QA-6) of leaving a test red to document a real,
unfixed defect rather than softening it to force a green run.

## Final verdict

**SIGNED OFF for Phase 4 with one Blocker-severity defect open (QA-9,
affecting M7-T1/M8-T2/M8-T3) and zero other new defects.** Every acceptance
criterion this phase's brief called for was independently exercised live
against the real Firebase project and cross-checked against real numbers
read directly via the Admin SDK — not just "does the screen render." M8-T1
(Real IAM)'s full Owner→Editor→Viewer permission matrix, including a genuine
unauthenticated second-identity signup and invitation acceptance with no
real email delivery, is proven end-to-end and defect-free. M7-T2 (report
templates) and M7-T3 (scheduled reports) are fully verified and defect-free.
M8-T7 (rate limiting) is confirmed working correctly on two independent
export routes. The one real defect found (QA-9) is serious — three
separate, previously-signed-off money/operational stat surfaces are
completely non-functional against real production Firestore, a gap that
every one of this milestone's own unit-test-only prior QA passes could not
have caught by construction (they never touch real Firestore). This is
exactly the kind of defect this whole 4-phase live-browser regression effort
was commissioned to find, and — per this loop's established convention —
it is left open, documented, and routed rather than fixed by QA. Phase 1's
two pre-existing Blocker defects (QA-1 signup/session redirect loop, QA-1b
its root cause) and Phase 2's Major defect (QA-8, Registration Path dialog
race) remain open and unaffected by this phase's M7/M8 scope.

**This is the final phase.** The Orchestrator should compile the final
cross-milestone summary covering all ~45 tickets across Phases 1–4 next;
this report does not attempt that compilation itself.
