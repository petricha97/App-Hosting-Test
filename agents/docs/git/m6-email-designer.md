# Merge Log — M6-T4 Email Designer via Shared Block Engine

- **Date:** 2026-07-16
- **Feature branch:** `feat/m6-t4-email-designer`
- **Target branch:** `prototype`
- **Merge commit:** `82faa8e` — `merge(m6-t4): shared block engine email designer`
- **Merge base (origin/prototype before merge):** `157aa38`

## Branch provenance (deviation from standard flow)

All of M6-T4's implementation work (the block engine, the Puck-based
designer UI, the render-pipeline wiring, and both fix cycles) was carried
out directly in the working tree while already checked out on `prototype`
— no `feat/m6-t4-email-designer` branch existed until the GitHub Agent
created one at merge time. This is the identical situation to the
M6-T2/M6-T3 precedents (`agents/docs/git/m6-emails-admin.md`,
`agents/docs/git/m6-lifecycle-triggers.md`). `feat/m6-t4-email-designer`
was cut via `git checkout -b feat/m6-t4-email-designer` from that
working-tree state (62 uncommitted/untracked entries, verified with `git
status --porcelain` before and after the checkout — output byte-identical,
confirming nothing was lost or altered), then the ticket's work was staged
and committed as a single commit on the new branch. `HANDOVER.md`,
`agents/docs/BACKLOG.md`, and `memory/` were excluded from that commit
(orchestration bookkeeping, same convention as every prior M6 ticket) and
instead committed separately on `prototype` after the merge (`memory/` was
left untracked entirely, per the loop convention of not versioning agent
scratch memory).

## Tickets landed

M6-T4 (email designer via shared block engine: 8 organizer-authorable
block types — Hero, Story, Highlights, Schedule, FAQ, CountdownTimer,
TicketPricingTable, RegistrationEmbed — rendered through a type-allowlisted,
escape-then-substitute pipeline; Puck-based visual designer with a mode
toggle between block-designer and legacy plain-text editing; merge-tag
menu integration; canvas disclaimer), including two fix cycles: Code
Review B-1 (Blocker) and QA QA-D-2 (Major defect).

## M6-T4 commits

| Hash | Message |
|------|---------|
| `8f3a441` | feat(email): shared block engine email designer (M6-T4) |
| `82faa8e` | merge(m6-t4): shared block engine email designer |
| `5363fbd` | docs(loop): M6-T4 gate artifacts and handover update — M6 milestone complete |

## Files (feature commit `8f3a441`)

72 files changed, 8120 insertions(+), 204 deletions(-). Notable additions:

- Block engine core: `src/features/emails/server/blocks/{countdown-timer,
  faq,hero,highlights,image-utils,index,registration-embed,schedule,story,
  styles,text-utils,ticket-pricing-table,types,url-validator}.ts` — type
  allowlist, escape-then-substitute rendering, URL-scheme validation as a
  control separate from escaping, zero free-text CSS (spec §3.1)
- Render-context resolver (Code Review B-1 fix): `src/features/emails/
  server/resolve-block-context.ts` — `resolveEmailBlockRenderContext`,
  wired into all 7 real production call sites (`fire-on-accept-email.ts`,
  `fire-on-submit-email.ts`, `resolve-definition.ts`, the preview/test-send
  API routes, the "email all" drafts route, and the emails page) so
  `RegistrationEmbed`/`TicketPricingTable`/`CountdownTimer` get live
  pricing/registration/countdown data instead of always rendering empty
  fallback state
- Absolute-origin resolver (header-trust fix, caught by the implementing
  agent before Code Review saw it): `src/lib/email/base-url.ts` —
  `resolveEmailBaseUrl` derives the origin strictly from
  `NEXT_PUBLIC_APP_URL` (deploy-time config, read by name only, never a
  hardcoded value) and never from client-controlled `Host`/
  `X-Forwarded-Host` request headers
- Designer UI: `src/features/emails/components/{email-block-designer,
  email-block-field-note,email-canvas-disclaimer,
  email-definition-picker-menu,email-editor-mode-toggle,
  email-puck-config}.tsx` (new), plus modified `email-editor-dialog.tsx`,
  `emails-workspace.tsx`, `merge-tag-menu.tsx`, `email-editor-test-send.tsx`
- Dark-mode document wrapper (QA-D-2 fix): `wrapEmailBodyHtmlDocument` in
  `src/features/emails/server/render.ts`, applied at the single chokepoint
  every real send/preview path already shares
- Schema/type additions: `src/lib/email/schemas.ts` (block schemas),
  `src/features/emails/schemas.ts`, `src/types/collection.ts`,
  `src/features/emails/types.ts`, `src/lib/db/adminEmailDefinition.ts`
- Lifecycle files extended (already shipped in M6-T3, now consuming the new
  render context): `src/lib/email/lifecycle/{evaluate-abandoned,
  evaluate-event,evaluate-scheduled,evaluate-unpaid-offsets,
  paged-trigger-runner}.ts`
- Test infra: `vitest.config.mts`, `src/__tests__/stubs/
  resize-observer-setup.ts`
- Docs: `agents/docs/{specs,design,data-models,reviews,security,qa}/
  m6-email-designer.md`
- Tests: 11 new test files + 8 modified, incl. block-renderer tests,
  boundary/source-safety tests, render-context tests, base-url tests,
  dark-mode meta tests, definition-picker-menu interaction tests, and the
  full render-blocks pipeline test

Excluded from this commit (committed separately on `prototype` in
`5363fbd`, or left untracked): `HANDOVER.md`, `agents/docs/BACKLOG.md`,
`memory/`.

## Gate status at merge time

- **Code Review:** APPROVED. Initial pass found 0 Should-fix, 1 Blocker
  (B-1: the live pricing/registration/countdown data 3 of the 8 shipped
  blocks need was never wired at any of the 7 real production call sites —
  only in unit tests — so `RegistrationEmbed`/`TicketPricingTable`/
  `CountdownTimer` always rendered empty fallback state everywhere in the
  actual product). Fixed (new `resolveEmailBlockRenderContext` shared
  helper, wired at all 7 sites) and re-reviewed APPROVED — the fix's own
  implementing agent additionally caught and fixed a self-introduced
  header-trust vulnerability (an early draft would have derived the
  embedded email link's origin from client-controlled `Host`/
  `X-Forwarded-Host` request headers — a phishing vector) before Code
  Review ever saw it (`agents/docs/reviews/m6-email-designer.md`).
- **Security:** PASS, 0 findings of any severity — a genuinely exceptional
  result for the first ticket introducing organizer-authored HTML
  structure into this app's email system. All 5 of spec §3.1's
  render-pipeline controls (type allowlist, escape-then-substitute,
  URL-scheme validation as a control separate from escaping, zero
  free-text CSS, unmodified merge-tag substitution) independently
  re-derived from source across 3 separate review passes (implementer,
  Code Review, Security), including a third independent confirmation that
  the header-trust fix was genuinely complete
  (`agents/docs/security/m6-email-designer.md`).
- **QA:** SIGNED OFF after one fix cycle. Found 1 Major defect (QA-D-2: no
  HTML document wrapper existed anywhere in the render pipeline — for
  either authoring mode — so spec §6 AC-2's required dark-mode `<meta>`
  tags were never declared; this predated M6-T4 entirely, going back to
  T1/T2's plain-text emails, but M6-T4 was the first ticket to make it an
  explicit, tested acceptance criterion). Fixed (`wrapEmailBodyHtmlDocument`
  in `render.ts`, applied at the single chokepoint every real send/preview
  path already shares) and re-verified SIGNED OFF. Client-rendering matrix
  (spec §6, real Outlook/Gmail/Apple Mail testing) honestly disclosed as
  untestable in this environment throughout — structural HTML-safety
  checks (table-based, inline styles, no flexbox/grid, absolute URLs,
  Gmail clipping threshold) done instead and clearly labeled as such, never
  conflated with real client verification (`agents/docs/qa/m6-email-designer.md`).
- **Checks (Orchestrator, final working tree):** lint clean, build exit 0,
  `npm test -- --run` 120 files / 1471 tests passing.
- **Secret scan of staged diffs before commit:** clean — grepped
  `git diff --cached` for API key/secret/password/token/private-key
  patterns across all new/modified files (no hits); confirmed no `.env*`
  file appeared in the staged diff or `git status`; confirmed
  `src/lib/email/base-url.ts` reads `NEXT_PUBLIC_APP_URL` by name only via
  `process.env`, never a hardcoded value.

## Pre-merge smoke check (on `feat/m6-t4-email-designer`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Post-merge smoke check (on `prototype`)

- `npm run lint` — PASS (no ESLint warnings or errors, exit 0)
- `npm run build` — PASS (exit 0)

## Conflicts

None. Merge made by the `ort` strategy with no conflicts.

## M6 milestone closure

This merge completes the M6 (Communications/Emails) milestone: M6-T1
(email infrastructure — transport, outbox, merge tags), M6-T2 (emails
admin screen — definitions, sender settings, send log), M6-T3 (lifecycle
triggers & audience segmentation), M6-T4 (email designer via shared block
engine) — all Done, all merged to `prototype`. Per explicit user
instruction, work stops here; M7 (Reporting) is next in the roadmap but
not started (see `agents/docs/BACKLOG.md`).

## Push results

- `feat/m6-t4-email-designer` pushed: new branch → `8f3a441`
- `prototype` pushed: `157aa38..82faa8e` (merge), then a follow-up push for
  `82faa8e..5363fbd` (docs bookkeeping commit)
- `main` untouched throughout (verified via `git branch --show-current`
  before every commit/merge/push; no git command targeted `main`).
