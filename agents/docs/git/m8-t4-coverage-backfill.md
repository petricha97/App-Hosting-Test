# Merge log — M8-T4 Coverage backfill + 4 cross-tenant/integrity fixes

Date: 2026-07-19. Executor: Orchestrator directly (Codex sandbox cannot write git refs).

## Commits

| Hash | Branch | Message |
|---|---|---|
| `f37c3aa` | feat/m8-t4-coverage-backfill | fix(security): close 4 cross-tenant/integrity bugs found by coverage backfill (M8-T4) — 10 files, +957/−10 |
| `72d8c06` | feat/m8-t4-coverage-backfill | docs(m8-t4): coverage plan, review, security (2 rounds), backlog + M8-T9/T10 — 5 files |
| `e0f61b2` | prototype | merge(m8-t4) --no-ff, `ort`, zero conflicts — 15 files, +1694/−11 |

Feature branch pushed `-u`; `prototype` pushed `264e857..e0f61b2`.

## What this ticket actually did

Opened as a test-coverage backfill; the new tests surfaced **4 pre-existing production bugs**, all fixed here:
- HIGH — event update route persisted client-supplied `organizationPath`/`formPath`/`eventPagePath`/`invoicePath` (cross-tenant re-attribution + foreign-resource pointer). Now server-owned, 403 on mismatch.
- HIGH — form-resolution getters (`getAdminPublishedFormForPublicEvent` + `getAdminFormForEvent`, both branches each) returned by-id/by-event forms without validating raw stored `eventId`/`organizationId`; `normalizeStoredFormDocument` masked the mismatch. An Org A event could render Org B's published form on the public registration path. All 3 resolution paths now validate raw stored fields before normalization. (Found in two rounds: the public pointer-fallback in Code Review's Blocker, then H1 direct-match + H2 sibling getter in Security's sibling sweep.)
- HIGH — `applyAdminTemplateToForms` updated every caller-supplied form with no validation; now reloads + validates the full list (org, template link, detached, target-event org-ownership) before any write.
- MEDIUM — `applyTemplateToSpecificEvents` (promotion apply-to-events) now validates the full requested list before any write.

+63 regression tests across 7 files (auth, permission, two-org tenancy, no-partial-write).

## Gate provenance (all Codex on gpt-5.6-sol, model verified per job)

- QA gap plan: `task-mrqx71lu-xd2gbl`
- Test-writing: Backend `task-mrqxluzc-suw2vh` ∥ Full-Stack `task-mrqxlv3z-26w8j1` (found bugs 1-3)
- Fix cycle 1: `task-mrqy21ks-0j8kfv` (bugs 1-3)
- Code Review: `task-mrqyh57g-zceexs` — CHANGES REQUESTED, found the formPath cross-tenant Blocker (bug 4) + 3 Should-fix
- Fix cycle 2: `task-mrqyw5hd-o28ltc` (formPath 2-layer + Should-fixes)
- Security: `task-mrqzbd4t-ncu1sq` — FAIL, sibling sweep found H1 + H2 (same bug class, 2 more paths) + M1
- Fix cycle 3: `task-mrqzqiyp-lesd2m` (H1/H2 raw-field guards; M1 deferred → M8-T9)
- Security re-review: `task-mrr06a26-ytu20v` — **PASS** (0 Crit/High; M1 Medium non-blocking, tracked)
- Git: Orchestrator directly (this log)

## Deferred / tracked follow-ups

- **M8-T9** — form-template propagation operational atomicity (Firestore batch under 500-write limit + bounded linked-form query). From Security M1.
- **M8-T10** — server-own `eventPagePath`/`invoicePath` review + coverage-provider tooling decision. From CR/plan.

## Smoke checks (pre-merge, on the branch tree)

- `npm run lint`: clean
- `npx tsc --noEmit --pretty false`: exactly the 7 pre-existing baseline errors, zero new
- `npm test -- --run`: 182 files / 2017 tests / 0 todo

## main untouched — verification

- Before: `main` = `origin/main` = `cd1951be9225c905e5187851bf8b5796b2c6a1b3`
- After: re-verified unchanged. `main` never checked out, committed, merged, rebased, or pushed.

## Left uncommitted (intentional)

`.claude/settings.json`, `CLAUDE.md`, `memory/`.
