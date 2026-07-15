# Merge Log — M6-T3 Lifecycle Triggers & Audience Segmentation

- **Date:** 2026-07-16
- **Feature branch:** `feat/m6-t3-lifecycle-triggers`
- **Target branch:** `prototype`
- **Merge commit:** `d09969b` (full: `d09969b10eac1663ee3a5321f0b06ea19e75e856`) — `merge(m6-t3): lifecycle triggers & audience segmentation`
- **Merge base (origin/prototype before merge):** `5925511`

## Branch provenance (deviation from standard flow)

All of M6-T3's implementation work (Backend periodic evaluator + Full-Stack
real-time hooks/UI wiring, dispatched in parallel, plus all fix cycles) was
carried out directly in the working tree while already checked out on
`prototype` — no `feat/m6-t3-lifecycle-triggers` branch existed until the
GitHub Agent created one at merge time. This is the identical situation to
the M6-T2 precedent (`agents/docs/git/m6-emails-admin.md`).
`feat/m6-t3-lifecycle-triggers` was cut via `git checkout -b
feat/m6-t3-lifecycle-triggers` from that working-tree state (48
uncommitted/untracked entries, verified with `git status --porcelain`
before and after the checkout to confirm nothing was lost or altered),
then the ticket's work was staged and committed as a single commit on the
new branch. `HANDOVER.md`, `agents/docs/BACKLOG.md`, and `memory/` were
excluded from that commit (orchestration bookkeeping, same convention as
the M6-T1/M6-T2 precedent) and instead committed separately on `prototype`
after the merge (`memory/` was left untracked entirely, per the loop
convention of not versioning agent scratch memory).

## Tickets landed

M6-T3 (lifecycle triggers & audience segmentation: periodic evaluator for
5 trigger types — scheduled, unpaid-invoice offsets, abandoned-registration,
on-submit, on-accept — with deterministic dedupeKey formulas reusing T1's
create-if-absent outbox safety mechanism; fail-closed shared-secret
internal scheduler entrypoint; real-time on-submit/on-accept hook wiring;
"Email all" bulk-send route for abandoned registrations sharing the
automation's dedupe key; trigger-cell/abandoned-tab UI wiring), including
one fix cycle (Security Medium + Low).

## M6-T3 commits

| Hash | Message |
|------|---------|
| `eece965` | feat(email): lifecycle triggers & audience segmentation (M6-T3) |
| `d09969b` | merge(m6-t3): lifecycle triggers & audience segmentation |
| `b8e6f31` | docs(loop): M6-T3 gate artifacts and handover update |

## Files (feature commit `eece965`)

57 files changed, 7341 insertions(+), 145 deletions(-). Notable additions:

- Lifecycle evaluator core: `src/lib/email/lifecycle/{audience-queries,
  dedupe-keys,definition-enabled,evaluate-abandoned,evaluate-event,
  evaluate-scheduled,evaluate-unpaid-offsets,evaluator-auth,event-schedule,
  paged-trigger-runner,qr,run-sweep,types}.ts`
- Internal scheduler entrypoint: `src/app/api/internal/email-triggers/
  evaluate/route.ts` (fail-closed shared-secret auth, rate-limited)
- Real-time hooks: `src/features/emails/server/{fire-on-accept-email,
  fire-on-submit-email,resolve-definition}.ts`
- "Email all" bulk-send route: `src/app/api/dashboard/events/[eventId]/
  drafts/email-all/route.ts`
- DAL additions: `src/lib/db/adminOrder.ts` (payment-status queries),
  `src/lib/db/adminFormData.ts`, `src/lib/db/adminRegistrationDraft.ts`,
  `src/lib/db/adminEvent.ts`
- UI wiring: `src/features/emails/components/trigger-cell.tsx`,
  `src/features/attendees/components/abandoned-tab.tsx`
- Infra: `firestore.indexes.json` (2 new composite indexes),
  `apphosting.yaml` (new `EMAIL_TRIGGER_EVALUATOR_SECRET` env var —
  references a secret name only, no value, same pattern as
  `QR_TOKEN_SECRET`/`scannerSessionSecret`)
- Docs: `agents/docs/{specs,data-models,reviews,security,qa}/
  m6-lifecycle-triggers.md`
- Tests: 15 new test files + 6 modified, incl. dedupeKey formula tests for
  all 5 trigger types, audience-query tests, paged-trigger-runner tests,
  evaluator-auth tests, on-accept/on-submit wiring tests, "Email all"
  route + dedupe tests, abandoned-tab interaction tests

Excluded from this commit (committed separately on `prototype` in
`b8e6f31`, or left untracked): `HANDOVER.md`, `agents/docs/BACKLOG.md`,
`memory/`.

## Gate status at merge time

- **Code Review:** APPROVED. 0 Blockers, 0 Should-fix, 4 Nits — one (N-3:
  missing rate-limiting on the new internal entrypoint) explicitly flagged
  for Security to make a deliberate call on rather than resolved as a
  Should-fix (`agents/docs/reviews/m6-lifecycle-triggers.md`).
- **Security:** PASS. 0 Critical/High, 1 Medium (the internal entrypoint's
  Zod ceilings permitted up to 200×500×200 per call with zero
  rate-limiting — fail-closed secret auth alone judged insufficient, a
  different threat model than brute-force: leaked secret / scheduler
  misconfig / retry storm all bypass auth and hit an endpoint unbounded by
  rate limiting), 1 Low (`drafts/email-all/route.ts` failed its entire
  batch and echoed raw unmasked emails in error responses when any one
  recipient was invalid). Both fixed (rate limit 6/min added matching
  Security's own recommendation + Zod ceilings tightened 200/500/200 →
  50/200/40; per-recipient pre-validation isolating invalid entries
  instead of whole-batch failure/echo) and independently re-verified
  (`agents/docs/security/m6-lifecycle-triggers.md`).
- **QA:** SIGNED OFF, zero defects across all 9 spec sections. Verified
  dedupeKey formulas line-by-line for all 5 trigger types, the
  three-layer accept-hook failure isolation, per-page `enabled` re-check
  discipline, and the two-condition `accepted-invoice` eligibility against
  deliberately tricky fixtures. Two non-blocking observations disclosed
  (not defects): the `all-invitees` no-op has no organizer-facing UI
  signal (spec's own OQ-1 already classifies this as accepted/deferred);
  the Email-all double-click test is sequential not truly concurrent
  (disclosed honestly, no behavioral risk since the underlying dedupe is a
  real Firestore transaction) (`agents/docs/qa/m6-lifecycle-triggers.md`).
- **Checks (Orchestrator, final working tree):** lint clean, build exit 0,
  `npm test -- --run` 109 files / 1317 tests passing.
- **Secret scan of staged diffs before commit:** clean — grepped for API
  key/secret/private-key patterns across new/modified files; the one hit
  (`NEXT_PUBLIC_FIREBASE_API_KEY` value in `apphosting.yaml`) was
  confirmed to be pre-existing unchanged context, not a new addition — the
  actual new lines in that file only add a secret *name*
  (`emailTriggerEvaluatorSecret`) with no value, same posture as the
  existing `QR_TOKEN_SECRET`/`scannerSessionSecret` entries. `.env.local`
  never appeared in `git status`; nothing staged.

## Pre-merge smoke check (on `feat/m6-t3-lifecycle-triggers`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Post-merge smoke check (on `prototype`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Conflicts

None. Merge made by the `ort` strategy with no conflicts.

## Push results

- `feat/m6-t3-lifecycle-triggers` pushed: new branch → `eece965`
- `prototype` pushed: `5925511..d09969b` (merge), then a follow-up push for
  `d09969b..b8e6f31` (docs bookkeeping commit)
- `main` untouched throughout (verified via `git branch --show-current`
  before every commit/merge/push; no git command targeted `main`).
