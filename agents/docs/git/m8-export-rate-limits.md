# Merge log — M8-T7 Rate-limit CSV export routes

Date: 2026-07-19. Executor: Orchestrator directly (Codex sandbox can't write git refs).

## Commits

| Hash | Branch | Message |
|---|---|---|
| `0232943` | feat/m8-t7-export-rate-limits | feat(exports): rate-limit all 8 CSV export routes (M8-T7) — 11 files, +335/−13 |
| `aaee2f7` | feat/m8-t7-export-rate-limits | docs(m8-t7): gate artifacts + backlog closure — 4 files |
| `e66c090` | prototype | merge(m8-t7) --no-ff, `ort`, zero conflicts — 15 files, +654/−15 |

Feature branch pushed `-u`; `prototype` pushed `d25d026..e66c090`.

## What it did
Closed M7-T2 Security M-1: none of the 8 dashboard CSV export routes had rate limiting (cost/DoS-amplification for a misused write:events account; each export scans up to 1000 rows).
- `checkRateLimit` on all 8 (attendees, event + workspace responses, 5 report exports), AFTER scope/auth (unauthorized still 401/403), BEFORE the expensive load.
- Distinct per-route key prefix + org + user (+ eventId where event-scoped); limit 10/min per (route, org, user).
- Report exports refactored: scope resolution moved from the shared `handleReportExportRequest` into each route so per-route rate-limiting precedes the shared load (no shared bucket).
- Workspace responses export: threaded `userId` (lowercased email, matching `resolveRegistrationRouteScope`) through `resolveResponsesOrgWriteScope` so it keys per-user like the rest.

## Gate provenance (all Codex on gpt-5.6-sol, model verified per job)
- Implementation (Research/Design skipped — mechanical, backlog explicit): `task-mrr5kp0t-mve98f`
- Code Review (+QA scope): `task-mrr60iz9-d292k6` — CHANGES REQUESTED (1 Should-fix: workspace export keyed org-only, not per-user)
- Security (closure): `task-mrr60j3l-vq8mlj` — **PASS**, 0 Crit/High/Med, 1 Low (the same workspace-key over-restriction; not bypassable)
- Fix: `task-mrr6g9zy-l8ht38` — threaded userId, per-user isolation test; minimal + directly verified, merged without a re-review cycle (loop precedent)
- Git: Orchestrator directly (this log)

## Residual (accepted, documented)
In-memory per-instance limiter (buckets per serverless instance; effective limit scales with instance count) — acceptable for cost-amplification blunting, not a hard boundary. A durable/shared limiter remains out of scope (pre-existing, documented in rate-limit.ts).

## Smoke (pre-merge, on the branch tree)
- lint clean · tsc 7-baseline · 186 files / 2050 tests / 0 todo

## main untouched
- Before/after: `main` = `origin/main` = `cd1951be9225c905e5187851bf8b5796b2c6a1b3` (via `git show-ref refs/heads/main`), unchanged.

## Left uncommitted (intentional)
`.claude/settings.json`, `CLAUDE.md`, `memory/`.
