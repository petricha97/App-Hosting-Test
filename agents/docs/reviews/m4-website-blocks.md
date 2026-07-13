# Code Review — M4 Website Blocks & Per-Path Pages

Reviewer: Code Reviewer agent, 2026-07-11. Scope: uncommitted working-tree changes on `feat/m4-website-blocks` (18 modified files, 12 new files incl. 6 test files). Spec: `agents/docs/specs/m4-website-blocks.md` (27 ACs); design: `agents/docs/design/m4-website-blocks.md`.

## Verdict: CHANGES REQUESTED

1 Blocker · 3 Should-fix · 5 Nits.

## Checks run

- `npm run lint` — clean.
- `npx vitest run` — **49 files / 733 tests pass** (includes all 44 new M4 tests). Note: running vitest from a lowercase drive-letter cwd (`c:\...`) makes every suite fail with "No test suite found" — environment quirk, reproduces at clean HEAD; run from `C:\...`.
- `npx tsc --noEmit` — 7 errors, all pre-existing in untouched test files (`event-org-scoping.test.ts`, `register-route.test.ts`); none in this diff.
- DAL grep — no `firebase/firestore` / `firebase-admin` imports added outside `src/lib/db/`. The `FieldValue` imports in the two page routes are pre-existing.

## Findings

### Blocker

**B1. Countdown custom target is parsed environment-locally → hydration mismatch and wrong instant (violates AC-12, breaks AC-10 semantics).**
- `src/features/event-pages/countdown.ts:26-32` (`parseInstantMs` uses bare `Date.parse`), `:62-66` (custom branch).
- `src/features/event-pages/blocks/countdown.tsx:57-61` (target resolved during render), `:97` + `:107` + `:135` (`formatCountdownTarget(targetMs, …)` rendered into SSR markup before mount).
- `src/features/event-pages/puck.tsx:768` — the field is `<Input type="datetime-local">`, which produces offset-less strings like `2026-09-15T09:00`.

Per ES spec, `Date.parse` interprets an offset-less date-time as **local time of the executing environment**. So for `target=custom`: the server (typically UTC) computes one `targetMs`, the hydrating browser computes another whenever the visitor's TZ differs — the visible absolute-target line and the `sr-only` line then mismatch → React hydration warning on essentially every custom-target page (AC-12 requires zero). Independently, the organizer's entered wall-clock is anchored to the *server's* timezone rather than the event's — every visitor is shown the wrong instant, and the countdown flips to `completedMessage` at the wrong time. The digits themselves don't mismatch (placeholders pre-mount) — the absolute-target text does.

Fix: detect the offset-less shape (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/` without `Z`/`±hh:mm`) and resolve it in the **event timezone** via `eventLocalDateTimeToUtcMs` (already added and exported in `src/features/registration/utils.ts:92` but only used for event start — thread the timezone into `resolveCountdownTargetMs`). Keep `Date.parse` for full ISO strings with offset. Add a regression test asserting an offset-less custom value resolves to the same instant regardless of process TZ (`TZ=` variation or explicit zone inputs). Note the existing tests dodge this: `countdown-utils.test.ts:32-40` only exercises a `Z`-suffixed custom value.

### Should-fix

**S1. Delete cascade is not failure-safe — orphan is permanent on partial failure (AC-26).**
`src/app/api/dashboard/events/[eventId]/registration-paths/[pathId]/route.ts:186-195` deletes the path doc first, then cascades the page docs. If the cascade throws, the route 500s with the path already gone; a client retry now 404s at the path lookup and the cascade never re-runs — exactly the orphaned-page-collides-on-recreate scenario AC-26 exists to prevent, with no recovery path. Trivial fix: run `deleteAdminEventPagesForPageKey` **before** `deleteAdminRegistrationPath` (a failed first step leaves the path intact and fully retryable), or batch both deletes.

**S2. Test gaps on new security-relevant and compat-critical branches.**
- The AC-25 validation (non-default `pageKey` must be a registration path of this event, else 400) at `src/app/api/dashboard/events/[eventId]/page/route.ts:66-81` and `.../page/publish/route.ts:66-81` has no route test — no page-route tests exist at all, and this is the branch that stops cross-event/foreign `pageKey` writes. The publish route's AC-24 guard (no `pageMode` flip for path pages) is likewise only covered at the DAL layer, not the route.
- No component-level tests for the three blocks: AC-16 (legacy saved props → default `buttonLabel`), AC-17 (`<script>` prop renders as literal text), AC-4/5 (sold-out badge, empty state) are asserted only indirectly or not at all. Testing Library is available; a few render tests would lock these.

**S3. `window.confirm` in the page switcher — adjudication: replace within this ticket.**
`src/features/event-pages/components/event-page-editor-workspace.tsx:365`. Functionally it satisfies the design's "confirm dialog" requirement, so this is not a blocker. But it is off-convention — the repo consistently uses shadcn dialog patterns (e.g., the registration-paths delete confirm this same diff extends), and a synchronous native `confirm` fired inside Radix `Select.onValueChange` can leave the trigger's focus/open state inconsistent on cancel. Swap for the existing confirm-dialog pattern.

### Nits

**N1. Lookup-then-create — adjudication: accepted as-is.**
`src/lib/db/adminEventPage.ts:100-155`. Two concurrent first-saves for the same `(eventId, pageKey)` could create duplicate docs (no transaction). Accepted because: it matches this module's pre-existing convention for the single default page; the surface is a single organizer's dashboard; and downstream code tolerates duplicates (lookups take first parsed match, `deleteAdminEventPagesForPageKey` removes *all* matches). If it ever matters, a deterministic doc id (`${eventId}__${pageKey}`) removes the race outright. The in-memory `pageKey` filtering is justified: a Firestore equality query on `pageKey` would miss legacy docs lacking the field, and per-event page counts are tiny.

**N2. `searchParams` typed as `{ path?: string }` but Next delivers `string[]` for repeated params.**
`src/app/events/[eventId]/page.tsx:28,36`; `src/app/dashboard/(event)/events/[eventId]/page-builder/page.tsx:23,31`. Degradation is safe (`?path=a&path=b` → lookup miss → default page / dashboard 404), but the type lies; normalize with `Array.isArray(path) ? path[0] : path` (the repo already types other pages as `string | string[]`).

**N3. Editor CTA preview href omits `?path=` when editing a path page.**
`src/features/event-pages/components/event-page-editor-workspace.tsx:335`. Harmless (editor variant renders a non-navigating span), but the preview caption claims it "links to the public registration flow" — make it path-aware for fidelity.

**N4. Dirty-check double-`JSON.stringify` on every Puck `onChange`.**
`src/features/event-pages/components/event-page-editor-workspace.tsx:1115` — O(document) serialization per edit. Fine at current page sizes; revisit if editors get slow.

**N5. Untracked junk in the tree.**
`debug.log`, `src/app/api/dashboard/events/[eventId]/pricing/taxes/debug.log` (also `prototype/contact_sheet.jpg`, `prototype/metadata/`). Ensure these do not ride into the M4 commit; gitignore or delete.

## Special-attention verification notes

1. **`adminEventPage` pageKey semantics (backend hat):** sound. Legacy docs read as `"default"` via the schema default (`schema.ts:37`, proven by `admin-event-page-pagekey.test.ts`); the `eventPagePath` id shortcut is gated to `pageKey === "default"` **and** re-checks `parsed.pageKey`, so a mispointed `eventPagePath` can never serve the wrong page; stale/missing shortcut falls through to the org+pageKey-filtered query, so no legacy lookup path misses its page. `saveAdminEventPageDraft` stamping `pageKey` on update safely normalizes legacy docs (a doc is only ever found under its own key). Route-level path-membership validation (AC-25) present in both save and publish routes.
2. **Countdown hydration:** placeholder-until-mount design is correct (`nowMs` starts `null`, `--` cells, reserved widths, `tabular-nums`), interval cleaned up, drift-free (each tick recomputes from `Date.now()`), completion at exactly zero — **except** the custom-target parse (B1).
3. **RegistrationEmbed backward compat:** verified. Same type + `title`/`body` props; `buttonLabel` defaulted at render for legacy docs (`puck.tsx:693-697`); `registrationCta = null` (0 paths ever) preserves the legacy inline form on both public and editor surfaces (AC-13/14/15/16 wiring all present).
4. **Pricing projection:** min/`isFrom` rule is equivalent to M3 `ticket-price.ts` (`min !== max` ≡ `distinct > 1`); exact-key rebuild verified in code and locked by `pricing-projection.test.ts` (AC-7); live-read confirmed on both surfaces — public `page.tsx` and the page-builder loader fetch per request, and publish stores `draftContent` props only, never price data (AC-6/19).
5. **Path-page resolution:** fallback matrix correct — inactive/foreign/unknown/draft-only all resolve `null` → default behavior including redirect mode, never 404; a published path page wins over redirect (`page.tsx` guards `redirect` with `!pathPage`); cascade delete implemented and tested (ordering caveat S1).
6. **Dev-flagged notes adjudicated:** `window.confirm` → Should-fix (S3); lookup-then-create → accepted (N1).
7. **Tests (44 new):** good quality — behavior-asserting, AC-traceable, strong negative cases (org scoping, blocked-delete no-cascade, inactive-path never resolvable, exact public key lists). Gaps captured in S2 + B1's missing regression.

## Re-review

Return after fixing B1 (+ regression test) and S1–S3. Nits optional.
