# Merge log — M8-T10 Coverage tooling + enforced floor + event-pointer tests

Date: 2026-07-19. Executor: Orchestrator directly (npm install [no Codex registry] + git [no Codex refs]).

## Commits

| Hash | Branch | Message |
|---|---|---|
| `e7e3fad` | feat/m8-t10-coverage-and-pointer-hardening | test(coverage): V8 coverage + enforced honest regression floor + event-pointer 403 tests (M8-T10) |
| (docs) | feat/m8-t10-coverage-and-pointer-hardening | docs(m8-t10): CR artifact + backlog closure |
| `8126d68` | prototype | merge(m8-t10) --no-ff, `ort`, zero conflicts — 6 files, +329/−18 |

Feature branch pushed `-u`; `prototype` pushed `9350c1a..8126d68`.

## What it did
- Installed `@vitest/coverage-v8@4.0.18` (Orchestrator — Codex sandbox has no registry). Added `npm run test:coverage`; `coverage/` already gitignored.
- Configured V8 coverage with `all: true` (counts entirely-untested files as 0% — HONEST whole-repo coverage, not just test-touched files).
- Excludes limited to test files / `*.d.ts` / configs / node_modules. **CR caught + fixed:** the first pass used blanket `src/**/types.ts` + `src/**/index.ts` globs that hid real logic (the M6-T4 email-block renderer dispatch, pricing/registration serializers); those were dropped.
- Enforced regression floor: statements 57 / branches 49 / functions 50 / lines 58 (~1–2 pt below the honest baseline 58.91 / 50.16 / 51.93 / 59.91). Passes today, fails on regression (proven: raising to 60 → exit 1). Documented to ratchet toward 80%, esp. branches/functions.
- Part B: eventPagePath/invoicePath were ALREADY server-owned in the event route by M8-T4 (all 4 pointer fields 403-guarded). Added the 2 regression tests M8-T4 CR flagged as missing (eventPagePath / invoicePath change → 403, no write). No production code changed.

## HONEST COVERAGE BASELINE (whole src tree, all:true): ~59% statements, ~50% branches, ~52% functions, ~60% lines. The "80%+" figure only applies to the subset of files tests import. Big untested surface = UI components, feature modules, and the routes M8-T4 flagged. Ratchet-up (writing tests toward 80%) is a separate effort, NOT done here — flagged to user.

## Gate provenance (all Codex on gpt-5.6-sol, model verified per job)
- Implementation: `task-mrrxuas9-je6b1f`
- Code Review: `task-mrryb8es-3coor7` — CHANGES REQUESTED (exclude honesty: blanket globs hid real logic)
- Exclude-honesty fix: `task-mrryq14n-jxs0m4` — dropped globs, rebaselined; Orchestrator verified globs gone + floor passes/enforces
- No SEC/QA: tooling + test-only, no production change (pointers already M8-T4-verified). CR is the gate.
- Git + npm install: Orchestrator directly (this log)

## Smoke (post-merge on merged prototype tip)
- lint clean · tsc 7-baseline · 187 files / 2070 tests · `npm run test:coverage` PASS (58.91/50.16/51.93/59.91 ≥ floor)

## main untouched
- Before/after: `main` = `origin/main` = `cd1951be9225c905e5187851bf8b5796b2c6a1b3`, unchanged.

## Left uncommitted (intentional): `.claude/settings.json`, `CLAUDE.md`, `memory/`.
