# Merge log — M3: Registration Paths & Public Flow

- **Date:** 2026-07-11
- **Feature branch:** `feat/m3-registration-paths`
- **Target branch:** `prototype`
- **Merge commit:** `5b6be05b13760fa9578ff499b34889974ee9c1d0`

## Commits included

- `16c18c7` feat(m3): registration paths, public multi-step flow, approval workflow (M3-T1..T5)
  - 104 files changed, 15,207 insertions(+), 393 deletions(-)

## Scope (tickets M3-T1..T5)

- Registration paths admin (workspace, path dialog, flow diagram, API routes,
  `adminRegistrationPath` DAL, Firestore rules/indexes).
- Form builder commerce field types (ticket, quantity, discount code).
- Public multi-step registration stepper backed by signed HMAC draft tokens
  (`DRAFT_TOKEN_SECRET`, `src/lib/draft-token.ts`), server-side quote/finalize
  wired to the M2 order engine.
- Response approval workflow (pending/accepted/declined), CSV export (event +
  org scope), on-submission-accepted side effects.
- Abandoned draft tracking and dashboard drafts purge route with rate limiting
  (`src/lib/rate-limit.ts`).
- Hygiene: `.gitignore` entries for `debug.log` and prototype capture
  artifacts (M3 review S7); `apphosting.yaml` `DRAFT_TOKEN_SECRET` secret ref
  (name only, no value committed).

## Loop verdicts

- Code Review: CHANGES REQUESTED -> 7 should-fixes applied
  (`agents/docs/reviews/m3-registration-paths.md`).
- Security: PASS — M-1/L-1/L-2/L-3 fixed
  (`agents/docs/security/m3-registration-paths.md`).
- QA: DEFECTS OPEN -> QA-M3-D1 fixed; QA regression test green, sign-off
  condition met per `agents/docs/qa/m3-registration-paths.md`.

## Verification on merge result (prototype @ 5b6be05)

- `npm run lint` — PASS (no ESLint warnings or errors)
- `npm run build` — PASS (compiled successfully, 31/31 static pages)
- `npm test` — PASS (43 files, 689/689 tests)

## Notes

- Merge was clean (feature branch was cut from prototype HEAD `8351391`;
  no conflicts).
- No push performed; `prototype` and `feat/m3-registration-paths` remain
  local-ahead of origin.
- Next branch cut: `feat/m4-website-blocks` from `prototype`.
