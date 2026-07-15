# Security Review — M6-T2 Emails admin screen

Security Agent, 2026-07-15. Scope: all uncommitted M6-T2 changes relative to
`prototype` — new `src/lib/db/{adminEmailDefinition,emailDefinitionId}.ts`
(+ `deleteAdminEmailSettings` added to `src/lib/db/adminEmailSettings.ts`),
new `src/features/emails/**` (components + `server/{render,sample-context,
read-json-body,serialize,trigger-wire}.ts` + `default-definitions.ts`/
`schemas.ts`/`types.ts`/`utils.ts`), new
`src/app/api/dashboard/events/[eventId]/emails/**` (7 route files:
definitions list+create, definitions patch+delete, messages list, messages
retry, preview, settings get+patch+delete, test-send), the emails
page/loading, `event-nav.ts`, `src/lib/email/schemas.ts` (EmailDefinition
Zod additions), `src/types/collection.ts` (`EmailDefinitionDoc` +
supporting types), `firestore.rules`/`firestore.indexes.json`, and the
carried L-5 fix (`src/features/checkin/server/resolve-scan.ts` + the two
public checkin routes). Reviewed against
`agents/docs/specs/m6-emails-admin.md`, `agents/docs/data-models/
m6-emails-admin.md`, `agents/docs/reviews/m6-emails-admin.md` (Code Review:
APPROVED, S-1/S-2 re-reviewed and resolved), and the M6-T1 security baseline
(`agents/docs/security/m6-email-infrastructure.md`) this ticket reuses
(`sendEventEmail`, `retryEmailMessage`, the merge-tag renderer,
`emailMessageId` scheme).

Gate 2 of 3 (code review APPROVED → security → QA).

## Checks executed

- `npm run lint` — clean, no warnings/errors.
- `npm run build` — succeeds; all 7 new email API routes and
  `/dashboard/events/[eventId]/emails` compile and appear in the route
  manifest.
- `npm test -- --run` — **89 files / 1165 tests passing** (matches the
  Code Reviewer's re-review count exactly).
- `npm audit --audit-level=high` — 23 pre-existing vulnerabilities
  (firebase-admin/@google-cloud/firestore chain, vite, vitest — same set
  M6-T1's security review already flagged as pre-existing/out of scope);
  `git diff --stat prototype -- package.json package-lock.json` is empty,
  confirming no new dependency surface was introduced by this ticket.
- Manual line-by-line read of `src/features/emails/server/{render,
  sample-context,read-json-body}.ts`, all 7 API route files, `src/lib/db/
  {adminEmailDefinition,emailDefinitionId}.ts`, `src/lib/email/merge-tags.ts`
  and `send-service.ts` (T1, reused), `src/features/emails/components/
  {email-preview-frame,send-log-row-detail,confirmation-preview-card,
  sender-settings-dialog}.tsx`, `src/features/checkin/server/
  resolve-scan.ts` + the two public checkin routes, `firestore.rules` diff,
  and the import-boundary test.

## Focus-area findings

### 1. XSS / header injection via merge fields and organizer-authored bodies — PASS

- **Body → `bodyHtml` escaping is airtight.** `deriveBodyHtmlTemplate`
  (`src/features/emails/server/render.ts:28-34`) calls `escapeHtml` (from
  `src/lib/email/merge-tags.ts:105-112`, escapes `&<>"'`) on the **whole
  organizer-typed template first** — including any literal
  `<script>alert(1)</script>` — before `{tag}` substitution runs.
  `escapeHtml` does not touch lowercase letters/digits/underscore/braces, so
  `{tag}` tokens survive the escape and `renderEmailTemplate`'s `TAG_RE`
  (`merge-tags.ts:141`) still finds them. Any merge-tag **value** substituted
  into the HTML variant is independently escaped again on the way in
  (`merge-tags.ts:198`), so a value containing `<script>` is safe even if a
  future context source became attacker-influenced. Verified this is real
  behavior, not just a comment, by reading `email-render-pipeline.test.ts`,
  which exercises the literal `<script>` case end-to-end through
  `renderEmailDefinitionPreview` and asserts the escaped HTML.
  `{qr_code}` is the one markup-passthrough tag and is not attacker
  reachable — its value is server-minted SVG from `mintQrToken`
  (`src/features/emails/server/sample-context.ts:56-65`), the same trusted
  source T1's security review already traced to a non-user-controllable
  token construction.
- **Preview iframe is correctly locked down.**
  `src/features/emails/components/email-preview-frame.tsx:48-53` renders
  `sandbox=""` (no `allow-scripts`, no `allow-same-origin`, no other token —
  confirmed by reading the literal JSX prop, not inferring from a comment)
  with `srcDoc={bodyHtml}`, where `bodyHtml` is always a value that
  traveled from a **server** response (`/emails/preview` route,
  `renderEmailDefinitionPreview` on the server page, or a stored
  `EmailMessage.bodyHtml` for the send-log detail) — never a raw client
  string built by concatenation. `grep -rn "sandbox" src/features/emails/`
  shows exactly this one iframe, exactly this one attribute value.
- **Subject header injection (CRLF) — covered by the T1 path, confirmed
  live for the new organizer-typed-subject case.** `EmailDefinition.subject`
  is stored verbatim as a template (`src/lib/email/schemas.ts` — no
  control-char stripping at store time, which is correct: it's inert prose
  until rendered/sent). The two places a definition's subject actually
  reaches a would-be email header are (a) test-send
  (`src/app/api/dashboard/events/[eventId]/emails/test-send/route.ts:106-122`)
  and (b) the real T3 send path (not built yet). Test-send calls **T1's**
  `sendEventEmail` with the raw `effective.subject` as `template.subject`
  — `sendEventEmail` (`src/lib/email/send-service.ts:243-260`) renders it
  through `renderEmailTemplate`, then runs `validateRenderedEmailContent`
  (`src/lib/email/schemas.ts`), which strips control characters from the
  **fully rendered** subject (T1 S-3 fix) and persists/sends
  `contentCheck.content`, never the raw `rendered` object
  (`send-service.ts:270-279`, confirmed by reading the code, not assuming
  the T1 fix "still applies" — it does, because T2 routes this new organizer
  content through the exact same function, not a parallel path). This
  closes the specific worry in scope item 1: an organizer typing
  `Subject\r\nBcc: attacker@evil.com` directly into the subject field (no
  merge tag involved) is sanitized at send time by the same T1 mechanism,
  because test-send never bypasses `sendEventEmail`. The `/emails/preview`
  route (`preview/route.ts`) does **not** run this sanitization — but it
  never sends anything or touches a header; it only returns JSON rendered
  into the UI, so this is correctly out of scope for header injection.

**Verdict: no exploitable XSS or header-injection path found in the new
T2 surface.**

### 2. Preview iframe — PASS (see above; no further findings)

### 3. Org/event isolation — PASS

- **`emailDefinitionId` is a one-way SHA-256 tuple hash** of
  `["EmailDefinition", organizationId, eventId, kind]`
  (`src/lib/db/emailDefinitionId.ts:26-38`) — not reversible, and not
  practically guessable in a way that matters: `kind` for the eight system
  defaults is public knowledge (documented in the spec/catalog itself), and
  `organizationId`/`eventId` are already known to any caller who can reach
  a given event's dashboard routes (they're path/session-derived, not
  secret). Knowing another org's definition id buys an attacker nothing,
  because every DAL read/write **re-checks stored `organizationId`/
  `eventId` against the caller's scope independently of the id** — this
  mirrors T1's already-reviewed `emailMessageId` posture exactly (same
  domain-prefix/tuple-hash family, same "the hash isn't the security
  boundary, the re-check is" design).
- **Every DAL method re-verifies tenancy, not just the id derivation:**
  `getAdminEmailDefinitionForEvent` returns `null` for missing OR
  cross-tenant docs (`src/lib/db/adminEmailDefinition.ts:105-122`);
  `listAdminEmailDefinitionsForEvent` filters `organizationId`/`eventId` in
  the **query itself** (`:147-162`), not a post-filter; `upsertAdminEmailDefinition`
  re-checks inside the transaction and returns `NOT_FOUND` (not a
  distinguishable "wrong org" code) for a cross-tenant id collision
  (`:230-236`); `deleteAdminEmailDefinition` is IDOR-safe via the same
  get-then-check pattern (`:381-395`).
  All four error paths collapse "missing" and "belongs to another org" into
  one shape, so there is no oracle to distinguish the two.
  `admin-email-definition.test.ts` exercises fresh two-org fake-Firestore
  seeds for this (per the Code Review's note) and the definitions route
  test file also has a genuine two-org route-level test
  (`email-definitions-route.test.ts:441+`, confirmed reading it directly).
- **Every route gates session → org membership → `write:events` →
  `getAdminEventForOrganization` (cross-org/unknown event → 404) before
  touching any DAL/service function** — verified individually for all 7
  route files (`resolveRegistrationRouteScope` call precedes every DAL
  call in every route, including the three GET reads, per the spec's
  explicit "every route gates write:events, including reads" convention).
  `route-scope.ts`'s cross-org handling additionally accounts for the
  known SEC M2 finding (client-writable "active org" field only trusted
  after re-validating server-locked membership) — unchanged by this
  ticket, still in effect.
- **Retry route IDOR — confirmed tenancy-checked before any transition.**
  `messages/[messageId]/retry/route.ts:36-40` calls `retryEmailMessage`
  with `{ messageId, eventId, organizationId: scope.organizationId }` —
  this is T1's `retryFailedEmailMessage`, which re-checks tenancy **inside
  the transaction** before any state transition and returns `NOT_FOUND` for
  a cross-org message id with zero writes (already verified by T1's
  security review at `adminEmailMessage.ts:279-285`; re-confirmed present
  and unchanged in this diff).

**Verdict: no IDOR path found on definitions, messages, retry, test-send,
or settings; the deterministic-id scheme is safe for the same reasons T1's
already-approved `emailMessageId` scheme is safe.**

### 4. Rate limiting — MEDIUM FINDING (see below)

`test-send` (10/min/user/event, `test-send/route.ts:40-42`),
`preview` (120/min/user, generous but bounded, `preview/route.ts:36`),
`messages/retry` (30/min/user, `retry/route.ts:25`), and
`settings` **PATCH only** (20/min/user, `settings/route.ts:64-66`) are all
correctly wired to `checkRateLimit`, not just mentioned in a comment. **However**,
the following mutating routes have **no rate limiting at all**:

- `POST /emails/definitions` (create a custom definition)
- `PATCH /emails/definitions/[kind]` (the single most-used mutating route
  in this feature — every default-email toggle, subject/body edit, and
  scheduled-datetime edit goes through this)
- `DELETE /emails/definitions/[kind]`
- `DELETE /emails/settings` (reset to platform default)

See **M-1** below.

### 5. IDOR on retry — PASS

Covered under Focus Area 3 above — tenancy is checked inside T1's
`retryFailedEmailMessage` transaction before any status transition is
attempted, and the route passes `eventId`/`organizationId` from the
server-verified scope, never trusting the `messageId` path param alone.

### 6. Secrets / client bundle — PASS

- The extended `email-import-boundary.test.ts` genuinely enforces (not
  just claims) that every module under `src/features/emails/server/` (a)
  contains `import "server-only";`, and (b) contains no
  `firebase-admin/firestore` or `@/app/lib/firestore` substring — verified
  by reading the test's actual assertions (`:88-121`), not trusting its
  name. Independently re-ran it as part of `npm test -- --run` (passing).
- `src/features/emails/default-definitions.ts` has no direct
  `import "server-only"` of its own (transitively server-only via its
  `merge-tags.ts` import only, per the Code Reviewer's N-1 nit) — verified
  no client component imports it directly (`grep -rl` shows only
  `page.tsx` and API routes as importers), so there is no live client-bundle
  leak today, but this is a latent gap worth closing (see **L-1**).
- No `NEXT_PUBLIC_*` occurrences in any new file (`grep -rn "NEXT_PUBLIC"
  src/features/emails/ src/app/api/dashboard/events/\[eventId\]/emails/`
  returns nothing).
- Client components (`email-editor-dialog.tsx`, `sender-settings-dialog.tsx`,
  etc.) only ever receive already-serialized `SerializedEmailDefinition` /
  `SerializedEmailMessage` / `SerializedEmailSettings` shapes as props —
  never a raw Firestore doc, never a raw `EmailDefinitionDoc`/`Timestamp`.

**Verdict: nothing importable client-side beyond what the page legitimately
renders; no env/secret leakage.**

### 7. L-5 checkin masking — PASS, no unmasked leak found in any other field

- `serializeScanAttendeeCard`/`checkedInByName`
  (`src/features/checkin/server/resolve-scan.ts:95-125`) is the **only**
  place `checkedInBy` is read into any response shape; `ScanAttendeeCard`
  (`src/features/checkin/scan-types.ts`) exposes exactly `checkedInByName:
  string | null` — there is no raw `checkedInBy` object, `userId`, or
  `teamMemberId` field anywhere else in `ScanConfirmResponse`/
  `ScanResolveResponse`. Read both public routes
  (`src/app/api/events/[eventId]/checkin/{confirm,resolve}/route.ts`) end
  to end: every call site that could disclose an admin identity
  (`ALREADY_CHECKED_IN` on confirm, the `OK`-resolves-to-already-checked-in
  case on resolve) passes `viewerIsTeamSession = true` explicitly, and
  `JSON.stringify`-ing the full response body contains no email/userId
  substring for the admin case (independently reasoned through the code;
  `checkin-l5-organizer-label.test.ts` locks this with a real
  `JSON.stringify(body)` assertion, confirmed passing).
  The two **dashboard-admin** checkin routes are untouched by this diff and
  keep the default `viewerIsTeamSession = false` (unmasked) — correct,
  since an admin viewing their own dashboard already has that identity.

**Verdict: no other field discloses the admin identity to a team scanner;
the masking is complete for this response shape.**

### 8. Firestore rules — PASS

`firestore.rules:332-341` adds:

```
match /EmailDefinition/{definitionId} {
  allow read, write: if false;
}
```

placed immediately after the existing `EmailMessage`/`EmailSettings`
deny-all block, inside the same `service cloud.firestore` / `match
/databases/{database}/documents` scope as every other rule in the file.
Confirmed by reading the full rules file (not just the diff) that:

- there is no earlier, broader `match /{document=**}` or similar wildcard
  rule anywhere above this block that could shadow/override it (Firestore
  rules are evaluated by matching **all** applicable `match` blocks for a
  path and requiring at least one to allow — a broader earlier `allow read`
  on a wildcard ancestor path would be a real bypass risk; none exists in
  this file for the root-collection paths used here);
  root-collection rules in this file are each scoped to their own
  `/{Collection}/{docId}` path with no shared ancestor rule that grants
  broader access;
- the rule is unconditionally `if false` for both read and write — no
  condition that could evaluate true under any auth state;
- no client repository (`src/lib/db/emailDefinition.ts` or similar) exists
  to attempt a client SDK call against this collection in the first place
  (grep for `collection("EmailDefinition")` outside `adminEmailDefinition.ts`
  returns nothing).

**Verdict: correctly scoped, no ordering issue, no client access path
exists.**

## New findings (not previously identified by Code Review)

### Medium

- **M-1 — Missing rate limiting on four mutating email routes**, contrary
  to spec §7 ("All T2 API routes: … `rate-limit.ts` on mutations
  (test-send 10/min/user/event per §5)") and this app's standing security
  checklist ("rate limiting on all endpoints"):
  - `src/app/api/dashboard/events/[eventId]/emails/definitions/route.ts`
    — `POST` (create custom definition): no `checkRateLimit` call anywhere
    in the file.
  - `src/app/api/dashboard/events/[eventId]/emails/definitions/[kind]/route.ts`
    — both `PATCH` and `DELETE`: no `checkRateLimit` call anywhere in the
    file.
  - `src/app/api/dashboard/events/[eventId]/emails/settings/route.ts` —
    `DELETE` (reset to platform default): `PATCH` in the same file *is*
    rate-limited (`:64-66`, 20/min), but `DELETE` (`:133-163`) has no
    limiter at all.

  **Exploitation scenario:** any authenticated same-org member holding
  `write:events` (a legitimate but possibly compromised or malicious
  account, or a buggy/runaway client retry loop) can call `PATCH
  .../definitions/[kind]` in an unbounded tight loop. Each call opens a
  Firestore `runTransaction` that does a `tx.get` (and, on the
  not-yet-materialized path, an additional `tx.get` count query across the
  event's definitions) plus a write — this is a real, uncapped
  Firestore read/write cost amplification vector scoped to the caller's
  own org (not a cross-tenant issue, and not achievable pre-auth), but it
  is a live, spec-mandated gap: PATCH is the single highest-traffic
  mutating route in this feature (every toggle and every subject/body
  keystroke-triggered save funnels through it), and it is the one route in
  the entire ticket that shipped with genuinely zero rate limiting despite
  the ticket's own spec calling out "rate-limit.ts on mutations" as a
  blanket requirement, not a test-send-only one.

  **Remediation:** add `checkRateLimit` calls to all four routes, following
  the exact pattern already used in the sibling `test-send`/`preview`/
  `retry`/`settings PATCH` routes in this same diff (e.g.,
  `emails-definitions-patch:${scope.userId}:${eventId}` at a generous but
  bounded limit — 60/min is a reasonable starting point given PATCH backs
  live-typing autosave-adjacent UI, mirroring the `preview` route's 120/min
  reasoning). Route back to the **Full-Stack Developer** — this is
  identical, copy-paste-level work to what's already correctly done in four
  other routes in this same file tree, not a design question.

### Low

- **L-1 — `src/features/emails/default-definitions.ts` has no direct
  `import "server-only";`**, relying entirely on the transitive chain
  through its `merge-tags.ts` import (itself `server-only`) plus reviewer
  vigilance to keep it out of a client bundle. No live exploit today (every
  consumer is `page.tsx` or a route file, confirmed by `grep -rl`), but a
  future refactor that imports this module from a `"use client"` component
  (e.g., to reuse `EMAIL_DEFAULT_DEFINITIONS` for client-side display
  without a round trip) would silently succeed today and only fail once
  someone notices template subject/body content for all eight defaults
  bundled client-side. Cheap fix: add `import "server-only";` at the top of
  the file, matching every other module in this feature. This is the same
  gap the Code Reviewer flagged as N-1 (nit); elevating it to a Low security
  note because it is specifically the kind of gap that turns into a real
  client-bundle content leak with zero warning from the build. Non-blocking.
- **L-2 — Pre-existing `npm audit --audit-level=high` findings** (same 23
  findings — firebase-admin/@google-cloud/firestore chain, vite, vitest —
  already flagged by the M6-T1 security review's L-2) are unrelated to this
  diff; `package.json`/`package-lock.json` are untouched. Not introduced by
  M6-T2; carried forward to the repo's general dependency-update backlog.

## Findings summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 (M-1 — missing rate limiting on 4 mutating routes) |
| Low | 2 (L-1 — missing explicit `server-only` on `default-definitions.ts`; L-2 — pre-existing dependency findings, informational) |

## Verdict

**PASS, with one Medium finding that should be closed before this ticket
is considered fully hardened but does not, by this loop's severity policy,
block the handoff to QA** (only Critical/High findings block; the
Orchestrator's Definition of Done requires "no open Critical/High
findings," which is satisfied). All eight mandatory focus areas — XSS via
merge fields/organizer bodies, header injection, the preview iframe,
org/event isolation (including the deterministic-id scheme), rate limiting,
retry IDOR, secrets/client-bundle boundary, and the L-5 checkin-masking
scope — were independently re-verified by reading the actual code and
re-running the tests, not by trusting the Code Review's prior sign-off.

**M-1 (missing rate limiting on `POST/PATCH/DELETE .../definitions[/kind]`
and `DELETE .../settings`) should be routed to the Full-Stack Developer and
fixed before or alongside QA** — it is a named, explicit spec requirement
(§7) that shipped incomplete, is cheap to fix (four call sites, copy-paste
from the sibling routes in the same diff), and directly closes a real
(same-org-scoped) cost-amplification vector on the highest-traffic mutating
route in the feature. Recommend the Orchestrator treat this as a
should-fix-before-QA item even though it does not block on the strict
Critical/High gate, since QA's route-matrix testing (per the Code Review's
carried-forward note about self-reported gaps) is likely to exercise these
exact routes anyway.

Cleared to proceed to QA, with M-1 flagged for the Orchestrator to route to
the Full-Stack Developer in parallel.
