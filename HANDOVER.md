# Project Handover

Date: 2026-07-11
Branch at handover: `feat/m5-attendees-checkin`

## AGENT LOOP STATE (live — updated by the loop after every step; read this first on restart)

Last updated: 2026-07-13 23:10 (+08). Branch: `feat/m5-attendees-checkin`, all loop work UNCOMMITTED in the working tree.

Done (do not redo):
1. Backlog reconciled; M5-T1..T5 went Review → Done (closed 2026-07-13, DoD verified). See `agents/docs/BACKLOG.md`.
2. Code review APPROVED (incl. S-1 fix + re-review): `agents/docs/reviews/m5-attendees-checkin.md`.
3. Security PASS, 0 Critical/High (1 Medium → M8-T5, 6 Lows): `agents/docs/security/m5-attendees-checkin.md`.
4. QA SIGNED OFF, 39/39 ACs (1 Minor defect D-1 → ticket M5-F1): `agents/docs/qa/m5-attendees-checkin.md`.
5. M6-T1 spec complete: `agents/docs/specs/m6-email-infrastructure.md`. L-4 spec reconciliation done.
6. Suite baseline: lint clean, build exit 0, 72 files / 965 tests passing (+2 pending from M5-F1 test promotion).

In progress:
- **GitHub Agent: commit + merge M5** — M5-F1 fix APPROVED and D-1 CLOSED by QA (2026-07-13 ~23:40, closure appended to QA doc; sign-off stands, zero open defects, 72 files / 967 tests). All gates complete: M5-T1..T5 + M5-F1 fully approved end-to-end.

Next steps, in order (per Orchestrator — full detail in `agents/docs/BACKLOG.md` Sprint 5 notes):
3. github-agent: commit milestone (conventional messages, ticket IDs in body), merge `feat/m5-attendees-checkin` → `prototype` with `--no-ff`, smoke-check lint+build, log to `agents/docs/git/m5-attendees-checkin.md`. NEVER touch `main`. (IN PROGRESS)
4. M6-T1: backend-agent + fullstack-developer in parallel from the M6-T1 spec, on `feat/m6-t1-email-infrastructure` cut from `prototype`. Then CR → SEC → QA pipeline.

Human tasks (unchanged): create `DRAFT_TOKEN_SECRET`, `QR_TOKEN_SECRET`, `SCANNER_SESSION_SECRET` in App Hosting before prod deploy; answer email-provider question (Q2) when convenient.

Rule for the loop: if a session/limit failure interrupts any step, update THIS section with exactly what completed and what remains before stopping, so the next loop iteration resumes here instead of re-running finished gates.

## What this project is

This repository is a Next.js 15 + TypeScript event-management app built toward Cvent-style parity on top of Firebase / Firestore. It includes an `agents/` directory with planning, specs, design notes, reviews, and QA artifacts from an agent-driven workflow.

You do not need to keep using that workflow just because the files are present. Treat `agents/docs/` as project documentation, not as required operating procedure.

## Actual implementation status

The planning backlog is partially stale.

- `M0` to `M4` are already implemented in code.
- `M5` is also implemented in code on this branch, even though `agents/docs/BACKLOG.md` still marks `M5-T1` through `M5-T5` as `Todo`.

### Implemented milestone summary

- `M0`: event shell, route cleanup, index audit, test baseline
- `M1`: registration types and ticket types
- `M2`: pricing, discounts, taxes, service-fee shell, orders/payment flow
- `M3`: registration paths, public multi-step registration, response workflow, abandoned registration tracking
- `M4`: event page builder blocks and per-path page customization
- `M5`: attendees and check-in

### M5 work included on this branch

- attendee entity and QR token flow
- attendee roster screen
- abandoned-registration tab UI
- check-in configuration and team-member management
- public and admin scan flows
- Firestore rules and index updates for attendee/check-in data
- App Hosting secret wiring for QR and scanner-session signing

## Best docs to read first

- `agents/docs/specs/m5-attendees-checkin.md`
- `agents/docs/design/m5-attendees-checkin.md`
- `agents/docs/data-models/m5-attendees-checkin.md`
- `agents/docs/BACKLOG.md`
- `agents/AGENT_LOOP.md`

Use the M5 spec/design/data-model docs as the most accurate handoff set for the latest branch work.

## Validation status at handover

These checks were run successfully on 2026-07-11:

- `npm run lint`
- `npm run build`
- `npm run test -- --run`

Result: `72` test files passed, `959` tests passed.

## Important operational notes

Before deploying M5, make sure these runtime secrets exist:

- `DRAFT_TOKEN_SECRET`
- `QR_TOKEN_SECRET`
- `SCANNER_SESSION_SECRET`

They are referenced in `apphosting.yaml`. In local/dev test runs the code falls back to dev-only secrets and logs warnings. Production is intended to fail closed without the real secrets.

## Known documentation mismatch

- `agents/docs/BACKLOG.md` still says M5 is `Todo`.
- I did not rewrite the backlog or synthesize missing review/security/QA artifacts for M5 in this handover commit.
- The code is ahead of the planning/status docs.

## What should happen next

### Immediate owner tasks

1. Review this branch and merge/ship the M5 work.
2. Decide whether to update `agents/docs/BACKLOG.md` so it matches reality.
3. Create the App Hosting secrets before deployment.

### Product roadmap after this branch

- `M6`: email infrastructure and communications UI
- `M7`: reporting and report delivery
- `M8`: real IAM enforcement, real dashboard metrics, hardening, and coverage backfill

## Practical recommendation

If you want the cleanest takeover:

- treat this commit as the closure of M5 implementation work
- keep the agent-loop docs as historical reference
- use normal human-owned backlog/process from here unless the team explicitly wants to continue the agent model
