# Merge Log — M8-T1 Real IAM

- **Date:** 2026-07-18
- **Feature branch:** `feat/m8-t1-real-iam`
- **Target branch:** `prototype`
- **Merge commit:** `d0e7189` — `merge(m8-t1): real IAM — Owner/Admin/Editor/Viewer RBAC, invitation lifecycle, route-enforcement sweep`
- **Merge base (prototype before merge):** `acc08ff`

## Branch provenance (same pattern as every prior ticket)

All of M8-T1's implementation work (Research, Backend DAL slice, Full-Stack
UI/routes slice, the follow-up invite-accept-page dispatch, and all three
independent verification passes — Code Review, Security, QA) was carried
out directly in the working tree while already checked out on `prototype`
— no `feat/m8-t1-real-iam` branch existed until the GitHub Agent created
one at commit time. This is the identical situation to every prior ticket
back through M6 and M7 (`agents/docs/git/m7-scheduled-reports.md` and its
own chain of precedents), the established pattern for this loop.
`feat/m8-t1-real-iam` was cut via `git checkout -b feat/m8-t1-real-iam`
from that working-tree state, then the ticket's work was staged (via a
pathspec excluding `HANDOVER.md`, `agents/docs/BACKLOG.md`, and `memory/`)
and committed as a single commit on the new branch. Those three exclusions
are orchestration bookkeeping, same convention as every prior ticket, and
were instead committed separately on `prototype` after the merge
(`memory/` left untracked entirely, per the loop convention of not
versioning agent scratch memory).

## Tickets landed

M8-T1 — first ticket of the M8 milestone: replaces the fully mocked IAM
dashboard screen with a real 4-tier role-based access control system
(Owner/Admin/Editor/Viewer, legacy `member` alias preserved for existing
data). Ships two new D12 reverse-index entities (`Invitation`,
`OrganizationMember`) and their DAL modules; a complete invitation
lifecycle (idempotent upsert-create, cryptographically strong
`nanoid(32)` token never logged, case-insensitive + whitespace-tolerant
email-matched accept with a fast-fail-then-in-transaction-re-verify
TOCTOU close, and an unconditionally-idempotent revoke); a D10
role-hierarchy guardrail so an Admin caller can never touch or promote
anyone into an Owner/Admin-tier row (including their own row); a
last-Owner guardrail whose owner-count query is genuinely
per-organization-scoped and read inside the same transaction as the
mutation; a route-enforcement sweep across five new
`/api/dashboard/iam/**` + accept routes plus one existing-route
reclassification (`attendees` GET, write:events → view-tier, with every
other of the ~30 `route-scope.ts` call sites behaviorally unchanged via a
new `requireWriteEvents` flag defaulting `true`); and a new
`/invite/[token]` accept-page surface wired into both the login form and
the signup wizard's invite-token branch (which now genuinely skips org
creation). One Should-fix cycle at Code Review (see below), zero defects
at QA. Security's one Medium finding (last-Owner guardrail's TOCTOU-race
safety is architecturally sound but unexercised by the in-memory
Firestore test double) was deferred to a new backlog ticket, M8-T8, not
silently dropped — added to `agents/docs/BACKLOG.md` in this session's
docs-bookkeeping commit.

## M8-T1 commits

| Hash | Message |
|------|---------|
| `975cf14` | feat(iam): real role-based access control — Owner/Admin/Editor/Viewer (M8-T1) |
| `d0e7189` | merge(m8-t1): real IAM — Owner/Admin/Editor/Viewer RBAC, invitation lifecycle, route-enforcement sweep |
| `1b92cef` | docs(handover): M8-T1 closure, M8-T8 added |

## Files (feature commit `975cf14`)

61 files changed, 10564 insertions(+), 918 deletions(-). Notable
additions/changes:

- DAL: `src/lib/db/{adminInvitation.ts, adminOrganizationMember.ts}` (new)
  and `src/lib/db/adminUserOrganization.ts` (extended, now 807 lines —
  flagged by Code Review as 7 lines over this repo's 800-line soft cap,
  Nit-only, not blocking) — `createOrUpdateAdminInvitation`,
  `revokeAdminInvitation`, `acceptAdminInvitation`,
  `changeAdminMemberRole`, `removeAdminMember`,
  `countAdminOrganizationOwners(InTransaction)`, `listAdminOrganizationMembers`,
  `listAdminInvitationsForOrganization` — every roster-mutating write
  transactional with the `OrganizationMember` reverse-index kept in sync
  inside the same transaction.
- Role model widening: `src/types/collection.ts` (`OrganizationRole`,
  `EDITOR_PERMISSIONS`, `InvitationDoc`, `OrganizationMemberDoc`),
  `src/lib/validation.ts` (`createInvitationSchema`, structurally cannot
  carry `role: "owner"` — `z.enum(["admin","editor","viewer"])`).
- Feature module: `src/features/iam/{permissions.ts, types.ts,
  components/{invite-member-dialog, members-table, role-actions-menu,
  role-badge, role-change-dialog, role-description-cards,
  status-badge}.tsx}` (new), `src/features/iam/components/iam-dashboard.tsx`
  rebuilt in place to fetch real data instead of mock summaries.
- Routes: `src/app/api/dashboard/iam/{route.ts, invites/route.ts,
  invites/[email]/revoke/route.ts, members/[email]/route.ts}` (new),
  `src/app/api/organizations/invitations/accept/route.ts` (new) — all
  Zod-validated, typed-DAL-rejection-mapped to specific HTTP statuses
  (401/403/404/409/410), never a raw 500 on a guardrail path. One
  existing-route reclassification:
  `src/app/api/dashboard/events/[eventId]/attendees/route.ts` GET
  (write:events → view-tier) plus the underlying
  `src/features/registration/server/route-scope.ts` change
  (`requireWriteEvents` option, defaulting `true`).
- Invite-accept surface: `src/app/invite/{[token]/page.tsx, layout.tsx}`
  (new), `src/features/iam/components/accept-invitation-view.tsx` (new),
  plus follow-up fixes to `src/components/auth/login-form.tsx`
  (`syncSessionCookie()` call on the Google sign-in path) and the signup
  wizard (`src/features/signup/{store.ts, components/{credentials-form,
  organization-form}.tsx}`, `src/app/(auth)/signup/{page.tsx,
  credentials/page.tsx}`) so an invite-token signup genuinely skips org
  creation/join.
- `firestore.rules` / `firestore.indexes.json` — `Invitation` and
  `OrganizationMember` both unconditional deny-all (server-DAL-only
  access, matching the `EmailDefinition`/`ReportSchedule` precedent), new
  `OrganizationMember(organizationId ASC, role ASC)` composite index for
  the owner-count query.
- Docs: `agents/docs/{specs,design,data-models,reviews,security,qa}/m8-real-iam.md`.
- Tests: 16 new test files (`admin-invitation`, `admin-organization-member`,
  `admin-user-organization-iam`, `iam-dashboard-route`,
  `iam-invite-member-dialog`, `iam-invites-route`,
  `iam-member-lifecycle-e2e`, `iam-members-route`, `iam-members-table`,
  `iam-permissions`, `iam-role-change-dialog`, `iam-role-description-cards`,
  `organizations-invitations-accept-route`,
  `permission-matrix-route-dal-integration`,
  `signup-organization-form-invite`, `accept-invitation-view`), plus
  updates to `attendees-list-export-routes`, `route-scope`, and
  `helpers/fake-admin-db` — including a real-route+real-DAL permission
  matrix integration suite, a full 7-stage member-lifecycle E2E, and
  QA's own 4 new files / 22 new regression tests closing coverage gaps
  found during its pass (none were behavior defects).

Excluded from this commit (committed separately on `prototype` in
`1b92cef`, or left untracked): `HANDOVER.md`, `agents/docs/BACKLOG.md`,
`memory/`.

## Gate status at merge time

- **Code Review:** CHANGES REQUESTED → fix verified → **APPROVED**. 0
  Blockers, 1 Should-fix, 2 Nits. The Should-fix (S-1):
  `revokeAdminInvitation` checked the D10 role-hierarchy guardrail
  *before* the idempotency check, so a non-Owner Admin caller "revoking"
  an already-accepted or already-revoked Admin-role invitation incorrectly
  got `HIERARCHY_VIOLATION` (403) instead of spec §3 AC-6's required
  unconditional `{ok:true}` no-op. Not a security hole (fails closed,
  over-restrictive rather than under-restrictive) but a genuine,
  fixable spec deviation with zero existing test coverage of that exact
  combination. Fixed by reordering the two checks (idempotency first)
  and adding a regression test; re-verified fixed by both Security and
  QA via direct source read, not re-trusted on Code Review's word.
  Two non-blocking Nits: `adminUserOrganization.ts` at 807 lines (7 over
  the 800-line soft cap, cohesive single unit, flagged for a future
  split) and `isManagerRole`/`isUpperTierRole` independently
  reimplemented in two DAL files rather than shared (a direct,
  documented consequence of avoiding a circular import between them).
  Also independently re-verified: the §6 enforcement-inventory's core
  claim (only `attendees/route.ts` GET changed among ~51 routes), the
  D10 hierarchy dispatch table (all seven named combinations), the
  last-Owner guardrail's per-org query scoping, the accept flow's
  email-match check (case-insensitivity, pre-write fast-fail, in-
  transaction re-verification), the DAL import boundary, and both
  invite-accept-page follow-up fixes (Google sign-in session sync,
  the `attemptedForRef` retry guard). (`agents/docs/reviews/m8-real-iam.md`).
- **Security:** **PASS**. 0 Critical, 0 High, 1 Medium, 0 Low. Nine
  adversarial attack surfaces worked through (privilege escalation via
  the role-change/removal endpoints, invitation forgery/IDOR,
  cross-tenant isolation, the last-Owner guardrail's DoS/TOCTOU
  properties, invitation token security, Firestore rules for the two new
  collections, rate limiting, the invite-accept page's XSS/open-redirect/
  session-fixation surface, and standard secret/PII/injection checks) —
  no privilege-escalation path found for an Editor/Viewer or a
  non-Owner Admin under any request shape or timing tried, no
  client-suppliable `organizationId` anywhere in the new surface, both
  new collections correctly deny-all in `firestore.rules`. The one
  Medium finding (**M-1**): the last-Owner guardrail's concurrent-race
  safety is architecturally sound (independently reasoned through
  Firestore's serializable transaction isolation) and *not exploitable
  in the current code* (verified by direct read that the owner-count
  read happens inside the same transaction as the write), but is
  completely unverified by this repo's test suite, since the in-memory
  Firestore test double (`fake-admin-db.ts`) executes `runTransaction`
  callbacks with zero conflict/retry simulation — a future regression
  (e.g. swapping in the already-exported non-transactional
  `countAdminOrganizationOwners` sibling) would not be caught. Deferred
  to backlog as **M8-T8**, not blocking. Independently re-verified the
  S-1 fix landed as claimed (`adminInvitation.ts:256-266`, idempotency
  now runs before the hierarchy check). No new dependencies
  (`package.json`/`package-lock.json` diff empty); `npm audit` baseline
  unchanged from M7-T3 (15 vulnerabilities, all pre-existing transitive,
  nothing newly reachable). (`agents/docs/security/m8-real-iam.md`).
- **QA:** **SIGNED OFF**, 0 defects found in the implementation at any
  severity. Independently re-verified the S-1 fix and the M-1 deferral
  rather than trusting either prior gate's prose. Found that every
  shipped route-level test asserted permission behavior via a
  hand-typed `permissions: [...]` array on a mocked `getAdminUserByEmail`
  rather than a real role fixture through the real
  `permissionsForOrganizationRole()` + DAL wiring — a genuine,
  if narrow, coverage gap — and closed it with a new real-fixture,
  real-route, real-DAL `permission-matrix-route-dal-integration.test.ts`
  (14 tests) plus a full 7-stage `iam-member-lifecycle-e2e.test.ts`
  proving a role downgrade's *very next request* actually 403s (D11
  freshness, functionally, not just structurally). Also found and closed
  zero-coverage gaps for the signup-wizard's invite-token
  org-creation-skip branch (`signup-organization-form-invite.test.tsx`,
  4 tests) and the previously-untested `RoleDescriptionCards` component
  (`iam-role-description-cards.test.tsx`, 3 tests). Every gap found was
  a test-coverage gap, not a behavior defect — the shipped
  implementation was correct in every instance investigated. Added 22
  regression tests total across 4 new files. Final suite: 164 files /
  1897 tests passing. (`agents/docs/qa/m8-real-iam.md`).
- **Checks (final working tree before merge):** lint clean, `tsc
  --noEmit` at baseline (same 7 pre-existing errors in 3 untouched
  files, re-confirmed by all three gates), build exit 0 with
  `/dashboard/iam`, `/invite/[token]`, and all 6 new/changed IAM routes
  present in the manifest, 164 files / 1897 tests passing.
- **Secret scan of staged diffs before commit:** clean — grepped
  `git diff --cached` for API key/secret/password/token/private-key
  patterns across all new/modified files (hits were only test-fixture
  password strings, form-field labels/autocomplete attributes, and doc
  prose discussing invitation tokens/session cookies, none actual secret
  material); confirmed no `.env*` file appeared in the staged diff or
  `git status`.

## Pre-merge smoke check

Not run standalone on `feat/m8-t1-real-iam` before merge (QA's own
automated suite pass, run immediately prior to sign-off in the same
working tree the branch was cut from, already covers this — lint clean,
`tsc --noEmit` at baseline, build exit 0, 164 files / 1897 tests
passing, per `agents/docs/qa/m8-real-iam.md`).

## Post-merge smoke check (on `prototype`)

- `npm run lint` — PASS (`✔ No ESLint warnings or errors`, exit 0)
- `npm run build` — PASS (exit 0; `/dashboard/iam`, `/invite/[token]`,
  and all new IAM API routes present in the route manifest)
- `npm test -- --run` — PASS, **164 files / 1897 tests**, 0 failing —
  matches QA's reported sign-off count exactly

## Conflicts

None. Merge made by the `ort` strategy with no conflicts.

## Fix cycles

One. Code Review's Should-fix (S-1 — `revokeAdminInvitation` checking
the D10 hierarchy guardrail before idempotency, causing a non-Owner
Admin's revoke of an already-resolved Admin-role invitation to
incorrectly 403 instead of no-op) was fixed (check order swapped, test
added) before Code Review's approval; independently re-verified fixed by
both Security and QA via direct source read. Security's Medium finding
(M-1 — last-Owner guardrail TOCTOU-race test-coverage gap) did not
require a fix cycle — deferred to backlog ticket M8-T8 as a
non-blocking follow-up, since the underlying guarantee is architecturally
correct in the shipped code (verified by both Security and QA via
independent reasoning about Firestore transaction semantics), only its
regression-safety net is missing.

## M8 milestone status

This merge lands the first ticket of M8: M8-T1 (Real IAM) — Done, merged
to `prototype`. Per `agents/docs/BACKLOG.md`, M8-T8 (last-Owner guardrail
TOCTOU-race test coverage) was added to the backlog this session as a
deferred follow-up from Security's M-1 finding; M8 milestone continues
with its remaining tickets.

## Push results

- `feat/m8-t1-real-iam` pushed: new branch → `975cf14`
- `prototype` pushed: `acc08ff..d0e7189` (merge), then a follow-up push
  for `d0e7189..1b92cef` (docs bookkeeping commit)
- `main` untouched throughout: `git rev-parse main` /
  `git rev-parse origin/main` both `cd1951be9225c905e5187851bf8b5796b2c6a1b3`
  before and after all work in this session — verified via
  `git branch --show-current` before every commit/merge/push; no git
  command targeted `main`.
