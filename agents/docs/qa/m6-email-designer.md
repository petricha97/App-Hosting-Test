# QA — M6-T4 Email designer via shared block engine

QA Agent, 2026-07-16. Gate 4 of 4 (Code Review APPROVED — including the B-1
blocker fix and its re-review — → Security PASS, zero findings of any
severity → **QA**). Scope: all uncommitted M6-T4 changes on the working tree
relative to `prototype` — `src/features/emails/server/blocks/**` (8 block
renderers + shared primitives), `src/features/emails/server/{render,
resolve-block-context}.ts`, `src/lib/email/base-url.ts`, the 6 new
`email-*` components (`email-block-designer`, `email-canvas-disclaimer`,
`email-block-field-note`, `email-definition-picker-menu`,
`email-editor-mode-toggle`, `email-puck-config`), the modified
`email-editor-dialog.tsx` / `emails-workspace.tsx` / `merge-tag-menu.tsx`,
`src/lib/email/schemas.ts`, `src/types/collection.ts`,
`src/lib/db/adminEmailDefinition.ts`, and the 7 real call sites wired to
`resolveEmailBlockRenderContext`. Reviewed against
`agents/docs/specs/m6-email-designer.md` (authoritative acceptance criteria,
§1–§8), `agents/docs/design/m6-email-designer.md` (UI/UX spec),
`agents/docs/reviews/m6-email-designer.md` (Code Review: APPROVED, B-1
blocker closed and re-reviewed), `agents/docs/security/m6-email-designer.md`
(Security: PASS, 0 findings of any severity).

## Method — what "actually run the app" and "the client-rendering matrix"
meant in this environment

**No browser-driving tool, no working local Firebase emulator (same
constraint as every prior QA pass in this loop — see
`agents/docs/qa/m6-emails-admin.md`), and — critically for this ticket's own
QA assignment (spec §6) — no access to real Outlook/Gmail/Apple Mail clients
or an email-rendering-testing service (Litmus/Email on Acid or similar).**
Spec §6 itself anticipates this exact gap ("QA is not expected to build a
Litmus/Email-on-Acid-style automated matrix... real-inbox manual
verification... is what 'acceptable' means here") and explicitly hands QA a
narrower, still-real form of verification that does not require a live
client: **structural email-safety of the assembled HTML** (table-based
layout, inline `style=` not `<style>` blocks, no flexbox/grid, the required
dark-mode `<meta>` tags, absolute not relative URLs). This pass did that
work thoroughly, as instructed, and is explicit below about what it did and
did not cover:

1. **Direct execution of the real render pipeline**, not a re-read of it.
   `deriveBodyHtmlFromBlocks`/`deriveBodyTextFromBlocks`/
   `renderEmailDefinitionPreview` were called directly (via a scratch
   Vitest file, not committed) with a representative 8-block, all-types
   fixture, in both the "no live context" and "live registrationCta/pricing/
   countdown context" shapes, and the actual output HTML/text strings were
   inspected byte-for-byte — not assumed correct because a comment says so.
   This is how the dark-mode-meta-tag gap below (QA-D-2) was found: it would
   not have surfaced from reading `agents/docs/reviews/` or
   `agents/docs/security/` alone, both of which correctly verified the
   *security* controls (§3.1) exhaustively but did not check spec §6's
   separate, non-security "assembled document" requirement.
2. **Component-level interaction testing** — the existing
   `email-editor-dialog-interactions.test.tsx` (extended by Full-Stack ahead
   of this gate) already drives the real `EmailEditorDialog`/
   `EmailEditorModeToggle` with real `fireEvent` interactions in jsdom,
   including the *exact* QA-D-1 (M6-T2) bug class applied to the new mode
   toggle: does switching modes with no other edit actually trip
   `form.formState.isDirty`? I independently re-read both
   `email-editor-mode-toggle.tsx` (writes `bodyMode` via
   `form.setValue(..., { shouldDirty: true })` on the *same* RHF instance,
   never a parallel `useState`) and `email-editor-dialog.tsx` (`isDirty` is
   destructured from `form.formState` **during render**, not only inside
   `attemptClose`'s callback — the exact fix QA-D-1 required) and confirmed
   the wiring is genuinely correct, not merely plausible-looking; the
   existing tests (`describe("QA — M6-T4 mode toggle dirty-tracking...")`,
   lines 293–336) exercise this for real and pass. I did not stop at "the
   tests pass" — I re-derived the mechanism from source myself, the same
   standard applied to QA-D-1's own fix verification.
3. **Real two-org data through the actual route layer, for the specific new
   field this ticket adds** — the pre-existing M6-T2 real-two-org harness
   (`email-cross-org-real-data-route.test.ts`) proved definitions/messages/
   settings never leak, but had no test naming `bodyBlocks` specifically.
   Added one (below) that PATCHes real block content into org-1's
   definition through the real route, confirms org-2's session never sees
   it anywhere in its response (not just "the kind is absent" — the whole
   serialized JSON is scanned for a secret token), and confirms a
   cross-org PATCH attempt 404s and leaves org-1's content untouched.
4. **What was NOT done, disclosed honestly, matching the M6-T2 precedent**:
   no real Outlook/Gmail/Apple Mail rendering was performed (spec §6 AC-1);
   no real dark-mode client screenshot was taken (spec §6 AC-2's client-side
   half); no multi-breakpoint/multi-theme screenshot pass of the dashboard
   chrome was performed (carried-forward gap from every prior QA pass in
   this loop, re-disclosed below, not silently dropped).

## Automated suite (this session, working tree)

| Check | Result |
|---|---|
| `npm run lint` | PASS — no ESLint warnings or errors |
| `npx tsc --noEmit --pretty false` | PASS except the same **3 pre-existing, unrelated** errors already carried by Code Review/Security (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62`) — confirmed still outside the M6-T4 diff |
| `npm run build` | PASS, exit 0 — `/dashboard/events/[eventId]/emails` and every touched API route compile and appear in the route manifest |
| `npm test -- --run` | PASS at baseline: **119 files / 1463 tests** (exact match to Code Review's re-review and Security's count) before this pass's own additions; **120 files / 1468 passing + 3 `it.todo` (1471 total)** after this pass's 2 new regression files/additions (see below) |

## New QA test files / additions (regression tests)

| File | What changed | What it locks |
|---|---|---|
| `src/__tests__/email-cross-org-real-data-route.test.ts` | +1 test (`"QA (M6-T4 spec §7 AC-2): a bodyBlocks payload PATCHed for org-1's definition through the real route is never readable via org-2's session"`) | Real two-org isolation of `bodyBlocks` specifically, through the real unmocked DAL + real route handlers (PATCH then GET both directions, plus a rejected cross-org PATCH leaving org-1 untouched) — spec §7 AC-2, previously only inferred from the whole-document isolation test, now explicitly locked |
| `src/__tests__/email-dark-mode-meta.test.ts` (new) | 4 passing + 3 `it.todo` | **QA-D-2 (Major, OPEN, below)** — pins the current absence of spec §6 AC-2's required dark-mode `<meta>` tags across `deriveBodyHtmlFromBlocks`, `deriveBodyHtmlTemplate`, `deriveBodyForDefinition` (both modes), and `renderEmailDefinitionPreview` (the function every real send path calls) |

---

## Per-section acceptance criteria

### §1 — Email-safe block registry

| AC | Result | Evidence |
|---|---|---|
| 1. Exactly 8 palette entries, `CallToAction` never appears | **PASS** | `EMAIL_SAFE_BLOCK_TYPES` (`src/types/collection.ts`) is exactly `["Hero","Highlights","Story","Schedule","Faq","RegistrationEmbed","TicketPricingTable","CountdownTimer"]`; `email-puck-config.tsx`'s `categories.email.components` spreads this array directly — no ninth entry possible. Independently confirmed by direct execution (below), not just reading the array. |
| 2. Every text-bearing prop HTML-escapes XSS payloads across all 8 blocks | **PASS** | Independently re-derived by direct execution (a representative fixture across all 8 types) — plain `escapeHtml`-shaped output only, matching Code Review/Security's own exhaustive 72-assertion suite (`email-block-renderers.test.ts`), which I re-ran and re-read rather than trusting the prior "PASS" verdicts alone |
| 3. Hero's CTA labels round-trip but never render | **PASS — independently confirmed** | My own direct-execution fixture used the exact literal strings `"Register"`/`"Learn more"` as Hero's `primaryCtaLabel`/`secondaryCtaLabel`; neither string appears anywhere in the assembled HTML for that block (confirmed by inspecting the actual output string, not just the existing unique-token test) |
| 4. Story's `imageSide` changes reading order, never 2-column | **PASS — independently confirmed** | Direct execution: `imageSide:"left"` → `story-left.png` index < `"Story body left"` index (image first); `imageSide:"right"` → text index < image index (text first); no `<td>` sibling markup, single `<table>`/`<tr>`/`<td>` per block |
| 5. RegistrationEmbed's 3 branches (open/closed/zero-paths), no `<form>` | **PASS — independently confirmed** | Direct execution with a live `registrationCta: {state:"open", registerHref:"https://app.example.com/events/evt-1/register"}` context produced a real `<a href="https://...">Register</a>` bulletproof-button table; with no context, produced the static `{event_url}`-pointing notice. Zero `<form` substring anywhere in either output. |
| 6. TicketPricingTable renders the render-time snapshot | **PASS — independently confirmed** | Direct execution with a live `pricing` context produced the real `"General Admission"`/`"GA"`/`"Open"` row text; with no context, the configured `emptyMessage` — matches spec's snapshot-not-live framing |
| 7. CountdownTimer never renders ticking tiles | **PASS — independently confirmed** | Direct execution: a live `countdown` context with `target:"eventStart"` produced `"September 15, 2026 · 9:00 AM"` (absolute string only); no `\d+:\d+` ticking-tile pattern anywhere in any of the 8 blocks' combined output |
| 8. Unknown block type skipped, never crashes | **PASS — independently confirmed** | Direct execution: appended a synthetic `{type:"CallToAction", props:{buttonLabel:"Click me"}}` entry to the fixture — output HTML byte-length identical to the fixture without it, `"Click me"` never appears anywhere, no exception thrown |
| 9. Freshness snapshot divergence, explicit and tested | **PASS (existing suite, re-read)** | `email-block-renderers.test.ts`'s dedicated "a later, DIFFERENT snapshot renders DIFFERENT output" test, re-read and confirmed correct; also directly observed in my own fixture (context-present vs. context-absent runs produced genuinely different TicketPricingTable/CountdownTimer output for the identical block props) |

### §2 — `EmailDefinition` schema additions

| AC | Result | Evidence |
|---|---|---|
| 1. PATCH accepts `bodyMode`/`bodyBlocks` under the same auth/rate-limit/locked-field rules as `subject`/`body` | **PASS** | `SYSTEM_LOCKED_SCALAR_FIELDS` (`adminEmailDefinition.ts`) omits both new fields (confirmed by direct read); `admin-email-definition-body-blocks.test.ts`'s "editable for isSystem:true... ZERO locked-field rejection" test, re-run and passing |
| 2. Unrecognized type / prop failing its schema rejected write-time, zero writes | **PASS** | `email-block-schemas.test.ts` + `admin-email-definition-body-blocks.test.ts`'s "rejects an unsafe imageUrl inside a Hero block with zero writes" test, re-run and passing |
| 3. Count/byte caps distinct from the 32 KB/256 KB caps | **PASS** | `emailBodyBlocksSchema` — `EMAIL_BODY_BLOCKS_MAX_COUNT=20`, `EMAIL_BODY_BLOCKS_MAX_BYTES=48*1024` (confirmed by direct read of `src/lib/email/schemas.ts`), both independently re-`safeParse`d inside `upsertAdminEmailDefinition`'s transaction — a direct API call bypassing the UI is still validated |
| 4. block→text→block round-trip preserves content byte-for-byte | **PASS (existing suite, re-read)** | `admin-email-definition-body-blocks.test.ts`'s dedicated round-trip test, re-read and confirmed the assertion genuinely compares the block payload, not a shape-only check |
| 5. Legacy doc (no `bodyMode`/`bodyBlocks`) reads as `text`/`[]` | **PASS** | `default-definitions.ts:377-378` (`doc.bodyMode ?? "text"`, `doc.bodyBlocks ?? []`) confirmed by direct read; `admin-email-definition-body-blocks.test.ts`'s dedicated test re-run |

### §3 — Render pipeline (security-critical core)

Per the task brief, this section builds on Security's already-exceptionally-thorough
independent verification (`agents/docs/security/m6-email-designer.md` — PASS,
zero findings, all 5 of §3.1's controls independently re-derived from source
including hand-running the exact adversarial URL values) rather than
re-litigating it. QA's own contribution here was direct execution (not just
re-reading) to spot-check the claims hold in practice:

| AC | Result | Evidence |
|---|---|---|
| 1. XSS payloads render as escaped literal text, all 8 blocks | **PASS (re-verified by direct execution + existing 72-assertion suite)** | See §1 AC-2 above |
| 2. Unsafe `imageUrl` dropped for Hero/Story | **PASS (existing suite, re-read)** | `email-block-renderers.test.ts:189-241` — `javascript:`, `data:`, `/foo.png`, `foo.png`, `//evil.example.com/x.png` all rejected for both blocks |
| 3. No free-text `style=` attribute anywhere | **PASS (Security's source-level scan, independently spot-confirmed)** | Direct read of all 8 renderer files + `styles.ts` confirms every `style="..."` interpolation is `EMAIL_BLOCK_COLORS.*` only; zero `bgcolor`... *(see QA note under §6 below — this is a real but distinct, non-XSS-relevant gap)* |
| 4. Maximal (20-block) definition stays under 256 KB for realistic content | **PASS (existing suite, re-read + independently re-computed)** | `email-render-blocks-pipeline.test.ts:215-269`; I additionally computed the actual byte size of a realistic 20-Hero-block fixture independently: **19,959 bytes** — comfortably under both the 256 KB hard cap and (relevant to §6 AC-3, below) the ~102 KB Gmail soft-clip threshold |
| 5. Unknown type renders every other block, no crash | **PASS — independently confirmed** | See §1 AC-8 above |
| 6. `renderEmailTemplate` unmodified | **PASS (Security's hash-pinned tripwire, independently re-confirmed)** | `git diff prototype -- src/lib/email/merge-tags.ts` is empty in this session too |
| 7. Plain-text derivation never exceeds 64 KB, no raw HTML | **PASS — independently confirmed** | My own direct-execution fixture's `deriveBodyTextFromBlocks` output contains zero `<...>` tag-shaped substrings (regex-checked) and correctly reads "View current ticket pricing: {event_url}" / "Register: https://..." for the non-text blocks, in reading order |

### §4 — UI scope: "Open Email Designer" → definition picker + mode toggle

| AC | Result | Evidence |
|---|---|---|
| 1. "Open Email Designer" enabled, opens a definition picker, selecting opens the dialog pre-set to Block designer | **PASS** | `emails-workspace.tsx` renders `EmailDefinitionPickerMenu` (no `disabled`, `Blocks` icon, "Open Email Designer" trigger text — confirmed by direct read, the disabled/tooltip button from T2 is gone); `email-definition-picker-menu.test.tsx`'s "calls onSelect with the chosen definition's kind" test, re-run; `email-editor-dialog-interactions.test.tsx`'s `forceInitialMode="blocks"` test confirms the toggle opens pre-pressed |
| 2. Never-block-edited definition (`bodyBlocks: []`) shows an empty canvas, never a crash, never pre-populated | **PASS** | `email-editor-dialog-interactions.test.tsx`'s `EMPTY_BLOCKS_DEFINITION` test, re-run — renders the empty-canvas warning copy verbatim, no crash |
| 3. **Mode-only switch trips the unsaved-changes guard (the exact QA-D-1 bug class) — VERIFIED FOR REAL, not assumed** | **PASS** | This is the specific risk this ticket's brief called out by name. Independently re-derived from source (see Method §2 above) *and* re-ran the existing real-`fireEvent` test (`"switching to Block designer with no other edits trips the unsaved-changes guard on Cancel"`) — clicking "Block designer" then "Cancel" with zero other field edits opens "Discard changes?" and `onOpenChange` is never called. I did not stop at "a test with this name exists and is green" — I traced the actual RHF wiring (`form.setValue("bodyMode", next, {shouldDirty:true})` → the render-scoped `const {isDirty} = form.formState` → `attemptClose`) myself and confirmed it is the correct fix shape, not a coincidentally-passing test. **This bug class does NOT recur in M6-T4** — Full-Stack correctly generalized the M6-T2 fix to the new field. |
| 4. Canvas-vs-preview distinction stated plainly, not just implied by layout | **PASS** | `EmailCanvasDisclaimer` renders the literal sentence "Canvas preview is approximate — email clients render differently." (always visible, non-dismissable) plus an expandable 4-bullet "What's different?" list; `EmailBlockDesigner` labels the authoritative iframe "Email preview (this is what sends)" directly above it — both confirmed by direct read, matching design §3.3/§3.6 verbatim |
| 5. Keyboard/focus parity with the existing dialog convention; Puck's own DnD gap is disclosed, not fixed | **PASS (as scoped) / DISCLOSED LIMITATION** | The mode toggle uses `role="group"`/`aria-pressed` (confirmed); field-panel inputs inside a selected block are ordinary native controls (confirmed by direct read of `email-puck-config.tsx`'s field definitions — plain `Input`/`Textarea`/radio, no custom non-native widget). **Not independently testable in this environment**: `@measured/puck`'s own canvas cannot mount in jsdom (confirmed — the existing test suite stubs it with a placeholder `<div data-testid="puck-editor" />`, the same precedent `event-page-editor-discard.test.tsx` already established for the web builder), so the actual drag-and-drop/keyboard-reorder behavior inside the live canvas was not exercised by this pass or any other automated test in this repo. This matches spec's own Non-goals ("no fix to any pre-existing Puck upstream accessibility gap... flagged for QA to report as a library-level finding if encountered, not a defect in this ticket's own code") — no new gap was found beyond the already-disclosed, pre-existing upstream limitation. |

### §5 — Preview and test-send compatibility

| AC | Result | Evidence |
|---|---|---|
| 1. Test-send of a block-mode definition produces a frozen outbox snapshot | **PASS (existing suite, re-read)** | `email-test-send-route.test.ts`'s B-1 integration test asserts real block content reaches the rendered `bodyHtml` sent to `sendEventEmail`; the frozen-snapshot mechanism itself (`createAdminEmailMessageIfAbsent` stores `bodyHtml`/`bodyText` directly on the message doc, never a live reference back to the definition) is unchanged, mode-agnostic code inherited byte-for-byte from T1/T2 — confirmed by direct read, not re-tested as a new block-mode-specific suite since the mechanism is identical regardless of authoring mode (no new code path exists to test) |
| 2. Confirmation-preview card renders correctly for a block-mode `confirmation-paid`, zero-attendee QR fallback unchanged | **PASS (code trace)** | `page.tsx`'s wiring to `resolveEmailBlockRenderContext` confirmed present (Code Review's B-1 re-review, item 3, independently spot-confirmed by direct read); `confirmation-preview-card.tsx` itself needs no changes per spec and has none (confirmed via `git diff`) |
| 3. A definition's `bodyMode` is independent of other definitions' modes, no cross-contamination | **PASS — verified via direct execution + schema** | Each `EmailDefinition` document independently stores its own `bodyMode`/`bodyBlocks`; no shared/global state exists anywhere in the write or render path (confirmed by direct read of `upsertAdminEmailDefinition` and `deriveBodyForDefinition`, both of which take a single definition's fields as pure input with no cross-document reads) |
| 4. Editing block content after a send does not retroactively change the frozen send-log snapshot | **PASS (code trace, mode-agnostic mechanism inherited from T1 §2 AC-8/T2 §3 AC-1)** | `EmailMessageDoc.bodyHtml`/`bodyText` are written once at send time and never re-derived from the definition on read (confirmed by direct read of `adminEmailMessage.ts`'s read paths — no join/re-render occurs); this is identical machinery for text- and block-mode messages, so T1/T2's already-passing regression tests for this guarantee cover the block-mode case by construction, not by coincidence |

### §6 — Representative client-rendering test matrix

| AC | Result | Evidence |
|---|---|---|
| 1. Real Outlook desktop / Gmail web / Apple Mail verification of a representative mixed-block email | **NOT PERFORMED — honestly disclosed, not a failure attributed to the code.** No real email client or email-rendering-testing service (Litmus/Email on Acid) is available in this environment. This is explicitly anticipated by the spec's own framing of QA's assignment (see Method above). Not gating this sign-off on its own (spec anticipated this constraint), but genuinely unverified and should be flagged to the Orchestrator/product owner before any real transport ships. |
| 2. Dark-mode meta tags present in the assembled document + one dark-mode client verified | **FAIL (structural half) — QA-D-2, Major, below. Client half NOT PERFORMED (same constraint as AC-1).** | The structural half of this AC — "the dark-mode meta tags are present in the assembled document" — is independently, fully verifiable without any live client, and it fails: **zero occurrences of `color-scheme` or `supported-color-schemes` exist anywhere in `src/`** (confirmed via `grep -rn "color-scheme" src/` → no hits outside my own new regression test), and there is no `<!DOCTYPE>`/`<html>`/`<head>` document wrapper anywhere in the pipeline for either `bodyMode` — `bodyHtml` is a bare fragment at every stage (`deriveBodyHtmlFromBlocks`, `deriveBodyHtmlTemplate`, `renderEmailTemplate`, `send-service.ts`, `EmailPreviewFrame`'s `srcDoc`). See QA-D-2 below. |
| 3. Maximal (20-block) fixture checked against Gmail's ~102 KB clipping threshold specifically | **PASS (verified structurally, non-gating per spec's own OQ-4)** | Independently computed: a realistic 20-Hero-block fixture serializes to **19,959 bytes** — comfortably under both the ~102 KB Gmail soft-clip threshold and the existing 256 KB hard cap. A deliberately pathological fixture *does* legitimately exceed even the 256 KB hard cap (existing test, §3 AC-4) well before Gmail's threshold becomes the binding constraint, so no realistic 20-block design is likely to hit Gmail's soft clip in practice. Spec's own OQ-4 frames an editor-side ~100 KB warning as "should-fix, not gating" — not filed as a defect, consistent with that framing. |
| 4. Findings recorded per-client, not one blanket claim | **PASS (this table)** | Findings above are recorded per the spec's own table structure, distinguishing "not performed" (client half, environment constraint) from "fails structurally" (QA-D-2, a genuine code gap independent of any client) |

### §7 — Permissions, tenancy

| AC | Result | Evidence |
|---|---|---|
| 1. Read-only member sees the shell, cannot persist anything via the block designer | **PASS (code trace, same posture as M6-T2 §7 AC-2, no new client-side gating introduced)** | `email-editor-dialog.tsx`'s Save/Test-send both go through the same two pre-existing server-gated routes (`PATCH .../definitions/[kind]`, `POST .../emails/preview`, `POST .../emails/test-send`) — no new route, no new client-side role check (confirmed by `git diff --stat -- src/app/api/` showing zero new route files, per Security's own independent confirmation, re-checked) |
| 2. Two-org isolation of `bodyBlocks` specifically | **PASS — closed this ticket's specific gap with a new regression test** | Added `email-cross-org-real-data-route.test.ts`'s new test (above): a real PATCH of block content for org-1's definition, through the real unmocked DAL + real route handlers, is never visible in org-2's session's response (whole-JSON secret-token scan, not just "the kind is absent"), and a cross-org PATCH attempt 404s with zero mutation of org-1's stored content |

### §8 — States & edge cases

| # | Result | Evidence |
|---|---|---|
| 1. Empty canvas warns, does not block Save, does block Test-send | **PASS** | `email-editor-dialog-interactions.test.tsx`'s `EMPTY_BLOCKS_DEFINITION` describe block, re-run — Test-send button `disabled:true`, Save button `disabled:false`, warning copy present verbatim |
| 2. Zero-attendee / sample context — no new concern beyond T2 | **PASS (code trace, mechanism unchanged)** | `resolveEmailBlockRenderContext`'s data sources (event/ticket/fee/registration-path docs) are independent of the recipient/attendee entirely — confirmed by direct read of `resolve-block-context.ts`'s three sub-resolvers, none of which take an attendee/recipient parameter |
| 3. Concurrent edits: last-write-wins, `bodyBlocks` part of the same whole-doc upsert | **PASS (code trace, by construction)** | `upsertAdminEmailDefinition`'s transaction writes the full patch object atomically — `bodyBlocks` is just another key in that object, no partial-block merge logic exists anywhere (confirmed by direct read) |
| 4. Both themes / responsive — dashboard chrome only, email content stays light-only by decision | **PASS (dashboard chrome, verified via direct read) / DECISION, not a bug (email content)** | `EmailBlockFieldNote`'s amber/neutral tone pairing both declare explicit `dark:` variants (confirmed by direct read: `dark:border-amber-900 dark:bg-amber-950/40` etc.) — no new bare-light-only class found anywhere in the 6 new dashboard-chrome components. `EmailPreviewFrame`'s iframe is explicitly commented "Deliberately NOT theme-following" — unchanged from T2, correctly not flagged as a bug per the carried decision. **Not independently screenshot-verified at real breakpoints/themes** — same disclosed, carried-forward gap as every prior QA pass in this loop (no browser tool available); rendered-DOM class presence was confirmed instead, which is stronger than a source read but not a substitute for a real screenshot pass. |
| 5. Event with zero paths/tickets/a past countdown target — each block's own empty/past state governs, never broken | **PASS — independently confirmed by direct execution** | See §1 AC-5/AC-6/AC-7 above; additionally directly observed a past-target CountdownTimer input render `completedMessage` rather than a negative/broken duration (existing suite `email-block-renderers.test.ts:443` re-read and re-run) |

---

## Defects

### QA-D-2 (Major, OPEN) — Required dark-mode `<meta>` tags (spec §6 AC-2) are missing everywhere in the render pipeline, for both authoring modes

- **Ticket:** M6-T4 spec §6 AC-2 / design (implicitly, via the spec's own
  "carries forward M6-T2 §8-1... into the real send path" framing — the
  design doc does not separately re-litigate this, it is a rendering-pipeline
  requirement, not a dashboard-chrome UI requirement). **Routed to:
  Full-Stack Developer** (owns `src/features/emails/server/render.ts` and
  the block renderers per this ticket's own code review) — may also touch
  `src/lib/email/merge-tags.ts`, which is nominally Backend/T1-owned; whoever
  picks it up should coordinate given `merge-tags.ts` is currently
  hash-pinned as "must not change" by an existing security tripwire test
  (`email-render-blocks-pipeline.test.ts`), so the fix should almost
  certainly live in `render.ts` (wrapping/prepending to `bodyHtml`) rather
  than inside `renderEmailTemplate` itself, to avoid re-triggering that
  tripwire unnecessarily.
- **Affected:** `src/features/emails/server/render.ts`
  (`deriveBodyHtmlFromBlocks`, `deriveBodyHtmlTemplate`,
  `deriveBodyForDefinition`, `renderEmailDefinitionPreview`) — i.e. every
  real send path in the app (test-send, both real-time trigger hooks, the
  periodic trigger runner, "Email all", the confirmation-preview card, and
  the editor's own live preview), for **both** `bodyMode: "text"` and
  `bodyMode: "blocks"`.
- **Root cause (confirmed by direct execution, not inferred from a
  comment):** `bodyHtml` is, at every stage of the pipeline, a bare HTML
  fragment (a sequence of `<table>`/`<p>` elements for block mode, a
  sequence of `<p>` elements for text mode) — there is no
  `<!DOCTYPE html>`/`<html>`/`<head>` wrapper anywhere in this diff or in
  the pre-existing T1/T2 code it builds on. `grep -rn "color-scheme" src/`
  (excluding the new regression test added by this pass) returns **zero**
  hits anywhere in the codebase. The transport layer
  (`dev-outbox-transport.ts`) and `send-service.ts` both pass `bodyHtml`
  through unmodified — neither wraps it either.
- **Repro (exact, deterministic):** call
  `deriveBodyHtmlFromBlocks([heroBlock], {})` (or
  `renderEmailDefinitionPreview({...bodyMode:"blocks"...})`, the same
  function every real send path calls) with any block content and inspect
  the returned string — it contains neither
  `<meta name="color-scheme" content="light">` nor
  `<meta name="supported-color-schemes" content="light">` nor any document
  wrapper at all. Locked as a passing "PINNED" regression test in
  `src/__tests__/email-dark-mode-meta.test.ts` (added by this pass).
- **Expected (spec §6, table + AC-2):** "The email HTML must include
  `<meta name="color-scheme" content="light">` and
  `<meta name="supported-color-schemes" content="light">` in its document
  wrapper, and every block's background/text colors must be explicit... —
  this carries forward M6-T2 §8-1's exact decision... into the real send
  path, not just the preview."
- **Actual:** no such tags, and no document wrapper of any kind, exist
  anywhere in the pipeline, for either authoring mode.
- **Severity: Major, not Critical.** This does not corrupt data, leak
  across tenants, or present any security risk (it is a pure rendering-
  completeness gap, orthogonal to §3's security controls, which Security
  independently and correctly verified as fully sound). It is Major, not a
  lower severity, because: (a) it is a directly stated, numbered acceptance
  criterion (§6 AC-2) that this ticket explicitly assigns itself to close,
  not an ambiguous or implied requirement; (b) it is systemic — it affects
  **100% of rendered emails**, in both authoring modes, not a rare edge
  case; (c) the real-world consequence it exists to prevent is genuine and
  well-documented (Apple Mail/iOS Mail's automatic dark-mode re-coloring can
  invert an intentionally light-styled card or make explicitly-dark text
  illegible against an auto-inverted background) — every block renderer in
  this ticket hard-codes light colors (`EMAIL_BLOCK_COLORS.*`, confirmed by
  Security's own review) with no client-side opt-out declared anywhere, so
  this is the exact scenario the spec's own table describes, not a
  theoretical concern.
- **Secondary, related, non-blocking observation (not filed as its own
  defect — same root area, lower severity):** the same §6 table row also
  calls for explicit `bgcolor` HTML **attributes** (not just inline
  `background-color` CSS) as defense-in-depth for older Outlook (Word-engine)
  rendering, "never 'no color set, relying on white-background-by-default'."
  `grep -rn "bgcolor" src/features/emails/server/blocks/` returns zero hits
  — every block relies on inline `style="background-color:..."` only, never
  a `bgcolor=` attribute. This is guidance in the same table row as QA-D-2
  (Outlook-degradation guidance, not a separately numbered AC), so it is
  recorded here as a **should-fix nit for whoever picks up QA-D-2**, not a
  second Major defect — worth doing in the same pass since it touches the
  same renderer files.
- **Suggested fix (not applied — QA does not patch application code):** wrap
  the final assembled `bodyHtml` (after block/text derivation, before or
  inside `renderEmailDefinitionPreview`'s return, or as a small dedicated
  wrapper function called from `send-service.ts`/every preview call site) in
  a minimal document shell: `<!DOCTYPE html><html><head><meta
  name="color-scheme" content="light"><meta name="supported-color-schemes"
  content="light"></head><body>...</body></html>`. This should NOT touch
  `renderEmailTemplate`/`merge-tags.ts` itself (preserving the existing
  hash-pinned "unmodified" tripwire, spec §3 AC-6) — the wrap should happen
  either just before or just after the merge-tag substitution pass, at the
  caller's discretion, as long as `{tag}` substitution inside the wrapped
  body still works (braces survive `escapeHtml` regardless of wrapper
  presence, so either ordering is safe).
- **Regression tests added:** `src/__tests__/email-dark-mode-meta.test.ts`
  (new file) — 4 passing "PINNED" tests (documenting the current, missing
  behavior across `deriveBodyHtmlFromBlocks`, `deriveBodyHtmlTemplate`,
  `deriveBodyForDefinition` for both modes, and
  `renderEmailDefinitionPreview`) that will **start failing** the moment a
  fix lands — the intended signal to delete them — plus 3 `it.todo` markers
  pinning the exact expected-post-fix assertions, following this loop's
  established QA-D-1 (M6-T2) convention exactly.

### Non-gating observations (not filed as defects)

- **§6 AC-1 (real client-matrix verification) and the client-side half of
  AC-2 (a real dark-mode client screenshot):** genuinely not performed in
  this environment — no browser-driving tool, no email-rendering-testing
  service, no real Outlook/Gmail/Apple Mail access. Spec's own framing
  anticipates this constraint and defines QA's job in this environment as
  the structural verification performed above. Flagged for the
  Orchestrator/product owner's awareness before any real transport ships
  (T1's dev-outbox transport performs no real delivery today, so no real
  recipient has seen a M6-T4 email yet regardless of this gap) — not
  gating this pass's verdict on its own, distinct from QA-D-2 which *is*
  gating because it is independently, structurally verifiable without a
  live client and fails.
- **§8-4 (both themes / all breakpoints, dashboard chrome):** verified via
  rendered-DOM/source-level class presence (stronger than a source read,
  per this loop's established standard) but **not** verified via an actual
  screenshot at 320/768/1024/1440 in both themes — the same disclosed,
  carried-forward gap present in every prior QA pass in this loop (no
  browser tool available in this environment for any ticket to date).
- **§4 AC-5 (Puck canvas keyboard/drag-and-drop accessibility):** the real
  `<Puck>` canvas cannot mount in jsdom (confirmed — every test file in this
  repo that touches it, including this ticket's own, stubs it with a
  placeholder), so the actual in-canvas keyboard-reorder experience was not
  exercised by any automated test, in this pass or any prior one. No new
  gap was found beyond the already-disclosed, spec-acknowledged upstream
  Puck limitation (spec Non-goals: explicitly out of this ticket's scope to
  fix).
- **The `bgcolor` attribute gap** — see QA-D-2's "Secondary, related,
  non-blocking observation" above; recorded there, not filed separately.

---

## QA-D-2 fix verification (2026-07-16, re-verification pass)

Full-Stack's fix landed in `src/features/emails/server/render.ts`: a new
private `wrapEmailBodyHtmlDocument` function (a fixed, code-authored
`<!DOCTYPE html><html><head>...` shell containing both
`<meta name="color-scheme" content="light">` and
`<meta name="supported-color-schemes" content="light">`, plus a
`<body>`/outer `<table>` carrying both the inline `background-color` CSS and
a legacy `bgcolor=` attribute — closing QA-D-2's secondary nit in the same
pass) is now called at the single `deriveBodyForDefinition` chokepoint, for
**both** the `bodyMode: "blocks"` branch (wrapping
`deriveBodyHtmlFromBlocks`'s output) and the `bodyMode: "text"`/default
branch (wrapping `deriveBodyHtmlTemplate`'s output) — confirmed by direct
read of the current `render.ts`, not assumed from the diff summary.

This pass independently re-verified the fix, not merely re-read the
report:

1. **Wrapper presence and correctness, direct read.** `render.ts`'s
   `wrapEmailBodyHtmlDocument` contains both required meta tags verbatim
   and is invoked from both branches of `deriveBodyForDefinition` (lines
   162–178) — confirmed by reading the current file, not the diff.
   `deriveBodyHtmlFromBlocks`/`deriveBodyHtmlTemplate` themselves
   deliberately stay bare fragments (the wrap is applied one layer up, at
   the "assembled document" boundary), which is architecturally correct and
   is exactly what the fix's own comments state.
2. **`merge-tags.ts` genuinely untouched.**
   `git diff --stat prototype -- src/lib/email/merge-tags.ts` is empty in
   this re-verification session — the hash-pinned spec §3 AC-6 tripwire
   still holds; the fix correctly avoided touching it.
3. **Every real consumer inherits the wrapper automatically.** Grepped every
   real (non-test) `.ts`/`.tsx` file in `src/` for direct imports of the
   lower-level fragment-only functions (`deriveBodyHtmlFromBlocks`,
   `deriveBodyHtmlTemplate`) outside `render.ts` itself — the only hits
   outside `render.ts`/tests are two **comments** (`blocks/index.ts`,
   `schemas.ts`), not actual imports. Separately confirmed every real
   consumer (`emails/page.tsx` confirmation-preview card, `email-all`
   route, `test-send` route, `preview` route,
   `fire-on-submit-email.ts`/`fire-on-accept-email.ts` real-time trigger
   hooks, `paged-trigger-runner.ts`, `resolve-definition.ts`) imports only
   `deriveBodyForDefinition`/`renderEmailDefinitionPreview` — the wrapped
   chokepoint — never the bare fragment functions directly. No call site
   was missed.
4. **My own regression test file, re-read and re-run.**
   `src/__tests__/email-dark-mode-meta.test.ts` now has **0** remaining
   `it.todo` — all 7 tests (the 2 "intentionally still bare" fragment
   tests, correctly preserved and re-purposed as architecture-documenting
   assertions rather than deleted, plus 5 real assembled-document/pipeline
   assertions, 3 of which were promoted from the original `it.todo`
   markers) are genuine, passing assertions, independently re-read line by
   line — not just "the file has no todo string in it." They correctly
   assert both meta tags are present for both `bodyMode`s, that content
   (`"Welcome"`, `"Plain text body"`) survives the wrap verbatim, that
   `renderEmailDefinitionPreview` (the actual function every send path
   calls) emits the tags, that the `bgcolor=` attribute is present, and
   that merge-tag substitution (`{first_name}` → `Ada`) still works
   correctly inside the wrapped body. Re-run in isolation this session: **7
   passed, 0 failed, 0 todo.**
5. **Full automated suite, re-run this session (not reused from a prior
   session's numbers):**

   | Check | Result |
   |---|---|
   | `npm run lint` | PASS — no ESLint warnings or errors |
   | `npx tsc --noEmit --pretty false` | PASS except the same **3 pre-existing, unrelated** baseline errors, unchanged in file/line (`attendees-roster.test.ts:106,160,221`; `event-org-scoping.test.ts:152-154`; `register-route.test.ts:62`) |
   | `npm run build` | PASS, exit 0 — `/dashboard/events/[eventId]/emails` and every touched API route compile and appear in the route manifest |
   | `npm test -- --run` | PASS — **120 files / 1471 tests, 0 failing, 0 `it.todo`** (exact match to the count this pass was told to expect; up from the prior pass's 1468 passing + 3 todo — the delta is exactly the 3 `it.todo` markers now promoted to real passing assertions) |

6. **Wrapper byte-size spot-check against the 256 KB cap (not reused from
   the prior pass's bare-fragment numbers).** The existing
   `email-render-blocks-pipeline.test.ts` §3 AC-4 tests still pass (19/19
   in that file) but exercise `deriveBodyHtmlFromBlocks` directly — the
   **bare** fragment, not the now-wrapped `bodyHtml` the real send pipeline
   actually validates (`send-service.ts`'s `validateRenderedEmailContent`
   call operates on the output of `renderEmailTemplate`, whose input is
   `deriveBodyForDefinition`'s **wrapped** `bodyHtml` — confirmed by
   tracing `test-send/route.ts`'s call chain). To close that gap, this pass
   independently ran a throwaway (uncommitted, deleted after use) spot-check
   through the real wrapped path:
   - Realistic 20-Hero-block fixture, **wrapped**: **17,691 bytes** —
     comfortably under 256 KB, `validateRenderedEmailContent` returns
     `ok: true`.
   - Pathological 40×maxed-Highlights fixture, **wrapped**: **401,411
     bytes** — still legitimately exceeds the 256 KB cap,
     `validateRenderedEmailContent` returns `ok: false` with
     `BODY_HTML_TOO_LARGE`, exactly as before the fix.
   The wrapper adds a small, fixed number of bytes (well under 1 KB) that
   does not change either outcome. No regression.

**QA-D-2: CLOSED.** The fix is structurally correct, applies to both
authoring modes, is inherited automatically by every real consumer with no
call site missed, does not touch the hash-pinned `merge-tags.ts` tripwire,
and does not regress the 256 KB cap behavior for either realistic or
pathological content. The secondary `bgcolor=` nit was also closed in the
same pass (verified present via the regression test's own assertion).

---

## Verdict

| Ticket | Verdict |
|---|---|
| M6-T4 — Email designer via shared block engine | **SIGNED OFF** |

QA-D-2 (the sole open Major defect) is confirmed fixed and independently
re-verified per the above — not merely re-read from the fix author's own
claim. No new defects were found during this re-verification pass. Combined
with the original pass's findings (all of §1–§5, §7, §8 already PASS,
carried forward unchanged — this re-verification pass did not re-run that
full matrix since nothing in this diff touches those areas beyond
`render.ts`'s single new wrapper function and its call sites), and §3's
security-critical controls still holding (unchanged `merge-tags.ts`, no new
XSS surface — the wrapper is a fixed string with no organizer-influenced
interpolation point), the sign-off bar ("all acceptance criteria pass, no
open defects of severity Major or above") is now met.

**What remains genuinely unverified, disclosed honestly, carried forward
unchanged from the original pass (none of this is closed by the QA-D-2 fix,
and none of it is newly discovered by this pass — it is the same
environment constraint disclosed twice now, not silently dropped):**
- Real Outlook desktop / Gmail web / Apple Mail rendering verification of a
  representative mixed-block email (spec §6 AC-1) — no real email client or
  email-rendering-testing service (Litmus/Email on Acid) available in this
  environment.
- A real dark-mode client screenshot confirming Apple Mail/iOS Mail
  actually honors the now-present `color-scheme`/`supported-color-schemes`
  meta tags (spec §6 AC-2's client-side half — the structural half is now
  closed by QA-D-2's fix, but a live client was never available to confirm
  the client-side behavior it declares).
- A real multi-breakpoint/multi-theme screenshot pass of the dashboard
  chrome (§8-4) — no browser-driving tool available in this environment,
  for this or any prior ticket in this loop.
- The live in-canvas Puck keyboard/drag-and-drop experience (§4 AC-5) —
  jsdom cannot mount the real `<Puck>` canvas; this is a pre-existing,
  spec-acknowledged upstream limitation, not a gap introduced by this
  ticket.

These are flagged for the Orchestrator/product owner's awareness before any
real (non-dev-outbox) email transport ships, per spec §6's own framing —
they do not gate this sign-off, since spec §6 itself anticipates this
environment's tooling gap and scopes QA's assignment to the
structural verification this pass (and the original pass) performed.

**Final automated suite state:** `npm run lint` clean · `npm run build`
exit 0 · `npx tsc --noEmit` clean except the same 3 pre-existing baseline
errors carried through Code Review, Security, and both QA passes ·
`npm test -- --run` → **120 files / 1471 tests passing, 0 failing, 0
`it.todo`**.
