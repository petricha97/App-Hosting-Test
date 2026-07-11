# QA — M4 Event Website: New Blocks & Per-Path Pages

QA Agent, 2026-07-11. Branch `feat/m4-website-blocks` (uncommitted working tree).
Spec: `agents/docs/specs/m4-website-blocks.md` (27 ACs: T1 = 20, T2 = 7). Design: `agents/docs/design/m4-website-blocks.md`. Inputs: code review (B1 + S1–S3, N1–N5) and security review (PASS; SEC-M4-1 Medium) — all blocking items claimed fixed.

## Verdict: **SIGNED OFF** — 27/27 ACs pass. 1 Minor defect open (QA-M4-D1, below the Major sign-off threshold), routed + locked by a regression test.

---

## Suite results (executed, not inferred; vitest run from uppercase `C:\` cwd per Windows quirk)

| Check | Result |
|---|---|
| `npm run lint` | PASS — "No ESLint warnings or errors" |
| `npm run build` | PASS — "Compiled successfully", 31/31 pages; route table unchanged vs. M3 (no routes added/removed; `/events/[eventId]`, `/dashboard/events/[eventId]/page-builder`, page/publish/paths API routes all present and dynamic) |
| `npx vitest run` (pre-QA tree) | PASS — **52 files / 759 tests green** (includes all M4 tests + review-fix regressions) |
| `npx vitest run` (after QA regression file added) | PASS — **53 files / 763 tests green**. New file `src/__tests__/event-page-editor-discard.test.tsx`: 3 passing switcher-guard locks + 1 `it.fails` documenting open defect QA-M4-D1 (fails by design today; flip to `it` when the fix lands — vitest will flag it as "expected to fail, but passed") |

Not executed: live-browser E2E against seeded Firebase data (no seeded env in this session — same constraint as M0–M3 QA). Flow verification below is code-trace + unit/route/component-test evidence.

## Review/security fix verification (all landed)

| Fix | Verified at |
|---|---|
| **B1** — offset-less `datetime-local` custom targets resolved in the EVENT timezone, not process TZ | `src/features/event-pages/countdown.ts:40-66` (`OFFSETLESS_DATE_TIME` → `eventLocalDateTimeToUtcMs`, explicit-offset strings keep `Date.parse`); TZ-stubbed regression tests `countdown-utils.test.ts:81-158` (same instant across UTC / New_York / Singapore / Kiritimati process TZs, DST wall clock, seconds/millis variants, stable absolute-target label = SSR/client identical) |
| **SEC-M4-1** — public RSC payload carries projection only | `src/features/event-pages/utils.ts:43-65` (`serializePublicEventPage`, exact keys id/title/publishedContent); wired in `src/app/events/[eventId]/page.tsx:131`; `PublicCustomEventPage` prop type narrowed to `PublicEventPagePayload`, `?? draftContent` fallback removed (`public-custom-event-page.tsx:79` renders `publishedContent` only); locked by `public-event-page-projection.test.ts` (exact key list + "UNANNOUNCED draft heading" never serializes) |
| **S1** — cascade-before-delete, failure-safe | `registration-paths/[pathId]/route.ts:186-198` (page cascade FIRST, then path delete); `path-delete-cascade.test.ts` asserts invocation order, path intact on cascade failure (retryable), no cascade on 409-blocked or 404 |
| **S2** — route + component test gaps | `event-page-routes.test.ts` (AC-25 foreign/unknown pageKey → 400 no-write on save AND publish; AC-24 path publish never flips pageMode/eventPagePath; default publish does; cross-org 404 before pageKey handling); `event-page-blocks.test.tsx` (AC-16 legacy default label, AC-14 legacy inline form, AC-17 XSS on all three blocks + hostile `customDateTime` never echoed, AC-4 sold-out badge, AC-5/8 empty state) |
| **S3** — `window.confirm` → AlertDialog | `event-page-editor-workspace.tsx:404-412` (pending switch stashed out of Radix `Select.onValueChange`), `:1251-1281` (AlertDialog, cancel = "Keep editing"); behavior locked by QA's `event-page-editor-discard.test.tsx` |
| **N2** — `?path=` `string | string[]` normalized | `src/app/events/[eventId]/page.tsx:30,39`; `page-builder/page.tsx:25,34` |
| **N3** — editor CTA preview href carries `?path=` | `event-page-editor-workspace.tsx:352-356` |
| **N5** — tree junk | both `debug.log` files deleted; `.gitignore` covers `debug.log`, `**/debug.log`, `/prototype/contact_sheet.jpg`, `/prototype/metadata/` (lines 29-30, 56-57); `git status` clean of them |

---

## AC-by-AC results

### T1 — Block 1: TicketPricingTable (8/8 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 derived-closed hidden, inclusive boundaries | PASS | `pricing-projection.ts:74-84` reuses M1 `isTicketOpen`; tests: manual close / before start / after end hidden, open AT salesStart and AT salesEnd exactly |
| 2 unpriced hidden; "—" in unpriced currency columns | PASS | `pricing-projection.ts:87-89` (no active fee → skip; archived never price — tested); `ticket-pricing-table.tsx:37-41` `priceLabel` → "—"; projection test "omits currencies a ticket is not priced in, while the projection still lists them as columns" |
| 3 min-across-fees "from" price per currency | PASS | `isFrom: distinct.size > 1` (`pricing-projection.ts:107-112`) — equivalent to M3 `ticket-price.ts` `min !== max` rule (verified side-by-side); `formatFeePrice` for minor units; block renders `from $120.00` (component test) |
| 4 sold-out badge, price visible, never hidden | PASS | `soldOut: capacity − registeredCount ≤ 0` boolean only; component test: badge in table + mobile card, price rendered |
| 5 empty state both surfaces, never broken table | PASS | component test (null projection → message, no `<table>`); builder passes `editorHints: true` → canvas adds "add tickets & fees under Pricing" hint (`ticket-pricing-table.tsx:98-103`); no sample data (spec overrides design here — design doc itself defers data semantics to spec) |
| 6 post-publish fee/ticket edit reflects without republish | PASS | `page.tsx:79-94` fetches `listPublicTicketsForEvent` per request; `publishAdminEventPage` snapshots `draftContent` (block props) only — no price data in the doc |
| 7 public-safe projection | PASS | exact-key rebuild (name/code/soldOut/audienceNames/prices{currency,minPriceMinor,isFrom}); AC-7 test asserts exact key sets at every level |
| 8 fetch failure → emptyMessage, no 500 | PASS | `page.tsx:85-95` try/catch → `pricingTickets = null` + `console.error`; null → block empty state (component test) |

### T1 — Block 2: CountdownTimer (4/4 PASS)

| AC | Result | Evidence |
|---|---|---|
| 9 eventStart tracks event doc per request | PASS | `page.tsx:114-117` resolves `resolveEventStartMs(event.periods, event.timezone)` on every request; legacy period key spellings + midnight/malformed-time fallbacks tested |
| 10 invalid custom → event start; neither → completedMessage | PASS | `resolveCountdownTargetMs` tests ("", whitespace, garbage → event start; null start → null); component renders static message branch for null target |
| 11 past/zero → message, never negative | PASS | `diffCountdown` returns null at remaining ≤ 0 (tested at exactly zero); component swaps to `completedMessage` with `role="status"` once |
| 12 hydration-safe, zero layout shift | PASS | `nowMs` starts null → deterministic "--" placeholders SSR+first paint; `min-w-[2ch]/[3ch]` + `tabular-nums`; no `Date.now()` in render; B1 fix makes the absolute-target line environment-independent (TZ-stubbed tests); interval cleaned up on unmount |

### T1 — Block 3: RegistrationEmbed (4/4 PASS)

| AC | Result | Evidence |
|---|---|---|
| 13 ≥1 active path → CTA into M3 flow | PASS | `registration-state.ts` (open = active path + published form); CTA links `/events/[id]/register`; M3 entry untouched: 1 path → server redirect into stepper, 2+ → picker (`register/page.tsx:102-131`) |
| 14 0 paths ever → legacy inline form | PASS | `registrationCta = null` wiring on both surfaces (`page.tsx:138-142`, workspace `:345-347`); component test: placeholder renders, no CTA link |
| 15 paths-but-closed → disabled notice, not hidden | PASS | closed span `aria-disabled`, non-focusable, "Registration is currently closed. Check back soon."; editor adds amber paths-link note; component test: no link role, SPAN |
| 16 legacy pages get default buttonLabel | PASS | render-time default (`puck.tsx:695-699`); component test with title/body-only props |

### T1 — Cross-block (4/4 PASS)

| AC | Result | Evidence |
|---|---|---|
| 17 XSS: props as React text, customDateTime never echoed | PASS | every prop `String(...)`-interpolated; zero `dangerouslySetInnerHTML` in `src/features/event-pages/` (grepped); component tests: `<script>` literal text on all three blocks; hostile `customDateTime` (`" onmouseover=`) absent from innerHTML — Intl-formatted instant renders instead |
| 18 palette + 3 viewports, no overflow, mobile stack | PASS | `categories` Content/Registration (`puck.tsx:405-423`); Puck `viewports` 360/768/1280 + preview `max-w` toggles with `aria-pressed` (workspace `:1135-1139`, `:1182-1198`); table `hidden sm:block` + cards `sm:hidden`, wrapping countdown tiles, `w-full sm:w-auto` CTA. Note: the preview-card `max-w` toggle approximates breakpoints (window-based `sm:`), by design — the Puck iframe canvas gives true 360px behavior; table sits in `overflow-x-auto` so no page overflow either way |
| 19 save/publish unchanged; props-only snapshot | PASS | publish = `publishedContent: draftContent` (props only); public page renders `publishedContent` exclusively (SEC-M4-1 fix removed the draft fallback entirely); draft-only path pages not publicly resolvable (test) |
| 20 schema + ensurePuckDataIds round-trip | PASS | `eventPageContentSchema` enforces `props.id` for every block type; new blocks flow through the same `ensurePuckDataIds` on change/save/publish (workspace `:1153`, `:512`, `:558`); route tests submit schema-valid content |

### T2 — Per-path pages (7/7 PASS)

| AC | Result | Evidence |
|---|---|---|
| 21 published path page renders; CTA carries `?path=` | PASS | `resolvePublicPathPage` (active path + published page) test; `page.tsx:120-122` `registerHref` appends encoded `pathId`; path page wins over redirect mode (`:64` guards `!pathPage`) |
| 22 no/draft-only page → default behavior, never 404/blank | PASS | resolution test "falls back when the path has no PUBLISHED page"; fall-through covers custom default page, generic detail, and redirect `pageMode` |
| 23 inactive/foreign/unknown `?path=` ignored | PASS | resolution tests: unknown/foreign (scoped lookup null), INACTIVE never resolves, missing param/org short-circuits with zero lookups |
| 24 switcher complete; pages independent; no pageMode flip | PASS | switcher = "Default event page" + all paths with Inactive badge (workspace `:1040-1059`); per-page cache key `event-page-editor-cache:{eventId}:{pathId|default}`; DAL tests (path publish never touches default doc; re-save updates same `(eventId,pageKey)` doc); route test AC-24 |
| 25 org + path-membership validated on admin routes | PASS | save + publish routes: session → org → `write:events` → event ownership → non-default pageKey must be a path of THIS event (400 otherwise, no write) — route tests both; builder `?path=` 404s foreign/unknown ids (`page-builder/page.tsx:49-54`) |
| 26 delete cascade + warning | PASS | cascade-first ordering + failure-safety + blocked/404 no-cascade (route tests); DAL cascade scoped eventId→org→pageKey (test: only that key's docs, 0 when none); delete confirm swaps to "…its custom page will also be deleted" when `customPageKeys` includes the path (`registration-paths-workspace.tsx:434-435`) |
| 27 legacy docs behave as default | PASS | `pageKey` schema default `"default"` (`schema.ts:38`); DAL tests: legacy doc (no field) resolves as default page, `eventPagePath` id shortcut re-checks parsed pageKey (never serves default doc for a path key), org-scoped; `getAdminEventPageKeysForEvent` counts legacy as default |

### Cross-cutting

- **Multi-org isolation:** all lookups org-scoped (`organizationId` derived server-side from the event's own `organizationPath`, never from input); pre-existing org-scoping suites green; DAL tests include cross-org negative cases.
- **Empty/error states:** pricing empty (public + canvas + editor hint), countdown no-target message, CTA closed notice, paths-table `loadError` panel, builder pricing-load failure degrades block without killing the editor (`page-builder/page.tsx:83-91`).
- **Themes:** public page + canvas are light-only by design (matches existing blocks); builder/paths chrome uses semantic tokens; new paths-table badges carry `dark:` variants.
- **A11y:** sr-only table caption + `scope="col"`; ticker `aria-hidden` + static sr-only fact + one-time `role="status"` completion; badges text-bearing; closed CTA non-focusable `aria-disabled` span; device toggles `aria-pressed` + sr-only labels; "Customize page for {name}" labels; visible "Editing page" label on the switcher.
- **Default-page regression:** all pre-M4 suites green unmodified in behavior (`registration-paths-route.test.ts` updated only to mock the new cascade dependency); build route table unchanged; legacy default-page lookup path proven by AC-27 tests.

---

## Defects

| ID | Severity | Description | Routing |
|---|---|---|---|
| **QA-M4-D1** | **Minor** | Builder page switcher: confirming **"Discard and switch"** does not discard. Every edit is persisted to `localStorage` (`event-page-editor-cache:{eventId}:{pageKey}`) as it happens (`event-page-editor-workspace.tsx:323-329`), and the AlertDialog action (`:1269-1275`) only navigates — it never clears the old page's cache entry. **Repro:** open page-builder → edit the title/canvas (dirty) → switch pages via "Editing page" → confirm "Discard and switch" → switch back. **Expected:** the discarded edits are gone (dialog copy + design §5 "Discard unsaved changes to this page?"). **Actual:** the "discarded" edits silently reload from the cache; a subsequent Save/Publish would persist them. Fix: remove the current cache key inside the discard action before navigating (or reconcile the copy, but design intent is discard). Non-blocking: no data loss, wrong-page writes impossible (per-page keys), single-organizer surface. | fullstack-developer (logic) + ui-ux-designer (dialog copy sanity-check) |

No Major/Critical defects. SEC-M4-2 (dependency upgrades) remains the standing M0 ticket — pre-existing, not M4.

## Regression tests added by QA

- `src/__tests__/event-page-editor-discard.test.tsx` — 4 tests: clean switch navigates without dialog; dirty switch gated behind AlertDialog and cancel stays put; confirm navigates to `?path=`; **`it.fails` lock on QA-M4-D1** (asserts the cache no longer contains the discarded edits — fails today by design, keeping the suite green; when the fix lands vitest reports "expected to fail, but passed" → flip `it.fails` to `it`).

## Final verdict

**SIGNED OFF.** 27/27 acceptance criteria pass; lint/build/tests green (53 files / 763 tests); all review blockers (B1) and should-fixes (S1–S3) plus SEC-M4-1 verified fixed with regression coverage. One Minor defect (QA-M4-D1) remains open, routed above and locked by a regression test — below the Major threshold that would block sign-off. Orchestrator may close M4; QA-M4-D1 should ride the next touch of the page-builder workspace.
