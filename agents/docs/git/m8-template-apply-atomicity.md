# Merge log — M8-T9 Form-template propagation operational atomicity

Date: 2026-07-19. Executor: Orchestrator directly (Codex sandbox can't write git refs).

## Commits

| Hash | Branch | Message |
|---|---|---|
| `7cd1259` | feat/m8-t9-template-apply-atomicity | fix(forms): atomic form-template propagation via Firestore batch (M8-T9) — 6 files, +594/−36 |
| `0873b9d` | feat/m8-t9-template-apply-atomicity | docs(m8-t9): gate artifacts + backlog closure — 4 files |
| `c2a1e5d` | prototype | merge(m8-t9) --no-ff, `ort`, zero conflicts — 10 files, +1008/−37 |

Feature branch pushed `-u`; `prototype` pushed `e58ae59..c2a1e5d`.

## What it did
Closed M8-T4 Security M-1 (Medium): applyAdminTemplateToForms validated the full list before writing but wrote sequentially → partial application on mid-loop failure.
- Sequential writes → single `adminDb.batch()` commit (genuine all-or-none); same per-form payload as updateAdminForm, reusing applyTemplateToLinkedForm.
- MAX_TEMPLATE_APPLY_FORMS=500 cap at DAL (throws) + route (mode:all reads 501 → 422; mode:selected caps formIds.length → 422) — one atomic batch, no chunking illusion.
- selected mode resolves requested IDs directly (not the truncatable 501-scan) — no silent skip.
- Typed TemplateApplyLimitError + TemplateApplyIneligibleFormError → clean 422s (were unhandled 500s); ineligible message generic (no cross-org existence oracle).
- M8-T4 tenancy validation + batch atomicity unchanged. fake-admin-db: opt-in atomic-batch + setBatchFailureAt (backward-compatible).

## Gate provenance (all Codex on gpt-5.6-sol, model verified per job)
- Implementation: `task-mrrpw1rj-3cx1be`
- Code Review: `task-mrrqcdi1-svbvz5` — CHANGES REQUESTED (selected-mode 501-scan silently skipped a requested form beyond row 501)
- Security: `task-mrrqcdmm-h5o0iy` — PASS (tenancy intact, batch atomic, bound genuine, clean 422)
- Selected-mode fix: `task-mrrqrr5t-c2fgor` (Option A: direct id resolution)
- Error-handling fix: `task-mrrr7ruy-9ah1ab` — **Orchestrator-found during verification:** the selected-mode fix made the DAL's generic ineligible-form throw reachable as an unhandled 500; fixed with typed errors → clean 422s, generic (no existence oracle)
- QA: `task-mrrrn7t5-rzd5zi` — SIGNED OFF, 0 defects, +7 tests (real-batch atomicity, >501 no-silent-skip seeding 502 forms, existence-oracle, tenancy)
- Git: Orchestrator directly (this log)

## Smoke (pre-merge, on the branch tree)
- lint clean · tsc 7-baseline · 187 files / 2068 tests / 0 todo

## main untouched
- Before/after: `main` = `origin/main` = `cd1951be9225c905e5187851bf8b5796b2c6a1b3` (`git show-ref refs/heads/main`), unchanged.

## Left uncommitted (intentional)
`.claude/settings.json`, `CLAUDE.md`, `memory/`.

## STATUS: M8-T9 complete. Per user: PAUSE here. M8-T10 + M8-T11 remain filed (T11 next@16/react@19 deferred by user).
