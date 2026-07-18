# Code Review — M8-T1 Real IAM

Code Reviewer, 2026-07-18. Scope: all uncommitted changes in the working
tree relative to `prototype` for M8-T1 — Backend's DAL slice
(`src/lib/db/{adminUserOrganization,adminInvitation,adminOrganizationMember}.ts`,
`src/types/collection.ts`, `src/lib/validation.ts`, `firestore.rules`,
`firestore.indexes.json`), Full-Stack's UI/route slice
(`src/features/iam/**`, `src/app/api/dashboard/iam/**`,
`src/app/api/organizations/invitations/accept/route.ts`,
`src/app/dashboard/(workspace)/iam/page.tsx`, the one
`src/app/api/dashboard/events/[eventId]/attendees/route.ts` +
`src/features/registration/server/route-scope.ts` reclassification), and
the follow-up invite-accept-page dispatch (`src/app/invite/**`,
`src/features/iam/components/accept-invitation-view.tsx`,
`src/components/auth/login-form.tsx`, signup-wizard changes). All new/changed
test files under `src/__tests__/`. (`HANDOVER.md`, `agents/docs/BACKLOG.md`,
`memory/` excluded — orchestration bookkeeping, matching prior review
precedent.) Reviewed against `agents/docs/specs/m8-real-iam.md`,
`agents/docs/design/m8-real-iam.md`, and `agents/docs/data-models/m8-real-iam.md`.

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the same
  **pre-existing, unrelated** 7-error baseline in 3 untouched files
  (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`,
  `register-route.test.ts:62`) — matches the Orchestrator's and prior M7
  reviews' reported baseline exactly. None touch any file in this diff's scope.
- `npm test -- --run` — PASS, **160 files / 1873 tests**, matches the claimed
  count exactly.

---

## Priority 1 — §6 enforcement-inventory completeness

Verified directly, not by re-trusting the spec's own claim: diffed every
changed file under `src/app/api/**` and `src/features/registration/server/route-scope.ts`
against §6's inventory.

**Confirmed: `src/app/api/dashboard/events/[eventId]/attendees/route.ts` (GET)
is the ONLY existing route file whose scope-check call site changes** —
`resolveRegistrationRouteScope(eventId, { requireWriteEvents: false })`,
matching D6 exactly. `route-scope.ts` itself gained the
`options: { requireWriteEvents?: boolean } = {}` param with `requireWriteEvents`
defaulting to `true`, so every other of the ~30 call sites (which pass zero
options) is behaviorally unchanged — verified by reading the diff hunk itself
(the gate condition changed from `if (!userDoc?.permissions.includes(...))`
to `if (requireWriteEvents && !userDoc?.permissions.includes(...))`, which is
a strict superset of the old behavior when the flag defaults `true`).

`git diff --name-only -- 'src/app/api/**'` shows no other existing route file
under `src/app/api/dashboard/**` was touched — the only other API-route
changes are the five brand-new IAM routes and the new accept route, none of
which have a "prior" state to compare against. §6's own claim that ~50 of ~51
routes need zero changes holds exactly as stated. New regression tests
(`route-scope.test.ts`'s new `{ requireWriteEvents: false }` describe block,
`attendees-list-export-routes.test.ts`'s updated 200-not-403 assertion) prove
the reclassification directly, and both still 401/403/404 correctly on the
auth/org-scope/cross-org paths when opted out. No Blocker here.

## Priority 2 — D10 role-hierarchy guardrail (`adminUserOrganization.ts`)

Read `changeAdminMemberRole`/`removeAdminMember`'s actual branching, not just
the tests, and traced every combination by hand:

```
if (callerRole !== "owner") {
  if (isUpperTierRole(targetMembership.role) || isUpperTierRole(input.newRole)) {
    return HIERARCHY_VIOLATION;
  }
}
```
(`removeAdminMember`'s equivalent: `callerRole !== "owner" && isUpperTierRole(targetMembership.role)`.)

Since `resolveCallerAndTargetMembership` already rejects any caller whose own
role isn't Owner/Admin (`CALLER_NOT_AUTHORIZED`), `callerRole !== "owner"`
at this point in the code can only mean "Admin caller." Verified every named
combination resolves correctly:
- Owner→Owner, Owner→Admin: allowed (falls through to the last-Owner check).
- Admin→Owner, Admin→Admin (change or remove): `isUpperTierRole(target.role)`
  is true → `HIERARCHY_VIOLATION`. Correct.
- Admin→Editor/Viewer (change to editor/viewer, or remove): allowed. Correct.
- Admin promotes anyone to Owner or Admin: `isUpperTierRole(newRole)` is true
  → `HIERARCHY_VIOLATION` regardless of the target's current role. Correct.

All seven named combinations in the dispatch brief are covered by direct,
behavioral tests in `admin-user-organization-iam.test.ts` (not tautological —
each asserts the typed rejection code and, where relevant, that the stored
doc/roster is unchanged). No Blocker.

## Priority 3 — Last-Owner guardrail + org-scoping

`countAdminOrganizationOwnersInTransaction`/`countAdminOrganizationOwners`
(`adminOrganizationMember.ts:146-174`) build the query as
`.where("organizationId", "==", organizationId).where("role", "==", "owner")`
— a genuine composite-field query scoped to the caller's own org, not a
raw/global count. No cross-org leakage possible: a same-named Owner in a
different org can never be counted. This is exactly the class of bug the
dispatch flagged as a real Blocker risk, and it does not exist here.

Both self-action and other-caller-action shapes are correctly gated (`if
(targetMembership.role === "owner" && input.newRole !== "owner")` for role
change; `if (targetMembership.role === "owner")` for removal — neither
special-cases who the caller is, so a self-demote/self-remove and an
other-caller demote/remove of the same sole Owner both correctly hit
`LAST_OWNER`). Verified against `admin-user-organization-iam.test.ts`'s
explicit two-Owner and sole-Owner fixtures for both `changeAdminMemberRole`
and `removeAdminMember`, both self and other-caller shapes, all passing and
asserting real store state (owner count via `countAdminOrganizationOwners`,
not just the return code). No Blocker.

## Priority 4 — `acceptAdminInvitation`'s email-match check

Read `acceptAdminInvitation` (`adminUserOrganization.ts`) directly:
- **Case-insensitive:** `callerEmail = input.callerEmail.trim().toLowerCase()`;
  `Invitation.email` is stored lowercased at write time
  (`createOrUpdateAdminInvitation`'s `email = input.email.trim().toLowerCase()`).
  Both sides normalized before comparison — genuinely case-insensitive.
- **Before any write:** the first comparison (`initial.email !== callerEmail`)
  happens against a **plain, non-transactional** `getAdminInvitationByToken`
  read, and returns `EMAIL_MISMATCH` before `adminDb.runTransaction` is ever
  called. Zero writes on the fast-fail path.
- **Re-verified inside the transaction (not a TOCTOU gap):** the transaction
  re-reads the same doc (`tx.get(invRef)`) and re-checks
  `invitation.email !== callerEmail` again against this fresh read, before
  calling `applyOrganizationJoinInTransaction`. This closes the exact race the
  dispatch was worried about (invitation doc mutated between the pre-check and
  the transaction opening).

The IDOR-shaped IDOR test (`admin-user-organization-iam.test.ts`, "rejects a
MISMATCHED authenticated email") and the route-level test
(`organizations-invitations-accept-route.test.ts`) both assert zero
membership write and zero invitation-status change on mismatch. No Blocker.

## Priority 5 — DAL boundary

Grepped every new/changed `.ts`/`.tsx` file (tracked diff + untracked new
files) for `firebase-admin`/`firebase/firestore` imports outside
`src/lib/db/`. The only hits are:
- `src/types/collection.ts`'s existing, pre-M8-T1 pattern:
  `import type { Timestamp, FieldValue } from "firebase/firestore"` (type-only,
  established codebase convention for the pure-types module).
- Test fixture files (`fake-admin-db.ts`, `admin-invitation.test.ts`,
  `admin-organization-member.test.ts`) importing `Timestamp`/`Transaction`
  types from `firebase-admin/firestore` for fixture construction — matching
  the same pattern many pre-existing test files already use.

No violation. No Blocker.

## Priority 6 — The two invite-accept-page follow-up fixes

**(a) `login-form.tsx` Google sign-in `syncSessionCookie()`:** the new call
(`await signInWithPopup(auth, provider); await syncSessionCookie(); router.push(redirectTo);`)
is a straight `await`-then-redirect, identical in shape to the pre-existing
email/password path (`onSubmit`) two functions above it. No race: the cookie
sync completes before the redirect fires. The pre-existing `onAuthStateChanged`
listener + 5-second countdown effect (`redirectDelaySec`, used for the
email-verification-pending flow) is a separate, already-existing mechanism
that also calls `router.push(redirectTo)` on a timer — but this was already
true for the email/password path before this diff, so adding the same
`syncSessionCookie()` call to the Google path doesn't introduce a *new*
double-redirect risk; the component unmounts on the immediate `router.push`
in the common case regardless. No new issue.

**(b) `accept-invitation-view.tsx`'s `attemptedForRef` keyed on `${token}:${user.uid}`:**
traced the `useEffect` logic directly. On sign-out, `attemptedForRef.current`
is reset to `null`; on a new `user`/`token` pairing, the key changes and the
guard (`if (attemptedForRef.current === attemptKey) return;`) does not fire,
so a fresh attempt runs. This correctly prevents both failure modes named in
the dispatch: (1) no infinite retry loop, since a completed attempt for the
same `(token, uid)` pair is never re-run even if the effect re-fires (e.g. on
a `user` object identity change from a token refresh); (2) no stale-attempt-
after-account-switch bug, since signing out resets the ref and signing back
in as a different account produces a different `attemptKey`. No Blocker.

## Priority 7 — Code quality pass

- **Naming/structure:** consistent with established conventions
  (`organizationMemberId`/`invitationId` mirror `reportScheduleId`;
  `adminOrganizationMember.ts`'s leaf-module dependency direction, documented
  and correct, avoids a real circular-import risk between `adminInvitation.ts`
  and `adminUserOrganization.ts`).
- **File size:** `src/lib/db/adminUserOrganization.ts` is **808 lines** —
  8 lines over this repo's stated 800-line hard cap (`agents/docs/reviews/m7-scheduled-reports.md`'s
  own convention, and this project's coding-style checklist). Marginal, and
  the file is a single cohesive unit (every IAM roster mutation, well-commented,
  no duplicated logic within it) — flagged as a Nit, not a Should-fix, but
  worth a follow-up split (e.g. extracting the invite-accept /
  role-change / removal block into a sibling file) the next time this file
  is touched.
- **Minor duplication:** `isManagerRole` (owner-or-admin predicate) is
  independently reimplemented in both `adminInvitation.ts` and
  `adminUserOrganization.ts` (as `isUpperTierRole`, aliased) rather than
  shared from one place. This is a direct consequence of the documented
  dependency-direction constraint (avoiding a circular import between the two
  modules) — understandable, but a tiny shared pure-predicate module (no
  Firebase imports, safe for either side to import) would have avoided the
  duplication entirely. Nit.
- **No `console.log`, no hardcoded secrets** found in any new/changed file.
- **Error handling:** every route maps DAL typed-rejection codes to specific,
  distinct HTTP statuses (401/403/404/409/410) with no raw Firestore/500-shaped
  error ever surfaced to the client on the guardrail paths — matches spec §8's
  "Never" list.
- **Test quality:** every new test file asserts real behavioral outcomes
  (stored doc/roster state, typed rejection codes, exact response mappings)
  rather than tautological "no crash" assertions. Confirmed by direct read of
  `admin-user-organization-iam.test.ts`, `admin-invitation.test.ts`,
  `admin-organization-member.test.ts`, `iam-members-route.test.ts`,
  `iam-invites-route.test.ts`, `iam-dashboard-route.test.ts`,
  `organizations-invitations-accept-route.test.ts`, `iam-permissions.test.ts`,
  `route-scope.test.ts`, `attendees-list-export-routes.test.ts`.

### One real correctness finding (Should-fix)

**`revokeAdminInvitation` (`src/lib/db/adminInvitation.ts:234-270`) checks the
D10 hierarchy guardrail *before* checking idempotency, so an Admin caller
"revoking" an already-accepted or already-revoked Admin-role invitation gets
`HIERARCHY_VIOLATION` (403) instead of the idempotent `{ok:true}` no-op spec
§3 AC-6 requires unconditionally.**

```ts
if (existing.role === "admin" && callerMember.role !== "owner") {
  return { ok: false, code: "HIERARCHY_VIOLATION" };   // <-- runs regardless of status
}
if (existing.status !== "pending") {
  return { ok: true };                                  // idempotent no-op — never reached above
}
```
The data-model doc's own §3 write-up describes the guardrail as gating
"revoking a **pending** Admin-role invite" (Owner-only) — implying the
hierarchy check should only matter when there's an actual pending action to
block. AC-6's text has no caller-role carve-out: "Revoking an already-accepted
or already-revoked invitation is a `200` no-op, not an error." As written, an
Admin who clicks "Revoke" on a stale UI row (e.g. an Admin-role invite someone
else already accepted, or that a different Owner already revoked) gets a
permission-denied error instead of a silent success. Not a security hole (it
fails closed, over-restrictive rather than under-restrictive), but it's a
genuine deviation from both the spec's stated intent and the literal AC-6
text, and the test suite doesn't exercise this exact combination — every
"idempotent revoke" test in `admin-invitation.test.ts` uses a `viewer`-role
invitation with an Owner caller, and every "Admin revoking an Admin-role
invite" test (`"D10: an Admin caller revoking a pending Admin-role invite gets
HIERARCHY_VIOLATION"`) only exercises the still-pending case. **Fix:** swap
the order — check `existing.status !== "pending"` (idempotent no-op) before
the hierarchy check, so a non-pending invitation is always a no-op regardless
of caller/role.

---

## Priority 8 — Full-Stack's reconciliation

Cross-checked every route file's imports against Backend's actual DAL
exports (`grep -n "from \"@/lib/db/admin" src/app/api/dashboard/iam/**/*.ts
src/app/api/organizations/invitations/accept/route.ts`) — all resolve to
real, current exports (`createOrUpdateAdminInvitation`, `revokeAdminInvitation`,
`listAdminInvitationsForOrganization`, `listAdminOrganizationMembers`,
`changeAdminMemberRole`, `removeAdminMember`, `acceptAdminInvitation`). No
dangling imports of guessed-signature functions, no leftover dead code from
an earlier draft found in the current tree. `tsc --noEmit` (clean beyond the
unrelated baseline) independently confirms this — a signature mismatch would
have surfaced as a type error.

---

## Findings

**Blockers: 0**

**Should-fix: 1**

1. **S-1 — `src/lib/db/adminInvitation.ts:256-263` (`revokeAdminInvitation`):**
   the D10 hierarchy check runs before the idempotency check, so revoking an
   already-resolved (`accepted`/`revoked`) Admin-role invitation as a
   non-Owner Admin caller incorrectly returns `HIERARCHY_VIOLATION` (403)
   instead of the idempotent `{ok:true}` no-op spec §3 AC-6 requires
   unconditionally. Reorder the two checks (idempotency first) and add a test
   covering an Admin caller revoking an already-resolved Admin-role invitation.

**Nits: 2**

1. **N-1 — `src/lib/db/adminUserOrganization.ts`** is 808 lines, 8 over this
   repo's stated 800-line hard cap. Cohesive and well-commented as-is; worth
   splitting the invite-accept/role-change/removal block into a sibling file
   next time this module is touched, not worth blocking on now.
2. **N-2 — `isManagerRole`/`isUpperTierRole`** (owner-or-admin predicate) is
   independently reimplemented in both `adminInvitation.ts` and
   `adminUserOrganization.ts` rather than shared from one leaf module — a
   direct, documented consequence of avoiding a circular import between the
   two files, but a tiny shared pure-predicate module would remove the
   duplication.

## Verdict: **CHANGES REQUESTED**

The security-critical surfaces this ticket exists to build — the D10
role-hierarchy guardrail, the last-Owner guardrail and its org-scoping, the
invitation email-match check (case-insensitivity, pre-write fast-fail, and
in-transaction re-verification), the §6 enforcement-inventory's core claim
(only `attendees/route.ts` GET changed among ~51 routes), the DAL boundary,
and both invite-accept-page follow-up fixes — were all independently
re-verified by direct source read (not just trusting tests or prior agent
reports) and hold correctly. `npm run lint`, `npx tsc --noEmit`, and
`npm test -- --run` (160 files / 1873 tests) all pass with no new errors
beyond the pre-existing 7-error baseline in unrelated files.

One genuine, if narrow, correctness bug was found in `revokeAdminInvitation`'s
check ordering (S-1 above) — it deviates from spec §3 AC-6's literal,
unconditional idempotency requirement for one specific combination (Admin
caller, already-resolved Admin-role invitation) and is not currently covered
by any test. It fails closed (over-restrictive, not a security gap), but it
is a real, fixable spec deviation, not a matter of interpretation — returning
**CHANGES REQUESTED** rather than approving with a note, per this ticket's
"multi-agent loop gates on Code Review before Security" posture. Once S-1 is
fixed (reorder the two checks in `revokeAdminInvitation`, add the missing
test), this is clear to re-review and, on confirmation, proceed to the
Security Agent — no other blocking issues were found across either
implementation slice or the follow-up dispatch.
