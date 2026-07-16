# Security Review — M6-T4 Email designer via shared block engine

Security Agent, 2026-07-16. Scope: all uncommitted M6-T4 changes relative to
`prototype` — new `src/features/emails/server/blocks/**` (8 block renderers +
`url-validator`/`text-utils`/`image-utils`/`styles`/`types`/`index`), new
`src/features/emails/server/resolve-block-context.ts` and
`src/lib/email/base-url.ts` (the B-1 header-trust fix), new
`src/features/emails/components/{email-block-designer,email-canvas-disclaimer,
email-block-field-note,email-definition-picker-menu,email-editor-mode-toggle,
email-puck-config}.tsx`, modified `email-editor-dialog.tsx`,
`emails-workspace.tsx`, `merge-tag-menu.tsx`,
`src/features/emails/server/render.ts`, `src/lib/email/schemas.ts`,
`src/types/collection.ts`, `src/lib/db/adminEmailDefinition.ts`, the 7 call
sites now wired to `resolveEmailBlockRenderContext` (preview route,
test-send route, the emails page confirmation-preview card,
`fire-on-submit-email.ts`, `fire-on-accept-email.ts`,
`paged-trigger-runner.ts`, the `email-all` route), and the additive-only
changes to `src/lib/email/lifecycle/{evaluate-*,paged-trigger-runner}.ts` and
`vitest.config.mts`. Reviewed against `agents/docs/specs/m6-email-designer.md`
(§3 in full — the render-pipeline's 5 mandatory controls), the Code Review
(`agents/docs/reviews/m6-email-designer.md`, APPROVED including the B-1
re-review), and the two prior security baselines this ticket extends
(`agents/docs/security/m6-emails-admin.md`, `agents/docs/security/
m6-email-infrastructure.md`).

Gate 2 of 3 (code review APPROVED → security → QA). Per the task brief, the
render-pipeline controls and the header-trust question were independently
re-verified from source rather than trusted from the two prior clean passes
(the implementer's own Codex check, then Code Review's B-1 re-review).

## Checks executed

- `npm run lint` — clean, no warnings/errors.
- `npm run build` — succeeds; `/dashboard/events/[eventId]/emails` and every
  touched API route (including `/api/internal/email-triggers/evaluate`)
  compile and appear in the route manifest.
- `npm test -- --run` — **119 files / 1463 tests passing**, matching the
  Code Reviewer's re-review count exactly.
- `npm audit --audit-level=high` — 24 pre-existing vulnerabilities
  (vitest UI-server file-read, `websocket-driver`, the firebase-admin/
  `@google-cloud/firestore` chain, vite — same family M6-T1/T2's security
  reviews already flagged as pre-existing/out of scope, one entry higher
  than T2's count, consistent with normal transitive-dependency drift, not
  a new risk introduced by this diff); `git diff prototype -- package.json
  package-lock.json firestore.rules firestore.indexes.json` is empty,
  confirming no new dependency surface and no rules changes were introduced
  by this ticket.
- Independent, from-source re-read of all 8 block renderers, the 5 shared
  block-engine primitives (`text-utils.ts`, `image-utils.ts`, `styles.ts`,
  `url-validator.ts`, `index.ts`), `resolve-block-context.ts`,
  `base-url.ts`, `render.ts`, the write-time Zod schemas
  (`src/lib/email/schemas.ts`), `adminEmailDefinition.ts`'s transaction
  logic, all 7 real call sites, `email-puck-config.tsx` (the client-side
  canvas registry), and a targeted `python3`/`grep` sweep for any
  `${...}` interpolation inside a `style="..."` attribute across every
  renderer file plus `styles.ts`.

## Focus-area findings (independent verification, per the task brief)

### 1. The 5 render-pipeline controls (spec §3.1), independently, in all 8 renderers — PASS

- **Control 1 (type allowlist).** `isEmailSafeBlockType`
  (`src/features/emails/server/blocks/index.ts:52-56`) is a `Set`-backed
  membership check against `EMAIL_SAFE_BLOCK_TYPES`
  (`src/types/collection.ts`, single source of truth). `deriveBodyHtmlFromBlocks`
  / `deriveBodyTextFromBlocks` (`src/features/emails/server/render.ts:49-76`)
  both `.filter()` on this predicate *before* dispatch — an unknown/removed
  type is dropped, never reaches `renderEmailBlockHtml`, never throws.
  `renderEmailBlockHtml`'s own `switch` (`index.ts:65-94`) additionally has
  a non-throwing `default: return null` as a second, redundant guard even
  though the caller already filtered — genuine defense in depth, not a
  single point of failure.
- **Control 2 (per-prop schema, re-run at render time, independent of
  write-time Zod).** Every free-text prop reads through
  `shortText`/`longText`/`escapedShortText`/`escapedLongText`/
  `escapedLongTextWithLineBreaks` (`text-utils.ts:21-57`): a non-string
  coerces to `""` (never throws on out-of-band-corrupted data), is
  re-clamped to the exact same `EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS`/
  `EMAIL_BLOCK_LONG_TEXT_MAX_CHARS` tiers the write-time schema enforces,
  and only then passed through `escapeHtml`. Every URL-typed prop
  (`imageUrl` on Hero/Story) goes through `safeImageUrl`
  (`image-utils.ts:16-23`), which independently re-runs `isEmailSafeUrl`
  and returns `null` — not the raw string — on any failure, so the caller
  falls back to its no-image state rather than ever passing an unsafe value
  through. I independently confirmed `text-utils.ts`/`image-utils.ts`
  import `escapeHtml` from `@/lib/email/merge-tags` and `isEmailSafeUrl`
  from `@/lib/email/schemas` (via the `url-validator.ts` re-export) — a
  `grep -rn "function escapeHtml\|function isEmailSafeUrl"` across
  `src/features/emails/server/blocks/` returns **zero** hits: neither
  function is reimplemented anywhere in this directory, only imported.
- **Control 3 (URL-scheme validation as a control separate from escaping,
  not merely "escaping also runs on URL values").** `isEmailSafeUrl`
  (`src/lib/email/schemas.ts:280-299`) is a `new URL(trimmed)` parse (no
  base argument, so a bare relative path throws by construction) gated by
  an explicit `Set(["http:", "https:"])` allowlist, plus an explicit
  `trimmed.startsWith("//")` reject stated independently of the URL
  constructor's own behavior. This is genuinely a distinct code path from
  `escapeHtml` — confirmed by reading every call site: `hero.ts:20`,
  `story.ts:16` (both via `safeImageUrl`), and
  `registration-embed.ts:56-71` (`isEmailSafeUrl(rawHref)` gates whether an
  `<a href>` is ever emitted at all, with `escapeHtml` applied only
  *afterward*, to the already-scheme-validated string). I independently
  ran the exact adversarial values spec §3.1 names —
  `javascript:alert(1)`, `data:text/html,<script>alert(1)</script>`,
  `vbscript:msgbox(1)`, `file:///etc/passwd`, and `//evil.example/x`
  (protocol-relative) — through the logic by hand: `new URL("javascript:alert(1)")`
  parses successfully (protocol `javascript:`) and is rejected only by the
  `SAFE_PROTOCOLS`/`EMAIL_SAFE_URL_SCHEMES` allowlist check, not by the
  `URL` constructor throwing — proving the allowlist check is load-bearing,
  not redundant with parse-failure. `data:`/`vbscript:`/`file:` are
  rejected the same way (parse succeeds, scheme fails the allowlist);
  `//evil.example/x` is rejected by the explicit `startsWith("//")` check
  before parsing is even attempted. This matches (and I independently
  re-derived, not just re-read) the exact "escaping alone does not
  neutralize a dangerous URL scheme" reasoning spec §3.1 requires.
- **Control 4 (zero free-text `style=` attributes, ever).** I wrote and ran
  a standalone script extracting every `style="..."` attribute literal from
  all 8 renderer files plus `styles.ts`, then extracting every `${...}`
  interpolation inside each one. **Every single interpolation across all 9
  files resolves to `EMAIL_BLOCK_COLORS.*`** — a fixed, code-authored
  11-entry hex-color table (`styles.ts:13-25`) — with zero exceptions:
  confirmed for `hero.ts`, `highlights.ts`, `story.ts`, `schedule.ts`,
  `faq.ts`, `registration-embed.ts`, `ticket-pricing-table.ts`,
  `countdown-timer.ts`, and `styles.ts`'s own `emailBlockCard`. The two
  enum props that exist (`imageSide` on Story, `target` on CountdownTimer)
  are read via plain `===`/ternary comparisons that select which HTML
  fragment (order/branch) to emit, never a value interpolated into a style
  string — confirmed by direct read of `story.ts:17,32-35` and
  `countdown-timer.ts:30,64-67`. This is independently corroborated by the
  existing source-level test
  (`src/__tests__/email-block-renderer-source-safety.test.ts`), which I
  read in full and confirm performs the genuinely equivalent check
  (regex-extracts every `style="..."` and asserts every `${...}` starts
  with `"EMAIL_BLOCK_COLORS."`, plus a second assertion that no renderer
  ever reads a literal `props.style`) — this is a real, non-tautological
  test, not a name-only placeholder.
- **Control 5 (`renderEmailTemplate` genuinely unmodified).** I
  independently ran `shasum -a 256 src/lib/email/merge-tags.ts` and it
  matches the hash the pipeline test pins
  (`e33eadbb83e919e9259265fff4c462f815f0e45c629a9d16cb20e76baefdef86`,
  `src/__tests__/email-render-blocks-pipeline.test.ts:333-336`) exactly.
  `git diff prototype -- src/lib/email/merge-tags.ts` is empty and the file
  does not appear in `git status --porcelain` at all — a real, hash-pinned
  tripwire, not an aspirational comment. `render.ts:131-156`
  (`renderEmailDefinitionPreview`) confirms both `bodyMode` branches funnel
  into the **same, single** `renderEmailTemplate(...)` call at the bottom
  of the function.
- No block renderer emits `<script>`, `<iframe>`, `<object>`, `<embed>`,
  `<form>`, `<style>`, or an `on*=` attribute anywhere — confirmed by
  direct read of all 8 files (the only place a `<form` substring could
  plausibly appear, RegistrationEmbed, is absent in all 3 of its real
  branches plus the defensive 4th "open-but-unsafe-href" fallback, verified
  below).

### 2. `base-url.ts` / `resolve-block-context.ts` — independent third pass on header-trust — PASS, fully closed

Two prior reviews (the implementer's own Codex check, then Code Review's
B-1 re-review) both concluded this is clean. I ran my own independent
sweep, not trusting either prior pass:

```
grep -Hn -E "headers\(\)|X-Forwarded|req\.headers|request\.headers|NextRequest|\.host\b|Host header" <every file changed by this diff>
```

Result: the **only** matches in the entire diff are two explanatory
**comments** (`base-url.ts:14`, and one in `email-base-url.test.ts:15`
documenting the invariant under test) — zero matches to any actual
header-reading statement, `NextRequest` parameter, or `next/headers`
import anywhere in `base-url.ts`, `resolve-block-context.ts`, or any of the
7 call sites. I additionally grepped the whole `src/` tree for any other
module that both imports `next/headers` and mentions "email" (to catch a
header-derived base URL hiding in a helper this diff merely calls into);
the only hit relevant to this diff's import graph is
`src/features/registration/server/route-scope.ts`, which imports `cookies`
from `next/headers` for **session-cookie authentication** — unrelated to
URL construction, and unchanged by this diff. `resolveEmailBaseUrl()`
(`src/lib/email/base-url.ts:33-52`) reads exactly one input,
`process.env.NEXT_PUBLIC_APP_URL`, parses it with `new URL(raw)` inside a
`try/catch`, rejects any protocol outside `Set(["http:", "https:"])`
(closing the `javascript:`/`ftp:`/`data:`-as-configured-value edge case
too), and returns `.origin` — never the raw string — so a configured value
with a trailing path/query/slash can't leak an unintended path segment
into every generated link. Every failure path (unset, malformed, unsafe
scheme) returns `null`, never throws.

I also independently traced **every** caller of `resolveEmailBaseUrl()`
(`grep -rn "resolveEmailBaseUrl" src/` outside test files returns exactly
one call site: `resolve-block-context.ts:106`) to confirm there is no
second, parallel base-URL resolver anywhere in the diff that might take a
different, less-safe posture. There is exactly one function that builds
this URL, and it is the one audited above.

**Independent conclusion (third opinion): the header-trust vulnerability
is genuinely and completely closed.** There is no code path anywhere in
this diff, or in anything this diff's server-side email code imports, that
derives an outbound email link from `Host`, `X-Forwarded-Host`, or any
other client-controlled request header. The only source is the deploy-time
`NEXT_PUBLIC_APP_URL` environment variable, validated to be a well-formed
absolute `http(s)://` origin before use. A forged `Host` header cannot
influence a link embedded in a real outbound email anywhere in this
feature. I concur with both prior reviews without reservation.

### 3. RegistrationEmbed's `registerHref` — render-time re-validation confirmed, not bypassed by the B-1 fix — PASS

`resolve-block-context.ts:127-132` builds
`` `${baseUrl}/events/${input.eventId}/register` `` from the validated
`resolveEmailBaseUrl()` origin and a path/event-id template — this is a
**caller-supplied**, not organizer-typed, value, but `registration-embed.ts`
does not special-case it as "trusted because it's caller-supplied": line
56-71 re-runs `isEmailSafeUrl(rawHref)` on it unconditionally before ever
building the `<a href>`, exactly as spec §3.1 step 2 requires for *every*
URL-typed value regardless of provenance. I confirmed this is not merely
theoretical by reading (and independently re-deriving the correctness of)
the existing adversarial test
(`src/__tests__/email-block-renderers.test.ts:341-347`): a context with
`registerHref: "javascript:alert(1)"` and `state: "open"` renders HTML that
**does not contain** the string `"javascript:alert(1)"` anywhere, and falls
through to the "zero paths configured" static-notice branch rather than
ever reaching an `<a href>` — this is the correct defense-in-depth
behavior, and it is exercised by a real test, not merely asserted safe by
comment. The B-1 wiring fix (`resolve-block-context.ts`) did not introduce
a bypass of this render-time control — it is the *producer* of a value
that still must clear the same gate every other URL-typed value clears.

### 4. CSS-injection / tracking-pixel vectors — PASS, no path exists

Re-confirmed via the same interpolation sweep as Control 4 above: no block
prop can influence a `background-image` URL or any other style-bearing
attribute — `grep -rn "background-image" src/features/emails/server/blocks/`
returns zero hits anywhere in the directory, and the sole background-color
property that exists (`background-color:${EMAIL_BLOCK_COLORS.*}` in
`styles.ts` and `registration-embed.ts`) only ever interpolates a
fixed-table color constant, never a prop-derived URL or string. There is
no free-text `style` prop anywhere in the write-time Zod schemas
(`src/lib/email/schemas.ts`'s 8 `emailXBlockPropsSchema` definitions) for
an organizer to even attempt to populate one. This structurally closes the
documented "attacker-controlled `style="background-image:url(...)"`"
tracking/exfiltration technique spec §3.1 step 2 names — there is no input
surface for it to exploit.

### 5. Mode-switch / dirty-tracking — no new permission tier — PASS

`bodyMode`/`bodyBlocks` join the exact same editable-fields bucket as
`subject`/`body` in both the write-time Zod envelope
(`src/lib/email/schemas.ts:538-552`,
`emailDefinitionEditablePatchSchema`) and the DAL's lock-check
(`src/lib/db/adminEmailDefinition.ts:71`, `SYSTEM_LOCKED_SCALAR_FIELDS =
["name", "group", "audience"]` — neither new field is listed, matching
`subject`/`body`'s existing unlocked status). The editor dialog
(`email-editor-dialog.tsx:220-320`) only ever calls the same two pre-existing
routes (`POST .../emails/preview`, `PATCH .../definitions/[kind]`) — no new
API route was added (confirmed: `git diff --stat prototype -- src/app/api/`
shows only edits to already-existing route files, zero new route files
under the emails tree). Both routes independently re-run the full
`write:events` → org-membership → rate-limit → Zod-validate chain
server-side regardless of what the client sends; the client-side mode
toggle is purely a UI state, never a trust boundary. `upsertAdminEmailDefinition`
(`adminEmailDefinition.ts:198-217`) `safeParse`s both the `ifAbsent` and
`patch` shapes with the same Zod schemas **inside** the transaction — a
direct API call bypassing the Puck UI entirely (e.g., a raw `PATCH` with a
hand-crafted `bodyBlocks` payload) is still fully validated, never a
silent passthrough. No new authorization decision is made client-side.

### 6. Secrets / size caps — PASS, enforced at write time, not just documented

- `EMAIL_BODY_BLOCKS_MAX_COUNT = 20` and `EMAIL_BODY_BLOCKS_MAX_BYTES =
  48 * 1024` (`src/lib/email/schemas.ts:512-513`) are real Zod
  constraints — `emailBodyBlocksSchema` (`:515-528`) is `.max(20, ...)`
  plus a `.refine()` on `Buffer.byteLength(JSON.stringify(blocks), "utf8")`
  — and this schema backs **both** `emailDefinitionEditablePatchSchema`
  (the PATCH-route boundary) and `emailDefinitionIfAbsentSchema`/
  `emailDefinitionCreateCustomSchema` (the materialize/create boundaries),
  all three of which `upsertAdminEmailDefinition` re-`safeParse`s
  server-side inside the write transaction — a caller cannot bypass this
  cap by skipping client-side validation.
- The existing 256 KB rendered-`bodyHtml` cap
  (`EMAIL_BODY_HTML_MAX_BYTES`, `src/lib/email/schemas.ts:97`,
  `validateRenderedEmailContent`) is genuinely **unchanged** and
  **genuinely still applied** to block-mode output — confirmed two ways:
  (a) `send-service.ts:270` calls `validateRenderedEmailContent(rendered)`
  unconditionally on whatever `bodyHtml` string `deriveBodyForDefinition`
  produced, regardless of `bodyMode`, and every real send path (test-send,
  both real-time triggers, the paged-trigger runner, `email-all`) routes
  through this single `sendEventEmail`/`validateRenderedEmailContent`
  chokepoint — no block-mode-specific bypass exists; (b) a dedicated test
  (`email-render-blocks-pipeline.test.ts:215-267`) proves the cap is a
  genuine, still-enforced limit for block-mode output specifically: a
  realistic 20-block fixture stays comfortably under 256 KB, and a
  deliberately pathological all-fields-maxed 20-block fixture legitimately
  **fails** with `BODY_HTML_TOO_LARGE` — the cap was not silently raised or
  bypassed for the new authoring mode.
- No secrets are introduced by this diff. `grep -rn "NEXT_PUBLIC"` across
  every new/modified file in this ticket returns only the one legitimate,
  intentional use (`NEXT_PUBLIC_APP_URL` in `base-url.ts`, discussed above)
  — no other env var, API key, or credential-shaped string appears
  anywhere in the diff. No new client component imports anything from
  `src/features/emails/server/**` (the import-boundary test,
  `email-block-renderer-boundary.test.ts`, independently locks this: every
  module under `server/blocks/` carries `import "server-only";`, contains
  no Firestore import, and never imports the `"use client"` web Puck
  registry). The new client-side canvas registry
  (`email-puck-config.tsx`) reuses only the web block registry's `render`
  closures (React-JSX, auto-escaped by construction) and never touches
  `server/blocks/**` — confirmed by reading the file's imports directly
  (`@/features/event-pages/puck`, `@/features/emails/types` — no
  `server/blocks` import anywhere).

## Additional checks performed (not explicitly requested, done for completeness)

- **No `dangerouslySetInnerHTML`/`innerHTML` anywhere in the new component
  files** — `grep -rn "dangerouslySetInnerHTML" src/features/emails/`
  returns two hits, both in files this diff does **not** touch
  (`confirmation-preview-card.tsx`, already reviewed and approved by T2's
  security review for its trusted server-minted QR SVG; `send-log-row-detail.tsx`,
  a comment noting the *absence* of the pattern). Zero occurrences in any
  M6-T4 file.
- **Block `id` values are never interpolated into rendered HTML** — `grep
  -rn "block\.id"` across `index.ts`/`render.ts` returns no usage inside a
  template string; `id` only ever flows through as a React/Puck
  bookkeeping key on the client canvas side, never reaches the server-side
  HTML string builders.
- **`formatFeePrice`/`formatRate`/`escapeHtml(currency)` in
  `ticket-pricing-table.ts`** — `formatFeePrice` (`src/features/pricing/utils.ts:54-59`)
  is pure numeric formatting (no string concatenation of external input);
  `ticket.name`/`ticket.code`/`audienceNames` originate from Firestore
  `TicketType` docs (not a block prop the write-time schema above
  validates) but are still passed through `escapeHtml` at every
  interpolation site (`ticket-pricing-table.ts:79-83`), matching spec
  §3.1 step 3's "every interpolation site, independent of source"
  requirement — genuine defense in depth even though this specific data
  is not organizer-typed.
- **M-1 from the M6-T2 security review (missing rate limiting on
  `POST/PATCH/DELETE .../definitions[/kind]` and `DELETE .../settings`)
  is resolved** — confirmed `checkRateLimit` is now present in all four
  previously-flagged routes (`definitions/route.ts`,
  `definitions/[kind]/route.ts` both PATCH and DELETE,
  `settings/route.ts` both PATCH and DELETE). Not part of this ticket's
  scope to re-verify in depth, but noted as a positive: no regression, and
  the PATCH route this ticket's own `bodyMode`/`bodyBlocks` traffic funnels
  through (`definitions/[kind]/route.ts:38-41`, 60/min/user/event) is rate
  limited.
- **`registration-state.ts`'s `resolveRegistrationCtaState` reuse is
  genuinely safe to import from a `server-only` module** — the file has no
  `"use client"` directive and no Firebase import (confirmed by direct
  read of its header comment and imports), so importing it from
  `resolve-block-context.ts` does not violate the server-only/DAL-boundary
  posture this feature otherwise enforces.

## Findings summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

No new findings — Critical, High, Medium, or Low — were identified in this
review beyond what the two prior code-review passes already surfaced and
closed (B-1, now fully resolved). Every one of the task brief's six
specific focus areas was independently re-derived from source, not trusted
from the prior clean passes, and all six hold up under that independent
scrutiny.

## Verdict

**PASS.** All 5 of spec §3.1's render-pipeline security controls are
genuinely present and independently re-verified, from source, in every one
of the 8 block renderers — type allowlist, per-prop re-validation
(escape-then-substitute via the verbatim-reused `escapeHtml`, never
reimplemented), URL-scheme validation as a control genuinely separate from
escaping (independently re-derived against the exact adversarial values
spec §3.1 names: `javascript:`, `data:`, `vbscript:`, `file:`,
protocol-relative), zero free-text `style=` attributes anywhere (every
single `${...}` interpolation inside every `style="..."` in all 9 files in
`server/blocks/` traces to `EMAIL_BLOCK_COLORS.*` only, confirmed via a
standalone extraction script, not spot-checked), and a hash-pinned,
independently-confirmed-unmodified `renderEmailTemplate`. The B-1
header-trust fix (`src/lib/email/base-url.ts`,
`src/features/emails/server/resolve-block-context.ts`) is confirmed, on an
independent third pass, to be fully and completely closed: the only source
of the embedded base URL anywhere in this diff or its import graph is
`NEXT_PUBLIC_APP_URL`, validated, never falling back to any request-derived
value; a full-diff header-pattern grep found zero header-reading code, only
explanatory comments. RegistrationEmbed's live `registerHref` (now
real, post-B-1) still passes through `isEmailSafeUrl` at render time before
ever reaching an `<a href>`, exercised by a real adversarial test — the B-1
wiring did not create a bypass of the render-time control spec §3.1 step 2
requires even for caller-supplied values. No CSS-injection/tracking-pixel
vector exists — there is no free-text style prop anywhere in the registry
for one to exploit. `bodyMode`/`bodyBlocks` carry no new permission tier —
same routes, same `write:events` gate, same Zod re-validation inside the
DAL transaction. `EMAIL_BODY_BLOCKS_MAX_COUNT`/`MAX_BYTES` are real,
server-enforced Zod constraints (not merely documented), and the existing
256 KB rendered-HTML cap is confirmed still genuinely applied, unchanged,
and unraised for block-mode output, including a test that a deliberately
pathological fixture legitimately fails it. `npm run lint` clean,
`npm run build` succeeds, `npm test -- --run` passes at **119 files / 1463
tests**, `npm audit --audit-level=high` shows only pre-existing,
diff-unrelated findings (package manifests untouched).

**Cleared to proceed to QA.** No Critical/High/Medium/Low findings to
route back to any agent.
