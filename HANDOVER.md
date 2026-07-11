# Project Handover

Date: 2026-07-11
Branch at handover: `feat/m5-attendees-checkin`

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
