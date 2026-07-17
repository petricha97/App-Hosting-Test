# Merge Log — M7-T3 Scheduled Report Delivery

- **Date:** 2026-07-17
- **Feature branch:** `feat/m7-t3-scheduled-reports`
- **Target branch:** `prototype`
- **Merge commit:** `ce7bc16` — `merge(m7-t3): scheduled report delivery — recurring dashboard-link emails`
- **Merge base (prototype before merge):** `86226a5`

## Branch provenance (same pattern as every prior ticket)

All of M7-T3's implementation work (Research, Backend DAL + lifecycle
sweep integration, Full-Stack schedule dialog/form + CRUD routes, and
all three independent verification passes) was carried out directly
in the working tree while already checked out on `prototype` — no
`feat/m7-t3-scheduled-reports` branch existed until the GitHub Agent
created one at commit time. This is the identical situation to every
prior ticket back through M6 (`agents/docs/git/m6-emails-admin.md`,
`agents/docs/git/m6-lifecycle-triggers.md`,
`agents/docs/git/m6-email-designer.md`) and M7-T1/T2
(`agents/docs/git/m7-reporting-summaries.md`,
`agents/docs/git/m7-report-templates.md`), the established pattern
for this loop. `feat/m7-t3-scheduled-reports` was cut via
`git checkout -b feat/m7-t3-scheduled-reports` from that working-tree
state (`git status --porcelain` captured before and after the
checkout — byte-identical, confirming nothing was lost or altered),
then the ticket's work was staged and committed as a single commit
on the new branch. `HANDOVER.md`, `agents/docs/BACKLOG.md`, and
`memory/` were excluded from that commit (orchestration bookkeeping,
same convention as every prior ticket) and instead committed
separately on `prototype` after the merge (`memory/` left untracked
entirely, per the loop convention of not versioning agent scratch
memory).

## Tickets landed

M7-T3 — third and final ticket of the M7 (Reporting) milestone:
recurring dashboard-link email notifications for the M7-T2 report
templates library, folded into the existing M6-T3 periodic
lifecycle sweep as one more evaluation step rather than a new
Cloud Scheduler job. Org admins configure per-event, per-template
schedules (frequency, free-text recipient list) via a new
report-schedules dialog. Recipient membership is verified against
the org roster inside the same transaction as the schedule
upsert (reject-all on any invalid email, zero partial writes), and
re-verified fresh against current org membership at every scheduled
fire (silently dropping any member since departed from that one
send, without mutating the stored recipient list — resumes
automatically if the member is re-added later). Delivery is
dashboard-deep-link only, never an attachment or CSV in the email
body — confirmed structurally impossible to regress since
`SendEmailInput` has no attachment field anywhere in the transport
pipeline. Zero fix cycles across Code Review, Security, and QA — the
third ticket in this loop to clear all three gates clean on the
first pass (after M7-T1 and M7-T2).

## M7-T3 commits

| Hash | Message |
|------|---------|
| `13afda5` | feat(reports): scheduled report delivery (M7-T3) |
| `ce7bc16` | merge(m7-t3): scheduled report delivery — recurring dashboard-link emails |
| `c3fcaad` | docs(handover): M7-T3 closure, M7 milestone complete |

## Files (feature commit `13afda5`)

39 files changed, 6653 insertions(+), 11 deletions(-). Notable
additions:

- DAL: `src/lib/db/{adminReportSchedule.ts, reportScheduleId.ts,
  reportScheduleSchemas.ts}` — `ReportScheduleDoc` (one schedule per
  event+template, deterministic id), `upsertAdminReportSchedule`
  verifies every candidate recipient's org membership *inside* the
  same transaction as the write (all-or-nothing — a route-layer-only
  check was the spec's floor, Backend shipped a stronger DAL-level
  guarantee)
- Lifecycle sweep integration: `src/lib/email/lifecycle/
  {evaluate-report-schedules.ts, report-schedule-periods.ts}`, wired
  as a pure-append extension into the existing M6-T3
  `evaluate-event.ts` per-event sweep and `dedupe-keys.ts`
  (`scheduleId:periodKey` dedupe key, since `emailMessageId()` already
  hashes `recipientEmail` as a separate tuple element) — no new
  Cloud Scheduler job, no new auth surface; the internal sweep
  entrypoint keeps M6-T3's exact tenancy contract (every DAL call
  carries `organizationId` + `eventId`, fail-closed shared-secret
  authenticated, never session-based)
- Feature module: `src/features/reports/{schedule-schemas.ts,
  schedule-utils.ts, components/{report-schedule-form,
  report-schedule-recipients-field, report-schedules-dialog}.tsx,
  server/{read-json-body, serialize-report-schedule}.ts}` — free-text
  recipient input (no roster picker, since no "list all org members"
  query exists), reused into the existing reports workspace via a
  `?template=` deep-link
- Routes: `src/app/api/dashboard/events/[eventId]/reports/schedules/`
  (collection + `[templateSlug]` routes) — CRUD gated on
  `write:events`, correctly stricter than M7-T2's Run routes,
  matching M7-T2's export-route tier
- `firestore.rules` — new `reportSchedules` subcollection rules
- Docs: `agents/docs/{specs,data-models,reviews,security,qa}/
  m7-scheduled-reports.md`
- Tests: 8 new test files (`admin-report-schedule`,
  `lifecycle-evaluate-event-report-schedules`,
  `lifecycle-evaluate-report-schedules`, `report-schedule-periods`,
  `report-schedule-recipients-field`, `report-schedules-dialog`,
  `report-schedules-route-dal-integration`, `report-schedules-routes`)
  plus updates to `lifecycle-dedupe-keys`, `reports-page`, and
  `reports-route-scope` test suites — including a real-route+real-DAL
  integration suite (closing the gap between the existing
  mocked-DAL-routes and real-DAL-no-routes suites), a
  departed-then-rejoined recipient across two real periods, and a
  fractional-UTC-offset timezone boundary test

Excluded from this commit (committed separately on `prototype` in
`c3fcaad`, or left untracked): `HANDOVER.md`,
`agents/docs/BACKLOG.md`, `memory/`.

## Gate status at merge time

- **Code Review:** APPROVED. 0 Blockers, 0 Should-fix, 1 Nit
  (inconsistent rate-limit ceilings across the schedule CRUD routes —
  harmless). The ticket's most subtle correctness requirement — write-
  time reject-all vs. fire-time drop-one for recipient membership —
  independently re-verified by direct source read at both call sites:
  `upsertAdminReportSchedule` verifies all candidates before the
  transaction even opens (zero writes on any single rejection);
  `evaluateReportScheduleTrigger` re-verifies fresh at every period
  and silently drops departed members from that one send only, never
  mutating the stored recipient list. Zero-PII email body, deep-link
  safety, and the `evaluate-event.ts` pure-append integration all
  also confirmed. (`agents/docs/reviews/m7-scheduled-reports.md`).
- **Security:** PASS, 0 findings of any severity. Checked whether a
  client could smuggle a pre-resolved `recipients:[{email,name}]`
  array past validation to bypass `verifyReportScheduleRecipient` —
  confirmed impossible (the Zod schema only defines
  `recipientEmails: string[]`, and default `z.object()` behavior
  strips unrecognized keys). CRUD routes confirmed `write:events`-
  gated. Internal sweep entrypoint's fail-closed auth confirmed
  untouched by this ticket's additive `evaluate-event.ts` extension.
  Code Review's rate-limit-ceiling Nit re-assessed and confirmed
  genuinely cosmetic, not escalated. No new dependencies.
  (`agents/docs/security/m7-scheduled-reports.md`).
- **QA:** SIGNED OFF, 0 defects found in the implementation at any
  severity. Wrote a new real-route+real-DAL integration suite and
  independently re-derived the anti-exfiltration properties from
  source rather than trusting Security's conclusion. Added 12
  regression tests total closing 5 genuine test-coverage gaps
  (real-route+DAL CRUD round-trip, a departed-then-rejoined recipient
  across two real periods, a fractional-UTC-offset timezone boundary,
  the body-size cap, the rate limit, and the Schedule button's
  permission gate) — all five gaps turned out to already be correctly
  implemented, not defects. Final suite: 148 files / 1708 tests
  passing. (`agents/docs/qa/m7-scheduled-reports.md`).
- **Checks (final working tree before merge):** lint clean, tsc at
  baseline (same 7 pre-existing errors in untouched files), build
  exit 0, 148 files / 1708 tests passing.
- **Secret scan of staged diffs before commit:** clean — grepped
  `git diff --cached` for API key/secret/password/token/private-key
  patterns across all new/modified files (hits were only doc prose
  discussing the unchanged M6-T3 fail-closed shared-secret sweep
  auth and test-mock `session`/`token` cookie values, none actual
  secret material); confirmed no `.env*` file appeared in the staged
  diff or `git status`.

## Pre-merge smoke check (on `feat/m7-t3-scheduled-reports`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Post-merge smoke check (on `prototype`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Conflicts

None. Merge made by the `ort` strategy with no conflicts.

## Fix cycles

Zero. One non-blocking Code Review Nit (inconsistent rate-limit
ceilings across schedule CRUD routes) noted but not escalated by
Security or QA — did not block merge.

## M7 milestone status

This merge lands the third and final ticket of M7 (Reporting):
M7-T3 (scheduled report delivery) — Done, merged to `prototype`.
**M7 (Reporting) is now fully complete — M7-T1, M7-T2, and M7-T3 all
merged.** Per `agents/docs/BACKLOG.md`, next milestone is M8.

## Push results

- `feat/m7-t3-scheduled-reports` pushed: new branch → `13afda5`
- `prototype` pushed: `86226a5..ce7bc16` (merge), then a follow-up
  push for `ce7bc16..c3fcaad` (docs bookkeeping commit)
- `main` untouched throughout: `git rev-parse main` /
  `git rev-parse origin/main` both `cd1951be9225c905e5187851bf8b5796b2c6a1b3`
  before and after all work in this session — verified via
  `git branch --show-current` before every commit/merge/push; no git
  command targeted `main`.
