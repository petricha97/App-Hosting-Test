# Project Handover

Date: 2026-07-11
Branch at handover: `feat/m5-attendees-checkin`

## AGENT LOOP STATE (live — updated by the loop after every step; read this first on restart)

Last updated: 2026-07-13 23:10 (+08). Branch: `feat/m5-attendees-checkin`, all loop work UNCOMMITTED in the working tree.

Done (do not redo):
1. Backlog reconciled; M5-T1..T5 went Review → Done (closed 2026-07-13, DoD verified). See `agents/docs/BACKLOG.md`.
2. Code review APPROVED (incl. S-1 fix + re-review): `agents/docs/reviews/m5-attendees-checkin.md`.
3. Security PASS, 0 Critical/High (1 Medium → M8-T5, 6 Lows): `agents/docs/security/m5-attendees-checkin.md`.
4. QA SIGNED OFF, 39/39 ACs (1 Minor defect D-1 → ticket M5-F1): `agents/docs/qa/m5-attendees-checkin.md`.
5. M6-T1 spec complete: `agents/docs/specs/m6-email-infrastructure.md`. L-4 spec reconciliation done.
6. Suite baseline: lint clean, build exit 0, 72 files / 965 tests passing (+2 pending from M5-F1 test promotion).

- **M5 MILESTONE LANDED (2026-07-13 ~23:50):** commits `34becf4` (fix: S-1 + M5-F1 + tests) and `3d789fa` (docs: gate artifacts + M6-T1 spec) on feat/m5-attendees-checkin, pushed; merged to `prototype` as `4ae2745` (--no-ff, zero conflicts; also carried M0–M4 history since origin/prototype was stale at cd1951b); merge log `6be9276`; lint+build smoke PASS on prototype; pushed. `main` untouched. Working tree now on `prototype`, clean. Merge log: `agents/docs/git/m5-attendees-checkin.md`.

- **M6-T1 IMPLEMENTATION DONE (2026-07-14 ~04:00):** full email infrastructure on `feat/m6-t1-email-infrastructure` (uncommitted): src/lib/email/ (transport interface + fail-closed factory, dev-outbox transport, send-service, 14-tag merge renderer, merge-context, sender-identity, Zod schemas) + src/lib/db/ (adminEmailMessage.ts with create-if-absent dedupe + guarded transitions, adminEmailSettings.ts, emailMessageId.ts) + types, deny-all rules, 3 composite indexes, data-model doc, 6 test files. Suite: 78 files / 1050 tests passing (+83), lint clean, build exit 0.

- **M6-T1 code review APPROVED (2026-07-14 ~04:30)** with 3 Should-fix to land before Security (report: agents/docs/reviews/m6-email-infrastructure.md): S-1 tenancy guard missing on markAdminEmailMessageSent/Failed (adminEmailMessage.ts:171-226); S-2 deliverQueuedMessage discards transition results (send-service.ts:174-186); S-3 subject-template control chars not stripped at validateRenderedEmailContent chokepoint (schemas.ts:102-120). 4 nits optional. NOTE: named subagents unavailable mid-loop; gates run via general-purpose agents acting the roles, same artifact conventions.

- **M6-T1 S-1/S-2/S-3 fixes DONE (2026-07-14 ~09:50):** scoped tenancy guard on markSent/markFailed (typed NOT_FOUND, zero writes cross-org); deliverQueuedMessage checks all transition results (typed failed outcome + console.error, shared markMessageFailedChecked helper); chokepoint strips C0/DEL from rendered subject and callers persist/send the sanitized content. +4 regression tests, data-model doc synced. lint clean, build clean, 78 files / 1054 tests passing.

- **M6-T1 code review APPROVED incl. S-1/S-2/S-3 re-review (2026-07-14 ~10:00)**, verdict in agents/docs/reviews/m6-email-infrastructure.md. 78 files / 1054 tests.

- **M6-T1 security PASS (2026-07-14 ~10:15):** 0 Critical/High/Medium, 3 Low (Unicode separator stripping defense-in-depth; pre-existing npm audit items; length bounds on kind/dedupeKey for T2/T3). Report: agents/docs/security/m6-email-infrastructure.md.

- **M6-T1 QA SIGNED OFF (2026-07-14 ~10:30):** zero defects, every spec AC traced to a test or code line, 78 files / 1054 tests. Report: agents/docs/qa/m6-email-infrastructure.md. ALL THREE GATES PASSED.

- **M6-T1 MILESTONE LANDED (2026-07-14 ~10:45):** commits `16385c9` (feat(email), 19 files +4014) + `f23cb6b` (docs) on feat/m6-t1-email-infrastructure, pushed; merged to prototype as `ae55bc9` (--no-ff, zero conflicts); merge log `fce5b05`; lint+build smoke PASS; pushed. main untouched (still cd1951b). Note: agents/docs/security/m6-email-infrastructure.md reads as binary to git (intentional literal NUL examples) — legitimate, flagged in merge log. Working tree on prototype, clean.

- **Backlog reconciliation (2026-07-14):** `agents/docs/BACKLOG.md` was stale (M6-T1 and M5-F1 both still showed "In Dev"). Corrected: M6-T1 → Done (2026-07-14), M5-F1 → Done (2026-07-13, landed pre-merge with M5), M6-T2 → Design (assigned UX). Reconciliation note added to BACKLOG.md.

- **M6-T2 Design DONE (2026-07-14):** `agents/docs/design/m6-emails-admin.md` (130 lines, all 8 spec sections + responsive + a11y + component list). NOTE (process learning): the first UI/UX Designer dispatch used `isolation: "worktree"` — the agent reported success but its worktree was auto-cleaned after completion and the file never reached the real repo. Caught via independent verification (searched filesystem, file was genuinely absent) before reporting done to the user. Resumed the same agent (no isolation) to rewrite the file directly to the repo path; verified by reading it back. **Lesson: don't use isolation:"worktree" for agents whose deliverable is a doc/code file meant to land in the shared working tree — only trust "written" after an independent read-back, and avoid worktree isolation for loop agents going forward** since GitHub Agent commits from the main working tree, not from ephemeral agent worktrees.

- **M6-T2 Backend DONE (2026-07-14 ~23:10):** `EmailDefinition` DAL shipped — `src/lib/db/emailDefinitionId.ts`, `src/lib/db/adminEmailDefinition.ts` (transactional create-if-absent upsert, server-re-verified locked-field enforcement, 100/event cap, custom-only delete with audit retention), Zod schemas in `src/lib/email/schemas.ts`, `firestore.rules` deny-all + `firestore.indexes.json` composite, data-model doc `agents/docs/data-models/m6-emails-admin.md`, 22 new tests. Independently verified (not just trusted the agent's report): lint clean, build exit 0, 80 files / 1076 tests passing, spot-read the DAL code for tenancy/lock correctness.

- **M6-T2 Full-Stack implementation DONE (2026-07-14 ~23:50):** 16 components under `src/features/emails/`, 7 API routes under `.../emails/`, `default-definitions.ts` virtual catalog, server render pipeline (`deriveBodyHtmlTemplate` + `renderEmailDefinitionPreview`), sample-context/QR reuse, L-5 fix (checkin `Organizer` masking for team-session viewers), `comingSoon` flag dropped. 10 new test files (+88 tests). Independently verified (not just trusted the report): lint clean, `tsc --noEmit` clean except the same 3 pre-existing unrelated errors, build exit 0 (emails route compiles, 16.8kB), 89 files / 1164 tests passing. Spot-read for security correctness: route auth reuses the vetted `resolveRegistrationRouteScope` helper (session→org→write:events, IDOR-safe), render pipeline escapes-before-substitutes (checked against `merge-tags.ts`), L-5 fix correctly scoped to team-viewer only.
  - **Known gaps self-reported by FS (not yet covered):** no component-level RTL/Playwright tests (dialog interactions, switch clicks, iframe preview updates); no visual/responsive verification at 320/768/1024/1440 (Tailwind classes reviewed against design doc only, not rendered); cross-org tests are route-level DAL-mocked, not fresh two-org fake-Firestore seeds. These are QA's job to close before sign-off.
  - **Flagged for Backend review:** `deleteAdminEmailSettings()` was added to `src/lib/db/adminEmailSettings.ts` by FS (delete-doc approach for §6's "Reset to platform default") — Backend Agent should confirm this during Code Review since it wasn't in the original DAL dispatch scope.

- **M6-T2 Code Review APPROVED (2026-07-14 ~00:15):** 0 Blockers, 2 Should-fix, 3 Nits (`agents/docs/reviews/m6-emails-admin.md`). Reviewer independently re-verified DAL boundary, XSS-safety claim, all 7 routes' permission gating, and L-5 masking scope (not just trusted prior claims) — all PASS. S-1: `email-editor-dialog.tsx` at 818 lines, over the 800-line cap — needs splitting. S-2: spec §5 AC-8's named "QA-1 promotion" cross-org/cross-event same-dedupeKey `EmailMessage` regression test was not added to `email-send-service.test.ts` — explicit acceptance criterion, missing.

- **M6-T2 S-1/S-2 fixes DONE (2026-07-15 ~00:35):** the fix-dispatch agent's process stalled/timed out mid-report (background-agent stream watchdog, not a work failure) — recovered by inspecting the working tree directly rather than trusting agent status. S-1: `email-editor-dialog.tsx` split 818→592 lines into 3 siblings (`email-editor-locked-row.tsx`, `email-editor-test-send.tsx`, `email-editor-trigger-fields.tsx`), verified correctly wired (grep-confirmed imports/usages, not just file existence). S-2: added the spec §5 AC-8 cross-org/cross-event same-dedupeKey regression test to `email-send-service.test.ts` (control case: 1 row/1 send; cross-tenant case: 2 rows/2 sends) — read the actual diff, assertions are real. Independently re-ran lint (clean) / tsc (clean, same 3 pre-existing) / build (exit 0) / test (89 files / **1165** tests, +1 from S-2).

- **M6-T2 re-review APPROVED (2026-07-15 ~00:45):** S-1 and S-2 both verified correctly fixed (592-line dialog, correctly-wired 3-file split; S-2 test discriminates same-tuple-control vs. cross-tenant with real assertions, not tautological). 89 files / 1165 tests. Report appended to `agents/docs/reviews/m6-emails-admin.md`.

- **M6-T2 Security PASS (2026-07-15 ~01:00):** 0 Critical/High, 1 Medium (M-1), 2 Low. `agents/docs/security/m6-emails-admin.md`. Independently verified: XSS-by-construction, CRLF/header-injection closure via T1's `validateRenderedEmailContent`, iframe sandboxing, deterministic-id tenancy re-checks, retry tenancy gate, server-only import boundary, firestore.rules scoping, L-5 no-leak — all confirmed, not just trusted. **M-1 (Medium, verified by Orchestrator via direct grep):** `POST .../emails/definitions`, `PATCH`/`DELETE .../emails/definitions/[kind]`, and `DELETE .../emails/settings` have zero `checkRateLimit` calls, while sibling routes in the same diff (test-send, retry, settings PATCH) correctly have it — spec §7 explicitly requires rate-limiting on all mutations. Cheap copy-paste fix from the routes that already do it right; routing back now rather than deferring, since it's a named spec requirement and this doesn't block the Critical/High gate but shouldn't ship half-done either.

- **M6-T2 M-1 fix DONE (2026-07-15 ~01:15):** rate limiting added to all 4 gap routes (POST definitions 20/min, PATCH definitions/[kind] 60/min matching the checkin/confirm+resolve convention, DELETE definitions/[kind] 20/min, DELETE settings 20/min matching sibling PATCH), same 429 response shape as the routes that already had it. +4 regression tests. Independently re-verified by Orchestrator (direct grep for `checkRateLimit` in all 3 files, not just trusted the report): lint clean, tsc clean (same 3 pre-existing), build exit 0, 89 files / 1169 tests passing.

- **M6-T2 QA in progress, first pass stalled (2026-07-15 ~01:35):** QA agent's process hit the 600s stream watchdog mid-debugging (not a work failure — same pattern as the earlier design-doc and fix-dispatch stalls in this session; the harness's background-agent processes have stalled 3x this session, always recoverable by inspecting the working tree directly and resuming). It left real, substantive work in the tree: 3 new test files closing the self-reported gaps — `email-editor-dialog-interactions.test.tsx`, `email-lifecycle-tab-interactions.test.tsx`, `email-cross-org-real-data-route.test.ts` — but 3 tests in the "unsaved-changes guard" block were failing with leftover debug `console.log`s, consistent with a React-Hook-Form-async-isDirty + Testing-Library `fireEvent` timing race (app code itself, `attemptClose` in `email-editor-dialog.tsx:207-209`, reads correctly implemented; the sibling "clean form" test in the same block passes). Resumed the same QA agent with explicit diagnosis instructions (confirm test-timing vs. real defect, don't assume) rather than fixing it directly, since QA still has the rest of its plan (visual/responsive, real two-org walkthrough, final report) to complete.

**Scope instruction from user (2026-07-15): finish M6, do not begin M7.** Continue driving M6-T2 through merge, then M6-T3 (lifecycle triggers & audience segmentation) and M6-T4 (email designer) through the full loop, but stop before starting any M7 (reporting) work — flag M7 as ready-to-start and hand off rather than kicking it off.

- **M6-T2 QA: NOT SIGNED OFF (2026-07-15 ~02:20)** — 1 Major defect, everything else passes. `agents/docs/qa/m6-emails-admin.md`. **QA-D-1 (Major, verified independently by Orchestrator via direct source read):** the unsaved-changes guard never fires — `email-editor-dialog.tsx:207-213`'s `attemptClose` reads `form.formState.isDirty` only inside the click-handler callback, never during render/JSX, so react-hook-form's Proxy-based `formState` never subscribes that field and `isDirty` is permanently stale. Editing any email and clicking Cancel/Esc/overlay silently discards edits every time, zero warning — spec §3 AC-7 violated, on the single most-used interaction in the feature. Fix: read `const { isDirty } = form.formState` during render, not only inside the callback. QA added 3 `it.todo` markers pinning the fixed behavior + 1 test pinning current-broken-state as a signal (M5 D-1 precedent).
  - QA also closed all 3 previously-flagged gaps: 47 new component-interaction assertions (found the defect this way), a real two-org route-level test (`email-cross-org-real-data-route.test.ts`, genuine two-tenant fake-Firestore seed, not just mocks), and DOM-level responsive/theme class assertions (disclosed as not a substitute for real browser screenshots — no browser tool / working Firebase emulator available in that environment, honestly reported as partial rather than falsely claimed complete).
  - Suite: 94 files / 1213 tests + 3 `it.todo` (up from 89/1169). Lint/build/tsc all clean (same pre-existing baseline errors).

- **M6-T2 QA-D-1 fix DONE (2026-07-15 ~02:35):** `isDirty` destructured from `form.formState` during render (`email-editor-dialog.tsx:174`, alongside the existing `form.watch()` calls) instead of read only inside `attemptClose` — fixes the Proxy-subscription gotcha. 3 `it.todo`s promoted to real passing tests; the test that pinned the broken behavior as a named regression marker was replaced with tests documenting the correct behavior. Independently verified by Orchestrator (not just trusted the report): read the exact diff (2-line fix, correctly scoped), lint clean, build exit 0, 94 files / **1215 tests** passing, 0 todo/failures. Skipped a separate formal Code Review dispatch for this fix specifically — it's a minimal, directly-inspected, obviously-correct 2-line change with its own Codex second-opinion already run in-dispatch; going straight to QA final sign-off (QA itself, being the agent that found and deeply understands this exact defect, is the right gate here, not a fresh full re-review).

- **M6-T2 QA final sign-off: SIGNED OFF (2026-07-15 ~02:45).** QA-D-1 fix confirmed correct (independently re-verified by Orchestrator too): render-body destructure, no shadowing/stale-closure issues, 3 `it.todo`s promoted, pinned-bug test removed. 94 files / 1215 tests, 0 failures, 0 todo. **M6-T2 CLOSED — all DoD items met** (spec ACs, design spec, DAL boundary + data model + indexes, CR APPROVED, SEC no Critical/High, QA SIGNED OFF, lint/build/test green). Closure note in `agents/docs/BACKLOG.md`.

- **M6-T2 MILESTONE LANDED (2026-07-15 ~03:15):** commit `242a45d` (feat, 72 files +11848/-31) on `feat/m6-t2-emails-admin`, pushed; merged to `prototype` as `8f78bd2` (--no-ff, zero conflicts); docs bookkeeping `ab7a542`; merge log `5925511`. Smoke-checks PASS pre- and post-merge (independently re-verified by Orchestrator on the actual merged `prototype` tip, not just trusted the agent report): lint clean, build exit 0, 94 files / 1215 tests passing. `main` verified untouched (`cd1951b` local==origin, unchanged from session start). Merge log: `agents/docs/git/m6-emails-admin.md` (documents the branch-provenance deviation — work was done directly on `prototype`'s working tree before the branch was cut retroactively). Working tree on `prototype`, clean except untracked `memory/`.
  - **Process note:** this dispatch also stalled once (600s watchdog, same pattern as 3 earlier stalls this session) mid-way through a redundant build re-check, after the branch/commit/push had already completed correctly. Verified directly via `git show --stat` + independent lint/build/test run before resuming — no work was lost or needed redoing.

- **M6-T3 Research DONE (2026-07-15 ~04:00):** `agents/docs/specs/m6-lifecycle-triggers.md`. Every claim grounded in real file paths (verified by Orchestrator via full read, not just the agent's summary) — exact firing conditions per trigger type, 6 audience segment query definitions, deterministic dedupeKey scheme per type (reuses T1's create-if-absent, no new tracking), "Email all" shares the automation's dedupe key, paging/volume safety for large events, scheduling mechanism explicitly left open for Backend (3 options with tradeoffs, non-binding recommendation). Non-goals: no new UI — everything was shipped in T2. **Design skipped** (same precedent as M6-T1) — moves straight to In Dev.

- **M6-T3 Implement DONE (2026-07-15 ~06:40):** Backend (periodic evaluator `src/lib/email/lifecycle/*`, chose Cloud Scheduler → internal authenticated Next.js route `/api/internal/email-triggers/evaluate` with a fail-closed shared secret matching the `QR_TOKEN_SECRET` posture, new `adminOrder.ts`/`adminFormData.ts`/`adminRegistrationDraft.ts`/`adminEvent.ts` queries, 2 new composite indexes, data-model doc `agents/docs/data-models/m6-lifecycle-triggers.md`) + Full-Stack (real-time on-submit/on-accept hooks, `Email all` route + dedupe, trigger-cell/abandoned-tab UI wiring) both dispatched in parallel with disjoint file ownership — both delivered fully, verified via `git status` that neither touched the other's files.
  - **Both agents hit the session's usage limit mid-work** (API error, not a work-quality failure) — Backend recovered via automatic retry and finished cleanly; Full-Stack's dispatch ended without a final report, but its work was ~complete in the tree.
  - **Orchestrator closed the gaps directly (small, mechanical fixes, not re-dispatched)** rather than burning more agent calls against the same limit: (1) 3 test failures from a `toBeDisabled` jest-dom matcher that doesn't exist in this repo's test setup (`@testing-library/jest-dom` isn't installed/registered anywhere — confirmed by repo-wide grep) — rewrote using the `(button as HTMLButtonElement).disabled` pattern already established in `confirmation-step.test.tsx`; (2) 8 new `tsc --noEmit` errors in two of Full-Stack's new test files (`email-lifecycle-on-accept.test.ts`: fixture object missing 10 required `AttendeeDoc` fields — filled in following the `makeAttendee` pattern from `attendees-roster.test.ts`, using real `FieldValue.serverTimestamp()` instead of a fake partial-Timestamp mock to avoid adding a 4th baseline tsc error; `on-submission-accepted-email-wiring.test.ts`: an untyped `vi.fn()` inferred an empty-tuple call-args type — added an explicit parameter type to the mock).
  - **Final verified state:** lint clean, build exit 0, `tsc --noEmit` back to exactly the pre-existing 3-error baseline (no new errors), 109 files / 1309 tests passing.

- **M6-T3 Code Review APPROVED (2026-07-16 ~00:15):** 0 Blockers, 0 Should-fix, 4 Nits. `agents/docs/reviews/m6-lifecycle-triggers.md`. Independently re-verified by Orchestrator: dedupe-key formulas traced against code for all 5 trigger types (all correct, incl. Email-all sharing the exact `draftId` with the automation), accept-hook failure isolation confirmed triple-layered with a real end-to-end test, internal entrypoint fail-closed correctly (constant-time secret compare, no dev-secret fallback in production, tenant-scoped under IDOR probe) — lint clean, build exit 0, 109 files / 1309 tests. **N-3 (Nit, verified real by Orchestrator via direct grep):** the new internal entrypoint (`/api/internal/email-triggers/evaluate`) has zero rate-limiting, unlike every other mutating route in this codebase including its own sibling "Email all" route — the shared secret is its only gate. Flagged explicitly for Security to make a deliberate call on (not a Blocker from Code Review, but worth Security's judgment given it's a new, unprecedented auth pattern for this app).
  - **Review agent also stalled once** (600s watchdog, same recurring pattern) right after confirming the build, before writing its report — recovered cleanly since it had made no code changes and no report file existed yet; resumed and it completed the full review on retry.

- **M6-T3 Security PASS (2026-07-16 ~00:40):** 0 Critical/High, 1 Medium, 1 Low. `agents/docs/security/m6-lifecycle-triggers.md`. Independently re-verified by Orchestrator (direct source read, not just trusted): **M-1 equivalent (Medium):** the internal entrypoint's own Zod schema permits up to `maxEvents=200 × pageSize=500 × maxPagesPerTrigger=200` per call with zero rate-limiting — confirmed via direct read of `evaluate/route.ts:36-38`. Security's explicit call: the shared secret is NOT sufficient alone (different threat model — leaked secret / scheduler misconfig / retry storm all bypass auth and hit an unbounded-by-rate-limit endpoint; dedupe prevents duplicate sends but not the Firestore-cost DoS vector). **L-1 equivalent (Low):** `drafts/email-all/route.ts:127-132` fails the ENTIRE batch and echoes raw unmasked draft emails in the 400 response body when any single recipient is invalid — confirmed via direct read; also a real robustness gap (one bad draft blocks the whole "Email all" click, not just a data-exposure nit). Auth mechanics, mass-send IDOR, header-injection/XSS on all 5 new send paths, and secrets hygiene all independently confirmed PASS. `npm audit` unchanged (23 pre-existing, no new dependency surface).

- **M6-T3 Medium+Low fixes DONE (2026-07-16 ~01:10):** Backend added rate limiting (`email-trigger-evaluate:global` key, 6/min — matches Security's own recommendation) to the internal entrypoint + tightened Zod ceilings (200/500/200 → 50/200/40). Full-Stack fixed `drafts/email-all/route.ts` to pre-validate recipients and isolate invalid ones (no more whole-batch failure, no more raw-email echo in error responses) — new `skippedInvalidEmail` count field, `sendEventEmailBatch` itself left untouched (fix at the call site, following `paged-trigger-runner.ts`'s established pattern). Both independently re-verified by Orchestrator via direct source read (not just trusted reports, and cross-checked the two dispatches' self-reported test-count deltas against the actual combined suite since they ran concurrently in the same tree): lint clean, tsc at baseline, build exit 0, 109 files / **1317 tests** passing.

- **M6-T3 QA: SIGNED OFF (2026-07-16 ~01:45), zero defects.** `agents/docs/qa/m6-lifecycle-triggers.md`. Independently re-verified by Orchestrator: lint clean, build exit 0, tsc at baseline, 109 files / 1317 tests. **M6-T3 CLOSED — all DoD items met.** Closure note in `agents/docs/BACKLOG.md`.

- **M6-T3 MILESTONE LANDED (2026-07-16 ~02:00):** commit `eece965` (feat, 57 files +7341/-145) on `feat/m6-t3-lifecycle-triggers`, pushed; merged to `prototype` as `d09969b` (--no-ff, zero conflicts); docs bookkeeping `b8e6f31`; merge log `157aa38`. Independently re-verified by Orchestrator on the actual merged `prototype` tip: `main` untouched (`cd1951b` local==origin, unchanged from session start), lint clean, build exit 0, 109 files / 1317 tests passing. Working tree on `prototype`, clean except untracked `memory/`.

- **M6-T4 Research DONE (2026-07-16 ~02:15):** `agents/docs/specs/m6-email-designer.md`. Real per-block email-safety verdicts on all 9 web Puck blocks (grounded by reading `puck.tsx` directly): 8 email-safe (with modifications — no side-by-side layouts anywhere, CountdownTimer becomes a static snapshot not a ticking timer, Hero's dead CTA spans dropped from email output), 1 excluded (`CallToAction` — has no `href` on the web either). Security-critical render pipeline (§3) correctly separates URL-scheme validation from HTML-escaping (escaping alone doesn't neutralize a `javascript:` URL) and structurally eliminates free-text CSS/style props (closes a real tracking-pixel/CSS-injection vector) — no "custom HTML" block type exists or ever will, by design. Explicitly flags that T2's sandboxed preview iframe was previously redundant defense-in-depth and becomes genuinely load-bearing with this ticket. Unlike M6-T1/T3, this ticket has real new UI (no prototype mockup exists for the designer screen) — **Design is NOT skipped**.

- **M6-T4 Design DONE (2026-07-16 ~02:30):** `agents/docs/design/m6-email-designer.md`. Extends (not forks) `EmailEditorDialog`: segmented-control mode toggle (not nested Tabs, avoids competing with the dialog's existing Compose/History tabs) wired into the *same* RHF form as a `bodyMode` field so the existing `isDirty`-based unsaved-changes guard covers mode switches for free — explicitly calls out that the Puck canvas's `onChange` must do the same (`form.setValue("bodyBlocks", ..., {shouldDirty:true})`) rather than a parallel dirty-tracking boolean, since two dirty sources of truth in one dialog is a real bug class. Dialog widens to `sm:max-w-6xl` in Block-designer mode (explicit further divergence from T2's own already-flagged divergence). Every layout/scope divergence from T2's shipped dialog is explicitly enumerated in its own section, not buried.

- **M6-T4 Implement DONE (2026-07-16 ~10:15):** both parallel dispatches (Backend + Full-Stack) hit the session usage limit mid-work (2nd time this session) but both landed substantively complete in the working tree. Recovered by direct inspection rather than resuming blindly: 116 files / 1435 tests passing, lint clean, tsc at baseline, build exit 0. Backend also touched `src/lib/email/lifecycle/*` (outside its originally-assigned file list) — legitimate, well-reasoned: the spec assumed all M6-T3 trigger paths called the shared `renderEmailDefinitionPreview` entry point for "zero call-site changes," but `paged-trigger-runner.ts` actually called a lower-level function directly, so extending it required a real (well-commented, correctly reasoning through the `{qr_code}` detection implications too) change. Also added a global `vitest.config.mts` `setupFiles` entry for a `ResizeObserver` polyfill (Puck's `@dnd-kit/dom` dependency needs one at module-import time, earlier than any per-test-file stub could run) — confirmed additive/no-op for every other test.
  - **Orchestrator deep-verified the security-critical block-renderer code directly** (not just running tests): read the URL-scheme validator (single implementation, shared between write-time Zod and render-time, `http/https`-only, relative/protocol-relative URLs rejected via bare `new URL()` with no base), the escape utilities (verbatim reuse of T1's `escapeHtml`, never reimplemented), and RegistrationEmbed's trickiest 3-branch logic (no `<form>` anywhere, caller-supplied context re-validated defensively, code-authored `{event_url}` literal correctly left unescaped for the merge-tag pass). Confirmed the XSS test suite is genuinely exhaustive per spec §3 AC-1 (every payload × every text prop × all 8 blocks, plus a meta-test guarding against a silently-skipped block type).

- **M6-T4 Code Review: CHANGES REQUESTED (2026-07-16 ~10:45).** 1 Blocker, 0 Should-fix, 3 Nits. `agents/docs/reviews/m6-email-designer.md`. All 5 render-pipeline security controls independently re-verified present and correct (URL-scheme validation genuinely separate from escaping, zero free-text style attributes, `renderEmailTemplate` byte-for-byte unmodified — hash-checked), XSS test exhaustiveness confirmed real, RegistrationEmbed's form-exclusion confirmed across all 3 branches, `paged-trigger-runner.ts`'s change confirmed to not regress any M6-T3 guarantee. **B-1 (Blocker, independently confirmed by Orchestrator via direct grep):** `EmailBlockRenderContext` (the live pricing/registration/countdown data `RegistrationEmbed`/`TicketPricingTable`/`CountdownTimer` need) is constructed nowhere except unit tests — every real call site (`deriveBodyForDefinition`/`renderEmailDefinitionPreview` across all 7 production callers: preview route, test-send route, confirmation-preview card, both real-time hooks, `paged-trigger-runner.ts`, "Email all" route) invokes it with the context argument omitted, defaulting to empty. Not a security bug (fallbacks are honest/non-crashing) but means 3 of 8 shipped blocks never show real data anywhere in the actual product. Confirmed the fix is bounded, not a from-scratch feature: `buildPublicPricingProjection`/the existing ticket-pricing server function already exist and are reused by the web page builder — this is wiring, not new data-layer work.

- **M6-T4 B-1 fix DONE (2026-07-16 ~10:50):** new `resolveEmailBlockRenderContext` shared helper wires pricing/registrationCta/countdown at all 7 real call sites, resolved once per render/send (snapshot, per spec §1 AC-9), every sub-resolution independently failure-isolated (never throws, degrades to null per-field). **Notable: the implementing agent found and fixed its own security issue mid-work** — its first draft of the new `resolveEmailBaseUrl()` helper (needed because `registerHref` must be an absolute URL to pass `isEmailSafeUrl`) fell back to the request's `Host`/`X-Forwarded-Host` headers, which are client-controlled — a forged request could have embedded a spoofed link in a real outbound email. Caught via its own Codex second-opinion pass, fixed to trust only `NEXT_PUBLIC_APP_URL` (validated, never thrown), degrading to null until an operator configures it. Independently re-verified by Orchestrator (read the fix directly, not just trusted the report): confirmed no header-trust remains, confirmed `NEXT_PUBLIC_APP_URL` isn't set anywhere in `apphosting*.yaml` (expected — flagged as an operational follow-up, not a bug), confirmed the resolver genuinely never throws. Lint clean, tsc at baseline, build exit 0, 119 files / **1463 tests** passing (up from 116/1435), M6-T3 trigger tests confirmed unregressed.
  - **Operational note carried forward:** `RegistrationEmbed`'s "open" state will render nothing (safe zero-paths fallback) in every environment until `NEXT_PUBLIC_APP_URL` is added to `apphosting.yaml` — same category as the QR/draft-token secrets, a pre-deploy human task, not a code defect.

- **M6-T4 re-review APPROVED (2026-07-16 ~11:00):** B-1 fully closed, independently re-verified (not just trusted the self-report) — exhaustive grep confirms zero header-reading code anywhere in `base-url.ts` or its callers, all 7 call sites confirmed wired by direct read, M6-T3 safety behavior confirmed byte-for-byte unchanged. 119 files / 1463 tests. Report appended to `agents/docs/reviews/m6-email-designer.md`.

- **M6-T4 Security PASS (2026-07-16 ~11:15): 0 findings of any severity.** `agents/docs/security/m6-email-designer.md`. Third independent pass on the header-trust question (after implementer's own catch and Code Review's re-verification) — from-scratch grep sweep across the entire diff, zero header-reading code found, genuinely and completely closed. Independent CSS-injection sweep via a standalone extraction script: every `style=` interpolation across all 8 block renderers traces only to a fixed color constant, zero exceptions, zero organizer-influenced CSS anywhere. Re-confirmed RegistrationEmbed's post-B-1 live `registerHref` still re-validates through `isEmailSafeUrl` at render time (the fix didn't bypass the control). Size caps confirmed enforced server-side in the DAL transaction, not just documented. `bodyMode`/`bodyBlocks` confirmed on the same permission tier as `subject`/`body`, no new tier introduced. Lint clean, build clean, 119 files / 1463 tests, `npm audit` unchanged.

- **M6-T4 QA: NOT SIGNED OFF (2026-07-16 ~11:45).** 1 Major defect. `agents/docs/qa/m6-email-designer.md`. Everything else passed, independently re-verified by QA via direct execution (not re-trusting prior gates): all 8 block per-block rules, `CallToAction` exclusion, unknown-type skip, structural email-safety, the mode-toggle dirty-tracking (re-derived from source — genuinely fixed, no QA-D-1 recurrence), write-time validation, two-org isolation (new real regression test). Client-rendering matrix (§6) honestly disclosed as untestable-in-environment, exactly as anticipated — structural checks (table-based, inline styles, no flexbox/grid, absolute URLs, Gmail ~102KB threshold) done instead and documented as such. **QA-D-2 (Major, independently confirmed by Orchestrator via direct grep):** spec §6 AC-2 requires `<meta name="color-scheme">`/`<meta name="supported-color-schemes">` in the assembled email's document wrapper — but **no HTML document wrapper exists anywhere in the render pipeline at all** (confirmed: zero `<html>`/`<head>`/`<!DOCTYPE>` in `src/features/emails/server/` or `src/lib/email/`), for either plain-text or block-designer mode. This actually predates M6-T4 (T1/T2 never added a wrapper either) — M6-T4 is simply the first ticket to make the dark-mode meta tags an explicit, numbered acceptance criterion, which is why QA correctly surfaces it here rather than it being a T4-introduced regression. Real consequence: Apple Mail/iOS auto-dark-mode can invert every block's hard-coded light styling with no client-side opt-out declared. Not a security issue.

- **M6-T4 QA-D-2 fix DONE (2026-07-16 ~11:55):** `wrapEmailBodyHtmlDocument` added to `render.ts`, applied inside `deriveBodyForDefinition` (the single chokepoint every real send path and preview surface already funnels through) — fixed dark-mode meta tags + `bgcolor`/CSS background belt-and-suspenders, background color pulled from the existing `EMAIL_BLOCK_COLORS.sectionBg` (not invented). Fixes both authoring modes. Independently verified by Orchestrator: `merge-tags.ts` diff genuinely empty (hash-pinned tripwire intact), lint clean, tsc at baseline, build exit 0, 120 files / **1471 tests** passing, 0 todo remaining.

- **M6-T4 QA: SIGNED OFF (2026-07-16 ~12:05).** QA-D-2 fix confirmed correct (independently re-verified by Orchestrator too): wrapper genuinely applied at the single chokepoint, `merge-tags.ts` untouched, all 7 real call sites confirmed inheriting it, 0 remaining `it.todo`. 120 files / 1471 tests. **M6-T4 CLOSED — all DoD items met.** Closure note in `agents/docs/BACKLOG.md`. **This was the last M6 ticket — M6 (Communications/Emails) is now fully complete pending this final merge.**

In progress:
- **GitHub Agent** dispatched: commit M6-T4 work (sitting directly on `prototype`'s working tree again, same pattern as M6-T2/T3), merge to `prototype` (--no-ff, smoke-check, merge log). NEVER main.

Next steps, in order:
30. Commit + merge M6-T4 → prototype. NEVER main.
31. **STOP.** M6 will then be fully done (M6-T1 through M6-T4, all merged). Per explicit user instruction, do not begin M7-T1 or any M7 work — leave M7 flagged ready-to-start for the next session/human decision.

Human tasks (unchanged): create `DRAFT_TOKEN_SECRET`, `QR_TOKEN_SECRET`, `SCANNER_SESSION_SECRET` in App Hosting before prod deploy; answer email-provider question (Q2) when convenient.

Rule for the loop: if a session/limit failure interrupts any step, update THIS section with exactly what completed and what remains before stopping, so the next loop iteration resumes here instead of re-running finished gates.

## What this project is

This repository is a Next.js 15 + TypeScript event-management app built toward Cvent-style parity on top of Firebase / Firestore. It includes an `agents/` directory with planning, specs, design notes, reviews, and QA artifacts from an agent-driven workflow.

You do not need to keep using that workflow just because the files are present. Treat `agents/docs/` as project documentation, not as required operating procedure.

## Actual implementation status

The planning backlog is partially stale.

- `M0` to `M4` are already implemented in code.
- `M5` is also implemented in code on this branch, even though `agents/docs/BACKLOG.md` still marks `M5-T1` through `M5-T5` as `Todo`.

### Implemented milestone summary

- `M0`: event shell, route cleanup, index audit, test baseline
- `M1`: registration types and ticket types
- `M2`: pricing, discounts, taxes, service-fee shell, orders/payment flow
- `M3`: registration paths, public multi-step registration, response workflow, abandoned registration tracking
- `M4`: event page builder blocks and per-path page customization
- `M5`: attendees and check-in

### M5 work included on this branch

- attendee entity and QR token flow
- attendee roster screen
- abandoned-registration tab UI
- check-in configuration and team-member management
- public and admin scan flows
- Firestore rules and index updates for attendee/check-in data
- App Hosting secret wiring for QR and scanner-session signing

## Best docs to read first

- `agents/docs/specs/m5-attendees-checkin.md`
- `agents/docs/design/m5-attendees-checkin.md`
- `agents/docs/data-models/m5-attendees-checkin.md`
- `agents/docs/BACKLOG.md`
- `agents/AGENT_LOOP.md`

Use the M5 spec/design/data-model docs as the most accurate handoff set for the latest branch work.

## Validation status at handover

These checks were run successfully on 2026-07-11:

- `npm run lint`
- `npm run build`
- `npm run test -- --run`

Result: `72` test files passed, `959` tests passed.

## Important operational notes

Before deploying M5, make sure these runtime secrets exist:

- `DRAFT_TOKEN_SECRET`
- `QR_TOKEN_SECRET`
- `SCANNER_SESSION_SECRET`

They are referenced in `apphosting.yaml`. In local/dev test runs the code falls back to dev-only secrets and logs warnings. Production is intended to fail closed without the real secrets.

## Known documentation mismatch

- `agents/docs/BACKLOG.md` still says M5 is `Todo`.
- I did not rewrite the backlog or synthesize missing review/security/QA artifacts for M5 in this handover commit.
- The code is ahead of the planning/status docs.

## What should happen next

### Immediate owner tasks

1. Review this branch and merge/ship the M5 work.
2. Decide whether to update `agents/docs/BACKLOG.md` so it matches reality.
3. Create the App Hosting secrets before deployment.

### Product roadmap after this branch

- `M6`: email infrastructure and communications UI
- `M7`: reporting and report delivery
- `M8`: real IAM enforcement, real dashboard metrics, hardening, and coverage backfill

## Practical recommendation

If you want the cleanest takeover:

- treat this commit as the closure of M5 implementation work
- keep the agent-loop docs as historical reference
- use normal human-owned backlog/process from here unless the team explicitly wants to continue the agent model
