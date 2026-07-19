# M8-T5 Execution Results — Dependency Hardening

Executed by Orchestrator (network-capable env; Codex sandbox has no registry access) on 2026-07-19, following the staged plan in `agents/docs/specs/m8-dependency-hardening.md`. Branch `feat/m8-t5-dependency-hardening`.

## Pre-state (authoritative)
`npm audit --omit=dev`: **15 vulnerabilities — 2 critical, 3 high, 10 moderate.**
- Critical: `next` (middleware auth-bypass GHSA-f82v-jwr5-mffw — not exploitable here, no `middleware.ts`, but flagged), `websocket-driver` (via firebase → @firebase/database → faye-websocket).
- High: `@grpc/grpc-js`, `form-data`, `protobufjs` (firebase-admin/google-cloud transitives).
- Moderate: `postcss`, `uuid` (multiple transitive copies), and others.

## Stage 1 — `npm audit fix --omit=dev` (non-breaking, lockfile-only)
- package.json unchanged; package-lock.json only (+43/−127 lines).
- Cleared: the 3 high firebase transitives + the websocket-driver critical.
- Post-stage audit: 11 vulns (10 moderate, 1 critical [next, pending Stage 2]).
- **Gate: lint clean · tsc 7-baseline · `npm run build` exit 0 · 182 files / 2017 tests pass.**

## Stage 2 — `npm i --save-exact next@15.5.20` (15.0.5 → 15.5.20)
- Latest stable 15.5.x line (15.5.20). Exact-pinned.
- **Cleared the `next` critical** and all remaining next advisories fixed in the 15.x line.
- **Gate: lint clean · tsc 7-baseline · `npm run build` exit 0 · 182 files / 2017 tests pass.**

## Post-state (authoritative)
`npm audit --omit=dev`: **11 moderate, 0 critical, 0 high.**
- **Full high-severity surface eliminated (2 crit + 3 high → 0).**
- Residual 11 moderate = the deliberately-deferred `--force`/major-bump items:
  - `postcss <8.5.10` (moderate; build-time dependency)
  - `uuid <11.1.1` (moderate; buffer-bounds in v3/v5/v6 when `buf` provided — multiple transitive copies via @measured/puck, @google-cloud/storage, google-gax, gaxios, teeny-request; none under app control without forcing major transitive bumps)
- These are OUT of M8-T5's defined scope (require `--force`/major) and are tracked for a follow-up (see M8-T10 grouping / a new deps-major ticket). No `next@16`/`react@19` bump performed (out of scope, breaking-change risk).

## Source changes
NONE. Only `package.json` (1 line: next pin) + `package-lock.json` + docs. No application code touched.

## Rollback
`cp` backups of package.json + package-lock.json taken pre-Stage-1 (scratchpad); `npm ci` restores the exact tree.
