# Code Review — M6-T4 Email designer via shared block engine

Code Reviewer, 2026-07-16. Scope: all uncommitted changes in the working
tree relative to `prototype` that belong to M6-T4 — new
`src/features/emails/server/blocks/**` (8 block renderers + `url-validator`,
`image-utils`, `text-utils`, `styles`, `types`, `index`), new
`src/features/emails/components/{email-block-designer,email-canvas-disclaimer,
email-block-field-note,email-definition-picker-menu,email-editor-mode-toggle,
email-puck-config}.tsx`, modified `email-editor-dialog.tsx`,
`emails-workspace.tsx`, `merge-tag-menu.tsx`, `src/features/emails/server/
render.ts`, `src/lib/email/schemas.ts`, `src/types/collection.ts`,
`src/lib/db/adminEmailDefinition.ts`, `src/features/emails/{schemas,types,
default-definitions}.ts`, `src/features/emails/server/{fire-on-accept-email,
fire-on-submit-email,resolve-definition}.ts`, the preview/test-send/
email-all API routes, the emails dashboard page, `src/lib/email/lifecycle/
{evaluate-abandoned,evaluate-event,evaluate-scheduled,evaluate-unpaid-offsets,
paged-trigger-runner}.ts` (M6-T3 code touched outside either agent's
originally-assigned scope), `vitest.config.mts`, and all new/modified test
files. Reviewed against `agents/docs/specs/m6-email-designer.md`,
`agents/docs/design/m6-email-designer.md`, `agents/docs/data-models/
m6-email-designer.md`, and `agents/AGENT_LOOP.md`'s Code Reviewer checklist.
(`HANDOVER.md`, `agents/docs/BACKLOG.md`, `memory/` excluded — orchestration
bookkeeping, not code, matching prior review precedent.)

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the same
  pre-existing, unrelated baseline errors seen at the M6-T3 review
  (`attendees-roster.test.ts:106/160/221`, `event-org-scoping.test.ts:
  152-154`, `register-route.test.ts:62`) — verified these are outside the
  M6-T4 diff and match the expected baseline exactly (same files, same
  cause, same line numbers as M6-T3's review logged).
- `npm run build` — PASS, exit 0; `/dashboard/events/[eventId]/emails` and
  every API route (including `/api/internal/email-triggers/evaluate`)
  compile and appear in the route manifest.
- `npm test -- --run` — PASS, **116 files / 1435 tests passing**, matching
  the Orchestrator's reported numbers exactly.

---

## Mandatory-check results

1. **DAL boundary — PASS.** `grep -rn "firebase-admin/firestore\|firebase/
   firestore\|@/app/lib/firestore"` across `src/features/emails/**` and the
   touched API routes returns zero hits. `src/features/emails/server/
   blocks/*` receives all contextual data (`EmailBlockRenderContext`) via
   function arguments only, never fetches itself — confirmed both by direct
   read and by the new `email-block-renderer-boundary.test.ts`, which scans
   every module in the directory for a Firestore import, a `"use client"`
   web-registry import, and a missing `"server-only"` directive.

2. **Render-pipeline security controls (spec §3.1, all 5) — PASS, verified
   directly against source, not trusted from comments.**
   - **Control 1 (type allowlist)** — `isEmailSafeBlockType`
     (`src/features/emails/server/blocks/index.ts:52-56`) backs both the
     write-time Zod discriminated union (`src/lib/email/schemas.ts`) and the
     render-time re-check; `deriveBodyHtmlFromBlocks`/
     `deriveBodyTextFromBlocks` (`render.ts:49-76`) both `.filter()` before
     dispatch. An unknown type contributes nothing, never throws — locked by
     `email-render-blocks-pipeline.test.ts:56-86` (mixed known/unknown list,
     unknown block's own prop values never leak into the output) and
     `email-block-renderers.test.ts:470-481`.
   - **Control 2 (per-prop schema, re-run at render time)** — every one of
     the 8 renderers reads free text through `shortText`/`longText`/
     `escapedShortText`/`escapedLongText` (`text-utils.ts:21-47`), which
     coerce non-strings to `""` and re-clamp to the same character tiers the
     write-time schema enforces — genuine re-validation, not a trust-and-
     pass-through. Every URL prop goes through `safeImageUrl`
     (`image-utils.ts:16-23`), which re-runs `isEmailSafeUrl` and drops
     (never passes through) an unsafe value.
   - **Control 3 (URL scheme is a separate control from escaping)** —
     `isEmailSafeUrl` (`src/lib/email/schemas.ts:29-46`, re-exported
     verbatim by `blocks/url-validator.ts`) is an explicit `http:`/`https:`
     allowlist via `new URL()` with no base argument (relative paths throw
     by construction) plus an explicit `startsWith("//")` reject for
     protocol-relative URLs. This is a genuinely separate check from
     `escapeHtml` — confirmed by reading both call sites (`hero.ts:20`,
     `story.ts:16`, `registration-embed.ts:63`): a `javascript:` value never
     reaches an `src=`/`href=` attribute regardless of escaping. Exhaustively
     tested (`email-block-schemas.test.ts:138-159`, `email-block-renderers.
     test.ts:189-241` for both Hero and Story, `:341-347` for
     RegistrationEmbed's caller-supplied-but-still-revalidated
     `registerHref`).
   - **Control 4 (no free-text `style=` attribute, ever)** — verified two
     ways: a runtime check (`story.ts`'s "never a 2-column layout" assertion,
     `email-block-renderers.test.ts:290-303`) and a genuine **source-level**
     scan, `email-block-renderer-source-safety.test.ts`, which regexes every
     `style="..."` attribute in every block-renderer `.ts` file and asserts
     every `${...}` interpolation inside it resolves to `EMAIL_BLOCK_COLORS.*`
     only (`src/features/emails/server/blocks/styles.ts`'s fixed,
     code-authored color table) — I independently re-read all 8 renderer
     files end-to-end and confirm every `style="` construction in fact only
     interpolates `EMAIL_BLOCK_COLORS.*` constants; the two enum props that
     exist (`imageSide`, `target`) are read via plain `===` comparisons that
     select HTML fragments or booleans, never a style string.
   - **Control 5 (`renderEmailTemplate` genuinely unmodified, AC-6)** — I
     independently ran `shasum -a 256 src/lib/email/merge-tags.ts` and it
     matches the hash `email-render-blocks-pipeline.test.ts:334-336` pins
     (`e33eadb...aefdef86`) exactly — this is a real tripwire, not an
     aspirational comment. `git diff -- src/lib/email/merge-tags.ts` is
     empty, confirming zero lines changed.
   - No block renderer emits `<script>`/`<iframe>`/`<object>`/`<embed>`/
     `<style>` or an `on*=` attribute anywhere — confirmed by direct read of
     all 8 files; the only place any of those substrings could plausibly
     appear (a `<form>` in RegistrationEmbed) is absent in all three of its
     branches (open/closed/zero-paths) — grepped and confirmed no `<form`
     substring exists anywhere under `src/features/emails/server/blocks/`.

3. **XSS test suite exhaustiveness claim — VERIFIED, not spot-checked.**
   `email-block-renderers.test.ts` runs all 3 XSS payloads (`<script>`, `<img
   onerror>`, `"><svg onload>`) against every text-bearing prop of every one
   of the 8 blocks (Hero's 3 text fields + both CTA labels, Highlights' 8,
   Story's 2, Schedule's 2, Faq's 7, RegistrationEmbed's 3 across all 3
   context branches, TicketPricingTable's 3, CountdownTimer's 2) — 24
   sub-tests × 3 payloads = 72 assertions, plus a meta-test
   (`:174-186`) that fails the suite if a block type is silently missing
   from the covered list, comparing against `EMAIL_SAFE_BLOCK_TYPES`
   directly. `expectPayloadEscaped` (`:57-63`) asserts both the *absence* of
   the raw payload/its dangerous substrings (`<script>`, `<svg `, `onerror=`)
   **and** the *presence* of `escapeHtml(payload)`'s exact output — a real,
   non-tautological check, not "the string changed somehow."

4. **RegistrationEmbed's form-exclusion — PASS, all 3 branches, verified by
   direct read.** `registration-embed.ts:47-94`: the "open" branch renders a
   table + `<a href>` bulletproof button; "closed" renders a disabled `<span>`
   + static text; the fallback (context null/undefined, or an "open" context
   whose `registerHref` fails URL-scheme validation) renders the
   `{event_url}`-pointing static notice. No `<form` substring anywhere in the
   file (confirmed by direct read and by grep across the whole `blocks/`
   directory). Locked by `email-block-renderers.test.ts:305-348`, which
   explicitly asserts `expect(html).not.toContain("<form")` on all 3 real
   branches plus the defensive "open-but-unsafe-href" 4th case.

5. **Hero's CTA-label omission (spec §1 AC-3) — PASS.** `hero.ts:13-38` never
   reads `props.primaryCtaLabel`/`props.secondaryCtaLabel` at all (confirmed
   by direct read — the only props read are `eyebrow`, `heading`, `body`,
   `imageUrl`). Locked by a dedicated round-trip test using unique token
   strings (`email-block-renderers.test.ts:243-258`) that would fail if
   either label leaked into the output by any path, plus the write-time Zod
   schema (`emailHeroBlockPropsSchema`) still storing both fields for
   round-trip persistence, as the spec requires.

6. **`paged-trigger-runner.ts` change (M6-T3 safety-critical code, touched
   outside either agent's assigned scope) — PASS, correct, and does not
   regress any M6-T3 guarantee.** The stated reasoning ("the spec assumed all
   trigger paths call `renderEmailDefinitionPreview`, but this file actually
   called the lower-level `deriveBodyHtmlTemplate` directly") is accurate —
   confirmed by reading the pre-diff code (`deriveBodyHtmlTemplate` imported
   directly, `bodyText: input.template.body` passed as the literal plain-text
   body). The fix replaces this with `deriveBodyForDefinition`, which:
   - Reproduces **byte-for-byte identical** behavior for the pre-existing
     text-mode call sites: `deriveBodyForDefinition({body})` returns
     `{bodyHtml: deriveBodyHtmlTemplate(body), bodyText: body}` — the exact
     same pair the old code computed inline (`render.ts:102-126`), and this
     specific equivalence is locked by a dedicated test
     (`email-render-blocks-pipeline.test.ts:95-99`).
   - Correctly generalizes the `{qr_code}`-usage pre-check
     (`templateUsesQrCode`, `qr.ts:19-27`, unchanged): the new code checks it
     against the **derived** `bodyText` (`paged-trigger-runner.ts:104-110`)
     rather than the raw `input.template.body` — for text mode these are
     identical (verified above), and for block mode `bodyText` is the
     `deriveBodyTextFromBlocks` walk of block props, which genuinely
     contains `{qr_code}` if any block's text field embeds it (spec §3.3),
     so the pre-check's accuracy is preserved rather than silently broken
     for a block-designed periodic email.
   - Derives `bodyHtml`/`bodyText` **once per tick**, before the page loop
     (`paged-trigger-runner.ts:98`), not once per recipient — correct, since
     the assembled HTML/text is identical for every recipient in the tick;
     only per-recipient merge-tag substitution differs, which
     `sendEventEmailBatch` still applies downstream, unchanged.
   - Does not touch dedupe-key derivation, the `enabled` re-check placement
     (still per-page, `paged-trigger-runner.ts` unchanged elsewhere), or
     failure-isolation — `evaluate-abandoned.ts`/`evaluate-event.ts`/
     `evaluate-scheduled.ts`/`evaluate-unpaid-offsets.ts` are touched only to
     thread `bodyMode`/`bodyBlocks` through as new, optional fields on
     existing interfaces (confirmed via `git diff`, each hunk is additive).
     `lifecycle-paged-trigger-runner.test.ts` (unmodified by this diff)
     continues to pass unchanged, confirming the M6-T3 enabled-re-check-per-
     page and interrupted/resumed dedupe guarantees still hold.

7. **`vitest.config.mts` change — PASS, genuinely additive/no-op.** The new
   `setupFiles: ['./src/__tests__/stubs/resize-observer-setup.ts']` entry
   only defines `globalThis.ResizeObserver` **if it is not already defined**
   (`resize-observer-setup.ts:21-24`, an `if (typeof ... === "undefined")`
   guard) — it can never override a test file's own `vi.stubGlobal`
   (per-file stubs run later and simply reassign the global, which this
   guard neither prevents nor conflicts with). The stated reason (`@dnd-kit/
   dom`, a transitive `@measured/puck` dependency, touches `ResizeObserver`
   at ES-module-top-level import time, before any test file's own top-level
   `vi.stubGlobal` statement can execute, because imports are hoisted ahead
   of a module's own statements) is a real, well-known jsdom/Vitest ordering
   issue, not a plausible-sounding but incorrect claim. Confirmed empirically:
   full suite (116 files / 1435 tests, including every pre-existing Radix-
   `Switch`-using suite that already had its own local stub) passes with no
   new failures or ResizeObserver-related errors.

8. **Types / structure / duplication — PASS.** No unjustified `any` found
   (`grep -rn ": any\b\|as any\b"` across the new/modified email files
   returns nothing beyond pre-existing, unrelated hits). Every new file is
   comfortably under the 800-line cap — the largest new/modified file is
   `email-editor-dialog.tsx` at 689 lines (already split once during M6-T2's
   review; this ticket's additions did not push it back over the cap), and
   every new `server/blocks/*` file is under 140 lines with one clear
   responsibility. `EMAIL_SAFE_BLOCK_TYPES` is declared once
   (`src/types/collection.ts`) and referenced by the write-time schema and
   the render-time re-check — no hand-duplicated allowlist. One
   documentation/implementation mismatch, not a functional issue: the
   data-model doc claims the client-side type layer
   (`src/features/emails/types.ts`) "independently re-declares the same 8
   string literals... not import-shared," but the actual code
   (`types.ts:5-20`) imports `EMAIL_SAFE_BLOCK_TYPES`/`EmailPuckBlock`/
   `EmailSafeBlockType` directly from `@/types/collection` and re-exports
   them — this is actually *better* (single source of truth, zero drift
   risk) than what the doc describes, and is safe (the only runtime import
   from `collection.ts` is a small string-literal array; the file's only
   other import is `import type { Timestamp, FieldValue } from
   "firebase/firestore"`, erased at compile time, so nothing Firebase-shaped
   reaches the client bundle) — flagged as a doc-accuracy nit only (N-1
   below), not a code defect.

9. **Tests assert real behavior — PASS.** Every new suite reviewed
   (`email-block-renderers`, `email-block-renderer-source-safety`,
   `email-block-renderer-boundary`, `email-render-blocks-pipeline`,
   `email-block-schemas`, `admin-email-definition-body-blocks`,
   `email-definition-picker-menu`, plus the extended
   `email-editor-dialog-interactions`/`email-lifecycle-tab-interactions`)
   asserts real rendered-HTML content, real Zod parse results, real stored
   Firestore-fake state, and real DOM/ARIA state — not snapshots of nothing.
   The empty-canvas Test-send-disabled-but-Save-enabled behavior (design §5)
   and the mode-toggle dirty-tracking regression (the exact QA-D-1 bug class
   from M6-T2) both have dedicated, correctly-asserting tests in
   `email-editor-dialog-interactions.test.tsx:292-364`.

**Data-model doc vs. code:** accurate throughout except the one client-type
re-declaration claim noted in item 8 (N-1) — schema shapes, size caps
(20 blocks / 48 KB / unchanged 256 KB rendered / unchanged 64 KB text),
editable-field bucket placement, and the `deriveBodyForDefinition` branch
design all match the code exactly on direct read.

---

## Findings

### Blockers

- **B-1 — `EmailBlockRenderContext` (the live registration-path/pricing/
  countdown data three of the eight shipped blocks need) is never wired at
  *any* real call site — RegistrationEmbed, TicketPricingTable, and
  CountdownTimer's default `eventStart` target are non-functional with real
  event data everywhere in the product today.** Confirmed by exhaustive
  grep (`grep -rn "blockContext\|registrationCta:\|pricing:\|countdown:"`
  across `src/features/emails/server/`, the emails API routes, and the
  emails dashboard page): the only places an `EmailBlockRenderContext`
  value is ever constructed are the block-renderer unit tests
  (`email-block-renderers.test.ts`) — never the real call sites. Every one
  of the seven production consumers of `deriveBodyForDefinition`/
  `renderEmailDefinitionPreview` calls it with **no third argument**:
  - `src/app/api/dashboard/events/[eventId]/emails/preview/route.ts:79-84`
    (the editor's own live preview, and — per spec §3.2 — now the
    genuinely load-bearing "authoritative" surface an organizer is told to
    trust over the canvas)
  - `src/app/api/dashboard/events/[eventId]/emails/test-send/route.ts:118`
  - `src/app/dashboard/(event)/events/[eventId]/emails/page.tsx:134-140`
    (the confirmation-preview card)
  - `src/features/emails/server/fire-on-submit-email.ts:69`,
    `fire-on-accept-email.ts:99` (real-time triggers)
  - `src/lib/email/lifecycle/paged-trigger-runner.ts:98` (periodic triggers)
  - `src/app/api/dashboard/events/[eventId]/drafts/email-all/route.ts:137`

  Consequently, **in every real render path**: `RegistrationEmbed` always
  falls through to its "0 paths ever configured" static notice
  (`registration-embed.ts:81-93`) regardless of whether the event actually
  has active registration paths — an organizer who builds a working
  registration CTA block, previews it, test-sends it, or lets it fire for
  real, will see (and recipients will receive) "Registration isn't set up
  on this page yet," never the real button, even for an event with fully
  live registration. `TicketPricingTable` always renders its empty-state
  message (`ticket-pricing-table.ts:57-60`) regardless of real ticket/fee
  data. `CountdownTimer`'s `target: "eventStart"` (the field's own default,
  `schemas.ts`'s `EMAIL_COUNTDOWN_TARGETS`) always resolves `eventStartIso`
  to `null` and therefore always renders `completedMessage`
  (`countdown-timer.ts:59-67`) — only the `target: "custom"` variant (which
  needs no context) actually functions today.

  This is not a security defect — every fallback is honest, non-crashing,
  and exactly matches each block's documented "context absent" behavior
  (spec §1's own framing: "never a broken render"). It is also explicitly
  self-disclosed by Backend in `agents/docs/data-models/m6-email-designer.md`
  ("Live-data wiring... is NOT part of this slice... FS/integration work
  built on top") — but the Full-Stack slice, which owns every one of the
  seven call sites above, did not close it either, and nothing in
  `agents/docs/BACKLOG.md` or the spec's Open Questions records this as a
  deliberately deferred follow-up ticket (unlike, e.g., `CallToAction`'s
  exclusion or the countdown-GIF OQ-3, both of which *are* explicitly
  scoped out with their own reasoning). The Orchestrator's own HANDOVER.md
  deep-verification pass of the security-critical renderer code did not
  catch this gap either.

  Impact beyond "the feature under-delivers": this also pre-emptively fails
  a QA acceptance criterion this ticket assigns to QA (spec §6 AC-1: "a
  representative block-mode email (mixing at least Hero, Highlights/Story,
  **RegistrationEmbed-open**, TicketPricingTable, CountdownTimer) is
  manually verified...") — QA cannot produce a "RegistrationEmbed-open"
  real send today, because no code path can ever construct a `state: "open"`
  context. **Recommend returning to Full-Stack** to wire real
  `registrationCta`/`pricing`/`countdown` data (the same projections the
  M4 web page builder's `createEventPagePuckConfig` callers already
  assemble — `registrationCta`/`pricingTickets`/`countdown` — for at least
  the preview and test-send routes, ideally all seven call sites, or a
  narrower explicitly-scoped subset with the rest tracked as a named
  follow-up ticket in BACKLOG.md rather than left silently unaddressed).

### Should-fix (fix in this ticket)

None beyond closing B-1 — no other should-fix-level issues found.

### Nits (optional)

- **N-1** — `agents/docs/data-models/m6-email-designer.md`'s claim that
  `src/features/emails/types.ts` "independently re-declares" the 8-entry
  block-type allowlist "not import-shared" is inaccurate: the actual code
  (`src/features/emails/types.ts:5-20`) imports `EMAIL_SAFE_BLOCK_TYPES`
  directly from `@/types/collection` and re-exports it. This is a safe,
  arguably better choice (single source of truth, no duplication-drift
  risk — the only runtime-relevant import from `collection.ts` is the small
  string array itself; the file's other import is `import type {
  Timestamp, FieldValue } from "firebase/firestore"`, fully erased at
  compile time) but the doc should be corrected to describe what was
  actually built, so a future reader doesn't go looking for a second,
  independently-maintained list that doesn't exist.
- **N-2** — `registration-embed.ts:81-93`'s defensive fallback (an "open"
  context whose `registerHref` fails URL-scheme validation) renders the
  "0 paths ever configured" copy ("Registration isn't set up on this page
  yet") rather than the "closed" copy ("Registration is currently closed").
  Cosmetically slightly misleading if this branch is ever actually reached
  in production (it shouldn't be, since `registerHref` is caller-supplied,
  not organizer-typed — this is belt-and-suspenders, per the file's own
  comment), but worth a one-line copy fix (route this case to the "closed"
  message instead) whenever B-1's wiring work touches this file next.
- **N-3** — `EmailEditorTestSendButton`'s new `disabledReason` prop
  (`email-editor-test-send.tsx`) correctly composes with the existing
  `!enabled` disable reason (enabled-check wins, matching the pre-T4
  behavior byte-for-byte when `disabledReason` is omitted) — no issue, just
  noting this was verified rather than assumed, since it's exactly the kind
  of two-independent-disable-reasons composition that's easy to get subtly
  wrong (e.g. losing one message when both conditions are true
  simultaneously — confirmed it can't happen here, since an `!enabled`
  definition can't simultaneously be in `isBlocksMode` with an empty canvas
  in a way that matters, and the code checks `!enabled` first regardless).

---

## Verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M6-T4 — Email designer via shared block engine | **CHANGES REQUESTED** | One Blocker (B-1): the block-render context (registration CTA state, ticket pricing, countdown target) that `RegistrationEmbed`/`TicketPricingTable`/`CountdownTimer` need is never wired at any of the seven real call sites (preview, test-send, confirmation-preview card, both real-time triggers, the periodic trigger runner, "Email all") — three of the eight shipped blocks render only their honest-but-non-functional fallback state in every real preview/test-send/live send today, and this also blocks QA from exercising spec §6 AC-1's required "RegistrationEmbed-open" client-matrix case. Everything else in this ticket is excellent: all 5 of spec §3.1's render-pipeline security controls are genuinely present and independently verified in every one of the 8 block renderers (not spot-checked) — type allowlist, per-prop re-validation, URL-scheme validation as a separate control from escaping, zero free-text `style=` attributes (both source-scanned and runtime-tested), and a hash-pinned, confirmed-unmodified `renderEmailTemplate`; the XSS test suite is genuinely exhaustive (every payload × every text prop × all 8 blocks, with a meta-test against silent coverage gaps); `RegistrationEmbed` never emits a `<form>` in any of its 3 branches; Hero's CTA labels are proven round-trip-storage-only; the `paged-trigger-runner.ts` change is correct, well-reasoned, and does not regress any M6-T3 guarantee (byte-for-byte-identical text-mode behavior, correctly generalized `{qr_code}` pre-check, unchanged per-page `enabled` re-check and dedupe discipline); the `vitest.config.mts` change is genuinely additive/no-op, confirmed both by reading the guard and by the full suite passing. DAL boundary, file sizes, naming, and test quality are all clean. |

**Not yet approved — returning to Full-Stack to close B-1** (wire real
`EmailBlockRenderContext` data at least at the preview/test-send call sites,
or explicitly scope a subset into this ticket with the remainder recorded
as a named BACKLOG follow-up, rather than left silently unaddressed).
Re-review requested once B-1 is closed; the security-critical render-pipeline
code (§3.1's 5 controls) is already verified and should not need re-review
unless the wiring work touches the block renderers themselves (it shouldn't
need to — `EmailBlockRenderContext` is already a stable, well-designed seam
for exactly this follow-up work).

---

## Re-review — B-1 fix verification

Code Reviewer, 2026-07-16. Scope, per this loop's re-entry convention: **only
the B-1 fix diff** — the two new files (`src/features/emails/server/
resolve-block-context.ts`, `src/lib/email/base-url.ts`), the wiring at each
of the 7 call sites named in the original B-1 finding, the additive change
to `paged-trigger-runner.ts`, and the new/extended tests
(`email-block-render-context.test.ts`, `email-base-url.test.ts`,
`email-preview-route.test.ts`, and the extended `email-all-route`,
`email-test-send-route`, `email-lifecycle-on-accept`,
`email-lifecycle-on-submit`, `lifecycle-paged-trigger-runner` suites). The
block renderers, dialog UI, and everything else already approved above was
**not** re-read for new issues, only spot-confirmed unchanged (`server/
blocks/*`, `email-editor-dialog.tsx`, etc. — no diff exists to review since
this working tree has no intervening commit; confirmed via direct read that
`render.ts`'s `deriveBodyForDefinition`/`renderEmailDefinitionPreview`
signatures and the 8 block renderers are identical to what was already
verified).

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the exact same
  pre-existing baseline errors as the first review pass, same 3 files, same
  line numbers (`attendees-roster.test.ts:106/160/221`,
  `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62`) —
  confirmed unrelated to this diff.
- `npm run build` — PASS, exit 0; `/dashboard/events/[eventId]/emails` and
  every touched API route compile and appear in the route manifest.
- `npm test -- --run` — PASS, **119 files / 1463 tests passing** (up from
  116/1435 at the first review pass — the delta is exactly the new/extended
  B-1 test coverage: `email-block-render-context.test.ts` (new),
  `email-base-url.test.ts` (new), `email-preview-route.test.ts` (new), plus
  extended assertions in the 5 modified suites listed above).

### B-1 fix verification

1. **`resolve-block-context.ts` (`src/features/emails/server/
   resolve-block-context.ts`) — PASS, reviewed in full.**
   - **Never throws** — verified structurally, not just by comment: every
     one of the three sub-resolvers (`resolvePricing:68-80`,
     `resolveRegistrationCta:89-137`, `resolveCountdown:141-151`, the last
     of which is pure/synchronous and cannot throw on its own inputs) is
     individually wrapped in its own `try/catch` that logs and degrades to
     `null`/an empty branch, **and** the outer `resolveEmailBlockRenderContext`
     (`153-185`) wraps the whole body in one more `try/catch` that returns
     `EMPTY_EMAIL_BLOCK_RENDER_CONTEXT` on any escape — a genuine
     belt-and-suspenders double guard, not a single point of failure. The
     `getAdminEventForOrganization` call additionally has its own inline
     `.catch()` (`158-163`) so an event-lookup failure degrades exactly like
     "event not found" rather than rejecting the `Promise.all`. Even the
     logger itself (`logResolutionError:53-66`) is wrapped so a
     misbehaving `console.error` override can't defeat the "never throw"
     contract. Locked by `email-block-render-context.test.ts`'s "never
     throws" describe block (`:261-282`, every sub-resolution rejecting
     simultaneously still resolves, never rejects) plus one dedicated test
     per individual failure mode (pricing-throws, paths/form-throws,
     event-throws) each asserting the *other* two fields still resolve
     correctly — real cross-field isolation, not just "doesn't throw."
   - **Resolved once per call, not per-recipient** — confirmed structurally:
     the function takes a single `{eventId, organizationId}` and returns one
     `EmailBlockRenderContext`; every one of the 7 call sites (verified
     individually below) calls it exactly once, before any per-recipient
     loop, and threads the single resolved value into `deriveBodyForDefinition`
     once. `paged-trigger-runner.ts:111` and the `email-all/route.ts:141`
     batch call resolve it once per tick/batch, matching the pre-existing
     `bodyHtml`/`bodyText` snapshot semantics exactly (same call shape the
     first review pass already verified for those two derivations). Locked
     by `lifecycle-paged-trigger-runner.test.ts:270-329`'s dedicated test and
     `email-all-route.test.ts:337` (`toHaveBeenCalledTimes(1)`).
   - **Reuses the existing web-page registration-CTA logic, not a
     reimplementation** — `resolveRegistrationCta` (`:89-137`) imports and
     calls the actual `resolveRegistrationCtaState` from
     `@/features/event-pages/registration-state` (`:29`), the same function
     `src/app/events/[eventId]/page.tsx:108-112` calls, with the identical
     three inputs (`hasPublishedForm`, `totalPaths`, `activePaths`) computed
     the identical way (`getAdminPublishedFormForPublicEvent` +
     `getAdminRegistrationPathsForEvent`, filtered by `.isActive`) —
     confirmed by direct side-by-side read of both files, not assumed from
     the comment. The only genuine divergence is `registerHref`: the web
     page can emit a site-relative path, this module must emit an absolute
     URL (via `resolveEmailBaseUrl()`) because `isEmailSafeUrl` (spec §3.1
     control 3) rejects relative/protocol-relative URLs by construction —
     documented inline (`:9-10`, `:87-88`) and correct.
   - **Tenancy scoping — PASS, every DAL call carries both `eventId` and
     `organizationId`.** `getAdminEventForOrganization(eventId,
     organizationId)` (`:158`, org-membership re-checked post-fetch inside
     the DAL function itself — confirmed by reading
     `src/lib/db/adminEvent.ts:56-70`, `eventBelongsToOrganization` gates the
     return); `listPublicTicketsForEvent({eventId, organizationId})`
     (`:72-75`); `getAdminPublishedFormForPublicEvent({eventId, eventName,
     organizationId, formPath})` (`:96-101`, identical call shape to the
     public page's own use); `getAdminRegistrationPathsForEvent({eventId,
     organizationId})` (`:102-105`, both fields are literal Firestore
     `.where()` clauses — confirmed by reading
     `src/lib/db/adminRegistrationPath.ts:58-63`). No DAL call in this file
     omits either field. `resolveEmailBaseUrl()` correctly takes no
     org/event-scoped input at all (it resolves a single deploy-wide origin,
     not tenant data).

2. **`base-url.ts` (`src/lib/email/base-url.ts`) — PASS, the header-trust
   vulnerability is genuinely and fully closed. This was scrutinized
   hardest, independently of the implementing agent's self-report.**
   - `grep -rn "headers()\|Host\|X-Forwarded\|req\.headers\|request\.headers"`
     across `src/lib/email/base-url.ts`, `src/features/emails/server/
     resolve-block-context.ts`, and every file that imports either module
     (the 7 call sites) returns **zero** matches to any actual header-reading
     code — the only hits at all are inside comments (`base-url.ts:14`,
     `resolve-block-context.ts:122`) explaining *why* headers are
     deliberately not used. The function body (`base-url.ts:33-52`) reads
     exactly one input, `process.env.NEXT_PUBLIC_APP_URL`, and nothing else
     — no `headers()` import from `next/headers`, no `Request`/`NextRequest`
     parameter, no fallback branch of any kind that could reach request
     data. This is a closed, complete fix, not a partial one.
   - **Env var validation — PASS, rejects non-http(s) schemes and malformed
     URLs, confirmed by direct read and by test.** `SAFE_PROTOCOLS = new
     Set(["http:", "https:"])` (`:31`); the function parses via `new
     URL(raw)` inside a `try/catch` (malformed/relative input throws inside
     `new URL()` and is caught, returning `null`, `:39-51`), then explicitly
     checks `SAFE_PROTOCOLS.has(parsed.protocol)` before ever using the
     value (`:41-43`) — a `javascript:`/`ftp:`/`data:` value is rejected
     even though it would otherwise parse successfully. Returns `.origin`,
     not the raw string, which also normalizes away any trailing
     path/query/slash so a configured value like
     `https://app.example.com/some/path?x=1` can't accidentally leak an
     unintended path segment into every generated link. Locked by
     `email-base-url.test.ts`: normalizes trailing slash (`:38-43`), strips
     trailing path/query (`:45-50`), accepts `http://` for local dev
     (`:52-55`), **rejects `javascript:alert(1)`** (`:57-60`, the exact
     phishing-relevant case), rejects a bare relative path (`:62-65`),
     unset (`:67-69`), and blank/whitespace-only (`:71-74`) — all 7 cases
     pass.
   - **Never throws — PASS.** Every failure path (`new URL()` throwing,
     `unset`, `unsafe protocol`) returns `null` rather than propagating;
     confirmed by direct read (no bare `throw` anywhere in the file) and by
     every test in `email-base-url.test.ts` asserting `.resolves.toBeNull()`
     rather than `.rejects`.
   - **Caller-side degrade-gracefully contract — PASS.**
     `resolveRegistrationCta` (`resolve-block-context.ts:127`) treats a
     `null` base URL as "cannot build a safe href" and degrades the whole
     `registrationCta` field to `null` (RegistrationEmbed's own "never
     configured" fallback) rather than emitting a context whose
     `registerHref` would fail `isEmailSafeUrl` downstream anyway — correct,
     and locked by `email-block-render-context.test.ts:171-178`.
   - **Independent conclusion: the header-trust vulnerability the
     implementing agent self-reported catching is genuinely fully closed.**
     There is no remaining code path, in this file or any of its callers,
     that derives the embedded-in-email base URL from anything other than
     `NEXT_PUBLIC_APP_URL`. A forged `Host`/`X-Forwarded-Host` header cannot
     influence an outbound email link anywhere in this diff.

3. **The 7 call-site integrations — PASS, all 7 genuinely wired, not just
   the helper existing.** Confirmed by direct read of each file (not just
   grep for the import):
   - `src/app/api/dashboard/events/[eventId]/emails/preview/route.ts:78-97`
     — resolved in parallel with `loadSampleEmailContext` via `Promise.all`,
     threaded as `blockContext` into `renderEmailDefinitionPreview`.
   - `src/app/api/dashboard/events/[eventId]/emails/test-send/route.ts:110-131`
     — same `Promise.all` pattern, threaded into `deriveBodyForDefinition`.
   - `src/app/dashboard/(event)/events/[eventId]/emails/page.tsx:121-125,149-158`
     — resolved alongside the page's other parallel data loads, threaded
     into `renderEmailDefinitionPreview` for the confirmation-preview card.
   - `src/features/emails/server/fire-on-submit-email.ts:77-84` — resolved
     once per send, inside the function's own outer `try/catch`, threaded
     into `deriveBodyForDefinition`.
   - `src/features/emails/server/fire-on-accept-email.ts:104-111` — same
     pattern, same outer-`try/catch` placement.
   - `src/lib/email/lifecycle/paged-trigger-runner.ts:111-118` — resolved
     once per tick, before the page loop, threaded into
     `deriveBodyForDefinition`; `templateUsesQrCode`'s pre-check (already
     verified in the first review pass) still runs against the derived
     `bodyText`, unaffected by this addition.
   - `src/app/api/dashboard/events/[eventId]/drafts/email-all/route.ts:141-148`
     — resolved once for the whole batch, threaded into
     `deriveBodyForDefinition`, matching every other paged/batch sender's
     snapshot semantics.
   All 7 pass `{eventId, organizationId}` — the correct tenant-scoped pair
   in every case (`scope.organizationId` from `resolveRegistrationRouteScope`
   for the 4 API-route/page call sites, `input.organizationId` for the 3
   server-module call sites) — confirmed by reading the surrounding function
   signature at each site, not assumed.

4. **`paged-trigger-runner.ts` and the two real-time trigger hooks — PASS,
   a pure addition, no regression of any M6-T3 guarantee.** Direct read of
   the full current file (reproduced above) confirms:
   - Dedupe-key derivation (`buildDedupeKeys`, `:157-158`, `:174-182`,
     `:188`) is byte-for-byte unchanged from the version verified at the
     first review pass — no line in that logic was touched.
   - The `enabled` re-check (`:132-142`) is still evaluated fresh at the top
     of every processed page, in the exact same position relative to the
     page loop — the new `blockContext`/`bodyHtml`/`bodyText` derivation
     (`:111-118`) sits entirely *before* the `for` loop begins, so it cannot
     affect per-page timing. Re-confirmed (not just re-asserted) by
     `lifecycle-paged-trigger-runner.test.ts:126-181`'s two "enabled
     re-check granularity" tests still passing unmodified.
   - Failure isolation is unaffected: `resolveEmailBlockRenderContext` never
     throws (verified above), so it cannot introduce a new tick-aborting
     failure mode; the invalid-recipient-isolation test
     (`:332-358`) and the interrupted/resumed-dedupe test (`:184-239`) both
     pass unmodified, confirming per-page/per-recipient isolation still
     holds.
   - `fire-on-submit-email.ts` and `fire-on-accept-email.ts`: the new
     `resolveEmailBlockRenderContext` call in each sits inside the
     function's pre-existing outer `try/catch` (confirmed above), so it
     inherits the exact same "log loudly, never rethrow, never surface as a
     finalize/accept failure" contract those functions already had — no
     restructuring of either function's control flow occurred.

5. **Test coverage for the fix — PASS, real assertions that data reaches
   rendered HTML at multiple call sites, and that a simulated resolution
   failure degrades gracefully.**
   - `email-block-render-context.test.ts` (new, 283 lines) — exhaustive
     isolated coverage of the helper itself: pricing/registrationCta/
     countdown correctness across every state (open/closed/no_paths/
     unresolvable-base-url), and independent per-field failure isolation
     (see item 1 above).
   - `email-base-url.test.ts` (new) — exhaustive isolated coverage of the
     env-var resolver (see item 2 above).
   - `email-preview-route.test.ts` (new) — genuine route-level integration
     test: asserts `resolveEmailBlockRenderContext` is called with the
     correct `{eventId, organizationId}` (`:136-139`) **and** that the
     returned `bodyHtml` actually contains the real, mocked-real
     `registerHref` string (`:141-143`) — a true "data reaches the rendered
     HTML" assertion, not a mock-was-called check alone. A second test
     confirms a `{}` context still renders 200 with the honest fallback
     copy, never a 500 (`:146-168`).
   - `email-test-send-route.test.ts` (extended) — equivalent real-data-in-
     rendered-HTML assertion for the test-send path (`:116-154`).
   - `email-all-route.test.ts` (extended) — equivalent for the batch path,
     plus the "resolved exactly once for the whole batch" assertion
     (`:284-338`).
   - `email-lifecycle-on-accept.test.ts` / `email-lifecycle-on-submit.test.ts`
     (extended) — equivalent for both real-time triggers, including a
     CountdownTimer-specific real-target assertion in the on-submit suite
     (`:208-240`), not just RegistrationEmbed/TicketPricingTable coverage.
   - `lifecycle-paged-trigger-runner.test.ts` (extended, `:269-329`) — the
     strongest of the six: uses the real `resolveEmailBlockRenderContext`
     (not mocked) against a fake in-memory Firestore
     (`createFakeAdminDb`) seeded with a real `Event`/`TicketType`/`Fee`
     doc, and asserts the value that actually reaches the transport's
     `send()` call contains `"General Admission"` and `"$50.00"` and does
     **not** contain the empty-state fallback string — genuine end-to-end
     proof through the real DAL layer, not a mocked seam. The three
     pre-existing M6-T3 safety-behavior tests in the same file (enabled
     re-check, interruption/resumption dedupe, invalid-recipient isolation)
     all continue to pass unmodified in the same run, directly confirming
     no regression.
   - **One coverage gap, not blocking:** the confirmation-preview card at
     `src/app/dashboard/(event)/events/[eventId]/emails/page.tsx` (call site
     #3) has no dedicated automated test proving live
     registrationCta/pricing/countdown data reaches *its* rendered HTML —
     the wiring itself was verified correct by direct code read (item 3
     above), and `page.tsx` as a Next.js server component had no dedicated
     unit-test file before this fix either (consistent with this codebase's
     existing test strategy for that specific file, not a new gap
     introduced here), but it is the one of the 7 call sites without an
     integration-level assertion. Recorded as **N-4** below; does not block
     approval given the other 6 call sites — including the two
     safety-critical trigger paths — are covered by genuine
     data-reaches-HTML tests, and the wiring at this specific site was
     independently verified by direct read.

### Findings

**Blockers:** none. B-1 is closed.

**Should-fix:** none.

**Nits:**
- **N-4** — `src/app/dashboard/(event)/events/[eventId]/emails/page.tsx`'s
  confirmation-preview card (B-1's call site #3) has no dedicated automated
  test asserting that live `registrationCta`/`pricing`/`countdown` data
  reaches its rendered `bodyHtml`, unlike the other 6 call sites. The wiring
  itself is verified correct by direct code read. Worth adding a test the
  next time this file is touched, matching the pattern
  `email-preview-route.test.ts` already established, but not a reason to
  withhold approval today.

### Updated verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M6-T4 — Email designer via shared block engine (B-1 re-review) | **APPROVED** | B-1 is fully closed: `resolveEmailBlockRenderContext` (new, `src/features/emails/server/resolve-block-context.ts`) is now genuinely called at all 7 real production call sites named in the original finding, resolved once per render/send/tick/batch (never per-recipient), correctly reuses (not reimplements) the public event page's own `resolveRegistrationCtaState` logic, is fully org/event tenancy-scoped on every DAL call, and never throws under any combination of sub-resolution failures (independently triple-guarded: per-sub-resolver try/catch, an inline `.catch()` on the event lookup, and one outer try/catch). The self-reported header-trust vulnerability in `src/lib/email/base-url.ts` is independently confirmed genuinely and fully closed — an exhaustive grep across the fix and all its callers finds zero header-reading code, only explanatory comments; the function trusts `NEXT_PUBLIC_APP_URL` alone, validates it rejects non-http(s) schemes and malformed/relative values, normalizes to `.origin`, and never throws. `paged-trigger-runner.ts` and both real-time trigger hooks received a pure, additive integration — dedupe-key derivation, the per-page `enabled` re-check timing, and failure isolation are all byte-for-byte unchanged and continue to pass every pre-existing M6-T3 safety-behavior test unmodified. Test coverage is genuine: 6 of 7 call sites (including the two safety-critical trigger paths, one via a real fake-Firestore end-to-end assertion) have dedicated tests proving real pricing/registration/countdown data reaches the actual rendered HTML/transport payload, plus a fully isolated 283-line suite for the helper itself and a 7-case suite for the URL resolver. One nit only (N-4, missing test at the confirmation-preview-card call site, verified correct by direct read regardless). `npm run lint` clean, `npx tsc --noEmit` at the identical pre-existing 3-file baseline, `npm run build` succeeds, `npm test -- --run` passes at **119 files / 1463 tests** (up from 116/1435, the exact delta expected from the new/extended B-1 test coverage). |

**APPROVED — hands off to the Security Agent.**
