# Merge Log — M7-T2 Report Templates Library

- **Date:** 2026-07-17
- **Feature branch:** `feat/m7-t2-report-templates`
- **Target branch:** `prototype`
- **Merge commit:** `df25e96` — `merge(m7-t2): report templates library — 5 templates, 10 routes, CSV export`
- **Merge base (origin/prototype before merge):** `04326c5`

## Branch provenance (deviation from standard flow)

All of M7-T2's implementation work (Research, Design, Backend DAL
cursor-pagination extension, Full-Stack orchestration + UI components,
and all three independent verification passes) was carried out
directly in the working tree while already checked out on `prototype`
— no `feat/m7-t2-report-templates` branch existed until the GitHub
Agent created one at merge time. This is the identical situation to
every prior ticket back through M6
(`agents/docs/git/m6-emails-admin.md`,
`agents/docs/git/m6-lifecycle-triggers.md`,
`agents/docs/git/m6-email-designer.md`) and M7-T1
(`agents/docs/git/m7-reporting-summaries.md`), now the established
pattern for this loop. `feat/m7-t2-report-templates` was cut via
`git checkout -b feat/m7-t2-report-templates` from that working-tree
state (`git status --porcelain` captured before and after the
checkout — byte-identical, confirming nothing was lost or altered),
then the ticket's work was staged and committed as a single commit on
the new branch. `HANDOVER.md`, `agents/docs/BACKLOG.md`, and
`memory/` were excluded from that commit (orchestration bookkeeping,
same convention as every prior ticket) and instead committed
separately on `prototype` after the merge (`memory/` left untracked
entirely, per the loop convention of not versioning agent scratch
memory).

**Mid-merge housekeeping note:** after the feature-branch commit, three
already-committed test files
(`qa-report-run-panel-states.test.tsx`,
`qa-report-templates-d1-all-routes.test.ts`,
`qa-report-templates-fixtures.test.ts`) picked up unstaged, purely
cosmetic Prettier-style line-wrap reformatting in the working tree
(no semantic changes — confirmed by direct diff read, e.g. breaking a
single-line `vi.fn().mockResolvedValue(...)` chain across multiple
lines). Origin traced to this same Claude session's own process
(`.claude/scheduled_tasks.lock` PID matches this session, no other
concurrent agent process found), most plausibly an editor
format-on-save touching open files — not a second agent editing
concurrently. Rather than fold unreviewed formatting drift into the
QA-approved ticket commit, everything (including the legitimate
`HANDOVER.md`/`BACKLOG.md` bookkeeping diffs) was stashed before
switching branches (avoiding any risk of losing work per the
git-safety protocol), then after the merge the three cosmetic diffs
were discarded (`git checkout --`) and only `HANDOVER.md`/
`agents/docs/BACKLOG.md` were kept and committed. The merged content
of all three test files on `prototype` is exactly what Code
Review/Security/QA signed off on — untouched by this drift.

## Tickets landed

M7-T2 — second ticket of the M7 (Reporting) milestone: a report
templates library with 5 templates (registration overview, order &
transaction details, email overview, abandoned registration details,
check-in history), each with a paginated Run view (inline
single-open accordion panel, org-membership-gated) and a full-dataset
CSV export (`write:events`-gated, capped at 1000 rows matching the
existing `ATTENDEES_EXPORT_LIMIT`/`RESPONSES_EXPORT_LIMIT`
precedent), backed by 10 new API routes built through two shared
handler functions so the permission split can't drift between
routes. Zero fix cycles across Code Review, Security, and QA — the
second ticket in this loop to clear all three gates clean on the
first pass (after M7-T1).

## M7-T2 commits

| Hash | Message |
|------|---------|
| `1c1da5c` | feat(reports): report templates library — 5 templates, 10 routes, CSV export (M7-T2) |
| `df25e96` | merge(m7-t2): report templates library — 5 templates, 10 routes, CSV export |
| `f9cb0b7` | docs(loop): M7-T2 gate artifacts and handover update — mark M7-T2 Done, add M8-T7 |

## Files (feature commit `1c1da5c`)

47 files changed, 6060 insertions(+), 5 deletions(-). Notable
additions:

- Reports feature module additions: `src/features/reports/
  {templates.ts, csv.ts, types.ts (extended),
  components/{report-run-panel, report-templates-section,
  report-templates-table}.tsx, server/{load-registration-overview,
  load-order-transactions, load-email-overview,
  load-abandoned-registrations, load-checkin-history,
  report-run-handler, report-export-loop, reports-route-scope,
  resolve-type-names}.ts}` — template registry, RFC-4180 CSV
  serialization reusing the existing `escapeCsvField`
  formula-injection guard verbatim, 5 loaders, two shared
  run/export request handlers centralizing the permission split,
  single parameterized Run panel component (not 5 near-duplicates)
- Route wiring: `src/app/api/dashboard/events/[eventId]/reports/
  {abandoned-registrations,checkin-history,email-overview,
  order-transactions,registration-overview}/{route.ts,export/route.ts}`
  — 10 new routes; Run stays org-membership-only (matches every
  other PII-bearing read surface), export requires `write:events`
  (matches the existing M5 attendee-CSV-export precedent)
- DAL extension: `src/lib/db/adminOrder.ts` —
  `getAdminOrdersForEvent` gains cursor pagination
  (`limit`/`startAfterCreatedAtMs`) for the order-transactions
  template; the other 4 templates' DAL functions needed no changes
- Additive export: `src/features/attendees/roster.ts` — used by the
  check-in-history and abandoned-registration templates
- UI wiring: `src/features/reports/components/reports-workspace.tsx`
  — renders the new report-templates-section
- Data-privacy decision baked structurally into the type system:
  abandoned registration details reuses `maskEmailDomain()`
  verbatim, masked email even in raw CSV bytes, never a plaintext
  `email` field anywhere in the `ReportRow` output shape
- "Badges printed" ships as a check-in-history report instead of
  literal badge-print tracking — a confirmed data gap (only
  `selfPrintBadges` settings toggle exists, no print log anywhere in
  the schema), flagged explicitly rather than silently invented
- Docs: `agents/docs/{specs,design,data-models,reviews,security,qa}/
  m7-report-templates.md`
- Tests: 15 new test files covering all 5 templates end-to-end
  (`admin-order-list`, `qa-report-run-panel-states`,
  `qa-report-templates-d1-all-routes`,
  `qa-report-templates-fixtures`, `report-abandoned-registrations`,
  `report-checkin-history`, `report-email-overview`,
  `report-order-transactions`, `report-registration-overview`,
  `report-templates-csv`, `report-templates-section`,
  `reports-route-scope`, `reports-run-export-routes`), including a
  regression test for Security's Order-doc field-leak finding
  (`idempotencyKey` never reachable via any row or CSV output) and
  CSV escaping verified via a real RFC-4180 parser round-trip

Excluded from this commit (committed separately on `prototype` in
`f9cb0b7`, or left untracked): `HANDOVER.md`,
`agents/docs/BACKLOG.md`, `memory/`.

## Gate status at merge time

- **Code Review:** APPROVED. 0 Blockers, 0 Should-fix, 3 Nits. Both
  central security decisions (D1 permission split, D4 masked-email)
  independently re-verified file-by-file across all 10 routes — zero
  reversed wiring. Order & transaction details checked column-by-
  column against `OrderDoc`, no internal-only field leaks
  (`idempotencyKey`, `feeId`, `taxIds` all correctly excluded).
  (`agents/docs/reviews/m7-report-templates.md`).
- **Security:** PASS, 0 Critical/High, 1 Medium, 2 Low. Medium
  finding (no rate limiting on any of the 10 new export/run routes)
  confirmed real but deliberately deferred — inherited technical
  debt already present on the pre-existing `attendees`/`responses`
  export routes, not a regression this ticket introduced; fixing
  only the 10 new routes would create an inconsistency, fixing all
  export routes would be scope creep beyond M7-T2. Tracked as new
  backlog ticket **M8-T7**. CSV formula-injection specifically
  checked and confirmed already closed by the pre-existing, reused
  `escapeCsvField` guard from M3-T4 — not a new gap. No new
  dependencies. (`agents/docs/security/m7-report-templates.md`).
- **QA:** SIGNED OFF, 1 Minor defect (QA-1: masked-email CSV cells
  carry a leading apostrophe in the raw file bytes, an artifact of
  the CSV formula-injection guard correctly treating any
  `@`-prefixed string as a risk) — accepted as-is, not fixed: the
  guard is behaving correctly, and special-casing it for one column
  would trade real protection for cosmetic byte-format tidiness. QA
  independently closed two nits Code Review had left open (D1
  exercised end-to-end for all 5 templates, not just one; CSV
  escaping verified via a real RFC-4180 parser round-trip, not
  string-containment) and added a regression test for Security's
  Order-doc field-leak finding. (`agents/docs/qa/m7-report-templates.md`).
- **Checks (final working tree before merge):** lint clean, build
  exit 0, `npm test -- --run` 140 files / 1615 tests passing.
- **Secret scan of staged diffs before commit:** clean — grepped
  `git diff --cached` for API key/secret/password/token/private-key
  patterns across all new/modified files (hits were only test
  fixture placeholder values like `SECRET_IDEMPOTENCY_KEY` and
  `secret@corp.com`, and doc prose discussing the absence of
  secrets, none actual secret material); confirmed no `.env*` file
  appeared in the staged diff or `git status`.

## Pre-merge smoke check (on `feat/m7-t2-report-templates`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Post-merge smoke check (on `prototype`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Conflicts

None. Merge made by the `ort` strategy with no conflicts.

## Fix cycles

Zero. One Minor QA defect accepted as-designed (QA-1, above) and one
Medium security finding deliberately deferred to backlog ticket
M8-T7 (rate limiting, above) — neither blocked merge; both were
gate-level judgment calls documented in the respective review docs,
not code that needed to change before Done.

## M7 milestone status

This merge lands the second ticket of M7 (Reporting): M7-T2 (report
templates library) — Done, merged to `prototype`. Next up per
`agents/docs/BACKLOG.md`: M7-T3 (scheduled report delivery, deps
M7-T2 + M6-T1/T3).

## Push results

- `feat/m7-t2-report-templates` pushed: new branch → `1c1da5c`
- `prototype` pushed: `04326c5..df25e96` (merge), then a follow-up
  push for `df25e96..f9cb0b7` (docs bookkeeping commit)
- `main` untouched throughout (verified via `git branch --show-current`
  before every commit/merge/push; no git command targeted `main`).
