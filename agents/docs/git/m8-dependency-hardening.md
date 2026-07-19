# Merge log — M8-T5 Dependency hardening

Date: 2026-07-19. Executor: Orchestrator directly (both the installs — Codex sandbox has no registry — and git — Codex sandbox can't write refs).

## Commits

| Hash | Branch | Message |
|---|---|---|
| `b00c0a5` (amended) | feat/m8-t5-dependency-hardening | chore(deps): next 15.0.5→15.5.20 + transitive audit fixes (M8-T5) — includes typescript spec restored to `^5` after CR flagged an unintended exact-pin |
| `60a6fe0` | feat/m8-t5-dependency-hardening | docs(m8-t5): CR + security gate artifacts, backlog + M8-T11 |
| `d8d0e0a` | prototype | merge(m8-t5) --no-ff, `ort`, zero conflicts — 8 files |

Feature branch pushed `-u`; `prototype` pushed `b014ce8..d8d0e0a`.

## What changed
- `package.json`: `next` 15.0.5 → 15.5.20 (exact-pinned). Nothing else (typescript restored to `^5`).
- `package-lock.json`: next bump + non-breaking transitive fixes (@grpc/grpc-js, form-data, protobufjs, websocket-driver).
- No application source touched.

## Audit transition (Orchestrator-captured, authoritative — registry unreachable from Codex)
- Before: 15 vulns — 2 critical / 3 high / 10 moderate.
- After: **11 moderate — 0 critical / 0 high.** Entire high-severity surface eliminated.
- Residual 11 moderate (postcss, uuid transitives) = deferred `--force`/major items → tracked as **M8-T11**.

## Gates
- Orchestrator staged execution: lint clean / tsc 7-baseline / `npm run build` exit 0 / 182 files 2017 tests — GREEN after BOTH Stage 1 and Stage 2.
- Code Review (`task-mrr1b6vf-a3vcjv`, gpt-5.6-sol): CHANGES REQUESTED → 2 Should-fix (typescript unintended pin; deferred-deps needed a real ticket) → both fixed (typescript restored, M8-T11 filed) → minimal directly-inspected fixes, merged per precedent without a re-review cycle.
- Security (`task-mrr1b702-yvtgh8`, gpt-5.6-sol): **PASS.** All crit/high cleared; next+websocket-driver were defense-in-depth here (no middleware.ts), grpc/form-data/protobufjs reachable via firebase-admin server paths and materially hardened; postcss residual build-time-only; uuid vulnerable v3/v5/v6-with-buffer path unused (consumers call arg-free v4). No new dependency capability or source/auth change.
- Post-merge build smoke on the merged `prototype` tip: exit 0.

## main untouched
- Before/after: `main` = `origin/main` = `cd1951be9225c905e5187851bf8b5796b2c6a1b3`, unchanged.

## Rollback
Pre-Stage-1 package.json + package-lock.json backups in the session scratchpad; `npm ci` restores exactly.

## Left uncommitted (intentional)
`.claude/settings.json`, `CLAUDE.md`, `memory/`.
