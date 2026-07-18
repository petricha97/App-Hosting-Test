# QA — M8-T1 Real IAM

QA Agent, 2026-07-18. Gate 3 of 3 (Code Review: **CHANGES REQUESTED → S-1
fixed → APPROVED** → Security: **PASS**, 0 Critical/High, 1 Medium (M-1,
deferred to backlog M8-T8) → **QA**). Scope: the full RBAC overhaul —
`OrganizationRole` widening, the `Invitation`/`OrganizationMember` D12
reverse-index entities, `adminUserOrganization.ts`'s new mutations
(`acceptAdminInvitation`, `changeAdminMemberRole`, `removeAdminMember`), the
five new `/api/dashboard/iam/**` + `/api/organizations/invitations/accept`
routes, the one existing-route reclassification
(`attendees/route.ts` GET, D6), the `/invite/[token]` accept-page surface,
and the signup-wizard invite-token plumbing. Reviewed against
`agents/docs/specs/m8-real-iam.md` (D1–D12, §1–§8), cross-checked against
`agents/docs/reviews/m8-real-iam.md` and `agents/docs/security/m8-real-iam.md`
rather than trusted on their word.

## Method

No local Firestore/Auth emulator is available in this environment (checked
this session: `firebase.json` only configures `apphosting`/`ui` emulators,
no `firestore`/`auth` blocks; no emulator process running) — the same
constraint every prior QA pass in this loop (M6-T3, M7-T2, M7-T3) has
disclosed. `npm run dev` click-through against real Firebase/Firestore was
**not** exercised; nothing in this report claims otherwise. Verification
instead centered on:

1. **Independent re-verification of Code Review's and Security's specific
   claims** by reading the actual source (not re-trusting their prose) —
   the S-1 fix (`revokeAdminInvitation` check ordering), the D10 hierarchy
   dispatch table, the last-Owner guardrail's transactional ordering, the
   §6 enforcement-inventory diff claim, and the M-1 deferral to backlog
   M8-T8.
2. **A direct read of a representative sample of the shipped test suite**
   (not just a file count) to determine whether the permission-matrix
   coverage claimed by the spec/reviews is genuine end-to-end coverage
   (real role fixtures through the real DAL) or route-level tests with a
   hand-typed `permissions: [...]` array on a mocked `getAdminUserByEmail`.
   Found it was **the latter** for every route-level IAM/attendees/
   route-scope test — a genuine, if narrow, coverage gap (see Regression
   tests added, below) — while the DAL-level tests
   (`admin-user-organization-iam.test.ts`, `admin-invitation.test.ts`,
   `admin-organization-member.test.ts`) are genuinely `fake-admin-db`-backed
   and exhaustive.
3. **New real-route + real-DAL integration tests**, written by QA this pass
   (mirroring M7-T3's own `report-schedules-route-dal-integration.test.ts`
   precedent), closing that gap and adding a full continuous member
   lifecycle E2E, a component-level test for the previously-untested
   `RoleDescriptionCards`, and a component-level test locking the
   signup-wizard's invite-token org-creation-skip branch (D7/D9).
4. **Automated suite** (lint, `tsc`, build, full test run) executed fresh in
   this session, both before and after this pass's own new tests.

## Automated suite (this session)

| Check | Result |
|---|---|
| `npm run lint` | PASS — `✔ No ESLint warnings or errors` |
| `npx tsc --noEmit --pretty false` | PASS — clean except the same **7 pre-existing, unrelated** baseline errors already carried through Code Review and Security (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62`) — re-confirmed this session these 3 files carry zero M8-T1 changes |
| `npm run build` | PASS — exit 0; `/dashboard/iam`, `/invite/[token]`, and all 6 new/changed IAM API routes present in the route manifest |
| `npm test -- --run` (before this pass's additions) | PASS — **160 files / 1875 tests**, matching Security's reported count exactly |
| `npm test -- --run` (after this pass's additions) | PASS — **164 files / 1897 tests**, 0 failing (this pass's own +4 files / +22 tests) |

## Per-section acceptance criteria

### §1 — Role model & permission matrix

| AC | Result | Evidence |
|---|---|---|
| 1. `permissionsForOrganizationRole` exact D3 matrix incl. legacy `"member"` alias | **PASS** | `admin-user-organization-iam.test.ts`'s table-driven test (real function, no mocks) asserts all 5 cases (owner/admin/editor/viewer/member) against the exact `OWNER_PERMISSIONS`/`EDITOR_PERMISSIONS`/`MEMBER_PERMISSIONS` constants |
| 2. Every existing route admits Owner/Admin/Editor, rejects Viewer | **PASS, genuine coverage gap found and closed this pass** | Every shipped route test (`route-scope.test.ts`, `attendees-list-export-routes.test.ts`, `iam-*-route.test.ts`) mocks `getAdminUserByEmail` with a **hand-typed** `permissions: [...]` array — none derive a role fixture through the real `permissionsForOrganizationRole()`/DAL wiring D4 depends on. Closed with `permission-matrix-route-dal-integration.test.ts` (14 tests, real fixtures via `permissionsForOrganizationRole()`, real routes, real `fake-admin-db`) |
| 3. No `PermissionGroupDoc`/`groupIds` added | **PASS** | Grepped `src/types/collection.ts` and every new IAM file — no such field exists; `iam-dashboard.tsx`'s old "Permission groups" card and mock data are fully removed |

### §2 — Members list & nav visibility

| AC | Result | Evidence |
|---|---|---|
| 1. Viewer `GET /api/dashboard/iam` → 200 with real data | **PASS, re-verified with a REAL Viewer fixture this pass** | `iam-dashboard-route.test.ts` (mocked DAL) + this pass's `permission-matrix-route-dal-integration.test.ts` (real Viewer fixture seeded via `permissionsForOrganizationRole("viewer")`, real roster returned, `canManageMembers: false`) |
| 2. Viewer mutating any IAM route → 403 | **PASS** | `iam-members-route.test.ts`/`iam-invites-route.test.ts` (mocked) + this pass's real-fixture 403 assertions in `permission-matrix-route-dal-integration.test.ts` |
| 3. `iam/page.tsx` calls real scope, mock placeholder gone | **PASS (structural read)** | `src/app/dashboard/(workspace)/iam/page.tsx` calls `getDashboardScope()`; `iam-dashboard.tsx` fetches `GET /api/dashboard/iam` on mount, no hardcoded `memberSummaries`/`pendingInvites` remain (grepped, zero hits) |
| 4. Cross-org isolation, no query-param override | **PASS** | Independently re-confirmed (Security's §3 finding, re-verified by direct read): no route in this diff reads `searchParams.get("organizationId")`; `resolveActiveOrganizationId(userDoc)` is the sole source |

### §3 — Invitation lifecycle

| AC | Result | Evidence |
|---|---|---|
| 1. Re-invite upserts to exactly one doc, second call wins | **PASS** | `admin-invitation.test.ts` |
| 2. Already-active-member rejected, zero write | **PASS** | `admin-invitation.test.ts` |
| 3. Member of a different org — succeeds, no cross-org leak | **PASS** | `admin-invitation.test.ts` + this pass's lifecycle E2E implicitly exercises single-org but the DAL test explicitly covers the two-org case |
| 4. Editor/Viewer 403 on invite/revoke; Admin inviting `role:"admin"` 403; Admin inviting editor/viewer succeeds | **PASS** | `iam-invites-route.test.ts` (route, mocked) + `admin-invitation.test.ts` (DAL, real) — both layers independently gate |
| 5. Expired invitation rejected without a sweep | **PASS** | `admin-user-organization-iam.test.ts`'s time-shifted-`expiresAt` fixture |
| 6. Revoke on already-resolved invitation is a 200 no-op | **PASS, S-1 fix independently re-verified** | Read `adminInvitation.ts:254-263` directly: idempotency check now runs **before** the D10 hierarchy check (was the reverse pre-fix). `admin-invitation.test.ts` covers both the already-accepted and already-revoked Admin-role-invite combinations for a non-Owner caller |

### §4 — Accept flow

| AC | Result | Evidence |
|---|---|---|
| 1. Valid accept stamps the invited role, invitation → accepted | **PASS** | `admin-user-organization-iam.test.ts` + this pass's lifecycle E2E (real route, real DAL, asserts the actual `User`/`Invitation` doc state) |
| 2. **Email-mismatch IDOR** — 403, zero membership write, zero status change | **PASS, confirmed genuine (two distinct fixtures, not a typo'd single email)** | `admin-user-organization-iam.test.ts:316-343`: invitation created for `alice@example.com`, accept attempted with `callerEmail: "bob@example.com"` — asserts `EMAIL_MISMATCH`, `fake.store.has("User/bob@example.com") === false`, and the invitation doc's `status` is still `"pending"`. This is the real, load-bearing test — the route-level test (`organizations-invitations-accept-route.test.ts`) only checks the HTTP status-code mapping with a mocked DAL, which is fine as a thin layer on top of this real one |
| 3. Expired invitation rejected without a sweep | **PASS** | `admin-user-organization-iam.test.ts` |
| 4. Already-accepted invitation, second accept rejected, no double join/count | **PASS** | `admin-user-organization-iam.test.ts` — asserts `memberCount` unchanged across both calls |
| 5. Brand-new user signs up via the invite-token URL, lands with the invited role; org-creation genuinely skipped | **PASS, coverage gap found and closed this pass** | Structurally confirmed by direct read of `organization-form.tsx:80,148-180,252-284` — when `store.prefilledInviteToken` is set, the entire org create/join form is replaced by a single "Continue" button whose handler (`onAcceptInviteContinue`) only creates the Firebase Auth account and redirects to `/invite/{token}`; it never calls `signupCreateOrgAndUser` or `joinOrganization`. **This had ZERO test coverage in the shipped diff** (no test file existed for `organization-form.tsx` at all). Closed with `signup-organization-form-invite.test.tsx` (4 tests): the invite-token branch renders instead of the org form, org-creation/join functions are never called on that branch (email-password AND Google-signup-already-authenticated sub-cases), and a control test proving the ordinary (non-invite) path still calls `signupCreateOrgAndUser` as before (the fork is genuine, not an accidental global no-op) |

### §5 — Role change & removal (D10 implementation)

| AC | Result | Evidence |
|---|---|---|
| 1. Owner promotes/demotes across all tiers | **PASS** | `admin-user-organization-iam.test.ts` |
| 2. Admin touching Owner/Admin rows (either direction) or promoting to Owner/Admin → 403 | **PASS, exhaustively confirmed** | Independently re-walked all named combinations against the actual code (matching Code Review's and Security's own independent traces): Admin→Owner (change/remove), Admin→Admin (change/remove, including a distinct second-Admin fixture, not self), Admin promoting Editor/Viewer→Owner or →Admin — all `HIERARCHY_VIOLATION`. Admin→Editor/Viewer (change either direction, remove) — all allowed. Also independently confirmed via Security's own trace (not re-derived by QA, but read directly) that an Admin cannot even touch their own row (self-demotion/self-removal), since `resolveCallerAndTargetMembership`'s self-case evaluates the caller's own current role as the "target" role |
| 3. Last-Owner guardrail rejects both self and other-caller shapes, zero writes | **PASS** | `admin-user-organization-iam.test.ts`'s sole-Owner self-attempt tests (both `changeAdminMemberRole` and `removeAdminMember`) assert the stored role/`memberCount` is unchanged after rejection |
| 4. Owner CAN self-demote/remove with ≥1 other Owner remaining | **PASS** | `admin-user-organization-iam.test.ts`'s two-Owner fixtures, both functions |
| 5. Removal deletes the reverse-index row and decrements `memberCount` atomically | **PASS** | `admin-user-organization-iam.test.ts` |

**Last-Owner guardrail TOCTOU-race (Security M-1):** independently
re-confirmed this is genuinely **unexercised** by any test in this repo
(`fake-admin-db.ts:416`'s `runTransaction` is a synchronous pass-through
with zero conflict/retry simulation) and genuinely **deferred**, not
silently dropped — `agents/docs/BACKLOG.md` line 52/541 tracks it as
**M8-T8**, correctly scoped as a regression-safety/test-infrastructure gap
against code that is architecturally correct as shipped (not a demonstrated
exploit). QA did not attempt to build a transaction-conflict simulator in
`fake-admin-db.ts` for this pass — that is explicitly the scope of the
already-filed M8-T8 ticket, and inventing a parallel, ad hoc version of it
here would fragment rather than close that backlog item. This is
disclosed, not silently accepted: the guarantee itself is real (verified by
direct read of the transactional ordering, matching Security's own
reasoning), but its regression-safety net does not yet exist.

### §6 — Route enforcement inventory

| AC | Result | Evidence |
|---|---|---|
| 1. Every VERIFY route has Owner/Admin/Editor 200 + Viewer 403 coverage | **PASS, genuine gap closed this pass (see §1 AC-2 above)** | Sample verified with REAL fixtures + REAL routes this pass: `events/[eventId]/status` POST (write:events), `attendees/route.ts` GET (the one D6-reclassified route), `GET /api/dashboard/iam` (view-tier by design) |
| 2. `attendees/route.ts` GET is the ONLY existing route file whose scope-check call site changed | **PASS, independently re-confirmed** | `git diff --name-only -- 'src/app/api/**'` run fresh this session returns exactly one file: `src/app/api/dashboard/events/[eventId]/attendees/route.ts`. Matches Code Review's and Security's own independent audits |
| 3. No route outside the inventory was missed | **PASS (by the same diff evidence above)** — not independently re-derived from a fresh grep by QA, but the diff-based check in AC-2 is a strong structural proxy: if no other route file changed, no other route's enforcement behavior changed either |

**§6 spot-check (Priority 8 — regression check for other write:events-gated
routes):** confirmed via direct `git diff` that `drafts/route.ts`,
`checkin/config/route.ts`, `emails/definitions|settings|messages/route.ts`,
and `promotions/templates/[templateId]/eligible-events/route.ts` are all
**untouched** by this diff. Their pre-existing tests
(`drafts-list-route.test.ts`, `checkin-config-route.test.ts`,
`email-definitions-route.test.ts`, `email-settings-route.test.ts`,
`email-messages-route.test.ts`) already assert 403 for a
`permissions: ["view:events"]` fixture and are unmodified, still passing in
the full 164-file run — no regression from the D6 reclassification leaked
into any of these explicitly-kept-write-tier routes.

### §7 — Multi-tenant isolation (D12)

| AC | Result | Evidence |
|---|---|---|
| 1. `GET /api/dashboard/iam` never cross-org leaks | **PASS** | `admin-organization-member.test.ts`'s cross-org list isolation test + this pass's lifecycle E2E (single-org, but structurally exercises the same `listAdminOrganizationMembers(organizationId)` code path) |
| 2. Mutating IAM routes 404 (not 403) cross-org | **PASS** | `admin-user-organization-iam.test.ts`'s `TARGET_NOT_FOUND` tests for both `changeAdminMemberRole`/`removeAdminMember`; `revokeAdminInvitation`'s `NOT_FOUND` (structurally guaranteed by the deterministic `(org,email)` doc id) |
| 3. Reverse-index written in the SAME transaction as every roster mutation | **PASS (verified by direct source read, matching Code Review/Security)** | Every roster-mutating function in `adminUserOrganization.ts` pairs its `User`/`Organization` write with an `OrganizationMember` write inside the same `tx` |
| 4. `firestore.rules` deny-all for both new collections | **PASS, independently re-read this session** | `firestore.rules:373-379` — both `Invitation` and `OrganizationMember` are unconditional `allow read, write: if false`; `firestore.indexes.json` carries the new `OrganizationMember(organizationId ASC, role ASC)` composite index |

### §4 (accept page) — component states

| State | Result | Evidence |
|---|---|---|
| Loading | **PASS** | `accept-invitation-view.test.tsx` — "Checking your account..." while `initializing: true`, zero fetch calls |
| Not-signed-in, existing user (sign-in then retry) | **PASS** | Reuses `LoginForm` with `redirectTo="/invite/{token}"` |
| Not-signed-in, new user (signup redirect carrying the token) | **PASS** | Link to `/signup?inviteToken={token}` asserted directly |
| Success | **PASS** | "You're in!" state, session-cookie sync call, toast, delayed redirect to `/dashboard` |
| Email-mismatch (§4 AC-2) | **PASS** | "Wrong account" state with a sign-out-and-retry action, never implying a plain retry will help |
| Invalid/expired/already-accepted | **PASS** | Collapsed `INVALID` state, with a context-sensitive link (sign-in vs. dashboard depending on whether the caller is currently authenticated) |
| Retry-after-identity-switch (extra, not spec-named but a real edge) | **PASS** | A second, different-uid sign-in after a mismatch correctly re-attempts, not suppressed by the `attemptedForRef` guard |

### §8 — UI states & cross-cutting

| State | Result | Evidence |
|---|---|---|
| Empty pending-invitations list (inline row, not boxed `EntityEmptyState`) | **PASS** | `iam-members-table.test.tsx` "renders the inline 'No pending invitations' row when invitations is empty" |
| Owner+Admin combined role-description card with footnote | **PASS, ZERO prior test coverage — closed this pass** | No test file existed for `role-description-cards.tsx` at all. Closed with `iam-role-description-cards.test.tsx` (3 tests): exactly 3 cards render (never a separate Admin card), the D5 footnote copy is exact and appears exactly once, Editor/Viewer cards carry their own copy |
| Two-tier role-change dialog (lightweight Dialog for Editor/Viewer-only changes; AlertDialog escalation for anything Owner/Admin-tier) | **PASS** | `iam-role-change-dialog.test.tsx` — both tiers independently tested, including the amber demotion-tone confirm button |
| Last-Owner guardrail's inline (non-toast) error presentation | **PASS** | Same file — `role="alert"` inline block inside the `AlertDialog`, confirm button disabled, Cancel remains available — confirmed NOT a toast |
| D10 em-dash terminal affordance (Admin caller viewing an Owner/Admin row) | **PASS** | `iam-members-table.test.tsx` — em dash for Admin-on-Owner-row, real menu for Admin-on-Editor-row |
| Both themes / responsive (320/768/1024/1440) | **Not independently pixel/browser-verified this pass (no dev-server/browser available — see Method)** | Structural source read: `role-badge.tsx`/`status-badge.tsx` use only semantic `dark:` Tailwind pairs (violet/emerald/amber at the same `-100/-900` light / `-950/-200` dark depth already used elsewhere in this app), zero hardcoded hex colors or inline `style` found anywhere under `src/features/iam/**` (grepped). Same "structural inspection, not pixel-rendered verification" caveat this loop's QA passes have consistently and honestly disclosed when no browser/emulator is available |

## Defects

**None found at Major severity or above.** Every item this pass
investigated for a possible implementation defect (the S-1 fix, the D10
hierarchy dispatch, the last-Owner guardrail's transactional ordering, the
§6 enforcement-inventory diff, the invite-accept email-match check, the
signup-wizard org-creation-skip branch) was **already correctly
implemented** — the gaps found were all test-coverage gaps, not behavior
defects, consistent with this ticket having already passed two prior gates
(Code Review, Security) that independently re-verified the security-critical
surfaces by direct source read rather than trusting prior claims.

Per this loop's established convention (M7-T3), a regression test was
written for every genuine coverage gap found, closing each one rather than
just reporting it.

## Regression tests added this pass

- `src/__tests__/permission-matrix-route-dal-integration.test.ts` (new, 14
  tests) — Priority 1: real Owner/Admin/Editor/Viewer fixtures seeded via
  the actual `permissionsForOrganizationRole()` (not hand-typed arrays),
  driven through the REAL route handlers against a REAL `fake-admin-db`, for
  a sample spanning a write:events route (`events/[eventId]/status` POST), the
  one D6-reclassified view-tier route (`attendees` GET), the roster GET, and
  a write:user IAM route (`members/[email]` PATCH) — including a real
  Admin-vs-Owner D10 hierarchy check.
- `src/__tests__/iam-member-lifecycle-e2e.test.ts` (new, 1 test, 7 stages) —
  Priority 2: a single continuous flow through all five IAM routes plus a
  real write:events route, proving invite → pending "Invited" row → accept
  (as the invited identity, via Bearer auth) → Active Editor member whose
  ACTUAL functional permission is proven (a real event publish succeeds, not
  just an inspected `permissions[]` array) → role change to Viewer (whose
  very next request genuinely 403s, proving D11 "next request" freshness
  functionally) → removal (whose next request 403s with no matching roster
  entry).
- `src/__tests__/signup-organization-form-invite.test.tsx` (new, 4 tests) —
  Priority 6: locks that the invite-token signup branch genuinely skips org
  creation/join (D7/D9) — `signupCreateOrgAndUser`/`joinOrganization` are
  never called on that branch (both the email/password and
  already-Google-authenticated sub-cases), plus a control test proving the
  ordinary non-invite path is unaffected.
- `src/__tests__/iam-role-description-cards.test.tsx` (new, 3 tests) —
  Priority 7: the previously-untested `RoleDescriptionCards` component —
  exactly 3 cards, the D5 footnote copy exact and singular, Editor/Viewer
  copy present with no footnote.

All four new files pass individually and as part of the full suite; no
existing test was modified.

## Verdict

| Ticket | Verdict |
|---|---|
| M8-T1 — Real IAM | **SIGNED OFF** |

All acceptance criteria across §1–§8 and D1–D12 pass. Both prior gates'
findings were independently re-confirmed by direct source read rather than
taken on their word: Code Review's S-1 fix (idempotency-before-hierarchy
ordering in `revokeAdminInvitation`) is genuinely in the current tree and
genuinely tested; Security's M-1 (last-Owner TOCTOU-race test-coverage gap)
is genuinely deferred to a tracked backlog ticket (M8-T8), not silently
dropped, and the underlying guarantee it concerns is architecturally sound
as shipped (verified by direct read of the transactional read-before-write
ordering). The one class of gap this pass found and closed — permission
coverage asserted only via mocked DAL/hand-typed permission arrays rather
than real fixtures through the real role-computation + DAL wiring, plus
zero coverage for two components (`RoleDescriptionCards`,
`OrganizationForm`'s invite-token branch) — was a coverage gap, not a
behavior defect, in every instance investigated; the shipped implementation
was correct in every case.

**Disclosed honestly per Method:** no local Firestore/Auth emulator is
available in this environment, so no `npm run dev` click-through against
real Firebase was performed; all integration-shaped verification in this
report and this pass's new tests is `fake-admin-db`-backed (a genuine,
route-handler-invoking, real-DAL-executing test double, not a mocked
permission array), and the theme/responsive claims in §8 were verified by
structural source read (semantic Tailwind tokens, no hardcoded colors) 
rather than pixel-rendered browser verification.

**Automated suite at sign-off:** `npm run lint` clean · `npx tsc --noEmit`
clean except the same 7 pre-existing baseline errors already carried
through Code Review and Security (confirmed outside the M8-T1 diff via
direct file inspection) · `npm run build` exit 0, `/dashboard/iam`,
`/invite/[token]`, and all 6 new/changed IAM routes present in the manifest
· `npm test -- --run` → **164 files / 1897 tests passing, 0 failing** (up
from Security's reported 160/1875 by this pass's own 4 new files / 22 new
regression tests).

Cleared to close M8-T1 and merge to `prototype`.
