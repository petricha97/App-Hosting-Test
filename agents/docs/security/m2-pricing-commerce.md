# Security Review — M2 Pricing & Commerce

- Branch: `feat/m2-pricing-commerce`
- Scope: uncommitted working-tree changes (firestore.rules + firebase.json wiring, `src/lib/db` fee/tax/order/promotion repos, `src/lib/orders/`, `src/lib/payments/`, `src/features/pricing/`, pricing + promotion-settings API routes, M1 delete-route upgrades).
- Reviewer: Security Agent
- Date: 2026-07-10

## Verdict: BLOCKED

One **Critical** and one **High** finding block the ticket. The commerce surface itself (money math, order finalize, payment simulation, IDOR scoping, write:events gating on the new routes) is well-built — but the newly introduced `firestore.rules` codifies a client-writable `User` doc that the M2 server routes trust for both authorization (`permissions`) and tenancy (`organizationId`), which collapses multi-tenant isolation for the entire dashboard including this new commerce surface.

Return to Developer (rules layer + route-scope trust boundary). The data-layer money/counter work is sound and does not itself need rework.

---

## Findings (most severe first)

### 1. CRITICAL — Cross-tenant takeover: client can rewrite own `User.organizationId`, and server routes trust it as the tenant key
Affected:
- `firestore.rules:66-71` (`match /User/{userEmail}` — `allow create, update` with no field restriction)
- `src/features/registration/server/route-scope.ts:35-61` (trusts `userDoc.organizationId`, no membership re-check)
- `src/features/dashboard/server/get-dashboard-scope.ts:16-29` (same trust)
- `src/lib/db/user.ts:26-31` (`updateUser` writes arbitrary `UserDoc` fields from the client)

Exploitation scenario:
1. Attacker signs in as any legitimate user (their own org).
2. From the browser (firebase client SDK), they call `updateDoc(doc(db,'User', myEmail), { organizationId: '<victimOrgId>' })`. The rule `allow update: if isSignedIn() && callerEmail() == userEmail` permits writing *any* field of their own doc, including `organizationId`. Victim org ids are trivially obtainable (see Finding 3 — `Organization` list is world-readable to any signed-in user).
3. Every M2 mutating route resolves tenancy via `resolveRegistrationRouteScope` → `getAdminUserByEmail(...).organizationId`, and every dashboard page via `getDashboardScope`. Neither cross-checks that the caller is actually a member of that org (the `organizations[]` array is never consulted server-side). `getAdminEventForOrganization(eventId, '<victimOrgId>')` now succeeds for the victim's events.
4. The attacker can now read all of the victim org's events/fees/taxes/promotions and create/update/delete fees, taxes, and discount settings, and (once M3 wires order finalize) transact against the victim org — full cross-tenant compromise of the commerce surface.

Note the rules file's own mitigating comment (`firestore.rules:59-64`) claims "server routes must keep treating userDoc.permissions as advisory" — but the M2 route-scope and the sibling promotions route do **not**; they trust `userDoc.permissions` and `userDoc.organizationId` directly. The documented assumption is false in the shipped code, so the note does not mitigate.

Remediation (any one closes it; do the first):
- Server-side: in `route-scope.ts` / `get-dashboard-scope.ts`, verify the resolved `organizationId` appears in the user's `organizations[]` membership list (and, for authorization, derive the effective role/permissions from that membership entry) rather than trusting the top-level `organizationId`/`permissions` mirror. This is the durable fix regardless of rules.
- Rules-side (defense in depth): restrict `User` update so `organizationId`, `permissions`, `organizationRole`, and `organizations` cannot be changed by the client (`request.resource.data.diff(resource.data).affectedKeys().hasOnly([...profile fields...])`), and move org-join finalization server-side (baseline R7).

### 2. HIGH — Self-service privilege escalation: client can grant itself `write:events` (and any permission) on its own `User` doc
Affected:
- `firestore.rules:66-71` (unrestricted own-`User` write)
- `src/features/registration/server/route-scope.ts:45-51` and `src/app/api/dashboard/events/[eventId]/promotions/[promotionId]/route.ts:83-84` (gate solely on `userDoc.permissions.includes("write:events")`)

Exploitation scenario: a view-only member (issued `MEMBER_PERMISSIONS`) sets `permissions: ["write:events", ...]` on their own `User` doc via the client SDK. Every new M2 mutating route (fees POST/PATCH/DELETE, taxes POST/PATCH/DELETE, promotion-settings PATCH) and the M1 routes gate exclusively on this self-writable array, so the member gains full write within their org, defeating the view-only role. Combined with Finding 1 the escalated permission also applies against the injected victim org.

Remediation: derive the caller's permissions/role server-side from the authoritative membership record (the org's own membership/roster or a server-stamped custom claim), not from the client-writable `User.permissions` mirror. At minimum, lock `permissions` in the rules as in Finding 1's rules-side fix.

### 3. HIGH — `Organization` collection is world-readable to any signed-in user (invite-code/token/orgId enumeration)
Affected: `firestore.rules:90-98` (`allow get, list: if isSignedIn();`)

Exploitation scenario: any authenticated user can `getDocs(collection(db,'Organization'))` and read every org's `inviteCode`, `inviteLinkToken`, `memberCount`, `domain`, and doc id. Consequences: (a) harvests the victim `organizationId` values that feed Finding 1; (b) harvests every org's invite code/token, letting the attacker join arbitrary organizations through the legitimate invite-join flow (`addExistingUserToOrg`), which also writes a real `organizations[]` membership — a standalone unauthorized-access path even if Finding 1 is fixed.

Remediation: do not expose invite secrets to non-members. Serve domain/invite-code lookups through a server route (Admin SDK) that returns only a boolean/opaque match, or move the secret fields to a separate collection that is never client-readable. If a client `list` must remain for signup, gate it and strip `inviteCode`/`inviteLinkToken` via a projection collection. Tracked as M8-T1 in the rules comment, but it is an active enabler of Findings 1 and thus should be addressed with this ticket.

### 4. LOW — `Organization` update rule does not constrain the `memberCount` value
Affected: `firestore.rules:94-96` (`hasOnly(['memberCount','updatedAt'])` allows any value, not `increment(1)`)

Any signed-in user can set an arbitrary org's `memberCount` to any integer (the rule only limits *which* keys change, not the delta). Impact is cosmetic (counter integrity), but note it is also reachable cross-org because the update rule has no membership predicate. Remediation: require `request.resource.data.memberCount == resource.data.memberCount + 1` and add an org-membership predicate, or move member-count maintenance server-side.

### 5. LOW / INFORMATIONAL — Event `create` tenancy backstop inherits the spoofable active-org
Affected: `firestore.rules:115-118` (create gated on `organizationPath in orgPathCandidates(callerUserDoc().organizationId)`)

The legacy `organizationPath` candidate list is a reasonable string-shape backstop, but because `callerUserDoc().organizationId` is client-controllable (Finding 1), the create gate is only as strong as the `User` doc. No independent action needed once Finding 1 is fixed; the multi-format candidate list itself is acceptable. Longer term, stamp `organizationId` server-side on event creation.

### 6. MEDIUM — Known-vulnerable dependencies (pre-existing; not introduced by M2)
Affected: `package.json` — `next@15.0.5`, plus transitive `@grpc/grpc-js`, `form-data`, `uuid` under `firebase-admin`.

`npm audit --omit=dev` reports 14 vulnerabilities (1 critical, 3 high). `next@15.0.5` carries multiple advisories (DoS via Server Actions/Components, image-optimization content injection, cache poisoning; middleware auth-bypass GHSA-f82v-jwr5-mffw — not directly reachable here since the repo has no `middleware.ts`). These predate this ticket and are not M2-specific, so they do not by themselves block, but they should be scheduled: upgrade Next.js to a patched 15.x and run `npm audit fix` for the `firebase-admin`/`grpc`/`form-data` chain.

---

## Verified SOUND (no action needed)

- **Money integrity.** Totals are computed server-side only; the client never supplies totals. `createAdminOrderWithFinalize` (`src/lib/db/adminOrder.ts:257-400`) re-reads fee/ticket/regType/promotion/taxes inside the transaction, recomputes via the pure `computeOrderTotals`, and aborts with `PRICE_CHANGED` on any drift (`orderAmountsEqual`, `pricing-math.ts:238-258`). Integer-minor-unit math throughout; no floats reach storage.
- **Counter integrity.** `registeredCount`/`usedCount` are unwritable via any client route (rules deny all writes to `TicketType`/`RegistrationType`/`EventPromotion`/`Order`). `usedCount` is incremented only inside the finalize transaction (`adminOrder.ts:449-455`), stripped from the promotion-settings payload schema (`schemas.ts:178-199`), and defensively removed by the DAL blocklist (`adminEventPromotion.ts:75-93`). Cap-below-used is rejected (`settings/route.ts:66-74`).
- **AuthZ shape on new routes.** Every new mutating route (fees, taxes, promotion-settings) calls `resolveRegistrationRouteScope`, which enforces session → `write:events` → org-owned event (403/404). The gate's *source of truth* is the problem (Findings 1–2), not its placement.
- **IDOR.** `getAdminFeeForEvent` / `getAdminTaxForEvent` (`adminFee.ts:62-78`, `adminTax.ts:71-87`) and the promotion-settings org check (`settings/route.ts:52`) scope every item fetch to event **and** org, returning null → 404 (existence never leaks cross-tenant). The finalize transaction re-validates every referenced doc's `eventId`/`organizationId` before moving counters.
- **M1 delete 409s.** `getAdminFeesReferencingTicketType` / `...RegistrationType` are scoped by `eventId`+`organizationId`, and the parent delete already validated the ticket/type belongs to the org, so `blockingFeeNames` in the 409 body are same-tenant only — no cross-tenant name leak.
- **Payment provider.** Simulated, in-memory, no secrets, no PAN handling. Idempotent replay returns the original result object (including failures), so a failed charge cannot be replayed into a success; deterministic failure trigger is amount-based. Finalize only accepts terminal-success statuses (`paid`/`outstanding`/`comped`), and real idempotency is owned by the deterministic Order doc id (`order-id.ts`, hashed over org+event+key — cross-tenant slot-probing safe).
- **Input validation.** All new routes Zod-validate at the boundary with `safeParse` and `.json().catch(() => null)`; server-owned fields are absent from payload schemas (Zod strips unknown keys) and re-stripped in the DAL allow-lists/blocklists. Fee/tax names are interpolated only into `NextResponse.json` bodies (JSON-encoded — no header/CRLF injection); no `dangerouslySetInnerHTML` in the pricing feature.
- **Rules deny surface.** `RegistrationType`, `TicketType`, `Fee`, `Tax` are client-read-only (org-member get) and write-denied; `Order`, `Form`, `FormData`, `FormTemplate`, `EventPage`, `PromotionTemplate` are fully denied; `EventPromotion` is read-only for org members and write-denied. Default-deny catch-all present. All correct.

---

# Re-review (2026-07-10) — after backend + fullstack fix pass

Verdict: **PASS**. All three blocking findings (1 Critical, 2 High) are closed at both the rules layer and the server trust boundary. No Critical or High remains; the ticket proceeds to QA. Residual items below are Medium/Low and do not block.

## Blocking findings — verification

### Finding 1 (CRITICAL — cross-tenant `organizationId` rewrite) — CLOSED
- **Rules layer:** `firestore.rules:131-143` — the `User` update rule now (a) locks the field set via `diff(resource.data).affectedKeys().hasOnly(['name','avatarUrl','organizationId','organizationRole','updatedAt'])`, and (b) permits an `organizationId` change only toward an org the *server-locked* roster already contains (`rosterHas(resource.data.organizations, …)`). `organizations` is not in the `hasOnly` set, so a client can neither inject a victim org into its own roster nor switch to a non-rostered org. The prior one-line `updateDoc(User, {organizationId: victimOrg})` attack is rejected.
- **Server layer (defense-in-depth):** `src/lib/org-membership.ts` (`resolveActiveOrganizationId`) is wired into `route-scope.ts:41`, `get-dashboard-scope.ts:24`, and the promotions `[promotionId]` route (`route.ts:85`). A spoofed active org resolves to null → 403 (routes) / redirect to `/login` (dashboard). The M2 commerce surface (fees/taxes/promotion-settings, all via `resolveRegistrationRouteScope`) is fully protected.
- **Field-diff bypass attempts, all rejected:** array-element merges (`organizations.0.role`) surface `organizations` in `affectedKeys()` → denied; `set(merge:true)` including `permissions`/`organizations` surfaces those keys → denied; roster-padding is impossible (roster unwritable). `rosterHas` unrolls only 10 entries, but this is fail-**closed** (an org at index 11+ cannot be switched-to client-side; the server switch route handles it) — an availability edge, not a bypass. The client cannot exceed 10 to smuggle a target because it cannot write the roster at all.

### Finding 2 (HIGH — self-grant `write:events`/any permission) — CLOSED
`permissions` is excluded from the update `hasOnly` allow-list (`firestore.rules:136-138`) → clients can never write it. It is stamped server-side from the active-org role (`adminUserOrganization.ts:47-51,161-166,345-349`), and `route-scope.ts:54` gates on that server-owned mirror. The view-only escalation path is gone.

### Finding 3 (HIGH — `Organization` world-readable / invite-secret enumeration) — CLOSED (one residual Low, below)
`firestore.rules:177-190`: `get` = roster-members only; `list` = the single domain-suggestion query shape (own email domain + `allowDomainAutoJoin`); `update`/`delete` = denied. The invite-code lookup moved to the Admin-SDK route `POST /api/organizations/lookup`, which returns only the `toOrganizationPreview` allow-list (`src/lib/org-preview.ts` — id/name/type/memberCount/logo; never `inviteCode`/`inviteLinkToken`/`domain`/`ownerId`) with a uniform 404 and a pre-read min-length guard. No enumeration oracle beyond "this exact code works".

### Finding 4 (LOW — unconstrained `memberCount`) — CLOSED
`Organization` update is now `if false` (`firestore.rules:188`). `memberCount` moves only inside the Admin-SDK membership transactions (`adminUserOrganization.ts:193-196`), atomic with the roster write, via `FieldValue.increment(1)`.

## New attack surface — verification
- **`/api/organizations/lookup`** (`route.ts`): pre-auth by design (the code *is* the entitlement). Sanitized preview only, uniform 404 for unknown/disabled/short codes, Zod-bounded input. No secret fields, no oracle. OK.
- **`/api/organizations/join`** (`route.ts`): bearer-or-cookie token → `decodeUser` → `adminAuth.verifyIdToken` — identical rigor to every other route. Entitlement validated server-side: invite-code path re-looks-up the code via Admin SDK; domain path derives the domain from the **token** email (`decoded.email`), never client input, and refuses personal-email domains. Membership write is delegated to `addAdminUserToOrganization`, which is idempotent — a re-join returns `already-member` **without** re-incrementing `memberCount` (`adminUserOrganization.ts:155-159`). Counter cannot be inflated by replay. OK.
- **`/api/organizations/switch`** (`route.ts`): target org validated against the authoritative roster via `setAdminUserActiveOrganization` → `findOrganizationMembership` (full-array scan, no 10-entry cap) → `not-a-member` = 403. Re-stamps `permissions` atomically. OK.
- **`place-order.ts` / `recordAdminFailedOrder`** (`adminOrder.ts:188-244`): a failed charge is persisted with `tx.create` only — no `usedCount`/`registeredCount` increment anywhere in the function. Deterministic order id means a later `placeOrder` for the same key hits the replay branch and returns `PAYMENT_FAILED` (`place-order.ts:119-128`) — a failed order can never flip to `paid`; retry requires a new idempotency key (new doc). OK.

## Client-write audit — verification
- No client code writes `permissions`/`organizations`/`memberCount`. The old join methods (`signupJoinOrg`/`addExistingUserToOrg`/`createNewUserAndJoinOrg`) are deleted from `user-organization.ts`; joins go through `org-join-client.ts` → the API. `switchOrganization` (`AuthContext.tsx:187-219`) now POSTs to `/api/organizations/switch` instead of writing the doc.
- `updateUser`/`createUser` (`user.ts:22-31`) remain defined but have **no callers** (grep) — dead, not runtime-failing.
- `signupCreateOrgAndUser` (`user-organization.ts:37-98`) stays client-side and satisfies the new create shapes exactly: org create (`ownerId==caller`, `memberCount==1`, `status:'pending'`, `domainVerified:false`) and User create (identity fields, single owner membership with `joinMethod:'created'`, org `ownerId==caller`, exact `OWNER_PERMISSIONS`). Confirmed `OWNER_PERMISSIONS` (`collection.ts:47-60`) is byte-for-byte in the same order as the rules literal (`firestore.rules:122-129`).

## Remaining findings (non-blocking)

### R1. MEDIUM — inconsistent server trust boundary: ~18 non-M2 routes trust `userDoc.organizationId` without the roster check
Affected (all read `userDoc.organizationId` directly after only a presence check): `dashboard/events/[eventId]/route.ts`, `.../status/route.ts`, `.../promotions/route.ts`, `.../page/route.ts`, `.../page/assets/route.ts`, `.../page/publish/route.ts`, `.../form/route.ts`, `.../form/submit/route.ts`, `.../form/detach/route.ts`, `dashboard/forms/templates/route.ts` + `[templateId]/route.ts` + `[templateId]/apply/route.ts`, `dashboard/promotions/templates/route.ts` + `[templateId]/route.ts` + `.../apply/route.ts` + `.../apply-to-events/route.ts` + `.../eligible-events/route.ts`, `dashboard/settings/organization/logo/route.ts`.

These do **not** call `resolveActiveOrganizationId`; they rely solely on the new `firestore.rules` roster-switch constraint to keep `organizationId` honest. That constraint is real and server-enforced, so this is **not exploitable today** — but it violates the trust contract the rules header itself documents ("derive tenancy from `userDoc.organizationId` ONLY after verifying it against the roster") and is a latent cross-tenant hole if the rules ever regress. The M2 commerce routes (this ticket's scope) are correctly on `resolveActiveOrganizationId`; these are M0/M1/promotion-template surfaces. Remediation: route every `userDoc.organizationId` tenancy derivation through `resolveActiveOrganizationId` for uniform defense-in-depth. Tracked for the owning tickets; does not block M2.

### R2. LOW — domain-suggestion `list` returns full Organization docs (incl. invite secrets) to same-domain non-members
Affected: `firestore.rules:180-182`, `src/lib/db/organization.ts:22-31`. The `list` rule permits the query but Firestore returns the **whole** doc, so a signed-in user who merely shares an org's email domain (auto-join enabled) receives `inviteCode` and `inviteLinkToken` in the snapshot before joining. They can already auto-join, but the invite *token* additionally lets them mint invite links for outsiders. Remediation: serve the suggestion through a server route returning `OrganizationPreview`, or split invite secrets into a non-listable subcollection.

### R3. LOW — `organizationRole` is client-writable and unconstrained against actual role
Affected: `firestore.rules:136-138` (`organizationRole` is in the update `hasOnly` set with no predicate tying it to the roster entry's role). A member can set `organizationRole:'owner'` on their own doc. No server route authorizes on `organizationRole` (they use the server-stamped `permissions`), so impact is cosmetic today — but it is a client-writable authority-adjacent field. Remediation: constrain it to match the target org's roster role, or drop it from the client-writable set and let the switch route stamp it.

### R4. LOW / INFORMATIONAL — signup create depends on order-sensitive `OWNER_PERMISSIONS` list equality
Affected: `firestore.rules:122-129` vs `src/types/collection.ts:47-60`. The rule uses `==` list equality against a hard-coded literal; any reordering/addition to `OWNER_PERMISSIONS` silently breaks new-org signup with a permission-denied. Currently in sync. Remediation: add a code comment cross-link (present) and a CI guard, or move owner-org creation server-side (mirrors the existing `createAdminOrganizationWithOwner`).

### R5. MEDIUM — dependency vulnerabilities (carried over, unchanged)
`npm audit` findings from the original review (`next@15.0.5` + `firebase-admin` transitive chain) are unaddressed by this pass. Pre-existing, not M2-specific; schedule the Next.js patch upgrade. Does not block.

## Re-review verdict
**PASS** — Findings 1 (Critical), 2 (High), 3 (High), 4 (Low) are all closed. Remaining items are one Medium defense-in-depth inconsistency on non-M2 routes (R1), the carried dependency Medium (R5), and three Low hardening items (R2-R4). None block M2; the ticket proceeds to QA.

---

## Root cause summary
Findings 1–3 share one root: the client-writable `User` doc (`permissions`, `organizationId`, `organizations`) is treated as the authorization + tenancy source of truth by the server, and the `Organization` collection leaks the org ids / invite secrets needed to weaponize it. Fixing the server-side trust boundary in `route-scope.ts` / `get-dashboard-scope.ts` (verify membership from the authoritative roster; derive permissions server-side) is the highest-leverage remediation and unblocks the ticket; the rules-layer field locks and `Organization` projection are defense-in-depth that should follow.
