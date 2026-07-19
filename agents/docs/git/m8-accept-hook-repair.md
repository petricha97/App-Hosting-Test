# Merge log — M8-T6 Generic accept-hook repair path

Date: 2026-07-19. Executor: Orchestrator directly (Codex sandbox can't write git refs).

## Commits

| Hash | Branch | Message |
|---|---|---|
| `c1e51bf` | feat/m8-t6-accept-hook-repair | feat(responses): generic accept-hook repair path (M8-T6) — 11 files, +855/−13 |
| `fcb3ceb` | feat/m8-t6-accept-hook-repair | docs(m8-t6): gate artifacts + backlog closure — 6 files |
| `dd6a13d` | prototype | merge(m8-t6) --no-ff, `ort`, zero conflicts — 17 files, +1497/−15 |

Feature branch pushed `-u`; `prototype` pushed `14f18a8..dd6a13d`.

## What it did
Closed the M5-documented gap: the generic responses status route returned 200 and ignored `acceptHookFailed`, leaving orphaned Accepted-but-no-attendee records unrepairable (the only repair seam was the manual register route).
- status route: one scoped repair attempt on hook failure → structured `500 ATTENDEE_CREATION_FAILED` (no silent 200); accepted-replay detects+heals without re-running the transition or rewriting `acceptedAt`.
- new `POST .../responses/[responseId]/retry-attendee-creation`: `resolveRegistrationRouteScope` (write:events, server-derived org, IDOR-safe), rate-limited (30, org:user:response), reuses exported idempotent `onSubmissionAccepted` (deterministic id + create-if-absent; email `dedupeKey=attendeeId` prevents re-send), 5 structured outcomes.
- UI: warning badge + Retry action only for `attendeeCreated:false` Accepted rows.

## Gate provenance (all Codex on gpt-5.6-sol, model verified per job)
- Research: `task-mrr2y5vg-o48ri7` (Design skipped, grounded)
- Implementation: `task-mrr3d2w9-uzvvo2`
- Code Review: `task-mrr3seqr-j11s8x` — CHANGES REQUESTED, 0 production Blockers, 4 test-quality Should-fix (caught a tautological idempotency test mocking the hook it claimed to verify)
- Test-hardening: `task-mrr47pv4-bnnele` — real-hook integration (onSubmissionAccepted spied call-through, transport-only mock); no production bugs surfaced
- Security: `task-mrr4n8hd-y7vflb` — **PASS**, 0 findings (write:events before repair, cross-org/cross-event → 404, no accept-bypass, email non-resend proven)
- QA: `task-mrr51vw0-xcd44n` — SIGNED OFF, 0 defects, +1 orphan-heal E2E (forces hook fail → structured 500 → real-hook heal → acceptedAt preserved)
- Git: Orchestrator directly (this log)

## Smoke (pre-merge, on the branch tree)
- lint clean · tsc 7-baseline · 185 files / 2038 tests / 0 todo

## main untouched
- Before/after: `main` = `origin/main` = `cd1951be9225c905e5187851bf8b5796b2c6a1b3`, unchanged.

## Left uncommitted (intentional)
`.claude/settings.json`, `CLAUDE.md`, `memory/`.
