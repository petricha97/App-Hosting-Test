# M8-T1 Data Model — Real IAM

Backend Agent, 2026-07-17. Implements the Backend slice of `agents/docs/specs/m8-real-iam.md` (D2/D3/D4/D5/D7/D9/D10/D12, §1/§3/§4/§5/§7) under `baseline.md` / `m7-scheduled-reports.md` conventions. Source of truth: the spec above + `src/types/collection.ts` (`OrganizationMembership`, `UserDoc`, `InvitationDoc`, `OrganizationMemberDoc`) + `src/lib/db/{adminUserOrganization,adminInvitation,adminOrganizationMember}.ts`.

**This slice ships the widened 4-tier role model, the `Invitation` entity + DAL, the `OrganizationMember` D12 reverse-index + DAL, and `adminUserOrganization.ts`'s new mutations (`acceptAdminInvitation`, `changeAdminMemberRole`, `removeAdminMember`).** It does not ship UI components, API routes, or the `resolveRegistrationRouteScope()` options-param change — those are the Full-Stack Developer's parallel slice on the same ticket, confirmed already landed and wired against the exact DAL signatures below (verified by direct read of `src/app/api/dashboard/iam/**` and `src/app/api/organizations/invitations/accept/route.ts`).

## 1 — Role model (spec D2/D3/D5)

`OrganizationRole` (new, `src/types/collection.ts`) widens the role union used by both `OrganizationMembership.role` and `UserDoc.organizationRole`:

```ts
export type OrganizationRole = "owner" | "admin" | "editor" | "viewer" | "member";
```

`"member"` is a **permanent, read-time-only legacy alias for `"viewer"`** (D2) — every membership ever written before this ticket stamps `"owner"` or `"member"`; no backfill migration runs. New writes after this ticket ships always use `"viewer"`, never `"member"`.

**Permission matrix (D3), `permissionsForOrganizationRole()` in `adminUserOrganization.ts`:**

| Role | Permission set |
|---|---|
| `owner` | `OWNER_PERMISSIONS` (all 12, unchanged) |
| `admin` | `OWNER_PERMISSIONS` (byte-identical to Owner — D5) |
| `editor` | `EDITOR_PERMISSIONS` (new, 7 strings) |
| `viewer` | `MEMBER_PERMISSIONS` (unchanged, 4 `view:*` strings) |
| `member` (legacy) | `MEMBER_PERMISSIONS` (same as Viewer — the alias is exact, not approximate) |

```ts
export const EDITOR_PERMISSIONS: UserPermission[] = [
  "view:events", "write:events",
  "view:form", "write:form",
  "view:promotion", "write:promotion",
  "view:invoice",
];
```

**D5 — Admin vs. Owner:** identical at the permission-string layer. The only real distinction is the D10 role-hierarchy guardrail on the member-management surface (§4 below) — never expressed as a `UserPermission` string, so it's invisible to every M1–M7 route's `permissions.includes(...)` check by design.

Every membership-mutating flow (`addAdminUserToOrganization`, `createAdminOrganizationWithOwner`, `acceptAdminInvitation`, `changeAdminMemberRole`) calls `permissionsForOrganizationRole()` to (re-)stamp `UserDoc.permissions` — the ~50 existing M1–M7 routes that gate on `permissions.includes(...)` need zero code changes (D4).

## 2 — Entity: `Invitation`

Root collection, deterministic doc id, SERVER-ONLY (no client repo pair, `firestore.rules` deny-all — same posture as `EmailDefinition`/`ReportSchedule`).

```ts
interface InvitationDoc {
  organizationId: string;
  email: string;                          // lowercased
  role: "admin" | "editor" | "viewer";    // never "owner" (D10)
  status: "pending" | "accepted" | "revoked"; // "expired" is DERIVED, never stored
  token: string;                          // opaque bearer secret for /invite/{token}
  invitedBy: string;                      // inviter's email, audit; re-stamped on every re-invite
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  expiresAt: Timestamp;                   // concrete Timestamp, never FieldValue
  acceptedAt?: Timestamp | FieldValue;
  acceptedBy?: string;
}
```

**Doc id:** `invitationId(organizationId, email)` = `sha256(JSON(["Invitation", organizationId, lowercasedEmail]))` (`src/lib/db/adminInvitation.ts`, co-located rather than a separate pure module since it has one consumer) — same tuple-hash family as `reportScheduleId`/`emailDefinitionId`. **One live invitation per (org, email) pair by construction** — re-inviting is an upsert onto this same id (spec §3 AC-1), never a duplicate/second "resend" endpoint.

**`INVITATION_EXPIRY_DAYS = 14`** (named, changeable constant). `isAdminInvitationExpired(invitation)` derives expiry from `expiresAt.toMillis() < Date.now()` at read/accept time — never a stored status, matching the abandoned-draft/`isAbandoned` convention already used elsewhere.

### Create/upsert (`createOrUpdateAdminInvitation`)

```ts
async function createOrUpdateAdminInvitation(input: {
  organizationId: string;
  callerEmail: string;
  email: string;
  role: "admin" | "editor" | "viewer";
}): Promise<
  | { ok: true; created: boolean; invitation: WithId<InvitationDoc> }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  | { ok: false; code: "HIERARCHY_VIOLATION" }
  | { ok: false; code: "ALREADY_MEMBER" }
>
```

Checks, in order (all before any write):
1. **Caller authorization** — resolves the caller's row from the D12 reverse-index (`getAdminOrganizationMember`, NOT `adminUserOrganization.ts`'s `getAdminUserMembership` — see §5's dependency-direction note); non-Owner/Admin callers get `CALLER_NOT_AUTHORIZED`. This is defense in depth: the route (`POST /api/dashboard/iam/invites`) already gates `write:user` and re-checks D10 via `canInviteRole()` before calling this, but the DAL never trusts that alone.
2. **D10 hierarchy** — `role === "admin"` requires `callerMember.role === "owner"`; an Admin caller inviting as Admin gets `HIERARCHY_VIOLATION`.
3. **Already-active-member** (spec §3 AC-2) — the invited email already having a D12 reverse-index row for THIS org is rejected with zero write. A member of a **different** org is unaffected (spec §3 AC-3) — the check is scoped to `organizationId` only.
4. **Upsert** (transactional get-then-create/set onto the deterministic id) — a full overwrite (`tx.set`, never a merge-`tx.update`) so a stale accepted/revoked cycle's `acceptedAt`/`acceptedBy` never survives into the fresh `"pending"` doc. `createdAt` is preserved across refreshes (audit-immutable); `role`/`token`/`expiresAt`/`invitedBy` are refreshed to the LATEST call's values (spec §3 AC-1: exactly one doc, second call wins).

### Revoke (`revokeAdminInvitation`)

```ts
async function revokeAdminInvitation(input: {
  organizationId: string;
  callerEmail: string;
  email: string;
}): Promise<
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  | { ok: false; code: "HIERARCHY_VIOLATION" }
>
```

Same caller-authorization + D10 (revoking a pending Admin-role invite is Owner-only) checks. **Idempotent** (spec §3 AC-6): revoking an already-accepted or already-revoked invitation is a `{ok:true}` no-op, never an error — only a currently-`"pending"` doc is actually mutated.

### Reads

- `getAdminInvitationForOrganization({organizationId, email})` — deterministic-id read, tenancy-scoped by construction.
- `getAdminInvitationByToken(token)` — single-field equality query (`token ==`), no composite index needed (matches `adminCheckinTeamMember.ts`'s `accessCodeHash` lookup precedent). Used exclusively by the accept flow, since the caller only has the opaque token.
- `listAdminInvitationsForOrganization(organizationId)` — bounded (`INVITATION_LIST_LIMIT = 500`) equality query, powers `GET /api/dashboard/iam`'s `invitations` field. Returns every status; the route filters to `"pending"` + unexpired for display.

## 3 — Entity: `OrganizationMember` (the D12 reverse-index)

Root collection, deterministic doc id, SERVER-ONLY. Closes the gap `m7-scheduled-reports.md` D2 explicitly named and deferred: `UserDoc.organizations[]` is embedded per-user, so "list every member of org X" has no correct query against `User` alone.

```ts
interface OrganizationMemberDoc {
  organizationId: string;
  email: string;              // lowercased
  role: OrganizationRole;
  name: string;                // denormalized from UserDoc.name at write time
  status: "active" | "pending" | "suspended"; // denormalized from UserDoc.status; "active" in practice (no suspend action ships in this ticket)
}
```

**Doc id:** `organizationMemberId(organizationId, email)` = `` `${organizationId}_${lowercasedEmail}` `` (`src/lib/db/adminOrganizationMember.ts`) — plain string concatenation per the spec's own recommended formula (D12), not a sha256 hash (unlike `Invitation`, which follows the `ReportSchedule`/`EmailDefinition` hash convention explicitly).

**Sync contract:** every WRITE function (`putAdminOrganizationMemberInTransaction`, `deleteAdminOrganizationMemberInTransaction`) takes an already-open `Transaction` and performs no I/O beyond it — every roster-mutating function in `adminUserOrganization.ts` pairs its own User/Organization write with one of these calls in the SAME transaction, so the index can never drift (spec §7 AC-3). `putAdminOrganizationMemberInTransaction` is a full overwrite (`tx.set`, not a merge) — a role or name change fully replaces the row.

### Reads (plain, non-transactional)

- `getAdminOrganizationMember(organizationId, email)` — doc-id read.
- `listAdminOrganizationMembers(organizationId)` — plain `where(organizationId == X)` via `adminBase.ts`'s existing `findWhere` (no new base-layer code, per spec). Powers `GET /api/dashboard/iam`'s `members` field.
- `countAdminOrganizationOwners(organizationId)` / `countAdminOrganizationOwnersInTransaction(tx, organizationId)` — the composite `where(organizationId==X, role=="owner")` query the last-Owner guardrail needs (spec §5). Bypasses `adminBase.ts`'s single-filter `findMany` (which cannot express a two-field `.where().where()` chain) and queries `adminDb` directly, mirroring `adminCheckinTeamMember.ts`'s own multi-`.where()` precedent. The transactional variant is read via `tx.get(query)` so the count is part of the same consistent snapshot as the mutation it's gating — must be called before any write in that transaction (Firestore requires all reads before all writes).

## 4 — `adminUserOrganization.ts` additions (spec §4/§5/D9/D10)

### `addAdminUserToOrganization()` — widened + D12-synced

`role?: Exclude<OrganizationRole, "owner">` (was `"member"`-only) — defaults to `"viewer"` (D9: self-serve joins are weaker provenance than an explicit per-email invite, so they land at the lowest tier; was previously `"member"`, the pre-D2 equivalent). The join CORE is refactored into a private `applyOrganizationJoinInTransaction(tx, input)` that takes an ALREADY-OPEN transaction — `addAdminUserToOrganization` is now a thin `adminDb.runTransaction` wrapper around it, and `acceptAdminInvitation` (below) calls the SAME core nested inside its own larger transaction, so the roster write, the permissions-mirror stamp, the `memberCount` increment, and the D12 reverse-index write can never drift apart or be duplicated in two places. Every existing caller's signature/behavior is unchanged.

### `createAdminOrganizationWithOwner()` — D12-synced

Now also writes the brand-new owner's `OrganizationMember` reverse-index row in the same transaction — every org's Owner count starts correctly at 1 from the moment the org exists (the last-Owner guardrail depends on this from day one, not just after the first invite-driven mutation).

### `acceptAdminInvitation()` (new, spec §4)

```ts
async function acceptAdminInvitation(input: {
  token: string;
  callerEmail: string;             // the AUTHENTICATED caller's own verified token email
  profile?: { uid: string; name?: string; avatarUrl?: string | null; emailVerified?: boolean };
}): Promise<
  | { ok: true; organizationId: string; role: "admin" | "editor" | "viewer" }
  | { ok: false; code: "INVALID" }              // unknown token, not-pending, or expired — collapsed into one generic rejection
  | { ok: false; code: "EMAIL_MISMATCH" }       // THE security-critical check (spec §4)
  | { ok: false; code: "ORGANIZATION_NOT_FOUND" }
  | { ok: false; code: "USER_PROFILE_REQUIRED" }
>
```

**The one security-critical check in this whole ticket:** the invitation's stored `email` must case-insensitively equal `callerEmail`, checked TWICE — once as a fast-fail before opening the transaction (against the initial token lookup), once again inside the transaction against the freshly re-read `Invitation` doc (defense in depth against a doc changing between the two reads). A signed-in user cannot accept someone else's invitation by guessing/leaking a token meant for a different address.

**One transaction:** re-read the `Invitation` doc (status/expiry re-verified fresh) → call `applyOrganizationJoinInTransaction` with `role: invitation.role`, `joinMethod: "invite_email"` (new `OrganizationMembership.joinMethod` value) → mark the invitation `"accepted"` + `acceptedAt`/`acceptedBy`. All reads (invitation, then user/org inside the join core) precede all writes (user/org/reverse-index, then invitation) — required ordering for Firestore transactions.

### `changeAdminMemberRole()` / `removeAdminMember()` (new, spec §5)

```ts
async function changeAdminMemberRole(input: {
  organizationId: string;
  callerEmail: string;
  targetEmail: string;
  newRole: Exclude<OrganizationRole, "member">;
}): Promise<
  | { ok: true; role: OrganizationRole }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  | { ok: false; code: "TARGET_NOT_FOUND" }     // route 404s — IDOR-safe, never 403 (never confirms/denies cross-org existence)
  | { ok: false; code: "HIERARCHY_VIOLATION" }
  | { ok: false; code: "LAST_OWNER" }
>

async function removeAdminMember(input: {
  organizationId: string;
  callerEmail: string;
  targetEmail: string;
}): Promise<
  | { ok: true }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  | { ok: false; code: "TARGET_NOT_FOUND" }
  | { ok: false; code: "HIERARCHY_VIOLATION" }
  | { ok: false; code: "LAST_OWNER" }
>
```

Both **re-derive the caller's role fresh from the roster inside the transaction** (`callerEmail` in, never a trusted `callerRole` param) — matching D11's "next request" freshness posture end-to-end, not just at the route layer.

**D10 hierarchy** (`isUpperTierRole(role) = role === "owner" || role === "admin"`): a non-Owner caller may not touch a target whose CURRENT role is Owner/Admin, and may not set anyone's role TO Owner/Admin. An Owner caller may do anything, subject to:

**Last-Owner guardrail:** before any role-change-away-from-owner or any removal of an Owner-role target, counts current Owners via `countAdminOrganizationOwnersInTransaction` (the D12 index) — if the target is the only Owner and the action would leave zero, rejects with `LAST_OWNER`, zero writes. Applies identically whether the caller is acting on themselves or on someone else; an Owner CAN demote/remove themselves when at least one other Owner remains (spec §5 AC-4).

**Removal mechanism** (spec §5, explicit instruction): `UserDoc.organizations[]` is updated via **predicate filtering** (`memberships.filter(m => m.organizationId !== organizationId)`), NOT `FieldValue.arrayRemove` — `arrayRemove` needs exact map equality and the membership's own `joinedAt` Timestamp makes that unreliable, the same reason `findOrganizationMembership()` (`org-membership.ts`) already uses predicate matching instead of equality. Role changes use the same predicate-map style (`memberships.map(m => m.organizationId === organizationId ? {...m, role: newRole} : m)`).

One transaction each: the roster array entry (+ the active-org permissions mirror, only re-stamped when the target's CURRENTLY active org is the one being mutated) and the D12 reverse-index row move together for role change; the roster removal + `Organization.memberCount` decrement + reverse-index row deletion move together for removal.

**No re-pointing on removal** (spec §5, deliberate): if the removed user's active org IS the one they were just removed from, no special logic runs — `resolveActiveOrganizationId()` already treats a stale active `organizationId` with no matching roster entry as "not a member," so their next request 403s/redirects like any other stale-active-org case already handled elsewhere.

## 5 — Dependency direction (avoids a circular import)

`adminInvitation.ts` depends on `adminOrganizationMember.ts` (a leaf module — only `adminDb` + types) for its "is this email already a member" and "is the caller a manager" checks, **not** on `adminUserOrganization.ts`, even though that module exposes an equivalent `getAdminUserMembership`. `adminUserOrganization.ts` itself imports `adminInvitation.ts` (for `getAdminInvitationByToken` in the accept flow) — importing `adminUserOrganization.ts` from `adminInvitation.ts` would create a cycle. Routing both invitation-side checks through the reverse-index instead breaks the cycle cleanly:

```
adminOrganizationMember.ts   (leaf: adminDb + types only)
        ^                ^
        |                |
adminInvitation.ts   adminUserOrganization.ts
        ^                |
        |________________|
     (adminUserOrganization.ts imports adminInvitation.ts,
      never the reverse)
```

## 6 — Query patterns and indexes

| Query | Method | Index |
|---|---|---|
| Invitation by (org, email) | `getAdminInvitationForOrganization` | doc-id read (`invitationId`), no query |
| Invitation by bearer token | `getAdminInvitationByToken` | single-field equality (`token ==`) — no composite index (automatic per-field index) |
| All invitations for an org | `listAdminInvitationsForOrganization` | single-field equality (`organizationId ==`), bounded `.limit(500)` — no composite index |
| Member row by (org, email) | `getAdminOrganizationMember` | doc-id read (`organizationMemberId`), no query |
| All members of an org | `listAdminOrganizationMembers` | single-field equality (`organizationId ==`) via `adminBase.findWhere` — no composite index |
| Owner count for an org | `countAdminOrganizationOwners(InTransaction)` | composite (`organizationId ==`, `role ==`) — **new index**, `firestore.indexes.json` (`OrganizationMember`: `organizationId ASC, role ASC`) |

## 7 — Read/write access rules

- **`firestore.rules`**: two new deny-all blocks (`Invitation`, `OrganizationMember`) — same one-line pattern as every prior server-only entity (`EmailDefinition`, `ReportSchedule`). No client-SDK access path exists or is needed for either collection.
- **Invitation CRUD**: `write:user` (Owner/Admin only, D3) + D10 hierarchy — enforced by the DAL itself (caller-authorization + hierarchy checks live in `adminInvitation.ts`, not just the route), belt-and-suspenders on top of the route's own `write:user` gate + `canInviteRole()`/`canManageTargetRole()` pre-checks (`src/features/iam/permissions.ts`, Full-Stack's parallel slice).
- **Role change / removal**: same `write:user` + D10 posture, enforced inside `changeAdminMemberRole`/`removeAdminMember` via a caller-role re-derivation from the roster (never a trusted client-supplied role).
- **Roster/invitation LISTING** (`GET /api/dashboard/iam`): view-tier — any org member, including a Viewer, per spec §2/D6's convention. No permission check inside `listAdminOrganizationMembers`/`listAdminInvitationsForOrganization` themselves; the route derives org scope from the roster-verified session only.
- **Accept flow**: session/bearer-authenticated, `write:user`-independent (self-service by construction, D10 not applicable) — gated entirely by the email-match check inside `acceptAdminInvitation`.

## 8 — Tests

| File | Covers |
|---|---|
| `admin-organization-member.test.ts` | deterministic id, full-overwrite put semantics, transactional/non-transactional delete, cross-org list isolation (spec §7 AC-1), owner counting (both variants) |
| `admin-invitation.test.ts` | deterministic id, expiry derivation, upsert idempotency (spec §3 AC-1, exactly one doc, second call wins), already-member rejection with zero write (AC-2), cross-org non-interference (AC-3), D10 hierarchy on invite/revoke, revoke idempotency (AC-6), token lookup |
| `admin-user-organization-iam.test.ts` | `permissionsForOrganizationRole` exact D3 matrix incl. legacy alias, D9 default-to-viewer, D12 sync on join/owner-creation/accept/role-change/remove, `acceptAdminInvitation` happy path (new + existing user), the email-mismatch IDOR case (AC-2), expiry (AC-3), idempotent re-accept (AC-4), missing-profile case, D10 hierarchy + last-Owner guardrail (self AND other-caller shapes) for both `changeAdminMemberRole` and `removeAdminMember`, predicate-based removal preserving other org memberships |

**Full-suite regression:** `npm test` — all pre-existing tests unaffected; the shared `fake-admin-db.ts` test helper gained `tx.set`/`tx.delete` (previously unsupported) and `FieldValue.increment`/`arrayUnion`/`arrayRemove` resolution inside `.update()` (both purely additive — `FieldValue.serverTimestamp()`/`.delete()` remain unresolved, unchanged, since other tests assert against those raw sentinels in `writes`, not resolved store state).

## 9 — Deviations from the spec

- **`OrganizationMember` doc id is a plain string concatenation** (`organizationId + "_" + email`), not a sha256 hash — this is the spec's OWN recommended formula (D12), a deliberate departure from the `Invitation`/`ReportSchedule`/`EmailDefinition` hash convention, kept as-is since D12 states this explicitly ("Backend's implementation call, not mandated").
- **`invitationId()` is co-located inside `adminInvitation.ts`** rather than a separate pure module (unlike `reportScheduleId.ts`/`emailDefinitionId.ts`) — it has exactly one consumer, so a dedicated file would be pure ceremony (YAGNI).
- **DAL-level caller-authorization + D10 hierarchy checks for Invitation CRUD live inside `adminInvitation.ts` itself**, not just the calling routes — matching this codebase's established "defense in depth" posture (e.g. `upsertAdminReportSchedule`'s own recipient re-verification, M7-T3). `changeAdminMemberRole`/`removeAdminMember` go further: they re-derive the caller's role from the roster themselves rather than trusting a route-supplied value at all, so the security boundary holds even if a future route forgets its own pre-check.
