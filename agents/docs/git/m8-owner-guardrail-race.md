# Merge log — M8-T8 Last-Owner guardrail TOCTOU-race test coverage

Date: 2026-07-19. Executor: Orchestrator directly (Codex sandbox can't write git refs).

## Commits

| Hash | Branch | Message |
|---|---|---|
| `366b98d` | feat/m8-t8-owner-guardrail-race | test(iam): prove last-Owner guardrail TOCTOU-race safety (M8-T8) — 2 files, +275/−2 |
| `28141fb` | feat/m8-t8-owner-guardrail-race | docs(m8-t8): review artifact + backlog closure — 3 files |
| `bc55410` | prototype | merge(m8-t8) --no-ff, `ort`, zero conflicts — 5 files, +425/−4 |

Feature branch pushed `-u`; `prototype` pushed `fd75bb7..bc55410`.

## What it did (test-only — zero production change)
Closed M8-T1 Security M-1: the last-Owner guardrail reads owner count inside its `runTransaction` (race-safe by construction) but was untested because the fake Firestore double ran transactions single-pass.
- fake-admin-db: opt-in transaction conflict/retry simulation (read-path+revision tracking, one-shot interleave hook, abort+retry on changed read, bounded 5 attempts, aborted attempts discard staged writes). Hookless path provably unchanged — all 2050 pre-existing tests pass.
- Race test: concurrent owner removal mid-transaction → guard retries → LAST_OWNER, org never hits 0 owners.
- Faithful mutation proof: the real non-transactional `countAdminOrganizationOwners` called INSIDE the callback (the exact helper-swap site) + an owner-demotion interleave the buggy tx never `tx.get`s → commits on attempt 1 (`buggyAttempts===1`), reaches 0 owners; the real guard under the SAME interleave retries and blocks. Proves the coverage catches the named regression.

## Gate provenance (all Codex on gpt-5.6-sol, model verified per job)
- Implementation: `task-mrr6zppc-v8s2cx`
- Code Review (doubling as QA — test-only, no security surface): `task-mrr7fnkt-uf1mgi` — CHANGES REQUESTED, 0 Blockers, 1 Should-fix. **Exceptionally sharp catch:** the first mutation proof hoisted the non-tx count OUTSIDE runTransaction (stale across all retries), which proves a different/stronger bug than the named helper-swap (which keeps the call INSIDE the re-running callback). Orchestrator independently verified the reviewer's mechanism in source (in-tx `tx.get(query)` registers owner rows in the read-set; non-tx `.get()` bypasses it) before acting.
- Faithful-mutant fix: `task-mrr7vjii-0mwuk7` — non-tx count inside callback + owner2-demotion interleave; `buggyAttempts===1` (no retry) → 0 owners; contrast real path retries → LAST_OWNER. Directly inspected by Orchestrator; merged without a re-review cycle (loop precedent for a directly-verified fix addressing the exact finding).
- Git: Orchestrator directly (this log).

## Smoke (pre-merge, on the branch tree)
- lint clean · tsc 7-baseline · 186 files / 2052 tests / 0 todo (all pre-existing pass — fake-db change backward-compatible)

## main untouched
- Before/after: `main` = `origin/main` = `cd1951be9225c905e5187851bf8b5796b2c6a1b3` (`git show-ref refs/heads/main`), unchanged.

## Left uncommitted (intentional)
`.claude/settings.json`, `CLAUDE.md`, `memory/`.

## STATUS: core M8 (T1–T8) COMPLETE. Remaining: follow-ups M8-T9/T10/T11 + the deferred Next 16/React 19 decision.
