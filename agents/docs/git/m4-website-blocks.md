# Merge Log — M4: Event Website Blocks & Per-Path Pages

- **Date:** 2026-07-11
- **Tickets:** M4-T1 (event website blocks), M4-T2 (per-path pages)
- **Feature branch:** `feat/m4-website-blocks`
- **Target branch:** `prototype`

## Commits included

- `011a935877d6a3299797a15e585e1d9c91958fc2` — feat(m4): website blocks & per-path pages (M4-T1, M4-T2)
  - Three Puck blocks: TicketPricingTable, Countdown, RegistrationCta
  - Live pricing projection reusing M2 order engine
  - Event-timezone-aware countdown utilities
  - pageKey model on adminEventPage with per-path page resolution + delete cascade
  - Public draft-content leak fix (SEC-M4-1)
  - 41 files changed, 4199 insertions(+), 117 deletions(-)

## Merge commit

- `65bd0d58a40c2f8c246505355cdc9a8e7338f78d` — merge(m4): event website — pricing table, countdown, registration embed + per-path pages (`--no-ff`, no conflicts)

## Loop verdicts

- Code review: CHANGES REQUESTED → B1 + S1–S3 + nits fixed, re-review clean (agents/docs/reviews/m4-website-blocks.md)
- Security: PASS after SEC-M4-1 fix (agents/docs/security/m4-website-blocks.md)
- QA: SIGNED OFF 27/27 ACs; QA-M4-D1 minor defect fixed post-signoff with regression test lock flipped (agents/docs/qa/m4-website-blocks.md)

## Post-merge verification (on prototype)

- `npm run lint` — PASS (no ESLint warnings or errors)
- `npm run build` — PASS (compiled successfully, 31/31 static pages generated)
- `npm test` — PASS (53 files / 763 tests, all green)

## Notes

- No push performed (per Orchestrator instruction).
- `feat/m5-attendees-checkin` cut from `prototype` at `65bd0d5` for the next milestone.
