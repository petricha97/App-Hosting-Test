# BACKLOG — Cvent Parity Master Plan

Owner: Orchestrator. Created 2026-07-09.
Inputs: `agents/AGENT_LOOP.md` (loop rules + milestone seed), `agents/docs/specs/_code-audit.md` (code state), `agents/docs/specs/_screen-inventory.md` (17 prototype screens).

Status flow per ticket: `Todo → Research → Design → In Dev → Review → Security → QA → Done`.
Tickets re-entering after fixes resume at **Review**, never restart. Agents: RL = Research Lead, UX = UI/UX Designer, BE = Backend Agent, FS = Full-Stack Developer, CR = Code Reviewer, SEC = Security Agent, QA = QA Agent.

---

## Backlog Table (loop state — update here every iteration)

| Ticket | Title | Milestone | Status | Assigned | Sprint |
|---|---|---|---|---|---|
| M0-T1 | Event workspace shell (event sidebar + event bar) | M0 | Done | — | S1 |
| M0-T2 | Starter-cruft cleanup | M0 | Done | — | S1 |
| M0-T3 | Firestore index & query audit | M0 | Done | — | S1 |
| M0-T4 | Test harness baseline | M0 | Done | — | S1 |
| M1-T1 | Registration Types | M1 | Done | — | S1 |
| M1-T2 | Ticket Types (admission items) | M1 | Done | — | S1 |
| M2-T1 | Fees + Pricing screen shell | M2 | Done | — | S2 |
| M2-T2 | Discounts tab (promotions integration) | M2 | Done | — | S2 |
| M2-T3 | Taxes & service fees | M2 | Done | — | S2 |
| M2-T4 | Orders & payment records | M2 | Done | — | S2 |
| M3-T1 | Registration Paths admin | M3 | Done | — | S3 |
| M3-T2 | Form builder commerce fields | M3 | Done | — | S3 |
| M3-T3 | Public multi-step registration flow | M3 | Done | — | S3 |
| M3-T4 | Response approval workflow | M3 | Done | — | S3 |
| M3-T5 | Abandoned-registration tracking | M3 | Done | — | S3 |
| M4-T1 | New Puck blocks (pricing table, countdown, reg embed) | M4 | Done | — | S4 |
| M4-T2 | Per-path page customization | M4 | Done | — | S4 |
| M5-T1 | Attendee entity + QR identity service | M5 | Done (2026-07-13) | — | S5 |
| M5-T2 | Attendee roster screen | M5 | Done (2026-07-13) | — | S5 |
| M5-T3 | Abandoned tab UI | M5 | Done (2026-07-13) | — | S5 |
| M5-T4 | Check-in configuration screen | M5 | Done (2026-07-13) | — | S5 |
| M5-T5 | Check-in scan flow | M5 | Done (2026-07-13) | — | S5 |
| M5-F1 | D-1 fix: drop sold-out precheck blocking idempotent replay | M5 | Done (2026-07-13) | — | S5 |
| M6-T1 | Email infrastructure (provider + outbox DAL) | M6 | Done (2026-07-14) | — | S6 |
| M6-T2 | Emails admin screen | M6 | Done (2026-07-15) | — | S6 |
| M6-T3 | Lifecycle triggers & audience segmentation | M6 | Done (2026-07-16) | — | S6 |
| M6-T4 | Email designer via shared block engine | M6 | Done (2026-07-16) | — | S6 |
| M7-T1 | Reporting aggregates + event report summaries | M7 | Done (2026-07-17) | — | S7 |
| M7-T2 | Report templates library | M7 | Done (2026-07-17) | — | S7 |
| M7-T3 | Scheduled report delivery | M7 | Todo | — | — |
| M8-T1 | Real IAM (replace mock data) | M8 | Todo | — | — |
| M8-T2 | Workspace dashboard real metrics | M8 | Todo | — | — |
| M8-T3 | Event overview parity | M8 | Todo | — | — |
| M8-T4 | Test coverage & regression backfill | M8 | Todo | — | — |
| M8-T5 | Dependency hardening (next 15.5.x bump + audit fixes) | M8 | Todo | — | — |
| M8-T6 | Generic accept-hook repair path (retry attendee creation) | M8 | Todo | — | — |
| M8-T7 | Rate-limit CSV export routes (reports + attendees + responses) | M8 | Todo | — | — |

---

### 2026-07-17 — M7-T2 CLOSED (DoD verified)
Full gate sequence, zero fix cycles (one deferred finding, one accepted-as-designed finding, neither gating):
- **Code Review:** APPROVED. 0 Blockers, 0 Should-fix, 3 Nits. Both central security decisions (D1 permission split, D4 masked-email) independently re-verified file-by-file across all 10 routes — zero reversed wiring. `agents/docs/reviews/m7-report-templates.md`.
- **Security:** PASS. 0 Critical/High, 1 Medium, 2 Low. Medium (no rate-limiting on export routes) confirmed real but deliberately deferred — it's inherited technical debt already present on the pre-existing `attendees`/`responses` export routes, not a regression this ticket introduced; fixing only the 10 new routes would create an inconsistency, fixing all of them would be scope creep. Tracked as new ticket **M8-T7**. CSV formula-injection specifically checked and confirmed already closed by the pre-existing, reused `escapeCsvField` guard. `agents/docs/security/m7-report-templates.md`.
- **QA:** SIGNED OFF. 1 Minor defect (QA-1: masked-email CSV cells carry a leading apostrophe in the raw file bytes, an artifact of the CSV formula-injection guard correctly treating any string starting with `@` as a risk) — accepted as-is, not fixed: the guard is behaving correctly, and special-casing it for one column would trade real protection for cosmetic byte-format tidiness. QA independently closed two nits Code Review had left open (D1 exercised end-to-end for all 5 templates, not just one; CSV escaping verified via a real RFC-4180 parser round-trip, not string-containment) and added a regression test for Security's Order-doc field-leak finding. `agents/docs/qa/m7-report-templates.md`.
- **Checks:** lint clean, build exit 0, `npm test -- --run` 140 files / 1615 tests passing on the final working tree.

### 2026-07-17 — M7-T1 CLOSED (DoD verified) — first M7 ticket, zero fix cycles
Full gate sequence, no fix cycles needed — a first for this session:
- **Code Review:** APPROVED. 0 Blockers, 1 Should-fix (non-gating — missing dedicated concurrency-timing test around code already confirmed correct by direct read), 3 Nits. The two riskiest details (comped-value sums `subtotalMinor` not `totalMinor`, enforced by a required non-defaulted DAL parameter; the incidental `progress.tsx` a11y bug fix, confirmed as the only `<Progress>` caller in the codebase) both independently re-derived from source. `agents/docs/reviews/m7-reporting-summaries.md`.
- **Security:** PASS, 0 findings of any severity. Explicitly confirmed org-membership-only gating (no `write:events`) is correct, not an oversight — verified the build manifest shows literally zero `/api/**` routes added, since this ticket has nothing to mutate. Cross-org isolation confirmed on both new DAL aggregate functions; `EntityEmptyState`'s new `href` prop confirmed not an open-redirect vector. `agents/docs/security/m7-reporting-summaries.md`.
- **QA:** SIGNED OFF, zero defects. Hand-computed a realistic seeded fixture (3 ticket types, mixed attendee statuses, 2 currencies × every payment status, 3 discount codes) through the real DAL and orchestration layers with nothing mocked but the Firestore boundary — every stress point (comped-order-with-real-subtotal, cancelled-attendee exclusion, pending/failed-order exclusion, currency non-blending, distinct-codes-not-redemptions counting) matched the hand computation exactly. `agents/docs/qa/m7-reporting-summaries.md`.
- **Checks:** lint clean, build exit 0, `npm test -- --run` 127 files / 1517 tests passing on the final working tree.
- **Notable:** Backend empirically resolved the ticket's one open architecture question (does Firestore `sum()` work on a nested field path?) by installing a local JDK and running a real Firestore emulator, rather than assuming — this is the kind of verification discipline this whole session has aimed for, now coming from an implementing agent itself, not just the Orchestrator's review pass.

## Orchestrator Notes

### 2026-07-13 — M5 closed (DoD verified)
All three gates completed on 2026-07-13 and the Definition of Done is met for M5-T1..T5:
- **Code Review:** APPROVED, all five tickets (`agents/docs/reviews/m5-attendees-checkin.md`). One Should-fix (S-1, invisible-registrant/false-200 on hook crash) was fixed by FS and re-reviewed; nits N-1..N-8 stand as optional.
- **Security:** PASS, zero Critical/High (`agents/docs/security/m5-attendees-checkin.md`). 1 Medium (M-1, pre-existing dependency advisories → new ticket **M8-T5**) and 6 Lows (L-1..L-6) carried below.
- **QA:** SIGNED OFF, all 39 acceptance criteria pass (`agents/docs/qa/m5-attendees-checkin.md`). One **Minor** open defect D-1 (below Major threshold, so sign-off stands) — tracked as **M5-F1**.
- **Checks:** lint clean, build exit 0, `npm test -- --run` 72 files / 965 tests passing on the final working tree.

**D-1 sequencing decision: fix BEFORE merge.** M5-F1 (drop/move the sold-out precheck in `attendees/register/route.ts` so `placeOrder`'s idempotency replay is reached; promote QA's two `it.todo` markers in `src/__tests__/attendees-register-route.test.ts` to real assertions) is executed on `feat/m5-attendees-checkin` before the GitHub Agent merges to `prototype`. Rationale: (a) the defect breaks the idempotent-replay contract and, in the crashed-hook corner, leaves an *unrepairable* orphan — and this route is the only shipped repair seam, so data integrity outranks speed; (b) it deviates from the spec's "same pipeline as public finalize" (spec correctness > speed); (c) `prototype` is the branch every future ticket cuts from — merging a known defect in the sole repair path propagates it into M6 work; (d) the fix is one scoped change with tests already pinned, so the cost is a single short fix-diff review cycle. Fix re-enters at **Review** (fix diff only), then QA verifies the promoted tests, then GitHub Agent merges.

**Carried items from M5 gates (not lost, not gating):**
- **M5-F1 / D-1 (Minor, FS):** sold-out precheck 409s before `placeOrder` replay (`attendees/register/route.ts:214-219`) — fix pre-merge per the decision above.
- **M8-T5 / M-1 (Medium, pre-existing):** bump `next` 15.0.5 → patched 15.5.x line and `npm audit fix` firebase-admin transitives (`@grpc/grpc-js`, `protobufjs`, `form-data`). Placed in M8 (hardening); independent, may be pulled forward if a convenient window appears before then.
- **M8-T6 (QA-triaged gap):** the generic responses status route ignores `acceptHookFailed` (spec-documented M5 gap — no generic repair route). Ship a generic heal path / admin "retry attendee creation" affordance so the manual-register route is not the only repair seam. Placed in M8; revisit when M6-T3 touches the accept hook.
- **M8-T7 / M-1 (Medium, M7-T2 security review, pre-existing pattern — not a new regression):** none of the CSV export routes in this app have rate limiting — `attendees/export`, `responses/export` (both pre-existing, shipped before M7), and now all 5 of M7-T2's new report-template export routes (which do up to 1000, or 4,000 for the Abandoned template's two-ceiling loop, Firestore reads per call). A cost/DoS-amplification gap for a compromised or misused `write:events` account — not a data-exposure or authz-bypass issue (every route is still correctly permission-gated). Deliberately NOT fixed only for M7-T2's 10 new routes (would leave the sibling attendees/responses exports inconsistently unprotected) and NOT expanded in-ticket to also fix the 2 pre-existing routes (scope creep beyond M7-T2). Fix all export routes together in one pass when M8 is picked up.
- **L-4 spec reconciliation (RL, doc-only):** M5 read pages gate org membership, not `write:events` — amend `agents/docs/specs/m5-attendees-checkin.md` to record the read-surface convention (or escalate as a product decision if view-role PII visibility is unwanted).
- **Optional cleanup (non-gating, pick up opportunistically):** Security L-1 (durable rate limiter → already an M8 note), L-2 (32KB body cap on dashboard mutating routes), L-3 (delete or org-scope dead `getAdminAttendeeByQrTokenHash`), L-5 (don't show admin email to team scanners — fold into M6-T2 polish), L-6 (document the QR-SVG server-only invariant at both sinks); Review nits N-1..N-8 (timezone helper, formatter consolidation, dead code, resolver cast, `.gitignore` comment, pagination interleave, approximate `checkedInAt`, ESM cycle watch).
- **Deployment prerequisite (human/owner):** create `DRAFT_TOKEN_SECRET`, `QR_TOKEN_SECRET`, `SCANNER_SESSION_SECRET` in App Hosting before production deploy.

**M6 kickoff confirmed:** M6-T1 spec complete (`agents/docs/specs/m6-email-infrastructure.md`); RL determined T1 has no UI, so the Design step is skipped and the ticket moves straight to **In Dev** (BE + FS). The M6 branch (`feat/m6-t1-email-infrastructure`) cuts from `prototype` **after** the M5 merge lands.

### 2026-07-14 — M6-T1 closed (DoD verified); M6-T2 enters Design
M6-T1 (email infrastructure — transport abstraction, outbox DAL, merge-tag renderer) is **Done**: Code Review APPROVED incl. S-1/S-2/S-3 fix re-review (`agents/docs/reviews/m6-email-infrastructure.md`), Security PASS with 0 Critical/High/Medium (3 Low, `agents/docs/security/m6-email-infrastructure.md`), QA SIGNED OFF zero defects (`agents/docs/qa/m6-email-infrastructure.md`), lint clean / build exit 0 / 78 files / 1054 tests passing. Merged to `prototype` as `ae55bc9` (--no-ff), merge log `agents/docs/git/m6-email-infrastructure.md`. `main` untouched.

M5-F1 (D-1 fix) is also **Done** — landed pre-merge with M5 per the 2026-07-13 sequencing decision above (commit `34becf4`); this table previously lagged reality and is now corrected.

**M6-T2 (emails admin screen) kicks off:** Research Lead spec complete — `agents/docs/specs/m6-emails-admin.md` (8 sections: list screen, `EmailDefinition` entity + default catalog, compose/preview, confirmation preview card, send log + retry + test-send, sender settings, permissions/tenancy, cross-cutting states). Per the standard sequence (Research → **Design** → Implement), the ticket now moves to the UI/UX Designer for a design spec against `prototype/prototype/event-emails.html`.

### 2026-07-14 — M6-T2 Design complete; Implement kicks off
UI/UX Designer produced `agents/docs/design/m6-emails-admin.md`: screen shell + Tabs (Lifecycle emails / Send log), grouped `email-group-table.tsx` (4-col/3-col variants), `email-editor-dialog.tsx` (compose+preview two-column, merge-tag menu, sandboxed preview iframe, unsaved-changes guard), `confirmation-preview-card.tsx`, `send-log-table.tsx` (event-wide + per-definition History reuse), `sender-settings-dialog.tsx` — all built from existing `src/components/ui/*` primitives, no new base components. Ticket moves to **In Dev** (BE + FS): Backend Agent first (DAL: `adminEmailDefinition.ts`, `emailDefinitionId.ts`, firestore rules deny-all + composite index, data-model doc), then Full-Stack Developer (screen components, API routes, `src/features/emails/`).

### 2026-07-14 — M6-T2 Backend + Full-Stack implementation complete; Code Review kicks off
Backend Agent shipped the `EmailDefinition` DAL (transactional create-if-absent upsert, server-re-verified locked-field enforcement, 100/event cap, custom-only delete, audit retention) — 22 tests. Full-Stack Developer shipped all 16 design-doc components, 7 API routes, virtual default catalog, render pipeline, and the carried L-5 polish item (checkin admin-email masking for team scanners) — 88 more tests. Both independently re-verified by the Orchestrator (not just trusted the agent reports): lint clean, build exit 0, 89 files / 1164 tests passing, `tsc --noEmit` clean except 3 pre-existing unrelated errors. Spot-read confirmed route auth/tenancy correctness, XSS-safe render pipeline, and correct L-5 scoping.

**Self-reported gaps to close before QA sign-off:** no component-level interaction tests (dialog/switch/preview), no visual/responsive verification at the four breakpoints, cross-org tests are DAL-mocked at the route level rather than fresh two-org fake-Firestore seeds. **Flagged for Code Reviewer:** FS added `deleteAdminEmailSettings()` to `src/lib/db/adminEmailSettings.ts` (outside its original dispatch scope) — needs Backend-convention sign-off during review.

Ticket moves to **Review**.

### 2026-07-15 — M6-T2 CLOSED (DoD verified)
Full gate sequence, with two fix cycles along the way:
- **Code Review:** APPROVED. Initial pass found 0 Blockers, 2 Should-fix (S-1: `email-editor-dialog.tsx` over 800-line cap; S-2: spec §5 AC-8's named cross-org dedupeKey regression test missing), 3 Nits. Both Should-fix items fixed (dialog split 818→592 lines into 3 sibling files; test added to `email-send-service.test.ts`) and re-reviewed APPROVED. `agents/docs/reviews/m6-emails-admin.md`.
- **Security:** PASS. 0 Critical/High, 1 Medium (M-1: 4 mutating routes missing rate-limiting, contrary to spec §7), 2 Low. M-1 fixed (rate limits added matching sibling-route conventions) and independently re-verified. `agents/docs/security/m6-emails-admin.md`.
- **QA:** SIGNED OFF. Found 1 Major defect (QA-D-1: unsaved-changes guard never fired — `form.formState.isDirty` read only inside a callback, never during render, so React Hook Form's Proxy never subscribed the field; editing an email and clicking Cancel silently discarded changes every time with zero warning). Fixed (destructured `isDirty` during render) and QA re-verified SIGNED OFF. QA also closed all previously-flagged coverage gaps: real component-interaction tests (47 assertions, this is how QA-D-1 was found), a genuine two-org fake-Firestore route-level isolation test, and DOM-level responsive/theme assertions (honestly disclosed as not a substitute for real browser screenshots — no browser tool/working local Firebase emulator available). `agents/docs/qa/m6-emails-admin.md`.
- **Checks:** lint clean, build exit 0, `npm test -- --run` 94 files / 1215 tests passing on the final working tree.
- **Orchestrator note (process learning, carried in `HANDOVER.md`):** three separate background-agent processes stalled mid-work this session (600s stream watchdog) — the design-doc dispatch (isolated worktree got auto-cleaned, losing the file entirely), the S-1/S-2 fix dispatch, and the first QA pass. In every case the actual work was recoverable by inspecting the working tree directly rather than trusting the terminal "failed" status, and resuming the same agent via message rather than restarting from scratch. Every claim from every agent in this ticket (file existence, test counts, fix correctness, security findings) was independently re-verified by the Orchestrator before being acted on — this caught nothing false in the end, but the design-doc file-loss incident would have shipped a phantom "done" state if not caught.

DoD: all 7 items met (spec ACs, design spec, DAL boundary + data model + indexes, CR APPROVED, SEC no Critical/High, QA SIGNED OFF, lint/build/test green). Ready for GitHub Agent: commit on `feat/m6-t2-emails-admin`, merge to `prototype` (`--no-ff`), never `main`.

### 2026-07-13 — M5 status reconciliation
M5-T1..T5 were fully implemented and shipped on branch `feat/m5-attendees-checkin` on 2026-07-11 (commit `2148ce8`, see `HANDOVER.md`), but this backlog was left stale at `Todo`. Per the loop rules ("code re-entering the pipeline resumes at Review, not from scratch"), all five tickets are now set to **Review** — specs (`agents/docs/specs/m5-attendees-checkin.md`), design (`agents/docs/design/m5-attendees-checkin.md`), and data-model (`agents/docs/data-models/m5-attendees-checkin.md`) docs exist; review/security/QA artifacts do **not** and must be produced before the tickets can close. At handover, `npm run lint`, `npm run build`, and `npm run test -- --run` all passed (72 files / 959 tests).

---

## Sprint 5 — Close out M5 (Review → Security → QA)

**Tickets:** M5-T1, M5-T2, M5-T3, M5-T4, M5-T5 — all at **Review**.

### Review strategy: one combined M5 diff
The five tickets are reviewed as **one combined milestone diff** (`prototype...feat/m5-attendees-checkin`), not five separate reviews, because:
1. **They shipped as one interdependent unit** — the attendee entity + QR token (T1) threads through the roster (T2), check-in config (T4), and scan flow (T5); reviewing them separately would force reviewers to re-read the same core files five times and would hide cross-ticket seams (e.g., attendee write consistency between accept-hook, manual registration, and scan updates).
2. **Milestone-combined artifacts are the established precedent** (M0–M4 each have one `reviews/`, `security/`, `qa/` artifact).
3. **Findings are still filed per ticket** inside each artifact (tagged M5-T1..T5) so a Blocker on the scan flow returns only that ticket to the Full-Stack Developer/Backend Agent without reopening the others.

**Security exception:** within the combined pass, the Security Agent must give explicit, individually-documented attention to the three high-risk surfaces: (a) QR token minting/entropy/lookup (T1), (b) scan endpoint auth + replay + cross-event scans + scanner-session scoping (T5), (c) `apphosting.yaml` secret wiring (`DRAFT_TOKEN_SECRET`, `QR_TOKEN_SECRET`, `SCANNER_SESSION_SECRET`) including the dev-fallback / production fail-closed behavior, plus Firestore rules changes for attendee/check-in data.

### Pipeline (strict order; fixes re-enter at Review)
1. **Code Review** (CR) → `agents/docs/reviews/m5-attendees-checkin.md` — verdict per ticket. Blockers → FS/BE fix → re-review.
2. **Security** (SEC) → `agents/docs/security/m5-attendees-checkin.md` — Critical/High block; findings per ticket.
3. **QA** (QA) → `agents/docs/qa/m5-attendees-checkin.md` — test plan from spec acceptance criteria + design states; regression tests added for any defect.
4. **Orchestrator** verifies DoD, closes M5-T1..T5.
5. **GitHub Agent** merges `feat/m5-attendees-checkin` → `prototype` (`--no-ff`), smoke-checks lint/build, logs to `agents/docs/git/m5-attendees-checkin.md`. **Never `main`.**

### Definition-of-Done items (per ticket, all five) — COMPLETE 2026-07-13
- [x] Code Reviewer verdict APPROVED — `agents/docs/reviews/m5-attendees-checkin.md` (S-1 fixed + re-reviewed; N-1..N-8 optional).
- [x] Security Agent pass, no Critical/High — `agents/docs/security/m5-attendees-checkin.md` (M-1 Medium → M8-T5; L-1..L-6 carried).
- [x] QA test plan executed + regression tests + sign-off — `agents/docs/qa/m5-attendees-checkin.md` (39/39 ACs; D-1 Minor → M5-F1, fixed pre-merge).
- [x] Fresh `npm run lint` / `npm run build` / `npm test` on final working tree — lint clean, build exit 0, 72 files / 965 tests passing.
- [x] Spec acceptance criteria coverage — QA verified all 39 across T1–T5.
- [x] Design spec (states/responsive/themes) — QA cross-cutting section verified.
- [x] DAL boundary + data model doc + `firestore.indexes.json` — CR mandatory checks 1 and 3 PASS.

**Sprint 5 remaining work before merge:** M5-F1 (D-1 fix, FS) → CR fix-diff review → QA promotes the two `it.todo` regressions and verifies → GitHub Agent merges `feat/m5-attendees-checkin` → `prototype` (`--no-ff`) and logs `agents/docs/git/m5-attendees-checkin.md`. See the 2026-07-13 closure note above for the full rationale.

**Deployment prerequisite (not DoD, but blocks release):** App Hosting secrets `DRAFT_TOKEN_SECRET`, `QR_TOKEN_SECRET`, `SCANNER_SESSION_SECRET` must be created before production deploy (human/owner task).

### Next after M5 closes: M6-T1 (email infrastructure)
M6-T1 is confirmed next in dependency order: it has no hard code dependency, blocks M6-T2/T3 and M7-T3, and M6-T2 additionally needs M5-T1's QR (now in place). Prerequisites:
- **Q2 (email provider)** remains open — proceed with the documented default (dev outbox transport + provider interface) so no blocking; real transport swaps in when Q2 is answered.
- M5 merged into `prototype` first, so the M6 branch (`feat/m6-t1-email-infrastructure`) cuts from an integration branch that already contains attendee/QR code.
- M6-T1 kicks off at **Research** (RL merge-tag catalog + send-log spec), per the standard sequence.

### 2026-07-15 — M6-T3 Research complete; Design skipped (no new UI), Implement kicks off in parallel
Research Lead produced `agents/docs/specs/m6-lifecycle-triggers.md`: exact firing conditions for all 6 trigger types (all already stored/displayed by T2 — this ticket only adds evaluation), 6 audience segment query definitions, a per-trigger-type deterministic `dedupeKey` scheme reusing T1's existing create-if-absent safety mechanism (no new "already sent" tracking), "Email all" wiring sharing the automation's exact dedupe key, and paging/volume-safety requirements for large events. Scheduling mechanism (Cloud Scheduler vs. Cloud Functions vs. opportunistic) is explicitly left as an open architecture question for Backend to resolve during Implement, not decided by Research. Spec's own Non-goals: **no new screens or UI components** — every affordance (trigger tooltips, "Email all" button) already shipped in T2; this ticket only makes them functional. Per the same precedent M6-T1 used (no UI → Design skipped), this ticket skips Design and moves straight to **In Dev**.

Real-time hooks (§1 on-submit, §2 on-accept) have no dependency on the periodic evaluator's architecture, so **Backend and Full-Stack are dispatched in parallel**: Backend owns the periodic evaluator (audience segment queries, Order paymentStatus query + index, the internal scheduler-invocation entrypoint with shared-secret auth, paging/volume safety) and the scheduling-mechanism architecture decision; Full-Stack owns the real-time hooks, the "Email all" API route, and the small UI wiring (trigger-cell tooltip condition, abandoned-tab button enable + result copy).

### 2026-07-16 — M6-T3 CLOSED (DoD verified)
Full gate sequence, one fix cycle:
- **Code Review:** APPROVED. 0 Blockers, 0 Should-fix, 4 Nits — one (N-3, missing rate-limiting on the new internal entrypoint) explicitly flagged for Security to make a deliberate call on. `agents/docs/reviews/m6-lifecycle-triggers.md`.
- **Security:** PASS. 0 Critical/High, 1 Medium (the internal entrypoint's Zod ceilings permitted up to 200×500×200 per call with zero rate-limiting — fail-closed secret auth alone judged insufficient, different threat model than brute-force), 1 Low (`drafts/email-all/route.ts` failed its entire batch and echoed raw unmasked emails in error responses when any one recipient was invalid). Both fixed (rate limit 6/min + tightened ceilings to 50/200/40; per-recipient pre-validation isolating invalid entries) and independently re-verified. `agents/docs/security/m6-lifecycle-triggers.md`.
- **QA:** SIGNED OFF, zero defects across all 9 spec sections. Verified dedupeKey formulas line-by-line for all 5 trigger types, the three-layer accept-hook failure isolation, per-page `enabled` re-check discipline, and the two-condition `accepted-invoice` eligibility against deliberately tricky fixtures. Two non-blocking observations disclosed (not defects): the `all-invitees` no-op has no organizer-facing UI signal — spec's own OQ-1 already classifies this as accepted/deferred; the Email-all double-click test is sequential not truly concurrent, disclosed honestly, no behavioral risk since the underlying dedupe is a real Firestore transaction. `agents/docs/qa/m6-lifecycle-triggers.md`.
- **Checks:** lint clean, build exit 0, `npm test -- --run` 109 files / 1317 tests passing on the final working tree.
- **Orchestrator note:** this ticket's implementation (Backend + Full-Stack) was dispatched in parallel for the first time this session, with strict disjoint file ownership — worked cleanly, no conflicts. Two of the three background-agent interruptions this ticket hit were a genuine account usage-limit error (not the recurring 600s stream-watchdog stall) — both recovered via resume with zero work lost, confirmed by direct working-tree inspection each time rather than trusting terminal status. A third stall (Code Review) also recovered cleanly with no report yet written, so nothing to lose.

### 2026-07-16 — M6-T4 CLOSED (DoD verified) — M6 MILESTONE COMPLETE
Full gate sequence, two fix cycles:
- **Code Review:** APPROVED. Initial pass found 0 Should-fix, 1 Blocker (B-1: the live pricing/registration/countdown data 3 of the 8 shipped blocks need was never wired at any of the 7 real production call sites — only in unit tests, so `RegistrationEmbed`/`TicketPricingTable`/`CountdownTimer` always rendered empty fallback state everywhere in the actual product). Fixed (new `resolveEmailBlockRenderContext` shared helper, wired at all 7 sites) and re-reviewed APPROVED — the fix's own implementing agent additionally caught and fixed a self-introduced header-trust vulnerability (an early draft would have derived the embedded email link's origin from client-controlled `Host`/`X-Forwarded-Host` request headers — a phishing vector) before Code Review ever saw it. `agents/docs/reviews/m6-email-designer.md`.
- **Security:** PASS, 0 findings of any severity — a genuinely exceptional result for the first ticket introducing organizer-authored HTML structure into this app's email system. All 5 of spec §3.1's render-pipeline controls (type allowlist, escape-then-substitute, URL-scheme validation as a control separate from escaping, zero free-text CSS, unmodified merge-tag substitution) independently re-derived from source across 3 separate review passes (implementer, Code Review, Security), including a third independent confirmation that the header-trust fix was genuinely complete. `agents/docs/security/m6-email-designer.md`.
- **QA:** SIGNED OFF after one fix cycle. Found 1 Major defect (QA-D-2: no HTML document wrapper existed anywhere in the render pipeline — for either authoring mode — so spec §6 AC-2's required dark-mode `<meta>` tags were never declared; this predated M6-T4 entirely, going back to T1/T2's plain-text emails, but M6-T4 was the first ticket to make it an explicit, tested acceptance criterion). Fixed (`wrapEmailBodyHtmlDocument` in `render.ts`, applied at the single chokepoint every real send/preview path already shares) and re-verified SIGNED OFF. Client-rendering matrix (spec §6, real Outlook/Gmail/Apple Mail testing) honestly disclosed as untestable in this environment throughout — structural HTML-safety checks (table-based, inline styles, no flexbox/grid, absolute URLs, Gmail clipping threshold) done instead and clearly labeled as such, never conflated with real client verification. `agents/docs/qa/m6-email-designer.md`.
- **Checks:** lint clean, build exit 0, `npm test -- --run` 120 files / 1471 tests passing on the final working tree.
- **Orchestrator note:** this ticket had the highest review-to-implementation ratio of the whole M6 milestone (3 independent security-adjacent verification passes, 2 fix cycles) — appropriate given it's the first ticket in this app's history where organizer-authored content shapes HTML structure rather than just filling escaped text into a fixed template. Every claim from every agent was independently re-verified before being acted on throughout, consistent with the rest of this session.

**M6 (Communications/Emails) is now fully complete**: M6-T1 (email infrastructure), M6-T2 (emails admin screen), M6-T3 (lifecycle triggers & audience segmentation), M6-T4 (email designer) — all Done, all merged to `prototype`. Per explicit user instruction, stopping here; M7 (Reporting) is next in the roadmap but not started.

Rationale for reordering vs. the AGENT_LOOP.md seed:
- The **Event shell** (grouped event-level sidebar seen in every `event-*.html`) must exist before any new event sub-screen, so it is M0, not part of "Events core".
- **Registration Types and Tickets are prerequisites for Pricing** (fees join ticket × registration type × currency), so the data spine (M1) precedes pricing (M2).
- **Registration Paths need tickets, pricing, and payment method** to be meaningful, so paths + public flow are M3, after commerce.
- **Attendees build on responses + tickets + orders**; **emails and check-in depend on the QR/attendee identity**, so M5 (attendees/QR/check-in config) precedes M6 (emails), with the scan flow and abandoned "Email all" wiring landing once both exist.
- **Reports come last** (they aggregate everything). **Hardening (M8)** covers the audit's PARTIAL items: mock IAM, mock dashboard metrics, thin tests.

---

## M0 — Foundations & Shell

### M0-T1 — Event workspace shell (event sidebar + event bar)
- **Goal:** Replace the single-page event detail with the prototype's Event shell: grouped sidebar (Overview / Build: Pages, Form / Registration: Tickets, Pricing, Reg Types, Reg Paths / Engage & Manage: Emails, Attendees, Check-in, Reports) + event bar (logo, title, date/venue/code, status badge). New sections render "coming soon" placeholders until their milestone lands.
- **Screens:** shell chrome shared by all `event-*.html`; `event-overview.html` (bar + nav only).
- **Code:** new `src/app/dashboard/events/[eventId]/layout.tsx`; `src/features/event/` (nav config, event bar component); reroute existing `form/`, `responses/`, `page-builder/` pages into the shell; `src/features/dashboard/nav.ts` untouched (workspace shell stays).
- **Deps:** none. **Blocks:** every event sub-screen ticket (M1–M7).
- **Agents:**
  - RL: spec the nav taxonomy, active/disabled states per event status, and which existing routes map to which group.
  - UX: design sidebar grouping, event bar, responsive collapse, both themes; define placeholder state for unbuilt sections.
  - FS: implement layout + nav, migrate existing sub-routes under it without regressions.
  - CR: verify no route breakage, component composition, no duplication with `dashboard-shell.tsx`.
  - QA: navigate every existing sub-route in both themes/responsive; regression tests for route rendering.

### M0-T2 — Starter-cruft cleanup
- **Goal:** Remove starter-template leftovers so reviews and builds are clean.
- **Code:** delete `src/app/api/chat/route.ts`, `src/app/api/todos/route.ts`, `src/app/todo/page.tsx`, `src/features/event/event-form-test.tsx`; prune dead deps/imports.
- **Deps:** none.
- **Agents:**
  - RL: confirm nothing references these (grep imports/links) — 1-line note in spec.
  - FS: delete files, fix any dangling imports, keep lint/build/test green.
  - CR: confirm deletions are complete and nothing else depends on removed code.
  - QA: run full suite + smoke the dashboard.

### M0-T3 — Firestore index & query audit
- **Goal:** Bring `firestore.indexes.json` (currently only EventPromotion) in sync with every composite query in `src/lib/db/`; document existing data model as the baseline others extend.
- **Code:** `firestore.indexes.json`, `src/lib/db/*.ts`, `agents/docs/data-models/baseline.md`.
- **Deps:** none.
- **Agents:**
  - BE: enumerate all queries in `src/lib/db/` (client + admin), add missing composite indexes, flag unbounded reads/missing pagination; write the baseline data-model doc.
  - CR: review index definitions vs. actual query shapes.
  - SEC: sanity-check that firestore rules match the documented model (multi-tenant isolation by org).
  - QA: exercise events/forms/responses/promotions lists against the emulator or live project for missing-index errors.

### M0-T4 — Test harness baseline
- **Goal:** Characterization tests for the strongest existing surfaces (event DAL, form schema, register API validation) so later refactors have a safety net. Only `domain-utils.test.ts` exists today.
- **Code:** `src/__tests__/`, targets: `src/lib/db/event.ts`, `src/features/form/schema.ts`, `src/app/api/events/[eventId]/register/route.ts`.
- **Deps:** none (parallel-safe).
- **Agents:**
  - RL: pick the top behaviors to lock in (short list, no spec ceremony).
  - FS: write the tests; BE reviews any DAL mocking approach.
  - CR: verify tests assert real behavior, not snapshots.
  - QA: confirm suite runs in CI-time and covers the listed behaviors; own the coverage list going forward.

---

## M1 — Registration Data Spine (types + tickets)

### M1-T1 — Registration Types
- **Goal:** New entity classifying *who* the attendee is (Delegate, Guest VIP, Press, Crew…): name, code, capacity, registered count. The join key for pricing, badges, emails, check-in.
- **Screens:** `event-registration-types.html`.
- **Code:** new `src/lib/db/registrationType.ts` + `adminRegistrationType.ts`; new `src/features/registration/` module; route `src/app/dashboard/events/[eventId]/registration-types/`; API under `src/app/api/dashboard/events/[eventId]/registration-types/`.
- **Deps:** M0-T1. **Blocks:** M1-T2 (filter), M2-T1 (fee axis), M3-T1 (path audience), M5 (badge pill).
- **Agents:**
  - RL: spec entity fields, capacity semantics (number/Unlimited), registered-count derivation, delete rules when referenced.
  - UX: table screen per prototype incl. note banner, empty/loading/error states, create/edit dialog.
  - BE: data model (subcollection under event vs. root — decide + document), DAL repos, indexes, count strategy.
  - FS: screen + API routes + Zod schemas + React Hook Form dialogs.
  - CR: DAL boundary, type safety, pattern consistency with `src/features/event/`.
  - SEC: org/event ownership checks on every route; IDOR on eventId/typeId.
  - QA: CRUD flows, capacity edge cases, empty state, multi-org isolation; regression tests.

### M1-T2 — Ticket Types (admission items)
- **Goal:** New entity for *what* the attendee registers as: name, code (e.g. `GC-SEB`), registered count, capacity, sales window (from/until dates driving Open/Closed), open flag, price display deferred to Pricing.
- **Screens:** `event-tickets.html`.
- **Code:** new `src/lib/db/ticketType.ts` + `adminTicketType.ts`; `src/features/registration/` (or `src/features/ticketing/`); route `.../[eventId]/tickets/`; API `.../[eventId]/tickets/`.
- **Deps:** M1-T1 (registration-type filter + association). **Blocks:** M2-T1, M3-T2/T3, M5, M7-T1.
- **Agents:**
  - RL: spec sales-window automation (early-bird closes by date, standard opens next), capacity vs. registered, reg-type ↔ ticket relationship (one type buys several tickets).
  - UX: table with search + reg-type filter + count badge, sales-window display states, create/edit form.
  - BE: model incl. sales-window fields and derived open state, DAL, indexes for filtered queries.
  - FS: screen + APIs + validation; derived Open/Closed logic with unit tests.
  - CR: review derived-state logic and date handling (timezone-safe).
  - SEC: authz on routes; no client-trusted capacity checks.
  - QA: sales-window boundary tests (opens/closes exactly at date), filter combos, empty state.

---

## M2 — Pricing & Commerce

### M2-T1 — Fees + Pricing screen shell
- **Goal:** Fee entity: price per ticket × registration type × currency (same ticket priced in USD/GBP, comp variants `/C` `/S`). Pricing screen with 4 tabs (Fees / Discounts / Taxes / Service Fees), Fees tab functional.
- **Screens:** `event-pricing.html` (Fees tab).
- **Code:** new `src/lib/db/fee.ts` + `adminFee.ts`; `src/features/pricing/`; route `.../[eventId]/pricing/`; API `.../[eventId]/pricing/fees/`.
- **Deps:** M1-T1, M1-T2. **Blocks:** M2-T4, M3-T3, M7-T1.
- **Agents:**
  - RL: spec the fee matrix semantics, currency handling, comp-code conventions, status field.
  - UX: tabbed screen, fees table, create/edit; define tab empty states now (used by T2/T3).
  - BE: fee model keyed to ticket+regType+currency (uniqueness constraint strategy), DAL, indexes.
  - FS: tabs shell + Fees tab + APIs.
  - CR / SEC / QA: standard — plus QA verifies uniqueness (no duplicate fee for same ticket×type×currency).

### M2-T2 — Discounts tab (promotions integration)
- **Goal:** Surface the existing discount engine (`src/features/event-promotions/`) inside Pricing → Discounts with prototype additions: validity window, usage cap + used count, level (Event/Partner).
- **Screens:** `event-pricing.html` (Discounts tab), `promotions.html` (unchanged upstream).
- **Code:** `src/features/event-promotions/types.ts` + workspace, `src/lib/db/adminEventPromotion.ts` (+ add missing client `eventPromotion.ts` per audit), Pricing tab.
- **Deps:** M2-T1 (tab shell).
- **Agents:**
  - RL: gap-spec current promotion fields vs. prototype discount fields (usage cap, validity, level).
  - UX: discounts table within tab, reuse promotion edit patterns.
  - BE: extend promotion model (cap/validity/usage counter — idempotent increment), create client `eventPromotion.ts` repo, indexes.
  - FS: tab UI + wiring, migration-safe field defaults for existing promotions.
  - CR: watch for duplication between promotions feature and pricing tab.
  - SEC: usage-cap enforcement must be server-side/transactional.
  - QA: cap exhaustion, expired validity, inherit-from-parent regression on existing promotions.

### M2-T3 — Taxes & service fees
- **Goal:** Tax entity (name, code, type, rate, active) with its tab; Service Fees tab shipped as the prototype's designed empty state (entity stubbed for later).
- **Screens:** `event-pricing.html` (Taxes + Service Fees tabs).
- **Code:** new `src/lib/db/tax.ts` + `adminTax.ts`; `src/features/pricing/`.
- **Deps:** M2-T1.
- **Agents:** RL (rate semantics, application order vs. fees/discounts) · UX (taxes table + service-fees empty state) · BE (model/DAL/indexes) · FS (implement) · CR · SEC (authz) · QA (rate math edge cases).

### M2-T4 — Orders & payment records
- **Goal:** Order entity linking a registration to ticket + fee + discount + tax with computed total, payment method (Card/Invoice/Comp/None) and payment status (paid/outstanding/comped). Provider integration per **Open Question Q1** (default: simulated provider behind an interface).
- **Screens:** `event-overview.html` (payment provider row), feeds `event-reports.html` finance, `event-emails.html` debt-chase.
- **Code:** new `src/lib/db/order.ts` + `adminOrder.ts`; `src/lib/payments/` provider interface; server routes under `src/app/api/`.
- **Deps:** M2-T1, M2-T2, M2-T3. **Blocks:** M3-T3 payment step, M6-T3 debt chase, M7-T1 finance.
- **Agents:**
  - RL: spec order lifecycle + total computation (fees → discounts → taxes), invoice vs. card flows.
  - BE: order model, transactional write with capacity + discount-usage decrement, indexes.
  - FS: provider interface + simulated implementation, server actions/routes.
  - CR: pricing-math correctness and test coverage (Blocker-level scrutiny).
  - SEC: amounts computed server-side only; idempotent payment callbacks; no client-trusted totals.
  - QA: total computation matrix tests, double-submit idempotency, comp/invoice paths.

---

## M3 — Registration Paths & Public Flow

### M3-T1 — Registration Paths admin
- **Goal:** Path entity: numbered name (2 / 2.1 variants), code, audience (registration type or Any), payment method, active flag; admin table + example flow-diagram card.
- **Screens:** `event-registration-paths.html`.
- **Code:** new `src/lib/db/registrationPath.ts` + `adminRegistrationPath.ts`; `src/features/registration/`; route `.../[eventId]/registration-paths/`.
- **Deps:** M1-T1, M2-T4 (payment methods). **Blocks:** M3-T3, M4-T2.
- **Agents:** RL (path ↔ audience ↔ payment mapping, step definition, numbering) · UX (table + flow card, create/edit) · BE (model/DAL/indexes) · FS (implement) · CR · SEC (authz) · QA (audience/payment combos, active toggle).

### M3-T2 — Form builder commerce fields
- **Goal:** Two new field types in the form builder: Ticket selector (bound to the event's Ticket Types) and Promo code (validates against discounts) — wiring forms to commerce.
- **Screens:** `event-form.html` (palette additions).
- **Code:** `src/features/form/` (`schema.ts`, `default-fields.ts`, builder workspace), submit route `src/app/api/events/[eventId]/register/route.ts`.
- **Deps:** M1-T2, M2-T2.
- **Agents:**
  - RL: spec field behavior (which tickets show per path/type, promo validation feedback, template-lock interaction).
  - UX: palette entries, field settings panel, public-facing render of both fields.
  - BE: server-side promo validation + ticket availability check at submit.
  - FS: builder + renderer + Zod schema extensions; keep template versioning working.
  - CR: schema backward-compatibility with existing published forms.
  - SEC: promo codes never enumerable client-side; availability enforced server-side.
  - QA: existing forms regression, sold-out ticket handling, invalid/expired promo codes.

### M3-T3 — Public multi-step registration flow
- **Goal:** Replace flat public form with path-driven stepper: Personal Info → Ticket & Options → Summary → Payment → Confirmation. Confirmation issues a registration reference (QR mint formalized in M5-T1 and retrofitted here).
- **Screens:** `event-registration-paths.html` (flow diagram), public side of `event-form.html`.
- **Code:** `src/features/public-events/`, `src/app/events/[eventId]/register/` (new), submit + order APIs; DAL `formData.ts`, `order.ts`.
- **Deps:** M3-T1, M3-T2, M2-T4. **Blocks:** M3-T5, M5-T1.
- **Agents:**
  - RL: spec step contents per path, resume behavior, validation per step, confirmation contents.
  - UX: stepper UI, mobile-first, error/loading per step, summary layout.
  - BE: draft-registration persistence between steps (feeds abandoned tracking), transactional finalize.
  - FS: stepper implementation, state machine (Zustand), payment step against provider interface.
  - CR: state-machine correctness, no business logic client-only.
  - SEC: step tampering (skipping payment), PII in draft records, rate limiting on public endpoint.
  - QA: full E2E per payment method, back/refresh mid-flow, capacity race (two users, last ticket).

### M3-T4 — Response approval workflow
- **Goal:** Submission status lifecycle New → Pending → Reviewed → Accepted with admin actions; add Ticket column to responses tables; CSV export.
- **Screens:** `responses.html`, per-event responses.
- **Code:** `src/features/responses/` (browser, `utils.ts`), `src/lib/db/formData.ts`/`adminFormData.ts`, routes `src/app/dashboard/responses/` + `.../[eventId]/responses/`.
- **Deps:** M3-T3 (ticket on submission); status model can start earlier if sequencing allows.
- **Agents:** RL (status transitions + who may transition, accept side-effects → attendee creation hook for M5) · UX (status badges, bulk/row actions, filters, export) · BE (status field + transition writes, indexes for status filters) · FS (implement + CSV export) · CR · SEC (transition authz) · QA (every transition, filter/export correctness).

### M3-T5 — Abandoned-registration tracking
- **Goal:** Persist last-page-reached for incomplete registrations (name, partial email, step, date) to power the Abandoned tab (M5-T3), +24h nudge email (M6-T3), and abandoned report (M7-T2). Mechanism per **Open Question Q3**.
- **Screens:** `event-attendees.html` (Abandoned tab data), `event-emails.html` (+24h trigger).
- **Code:** step-tracking in the M3-T3 stepper; new `src/lib/db/abandonedRegistration.ts` + admin variant (or status on draft registration docs).
- **Deps:** M3-T3, Q3 answered.
- **Agents:** RL (what counts as abandoned, retention window, consent implications) · BE (draft-doc model vs. separate collection, TTL/cleanup strategy, indexes) · FS (stepper instrumentation) · CR · SEC (PII minimization, retention, no tracking before consent if required) · QA (abandon at each step, resume-then-complete removes record).

---

## M4 — Event Website (Page Builder parity)

### M4-T1 — New Puck blocks: Ticket & Pricing table, Countdown timer, Registration Embed
- **Goal:** Add the three prototype-flagged blocks to the existing Puck config; pricing table reads live ticket/fee data; embed points at the M3-T3 flow.
- **Screens:** `event-page-builder.html`.
- **Code:** `src/features/event-pages/puck.tsx`, `event-page-editor-workspace.tsx`, public render `public-custom-event-page.tsx`.
- **Deps:** M1-T2, M2-T1, M3-T3 (embed target).
- **Agents:** RL (block props + data-binding behavior when tickets change post-publish) · UX (block designs, settings panels, device previews) · BE (safe read path for public pricing data — no over-fetch) · FS (blocks + render) · CR · SEC (XSS in rendered block props — existing Puck surface) · QA (publish/draft, all three devices, stale-data behavior).

### M4-T2 — Per-path page customization
- **Goal:** Each registration path's page is customizable in the builder ("Each path page is customizable in Page Builder").
- **Screens:** `event-registration-paths.html`, `event-page-builder.html`.
- **Code:** `src/lib/db/eventPage.ts`/`adminEventPage.ts` (page-per-path keys), builder routing, public flow entry.
- **Deps:** M3-T1, M4-T1.
- **Agents:** RL (fallback when a path has no custom page) · UX (path switcher in builder) · BE (page keying/model extension) · FS (implement) · CR · SEC (path-page access control) · QA (per-path render + fallback).

---

## M5 — Attendees & Check-in

### M5-T1 — Attendee entity + QR identity service
- **Goal:** First-class Attendee record created on acceptance (from M3-T4 hook): name, email, company, registration type, ticket, status, check-in state; mint a unique QR token at confirmation — the identity thread reused by email → wallet → badge → door scan. Retrofit QR into the M3-T3 confirmation page.
- **Screens:** `event-attendees.html` (data), `event-checkin.html` + `event-emails.html` (QR consumers).
- **Code:** new `src/lib/db/attendee.ts` + `adminAttendee.ts`; `src/lib/qr/` token service; hook in accept transition + registration finalize.
- **Deps:** M3-T3, M3-T4. **Blocks:** M5-T2/T4/T5, M6-T3 confirmation email, M7 attendee reports.
- **Agents:**
  - RL: spec attendee lifecycle vs. submission lifecycle (they are not the same record), QR contents/format.
  - BE: attendee model + denormalization from submission/order, QR token storage (unguessable, revocable), indexes.
  - FS: creation hooks, confirmation-page QR render.
  - CR: consistency between submission/order/attendee writes (transactions/batches).
  - SEC: QR token entropy, no PII inside the QR payload, token lookup rate-limited.
  - QA: accept → attendee appears; duplicate-accept idempotency; QR resolves to correct attendee only.

### M5-T2 — Attendee roster screen
- **Goal:** Attendee list tab: search, status filter, CSV export, admin-side "+ Register attendee" (manual registration).
- **Screens:** `event-attendees.html` (Attendee list tab).
- **Code:** `src/features/attendees/` (new); route `.../[eventId]/attendees/`; API routes; DAL from M5-T1.
- **Deps:** M5-T1.
- **Agents:** RL (manual-registration semantics: which path/pricing applies) · UX (tabs, table, export, register-attendee dialog, empty state) · BE (paginated queries + indexes) · FS (implement) · CR · SEC (export authz — Viewer role read-only per `users.html`) · QA (search/filter/export, manual registration E2E).

### M5-T3 — Abandoned tab UI
- **Goal:** Abandoned tab: name, partial email, last page reached, date; "Email all" button (disabled/tooltip until M6-T3 wires it).
- **Screens:** `event-attendees.html` (Abandoned tab).
- **Code:** `src/features/attendees/`, DAL from M3-T5.
- **Deps:** M3-T5, M5-T2.
- **Agents:** RL (display rules for partial data) · UX (tab + disabled email-all state) · FS (implement) · BE (query review) · CR · SEC (PII display minimization) · QA (records per abandonment step render correctly).

### M5-T4 — Check-in configuration screen
- **Goal:** Check-in setup: stat cards (checked-in / expected / badges ready), badge preview (QR + merge fields `{full_name}` `{job_title}` `{company}`, reg-type pill, stock spec), settings toggles (signature, photo capture, ID verification, self-print, wallet passes), team-members list with empty state.
- **Screens:** `event-checkin.html`.
- **Code:** new `src/lib/db/checkinConfig.ts` + admin variant; `src/features/checkin/` (new); route `.../[eventId]/checkin/`.
- **Deps:** M5-T1 (QR + attendee counts), M1-T1 (reg-type pill).
- **Agents:** RL (setting semantics, badge merge-field source, team-member model) · UX (stat cards, badge preview, toggles, empty state per prototype) · BE (config + team-member model/DAL) · FS (implement) · CR · SEC (scanner staff credentials/scoping) · QA (toggle persistence, badge preview merge fields, empty state).

### M5-T5 — Check-in scan flow
- **Goal:** Actually check attendees in: scanner surface (web-based by default — **Open Question Q6**) resolving QR → attendee, flipping check-in state, updating counts.
- **Screens:** `event-checkin.html` (stats), `event-attendees.html` (check-in column).
- **Code:** `src/features/checkin/`, scan API route, `attendee.ts` DAL update method.
- **Deps:** M5-T1, M5-T4.
- **Agents:** RL (duplicate-scan, wrong-event scan, offline expectations) · UX (scan result states: success/already-checked-in/invalid) · BE (idempotent check-in write, timestamped) · FS (scanner UI + camera/QR lib) · CR · SEC (scan endpoint auth — team-member scoped, token replay) · QA (happy/duplicate/invalid/cross-event scans).

---

## M6 — Communications (Emails)

### M6-T1 — Email infrastructure (provider + outbox DAL)
- **Goal:** Sending abstraction (provider per **Open Question Q2**; default: outbox collection + console/dev transport so everything is testable without a provider), merge-tag rendering (`{event_title}`, `{first_name}`), from-address config.
- **Code:** new `src/lib/email/` (transport interface, merge renderer); `src/lib/db/emailMessage.ts` + admin variant (definitions + send log); no UI.
- **Deps:** none hard; Q2 answered for real transport. **Blocks:** M6-T2/T3, M7-T3.
- **Agents:** RL (merge-tag catalog, send-log requirements) · BE (definition + outbox/log model, indexes) · FS (transport interface + dev transport + renderer with unit tests) · CR (interface design — provider swappable) · SEC (header injection via merge fields, no secrets client-side, unsubscribe consideration) · QA (renderer edge cases, log correctness).

### M6-T2 — Emails admin screen
- **Goal:** Per-event Emails screen: grouped tables (Pre-event / Post-registration / Debt chase & countdown), per-email trigger + audience + active toggle, confirmation-email preview card with QR + wallet buttons (wallet per **Open Question Q4**).
- **Screens:** `event-emails.html`.
- **Code:** `src/features/emails/` (new); route `.../[eventId]/emails/`; DAL from M6-T1.
- **Deps:** M6-T1, M5-T1 (QR in preview).
- **Agents:** RL (default email set seeded per event, editable fields) · UX (grouped tables, preview card, create dialog, toggle states) · BE (query review) · FS (implement) · CR · SEC (preview renders untrusted content safely) · QA (create/toggle/preview per group).

### M6-T3 — Lifecycle triggers & audience segmentation
- **Goal:** Trigger engine: Auto on submit, Auto on accept, +24h abandoned, +7/14/21d unpaid (debt chase), scheduled datetime, Manual; audience segments keyed to registration/payment status; wire "Email all" (M5-T3).
- **Code:** `src/lib/email/` trigger evaluation, server scheduling strategy (App Hosting constraint — likely Cloud Functions/Scheduler or cron route, BE to decide + document), hooks in submit/accept/order flows.
- **Deps:** M6-T1, M3-T5 (abandoned), M2-T4 (unpaid), M3-T4 (accept).
- **Agents:** RL (exact trigger conditions + segment definitions, dedupe rules — never double-send) · BE (scheduling architecture on Firebase, idempotent send markers, indexes for segment queries) · FS (hooks + manual send + email-all) · CR (idempotency logic) · SEC (mass-send authz, rate limits) · QA (each trigger simulated via clock/fixtures, dedupe verified).

### M6-T4 — Email designer via shared block engine (stretch)
- **Goal:** "Open Email Designer" reusing the Puck block engine for email bodies (inventory: same blocks power pages, emails, badges). Ship after M6-T2 basic bodies work.
- **Screens:** `event-emails.html` (designer button), `event-page-builder.html` (engine).
- **Code:** `src/features/event-pages/puck.tsx` (email-safe block subset), `src/features/emails/`.
- **Deps:** M6-T2, M4-T1.
- **Agents:** RL (email-safe block subset — email HTML constraints) · UX (designer variant) · FS (render Puck data → email-safe HTML) · CR · SEC (XSS/HTML injection in generated email) · QA (render across a representative client matrix — scope with RL).

---

## M7 — Reporting

### M7-T1 — Reporting aggregates + event report summaries
- **Goal:** Aggregation layer + the two summary cards: registrations-by-ticket-type bar chart and finance key-values (paid card, outstanding invoice, comped value, discount codes used).
- **Screens:** `event-reports.html` (summary cards).
- **Code:** new `src/lib/db/` aggregate readers (or Firestore `count()`/aggregation queries); `src/features/reports/` (new); route `.../[eventId]/reports/`.
- **Deps:** M1-T2, M2-T4, M5-T1.
- **Agents:** RL (metric definitions — what exactly counts as "registered", "outstanding") · UX (chart + finance card, loading/empty states) · BE (aggregation strategy: counters vs. query-time, cost analysis, indexes) · FS (implement, chart lib consistent with stack) · CR · SEC (Viewer-role read access only) · QA (metric correctness against seeded fixtures).

### M7-T2 — Report templates library
- **Goal:** Runnable report templates table (Registration overview, Order & transaction details, Abandoned registration details, Badges printed, Email overview) with category, Run → tabular output, Export CSV.
- **Screens:** `event-reports.html` (templates table).
- **Code:** `src/features/reports/`, report-runner APIs, DAL readers across attendee/order/abandoned/checkin/email collections.
- **Deps:** M7-T1, M3-T5, M5-T5, M6-T3 (data sources).
- **Agents:** RL (column spec per template) · UX (run/output/export UX) · BE (paginated cross-collection readers) · FS (implement) · CR · SEC (export contains PII — role gate) · QA (each template against fixtures, CSV integrity).

### M7-T3 — Scheduled report delivery
- **Goal:** "Schedule" recurring report delivery via email.
- **Deps:** M7-T2, M6-T1/T3 (transport + scheduler).
- **Code:** `src/features/reports/`, scheduling via the M6-T3 architecture.
- **Agents:** RL (frequency options, recipients) · BE (schedule model + job) · FS (UI + wiring) · CR · SEC (recipient validation — no exfiltration to arbitrary emails without role check) · QA (simulated schedule fire).

---

## M8 — Hardening & Platform Parity

### M8-T1 — Real IAM (replace mock data)
- **Goal:** Replace hardcoded mock in `src/features/iam/components/iam-dashboard.tsx` with real members/invitations/roles (Owner/Admin/Editor/Viewer per `users.html`), server-side role enforcement across all API routes built in M1–M7. *Note:* if SEC raises repeated authz findings earlier, Orchestrator may pull the role-check helper (not the UI) forward.
- **Screens:** `users.html`.
- **Code:** `src/features/iam/`, `src/lib/db/user-organization.ts` (+ missing `adminUserOrganization.ts` per audit), `src/lib/auth-utils.ts`, invite flow + `join-organization-dialog.tsx`.
- **Deps:** none hard; touches all routes.
- **Agents:** RL (role → permission matrix per screen, invite lifecycle) · UX (members table, role cards, invite dialog, Invited/Active states) · BE (membership/invite model, admin repo, indexes) · FS (UI + enforcement sweep across routes) · CR (enforcement completeness) · SEC (full authz review — this is the ticket's core; multi-tenant isolation re-test) · QA (permission matrix per role, invite E2E).

### M8-T2 — Workspace dashboard real metrics
- **Goal:** Replace `src/features/dashboard/mock-data.ts` with real aggregates: draft/published events, registrations, revenue; wire quick-actions/checklist deep links to the now-real sub-screens.
- **Screens:** `index.html`.
- **Code:** `src/app/dashboard/page.tsx`, `src/features/dashboard/` (shell, mock-data removal), aggregate readers from M7-T1.
- **Deps:** M7-T1 (aggregates), M2-T4 (revenue).
- **Agents:** RL (metric defs shared with M7-T1) · UX (loading skeletons for stat cards) · BE (org-level aggregate queries) · FS (implement, delete mock-data.ts) · CR · QA (numbers match seeded data).

### M8-T3 — Event overview parity
- **Goal:** Upgrade `organization-event-detail.tsx` overview to prototype: stat cards (registered/invited/revenue/abandoned), identity rows (visibility, registration state with path count, payment provider), full 6-item readiness checklist, Preview/Publish actions.
- **Screens:** `event-overview.html`.
- **Code:** `src/features/dashboard/components/organization-event-detail.tsx` → likely refactor into `src/features/event/overview/` under the M0-T1 shell.
- **Deps:** effectively all milestones (each lights a checklist item) — final integration ticket.
- **Agents:** RL (readiness rules per item) · UX (layout per prototype, both themes) · BE (checklist status reads) · FS (implement/refactor) · CR (refactor safety) · QA (checklist truth table, deep links).

### M8-T4 — Test coverage & regression backfill
- **Goal:** Close coverage gaps flagged in the audit (API routes, DAL, promotions, forms, page-builder) beyond per-ticket regression tests; establish a coverage floor.
- **Code:** `src/__tests__/`.
- **Deps:** ongoing; final pass after M7.
- **Agents:** QA (own the gap list + plan) · FS/BE (write tests in their areas) · CR (test quality review).

### M8-T5 — Dependency hardening (from M5 Security M-1)
- **Goal:** Clear the pre-existing `npm audit --omit=dev` advisories: bump `next@15.0.5` to the patched 15.5.x line (middleware-bypass/SSRF/cache-poisoning advisories — not directly exploitable today, no `middleware.ts`) and fix firebase-admin transitives (`@grpc/grpc-js`, `protobufjs`, `form-data`).
- **Code:** `package.json`, lockfile; full regression run after the Next bump.
- **Deps:** none — independent; **may be pulled forward** before M8 if a convenient window appears.
- **Agents:** FS (bump + fix breakages) · CR (diff review) · SEC (verify audit clean) · QA (full suite + smoke).

### M8-T6 — Generic accept-hook repair path (from M5 QA triage)
- **Goal:** The generic responses accept route returns 200 and ignores `acceptHookFailed` (spec-documented M5 gap), so an orphaned accepted submission (`attendeeCreated:false`) created outside the manual-register route has no repair affordance. Ship a generic heal: re-invoke the exported idempotent `onSubmissionAccepted` on replay/detection, and/or an admin "retry attendee creation" action.
- **Code:** `src/app/api/dashboard/responses/` status route, `src/features/responses/on-submission-accepted.ts` callers; regression tests.
- **Deps:** M5 (Done); revisit design when M6-T3 adds email side-effects to the accept hook.
- **Agents:** RL (amend spec: repair semantics) · FS (implement) · CR · SEC (authz on retry action) · QA (orphan-heal E2E).

---

## Sprint 1 Recommendation

**Tickets: M0-T1, M0-T2, M0-T3, M1-T1, M1-T2.**

Why these five:
1. **M0-T1 (Event shell)** blocks *every* new event sub-screen — tickets, pricing, reg types/paths, emails, attendees, check-in, reports all render inside it. Nothing downstream can be designed against the wrong chrome.
2. **M1-T1 + M1-T2 (Registration Types, Tickets)** are the top of the data-model spine (Type × Ticket × Fee × Path). Pricing (M2), paths and the public flow (M3), attendees/badges (M5), and reports (M7) all join through these two entities. They also establish the pattern (feature module + DAL pair + indexes + event-scoped API) every later entity ticket copies.
3. **M0-T2 (cruft cleanup)** and **M0-T3 (index audit)** are cheap, parallel-safe, and de-risk everything: reviews stop tripping on dead code, and the index baseline prevents missing-index failures compounding as M1+ adds queries.

M0-T4 (test harness) runs opportunistically in Sprint 1 if capacity allows; otherwise Sprint 2 alongside M2-T1.

Suggested sequencing inside the sprint: M0-T2 and M0-T3 immediately (parallel, small); M0-T1 research/design first, then M1-T1 research can start in parallel with M0-T1 implementation; M1-T2 last (depends on M1-T1's reg-type entity).

---

## Open Product Questions (for the human — blocking where noted)

- **Q1 — Payments: real or simulated?** Prototype shows "Stripe: card + invoice". Do we integrate real Stripe (keys, webhooks, PCI-scope decisions) or ship a simulated provider behind an interface and swap later? **Blocks M2-T4 final form** (default assumption: simulated behind an interface).
- **Q2 — Email provider.** Resend / SendGrid / SES / nodemailer-SMTP — and which sending domain/from address? **Blocks M6-T1 real transport** (default: dev outbox transport so M6 UI/triggers proceed regardless).
- **Q3 — Abandoned-registration tracking mechanism & privacy.** Prototype stores name + partial email + last page reached for *incomplete* registrations. OK to persist PII pre-submission? Any consent banner/retention limit required (GDPR-style)? Server-persisted draft docs vs. client analytics? **Blocks M3-T5.**
- **Q4 — Wallet passes (Apple/Google).** Real passes need Apple developer certs + Google Wallet issuer setup. Real, or visual placeholder buttons for now? Affects M5-T1/M6-T2.
- **Q5 — Multi-currency.** Prototype prices the same ticket in USD and GBP. Manual per-currency fee rows only (no FX), or currency conversion? Affects M2-T1 model.
- **Q6 — Check-in scanner form factor.** Prototype mentions an iOS scanner device. Web-based camera scanner page (works on any phone) acceptable for v1? Affects M5-T5.
- **Q7 — Role set confirmation.** `users.html` shows Owner/Admin/Editor/Viewer but only describes three; is Admin distinct from Owner (billing?), and is billing in scope at all? Affects M8-T1.
