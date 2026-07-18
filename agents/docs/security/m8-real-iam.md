# Security Review — M8-T1 Real IAM

Security Agent, 2026-07-18. Scope: all uncommitted changes in the working
tree belonging to M8-T1 — role-model widening (`src/types/collection.ts`:
`OrganizationRole`, `EDITOR_PERMISSIONS`, `InvitationDoc`,
`OrganizationMemberDoc`), the DAL slice
(`src/lib/db/{adminUserOrganization,adminInvitation,adminOrganizationMember}.ts`),
`firestore.rules`/`firestore.indexes.json`, `src/lib/validation.ts`
(`createInvitationSchema`), `src/features/iam/**` (permissions helpers +
components), the five new API routes
(`src/app/api/dashboard/iam/**`,
`src/app/api/organizations/invitations/accept/route.ts`), the one existing
route/scope-helper reclassification
(`src/app/api/dashboard/events/[eventId]/attendees/route.ts`,
`src/features/registration/server/route-scope.ts`), and the invite-accept
follow-up surface (`src/app/invite/**`,
`accept-invitation-view.tsx`, `login-form.tsx`, signup-wizard
`inviteToken` plumbing). Reviewed against `agents/docs/specs/m8-real-iam.md`
(D1–D12, §1–§8) and independently re-verified against Code Review's
`agents/docs/reviews/m8-real-iam.md` (CHANGES REQUESTED → S-1 fixed →
re-review implied APPROVED per the Orchestrator's note) rather than trusted
on its word.

Checks executed this session:
- `npm run lint` — not re-run standalone this session (Code Review's clean
  pass is recent and no lint-relevant file changed since); `npx tsc` /
  `npm test` re-run directly, see below.
- `npm test -- --run` — **PASS, 160 files / 1875 tests** (2 more than Code
  Review's reported 1873 — consistent with the S-1 fix's added idempotency
  test for an Admin caller revoking an already-resolved Admin-role
  invitation, confirmed present at
  `src/__tests__/admin-invitation.test.ts:332,365`).
- `git diff --stat prototype -- package.json package-lock.json` — empty, no
  new dependency added by this ticket, confirmed independently (not taken on
  the spec's word).
- `npm audit --omit=dev` — **15 vulnerabilities (10 moderate / 3 high / 2
  critical)** — identical count to M7-T3's own baseline
  (`agents/docs/security/m7-scheduled-reports.md`), all transitive through
  `next`/`firebase-admin` → `@google-cloud/firestore` →
  `google-gax`/`teeny-request`/`retry-request`/`uuid`, plus `@grpc/grpc-js`,
  `form-data`, `postcss`, `websocket-driver`. Nothing newly introduced or
  newly reachable by this ticket's code — confirmed by the empty
  package.json/package-lock.json diff above.
- Verified S-1 (Code Review's Should-fix — `revokeAdminInvitation` checking
  D10 hierarchy before idempotency) is actually fixed in the current tree:
  read `src/lib/db/adminInvitation.ts:256-266` directly — the
  `existing.status !== "pending"` no-op check now runs **before** the
  `existing.role === "admin" && callerMember.role !== "owner"` hierarchy
  check, matching spec §3 AC-6's unconditional idempotency requirement. Not
  a security hole either way (fails closed), but confirmed fixed as claimed.

---

## 1. Privilege escalation via the role-change/removal endpoints

**Adversarial question: can an Editor/Viewer reach `PATCH`/`DELETE
/api/dashboard/iam/members/[email]` at all? Can an Admin caller promote
themselves/anyone to Owner, or act on an Owner/Admin row through any
overlooked path?**

- **Editor/Viewer 403, immediately, before any DAL call:**
  `resolveCallerScope()` (`src/app/api/dashboard/iam/members/[email]/route.ts:39-62`)
  checks `userDoc.permissions.includes("write:user")` and 403s before
  `changeAdminMemberRole`/`removeAdminMember` is ever invoked.
  `EDITOR_PERMISSIONS` (`src/types/collection.ts:100-108`) and
  `MEMBER_PERMISSIONS` (`:90-95`) — independently read, not taken on the
  spec's table — confirm neither `view:user` nor `write:user` is present in
  either set, matching D3's matrix exactly (only `owner`/`admin` carry
  `write:user`, byte-identical `OWNER_PERMISSIONS`, `:72-85`).
- **Request-body field injection cannot smuggle a different target or org:**
  `patchSchema = z.object({ role: z.enum([...]) })`
  (`members/[email]/route.ts:31-33`) is a plain (non-`.passthrough()`) Zod
  object — unknown keys (e.g. a client-supplied `organizationId` or
  `callerRole`) are silently stripped, never reach `changeAdminMemberRole`.
  `organizationId` is always `scope.organizationId` (server-derived from the
  roster-verified session, `resolveCallerScope()` →
  `resolveActiveOrganizationId(userDoc)`); `targetEmail` is always the URL
  path segment, never a body field. No path from request body to
  organization/target override exists.
- **An Admin caller cannot touch their own Admin-tier row, in either
  direction, including self-removal:** traced
  `resolveCallerAndTargetMembership` (`adminUserOrganization.ts:595-648`) —
  when `callerEmail === targetEmail` it reads the same doc once, and the
  D10 gate (`callerRole !== "owner" && isUpperTierRole(targetMembership.role)`)
  evaluates the CALLER'S OWN current role as the target's role in the
  self-action case. An Admin's own role is `"admin"` (upper-tier), so an
  Admin can never demote or remove *themselves* either — only touch
  Editor/Viewer rows. This is a strict, literal reading of spec D10's own
  text ("attempting to touch an Owner- or Admin-role member ... returns 403
  for an Admin caller" — no carve-out for the caller's own row) — correct,
  not a bug, and fails closed (over-restrictive) rather than open.
- **Race between two concurrent role-change requests cannot escalate
  privilege:** every branch of `changeAdminMemberRole`/`removeAdminMember`
  runs inside one `adminDb.runTransaction`, with the D10 hierarchy check and
  the last-Owner owner-count query both evaluated from data read **inside**
  that same transaction (`resolveCallerAndTargetMembership`'s two `tx.get`s,
  then `countAdminOrganizationOwnersInTransaction`'s `tx.get(query)` — see
  §4 below for the deeper concurrency analysis of the last-Owner case
  specifically). No mutation happens before every read completes (Firestore
  transaction read-before-write ordering, explicitly commented on in the
  source and honored in every function traced).
- **All seven D10 combinations independently re-walked by hand** (Owner→any,
  Admin→Editor/Viewer, Admin→Owner/Admin in either direction, Admin
  promoting anyone to Owner/Admin) against the actual code — matches Code
  Review's own table exactly, re-derived rather than re-read.

**No Blocker.** No path found for an Editor/Viewer to reach these routes,
for a request body to override the org/target scope, or for an Admin caller
to touch an Owner/Admin row (including their own) under any request shape
or ordering tried.

## 2. Invitation forgery / IDOR

**Adversarial question: can a non-Owner craft a raw request to invite
someone as `role: "admin"`? Can the accept flow be tricked into granting
membership to a mismatched email via a malformed token, cross-org token
reuse, case-sensitivity, unicode, or whitespace tricks?**

- **Server independently re-checks D10 on every invite/revoke, not just the
  UI:** `POST /api/dashboard/iam/invites` (`invites/route.ts:76-85`) has its
  own `canInviteRole(callerRole, inviteRole)` pre-check, but the actual
  authority is `createOrUpdateAdminInvitation`
  (`adminInvitation.ts:145-171`), which **independently** re-derives the
  caller's role from the D12 reverse-index (`getAdminOrganizationMember`,
  not trusted from the route's already-read `userDoc`) and re-checks
  `input.role === "admin" && callerMember.role !== "owner"` before any
  write. `revokeAdminInvitation` does the identical independent re-derivation
  (`adminInvitation.ts:242-266`). A raw `curl` request that skips the
  client dialog entirely (e.g., an Admin POSTing `{email, role:"admin"}`
  directly) is rejected by the DAL layer even if a hypothetical future route
  refactor dropped the route's own pre-check — genuine defense in depth, not
  a single point of failure.
- **Client-side `createInvitationSchema`
  (`src/lib/validation.ts:124-127`) structurally cannot carry `role:
  "owner"`** — `z.enum(["admin", "editor", "viewer"])` — a crafted body with
  `role: "owner"` fails Zod validation (400) before any DAL call, matching
  D10 ("never owner") at the schema layer too.
- **Accept-flow email-match check — the one security-critical check in the
  whole flow — independently re-verified, not re-read from Code Review's
  prose:**
  - Case-insensitive **and** whitespace-tolerant on both sides:
    `acceptAdminInvitation`'s `callerEmail = input.callerEmail.trim().toLowerCase()`
    (`adminUserOrganization.ts:530`) against `invitation.email`, which is
    stored `.trim().toLowerCase()` at write time
    (`createOrUpdateAdminInvitation`'s `email = input.email.trim().toLowerCase()`,
    `adminInvitation.ts:152`). Leading/trailing-whitespace and mixed-case
    tricks (`"Carlos@Economist.COM "` vs `"carlos@economist.com"`) resolve
    identically on both sides — verified by reading both normalization call
    sites, not assumed.
  - **Fast-fail before any transaction, then re-verified inside the
    transaction against a fresh read** — genuinely closes the TOCTOU window
    Code Review flagged and I independently re-traced: `initial =
    getAdminInvitationByToken(...)` (non-transactional) rejects a mismatch
    immediately with zero writes; `adminDb.runTransaction` then re-reads the
    **same** doc (`tx.get(invRef)`) and re-checks `invitation.email !==
    callerEmail` a second time before calling
    `applyOrganizationJoinInTransaction`. An attacker cannot win a race by
    mutating the invitation's email between the two checks — `InvitationDoc`
    is server-only (rules deny-all, §6 below) and no DAL function ever
    updates `.email` post-create (`createOrUpdateAdminInvitation`'s upsert
    always uses the SAME deterministic `(org, email)` id, so a doc's `email`
    field can never drift from the id it lives at).
  - **Malformed/unknown token:** `getAdminInvitationByToken` does an exact
    equality query (`.where("token", "==", token)`); no token substring
    matching, no regex, no prefix logic — an unknown or truncated token
    simply returns `null` → generic `INVALID` (410), never a 500 or a
    partial match.
  - **Token reuse across orgs is structurally impossible:** the token is
    generated fresh per invitation (`generateInviteToken()`, `nanoid(32)`) on
    every `createOrUpdateAdminInvitation` call, including the upsert-refresh
    path (`adminInvitation.ts:198`) — there is no shared/global token value
    and the token-to-invitation lookup resolves to exactly one
    `(organizationId, email)` tuple by construction (the doc it's stored
    on). A token from Org A's invitation can only ever resolve to Org A's
    `organizationId` in `acceptAdminInvitation`'s `applyOrganizationJoinInTransaction`
    call — there is no code path that lets a caller supply their own
    `organizationId` alongside the token.
  - **Unicode homograph tricks:** out of scope for this ticket's own logic —
    the comparison is a byte-exact string match on the *authenticated
    caller's own Firebase-verified token email* against the stored
    invitation email. A homograph email (visually similar, different code
    points) is a genuinely different string and would only match if the
    attacker's Firebase Auth account is *actually registered* under that
    exact homograph address — which is a Firebase Auth / email-provider
    level concern predating and outside this ticket's mechanism, not a gap
    this diff introduces or could reasonably close.

**No Blocker.** The layered checks (route pre-check + DAL independent
re-derivation + Zod schema shape + fast-fail-then-in-transaction-re-verify
email match) hold under every crafted-request and race scenario tried.

## 3. Cross-tenant isolation

**Adversarial question: is `organizationId` ever taken from client input
instead of the server-verified session/roster, anywhere in the new IAM
surface?**

Grepped every new route and DAL function for the literal string
`organizationId` and traced its origin at each use site:
- All five new/changed routes (`iam/route.ts`, `iam/invites/route.ts`,
  `iam/invites/[email]/revoke/route.ts`, `iam/members/[email]/route.ts`,
  `attendees/route.ts`'s reclassified `GET`) derive `organizationId`
  exclusively via `resolveActiveOrganizationId(userDoc)` — never from a
  query param, body field, or path segment. Confirmed no route in this diff
  reads `request.nextUrl.searchParams.get("organizationId")` or an
  equivalent client-suppliable org id anywhere (grepped, zero hits).
- `POST /api/organizations/invitations/accept` (the one route that runs
  *before* the caller is a member of the target org) never accepts an
  `organizationId` in its body either — `acceptSchema` only has `token` and
  `displayName` (`accept/route.ts:29-35`); the target org is entirely
  determined server-side by resolving the token to its `InvitationDoc`,
  which the caller cannot influence beyond the opaque token string itself.
- **Cross-org mutation attempts 404, not 403** (spec §7 AC-2, IDOR-safe
  convention, matching the established `getAdminEventForOrganization`
  pattern): `changeAdminMemberRole`/`removeAdminMember` return
  `TARGET_NOT_FOUND` when the target's roster has no entry for the caller's
  org (`resolveCallerAndTargetMembership`,
  `adminUserOrganization.ts:629-639`), mapped to a plain 404
  (`members/[email]/route.ts:74-75`) — a caller cannot distinguish "this
  email doesn't exist" from "this email exists but isn't in my org."
  `revokeAdminInvitation`'s `NOT_FOUND` is the identical shape, and is
  structurally guaranteed by the deterministic `(org, email)` doc id — a
  different org's pending invitation for the same email lives at a
  different doc id entirely, so it is "structurally indistinguishable from
  never invited" (confirmed by reading `invitationId()`'s hash inputs,
  `adminInvitation.ts:62-69`).
- **The owner-count query used by the last-Owner guardrail is genuinely
  org-scoped**, not global: `organizationOwnersQuery`
  (`adminOrganizationMember.ts:146-151`) is
  `.where("organizationId", "==", organizationId).where("role", "==",
  "owner")` — a same-named Owner in a different org can never be counted
  toward this org's guardrail. Independently re-verified (not re-read from
  Code Review), including that the `organizationId` value it's called with
  always originates from the roster-verified caller's own org
  (`changeAdminMemberRole`/`removeAdminMember`'s `input.organizationId`,
  itself always `scope.organizationId` from the route).
- **`GET /api/dashboard/iam`** — the roster/invitation listing route —
  passes `organizationId` from `resolveActiveOrganizationId(userDoc)` into
  both `listAdminOrganizationMembers` and
  `listAdminInvitationsForOrganization`, both plain single-field
  `where(organizationId == X)` queries with no secondary filter that could
  leak a superset. A crafted `?organizationId=orgB` query string on this GET
  is never read by the route at all (confirmed: the route only destructures
  `request` for nothing beyond the cookie — no `searchParams` read
  anywhere in the file).

**No Blocker.** No client-suppliable `organizationId` input exists anywhere
in this ticket's new surface; every mutation is scoped to the
roster-verified active org, and cross-org access attempts uniformly 404.

## 4. Last-Owner guardrail — DoS/lockout vector and its inverse (TOCTOU)

**Adversarial question: can the guardrail be bypassed via a race between two
concurrent removal requests on two different Owners of a 2-Owner org, both
passing the "count >= 2" check before either commits, leaving zero Owners?
Is the count query and the mutation in the SAME transaction?**

- **Yes, same transaction, reads-before-writes ordering confirmed by direct
  read:** `countAdminOrganizationOwnersInTransaction` is called with the
  *same* `tx` object the roster mutation later writes through
  (`changeAdminMemberRole`/`removeAdminMember`,
  `adminUserOrganization.ts:695-703,777-785`), and it runs strictly before
  any `tx.update`/`tx.delete` call in either function — satisfying
  Firestore's read-before-write transaction requirement, which the source
  comments correctly call out.
- **The genuine concurrency question — does Firestore's transaction
  isolation actually prevent the 2-Owner double-removal race — was reasoned
  through independently, not assumed:** Firestore's server-side
  transactions provide true serializable isolation, including for query
  reads (not just single-document `get`s): a document that is part of a
  query's result set inside a transaction is tracked as part of that
  transaction's read set for conflict detection, and a concurrent write to
  *any* document in that read set before commit forces the reading
  transaction to retry. In the 2-Owner race (Transaction A removing OwnerX,
  Transaction B removing OwnerY, both querying `role == "owner"` and both
  initially seeing `{OwnerX, OwnerY}`): whichever transaction commits second
  has OwnerY's (or OwnerX's) `OrganizationMember` doc — a document that WAS
  part of its own owner-count query result — mutated out from under it by
  the first transaction's commit, which Firestore's serializable isolation
  detects as a write-set/read-set conflict and forces an automatic retry.
  On retry, the second transaction re-runs the whole function body
  (`adminDb.runTransaction`'s built-in retry-on-conflict behavior for the
  Admin SDK), re-queries the owner count, now correctly sees only one Owner
  remaining, and correctly returns `LAST_OWNER`. **This closes the race as
  designed, and is architecturally correct** — but see the finding below.
- **FINDING (Medium) — this guarantee is completely unverified by this
  ticket's own test suite, and a future regression that broke it would not
  be caught.** The fake Firestore double used across the IAM test suite
  (`src/__tests__/helpers/fake-admin-db.ts:416`,
  `runTransaction: async (fn) => fn(tx)`) executes the transaction callback
  directly with **zero conflict detection, zero retry, and zero simulation
  of concurrent transactions** — it is a synchronous pass-through. Every
  "two-Owner fixture" test in `admin-user-organization-iam.test.ts`
  (referenced by both the spec's §5 AC-3/AC-4 and Code Review's Priority 3)
  tests the **sequential logic** of the guardrail (count computed correctly,
  gate fires when `ownerCount <= 1`) but **cannot and does not** exercise
  the actual race condition this section's adversarial question asks about,
  because the test harness has no mechanism to run two transactions
  concurrently or to simulate Firestore's conflict-retry behavior. The
  guardrail's real-world safety currently rests entirely on an
  (independently reasoned, believed-correct) property of the production
  Firestore SDK that is not exercised by any test in this repository — a
  future code change that, say, replaced the transactional owner-count read
  with the already-exported non-transactional `countAdminOrganizationOwners`
  (a real, callable function sitting right next to the transactional one,
  differing only by not taking a `tx` — confirmed only currently called from
  its own transactional sibling and tests, never from a mutation path,
  `grep` results in §3 above) would silently reintroduce exactly this race,
  and the existing test suite would not catch it, because no test asserts
  "the count read happens inside the same transaction as the write," only
  that the count-vs-threshold *logic* is correct.
  **Recommendation (non-blocking):** add either (a) a lightweight
  transaction-conflict simulation to `fake-admin-db.ts` that can fail/retry
  a second `runTransaction` call whose read set overlaps a first call's
  write set (mirroring real Firestore semantics), with a test that
  explicitly proves the 2-Owner concurrent-removal race resolves to exactly
  one success, or (b) at minimum a static/lint-level guard or code comment
  co-located with `countAdminOrganizationOwners` (the non-transactional
  variant) warning it must never be called from a mutation path, plus an
  integration-level (not unit-level) test against a real/emulated Firestore
  instance if this repo's CI has that capability, to close the gap between
  "the logic is correct" and "the concurrency guarantee is proven."

**Inverse direction (Owner-scarcity used as a DoS against a departing
Owner):** no evidence found that the guardrail can be *abused* to trap a
legitimate sole Owner who wants to leave without a successor — the spec's
own design requires promoting a second Owner first, which any sole Owner
can always do (an Owner may set any role on any target, `changeAdminMemberRole`'s
`callerRole === "owner"` branch skips the D10 gate entirely). Not a
findable DoS vector distinct from the intended, spec'd behavior.

## 5. Invitation token security

- **Generation:** `generateInviteToken()` (`src/lib/invite-utils.ts:13-15`)
  is `nanoid(32)` — `nanoid`'s default alphabet is 64 characters
  (URL-safe), giving ~192 bits of entropy per token, generated via
  `crypto.getRandomValues` under the hood (nanoid's documented CSPRNG
  source, not `Math.random()`). Not predictable, not sequential, not
  short — brute-forcing a valid token is computationally infeasible at any
  request volume this app could plausibly sustain, rate-limited or not (see
  §7).
- **Not logged:** grepped every new/changed file under
  `src/lib/db/adminInvitation.ts`, `src/app/api/dashboard/iam/**`,
  `src/app/api/organizations/invitations/**`, and
  `src/features/iam/**` for `console.log`/`console.error`/`console.warn` —
  zero hits.
- **Exposure surface is deliberately narrow (D8):** the token only ever
  appears (a) inside the `Invitation` Firestore doc (server-only,
  deny-all rules, §6 below), (b) in the JSON response body of
  `POST /api/dashboard/iam/invites` to the inviting Owner/Admin themselves
  (an authorized party who is, by construction, entitled to mint this exact
  invite), and (c) embedded in the `/invite/{token}` URL path the inviter
  manually copies/shares (D8's explicit, spec'd copy-link UX — no email
  send, so no email-transport-level exposure).
- **Referrer-header leakage:** the accept page (`/invite/[token]/page.tsx`
  → `AcceptInvitationView`) contains exactly two outbound-navigation
  surfaces: a `Link` to `/signup?inviteToken=...` (same-origin, `Referer`
  stays same-origin regardless) and a `Link` to `/` / `/dashboard` /
  `/login` (all same-origin). No third-party script, image, font, or link
  is loaded from this page or its layout (`invite/layout.tsx` is pure
  layout markup, no external resources) — so there is no cross-origin
  request from a token-bearing URL that could leak the token via `Referer`.
  The token is also never placed in a query string (only a path segment),
  which additionally means it would not be logged by generic
  `?query=`-stripping referrer-privacy tooling that leaves paths intact —
  worth noting as a residual, low-severity exposure class (any
  same-origin JS error-reporting/analytics tool that logs full request
  paths would capture the token), but this is a general property of any
  path-embedded bearer token (consistent with this codebase's own
  pre-existing `inviteLinkToken`/`/join/{token}` convention, not a new
  M8-T1-introduced pattern) and not something this diff regresses.

**No Blocker, no new finding.** Token entropy, non-logging, and exposure
surface are all sound and consistent with this codebase's established
bearer-token conventions.

## 6. `OrganizationMemberDoc` / `Invitation` reverse-index — Firestore rules

Read the actual rules file directly (not the data-model doc's description):

```
firestore.rules:373-379
match /Invitation/{invitationId} {
  allow read, write: if false;
}

match /OrganizationMember/{organizationMemberId} {
  allow read, write: if false;
}
```

Both collections are unconditional deny-all, matching the
`EmailDefinition`/`ReportSchedule` precedent exactly (same file, lines
340-354). No `allow get`/`allow list` carve-out exists for either — a
signed-in user cannot enumerate the org roster or read any invitation
(including its token) via the client Firestore SDK under any auth state.
The only read paths are the two Admin-SDK DAL modules
(`adminInvitation.ts`, `adminOrganizationMember.ts`), reached exclusively
through the `write:user`-gated (or session/bearer + email-match-gated, for
accept) server routes. Also confirmed the pre-existing `User` doc rules
(§1-§2 of `firestore.rules`) are **unmodified** by this ticket — the
create-shape rule's literal `'owner'` check and exact-`OWNER_PERMISSIONS`
array check are untouched, since D2's role-value widening only ever affects
values written server-side, never the brand-new-org-owner client-create
shape those rules validate.

**No Blocker.**

## 7. Rate limiting

**Adversarial question: are the new mutating IAM routes rate-limited
consistently with this app's convention? Check for gaps.**

- This codebase's established convention (per `src/lib/rate-limit.ts`'s own
  header comment and every call site grepped) is: rate limiting is applied
  to **unauthenticated, public-facing** endpoints where the credential *is*
  the request itself (registration drafts/finalize, promo validation,
  checkin access-code exchange) — never to authenticated, session-gated
  dashboard mutation routes, which rely on the auth/authorization boundary
  instead. Confirmed by grep: every one of the 17 files importing
  `rate-limit.ts` is either a public `src/app/api/events/[eventId]/**`
  route or the shared-secret internal evaluator — zero authenticated
  `src/app/api/dashboard/**` routes use it anywhere in this codebase,
  before or after this ticket.
- All five new IAM routes require a verified session (cookie) or, for
  accept only, a verified bearer token — none are reachable
  unauthenticated. This matches the **existing** authenticated-route
  posture exactly: `POST /api/organizations/join` (the pre-existing sibling
  this ticket's accept route is modeled on) is *also* unrated-limited
  despite accepting a `code` field with materially *less* entropy
  (`generateInviteCode()`, 8 chars from a 33-char alphabet ≈ 40 bits) than
  this ticket's 192-bit invite tokens.
- **Not a new gap introduced by this ticket** — the new IAM routes are
  exactly as rate-limited (i.e., not directly, relying on session auth) as
  every comparable pre-existing authenticated mutation route in this
  codebase. Flagging as **informational, not a finding**: if a future
  ticket decides to add authenticated-route rate limiting as a
  defense-in-depth layer (e.g., against a compromised session token being
  used for a rapid mass-invite/removal spree), it should be applied
  uniformly across the whole authenticated surface, not singled out for
  IAM — a scope decision for a future ticket, not this one.

**No Blocker, no new finding** — consistent with established convention.

## 8. Invite-accept page auth-adjacent surface

**Adversarial question: any new XSS/open-redirect/session-fixation surface
from handling a token from the URL and redirecting after signup/accept?**

- **XSS:** grepped `src/app/invite/**` and
  `src/features/iam/components/accept-invitation-view.tsx` for
  `dangerouslySetInnerHTML` — zero hits. The `token` param is used in
  exactly three ways: (a) as a JSON body field in a `fetch` POST (never
  rendered as HTML), (b) inside a `Link href` via
  `` `/signup?inviteToken=${encodeURIComponent(token)}` `` (properly
  encoded), and (c) inside a `LoginForm redirectTo` prop as
  `` `/invite/${token}` `` (interpolated into a route string, not rendered
  as HTML — React JSX auto-escapes all text content regardless, and this
  value is never used as a `href`/`src` attribute that could carry a
  `javascript:` scheme). No sink exists that could turn a crafted token
  value into executable script or an injected attribute.
- **Open redirect:** the two client-side redirect call sites that consume a
  token-derived string are both structurally constrained to same-origin,
  `/invite`-prefixed paths:
  `organization-form.tsx:167`'s `router.push(\`/invite/${inviteToken}\`)`
  and `accept-invitation-view.tsx`'s `LoginForm redirectTo={\`/invite/${token}\`}`.
  Because the literal string `"/invite/"` is always prepended before the
  token value, the resulting string can never become a scheme-relative
  (`//evil.com`) or absolute (`https://evil.com`) URL regardless of what
  the token contains — it always begins with a same-origin absolute path.
  `router.push` (Next.js App Router) additionally cannot navigate
  cross-origin via the History API even if a crafted string somehow began
  with `//`, since `history.pushState` throws for non-same-origin targets
  and Next's router does not fall back to `window.location` for
  client-transition failures of this shape. The `?inviteToken=` query param
  itself (read server-side in `signup/page.tsx`/`signup/credentials/page.tsx`
  and forwarded as a literal string into the next hop's query string, never
  parsed as a URL and never used in a `redirect()`/`Location` header
  computation with attacker-controlled scheme/host) carries no open-redirect
  primitive — confirmed by reading both signup page files directly.
- **Session fixation:** `syncSessionCookie` (`accept-invitation-view.tsx:52-63`)
  POSTs the caller's own freshly-obtained Firebase ID token
  (`user.getIdToken()`) to `/api/auth/session`, which independently
  re-verifies it via `adminAuth.verifyIdToken` before minting the cookie
  (`src/app/api/auth/session/route.ts:14-18`) — the accept flow cannot
  inject an attacker-chosen/stale token into another user's session; the
  token always corresponds to whichever Firebase user is currently
  authenticated in that browser tab, verified server-side before the cookie
  is set. This is the same pre-existing mechanism `login-form.tsx` uses,
  unmodified by this ticket beyond the one new call site.
- **The Google sign-in `syncSessionCookie()` fix (login-form.tsx) and the
  `attemptedForRef` accept-retry guard** — both independently re-traced
  (not re-read from Code Review's prose) and confirmed correct: no
  double-redirect race, no stale-attempt-after-account-switch bug (ref
  resets to `null` on sign-out, and a new `(token, uid)` pair produces a
  fresh `attemptKey` on sign-back-in as a different account).

**No Blocker.**

## 9. Standard checks

- **Secrets:** no `.env`/service-account material referenced in any
  new/changed file (grepped for `process.env` in the IAM diff — none
  found; all config this surface needs, e.g. the accept URL's origin, is
  derived from `new URL(request.url).origin`, not an env var).
- **PII in error messages:** every typed rejection across all five routes
  maps to a generic, non-leaking message ("You don't have permission to do
  that," "Member not found," "This invitation is no longer valid," etc.) —
  no route ever echoes back which email an invitation belongs to, which org
  a cross-org request targeted, or a raw Firestore/stack-trace error.
  Confirmed no route in this diff is missing a `switch`/`default` fallback
  that could let an unhandled DAL error code fall through to a raw 500 with
  internal detail (every `switch` has an explicit `default` case mapping to
  a generic message).
- **Zod validation at every boundary:** `createInvitationSchema` (invite
  create), `patchSchema` (role change), `acceptSchema` (accept) — all three
  new/changed routes with a request body validate through Zod before any
  DAL call; the two path-param-only routes (revoke, remove) take no body.
  No route parses `request.json()` and uses the result without validation.
- **No SQL/NoSQL injection-shaped string concatenation:** every Firestore
  query in the new DAL modules uses parameterized `.where(field, "==",
  value)` calls with the value passed as a plain JS value, never
  interpolated into a query-string/filter-expression — standard, safe
  Admin SDK usage throughout, consistent with every prior ticket's DAL
  pattern in this codebase.

**No Blocker.**

---

## Findings

**Critical: 0**
**High: 0**
**Medium: 1**
**Low: 0**

1. **M-1 — Last-Owner guardrail's TOCTOU-race safety is architecturally
   sound (verified by independent reasoning about Firestore's serializable
   transaction isolation, §4) but is completely unverified by this
   ticket's test suite**, because the in-memory Firestore test double
   (`src/__tests__/helpers/fake-admin-db.ts:416`) executes
   `runTransaction` callbacks with zero conflict detection or retry
   simulation. A future regression — e.g., swapping the transactional
   owner-count read for the already-exported non-transactional sibling
   `countAdminOrganizationOwners`, or moving the count query outside the
   transaction for a performance "optimization" — would silently
   reintroduce the exact zero-Owner race this section's adversarial
   question describes, and no test in this repository would catch it.
   **Not exploitable today** (the current code correctly reads the owner
   count inside the same transaction it mutates in, verified by direct
   read), so this does not block the ticket, but it is a real
   verification/regression-safety gap, not merely a style nit. Recommend a
   follow-up: either a transaction-conflict-simulating test harness
   addition, or an integration test against a real/emulated Firestore
   instance, plus a code comment on `countAdminOrganizationOwners`
   (non-transactional) warning it must never be called from a
   guardrail-gated mutation path.

No Low findings — the rate-limiting question (§7) and the path-embedded
bearer-token/Referer question (§5) were both investigated and are
consistent with this codebase's pre-existing, established conventions, not
new gaps this ticket introduces.

## Adversarial-thinking conclusion

Working through all nine assigned attack surfaces as a `write:events`-tier
Editor, a compromised/malicious Admin, and an invitation-link interceptor:
no privilege-escalation path was found for an Editor/Viewer to reach any
IAM mutation route, no path was found for an Admin caller to touch an
Owner/Admin-tier row (including their own) under any request shape or
timing tried, no invitation-forgery or IDOR path was found across the
create/revoke/accept lifecycle (including deliberate case/whitespace/token
tricks), no client-suppliable `organizationId` exists anywhere in the new
surface, both new server-only collections are correctly deny-all in
`firestore.rules`, invitation tokens are cryptographically strong and never
logged, and the invite-accept page introduces no new XSS/open-redirect/
session-fixation surface. The one Medium finding (M-1) is a test-coverage
gap around a guarantee that — independently reasoned through against
Firestore's actual transaction semantics — currently holds correctly in
the shipped code, not a demonstrated exploit.

## Verdict: **PASS**

No Critical or High findings. One Medium (M-1, a testing/regression-safety
gap around the last-Owner guardrail's concurrency guarantee, not a
demonstrated vulnerability in the current code) is documented for
follow-up but does not block. Cleared to proceed to the QA Agent.
