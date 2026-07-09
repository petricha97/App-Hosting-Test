# Security Review — M1 Registration Spine

- **Ticket:** m1-registration-spine (branch `feat/m1-registration-spine`, uncommitted working tree)
- **Reviewed:** 2026-07-10
- **Verdict:** **BLOCKED** — 1 High finding (missing `write:events` permission check on all four mutating routes). Everything else is Medium or below.

Scope reviewed: 4 API routes under `src/app/api/dashboard/events/[eventId]/{registration-types,tickets}/`, shared auth helper `src/features/registration/server/route-scope.ts`, schemas/utils/components under `src/features/registration/`, DAL files `src/lib/db/{adminRegistrationType,adminTicketType,registrationType,ticketType,registrationCode}.ts`, modified pages, `src/types/collection.ts`, `firestore.indexes.json`, new `src/components/ui/{alert-dialog,checkbox,table}.tsx`, route tests, and `npm audit`.

---

## HIGH

### H-1. Mutating registration/ticket routes skip the `write:events` permission check — view-only members can create/edit/delete

- **Files:**
  - `src/features/registration/server/route-scope.ts:39-40` (TODO instead of a check)
  - All four routes that rely on it:
    - `src/app/api/dashboard/events/[eventId]/registration-types/route.ts:22`
    - `src/app/api/dashboard/events/[eventId]/registration-types/[registrationTypeId]/route.ts:27,89`
    - `src/app/api/dashboard/events/[eventId]/tickets/route.ts:29`
    - `src/app/api/dashboard/events/[eventId]/tickets/[ticketTypeId]/route.ts:31,121`
- **Details:** `resolveRegistrationRouteScope` verifies session → user doc → org → event ownership, but never checks `userDoc.permissions`. Every other mutating event route in the codebase enforces `write:events` (e.g. `src/app/api/dashboard/events/[eventId]/promotions/route.ts:51`, plus the event, status, page, publish, and assets routes). The permission model is live today: `MEMBER_PERMISSIONS` in `src/types/collection.ts:62-67` is view-only (`view:events`, no `write:events`).
- **Exploitation scenario:** A user invited with the default "member" role — who cannot edit the event, its promotions, or its pages — calls `POST /api/dashboard/events/{eventId}/tickets` or `DELETE .../registration-types/{id}` directly (same session cookie, plain `fetch`) and can create, reprice-relevant, open/close, or delete the event's ticket and registration types. Within-org privilege escalation from viewer to editor for the registration configuration that will drive M2/M3 sales.
- **Note:** the spec (`agents/docs/specs/m1-registration-spine.md`, line 12) explicitly defers per-role gating to M8-T1 ("Any org member may CRUD in M1"). That decision predates checking it against the live permission model: `write:events` enforcement already exists on every sibling mutating route, so this is an inconsistency exploitable today, not future work. The route tests even mock a user *with* `write:events` (`src/__tests__/registration-types-route.test.ts:113`) but never assert a viewer is rejected.
- **Remediation:** Mirror the promotions route inside `resolveRegistrationRouteScope`: after the org check, `if (!userDoc.permissions.includes("write:events")) return { ok: false, error: "Missing write:events permission", status: 403 }`. Add a route test for the viewer-role 403. (Alternatively, the orchestrator may record explicit risk acceptance overriding the existing convention — not recommended.)

---

## MEDIUM

### M-1. New client-side DAL repos for `RegistrationType`/`TicketType` with no Firestore security rules in the repo

- **Files:** `src/lib/db/registrationType.ts`, `src/lib/db/ticketType.ts`; `firebase.json` (declares only `firestore.indexes`, no `rules`); no `firestore.rules` anywhere in the repo.
- **Details:** The ticket adds browser-SDK repos exposing `create/update/delete` for the two new collections, including `createRegistrationType`/`createTicketType` that accept an arbitrary `organizationId` from the caller. M1 UI flows do not use them (all mutations go through the admin API routes), but the enforcement story for direct client access is whatever rules are deployed out-of-band — unverifiable from this repo. If deployed rules are permissive for these (new, therefore likely un-ruled) collections, any authenticated user could bypass every route-level control: org spoofing, forged `registeredCount`, duplicate codes, cross-event `registrationTypeIds`, and deletion of blocked types.
- **Remediation:** Add/confirm Firestore rules that deny client writes to `RegistrationType` and `TicketType` (server-only via admin SDK) and restrict reads to same-org members, and bring the rules file under version control (`firebase.json` → `firestore.rules`). This is a repo-wide pre-existing gap (all collections have client repos), so it is graded Medium for this ticket rather than blocking, but it should be resolved before M2 makes these collections order-critical.

### M-2. Known-vulnerable production dependencies (pre-existing, unchanged by this ticket)

- **Details:** `npm audit --omit=dev`: 14 vulnerabilities (1 critical, 3 high, 10 moderate) in the `firebase-admin` → `@google-cloud/firestore`/`google-gax`/`teeny-request`/`uuid` chain and `@measured/puck` (vulnerable `uuid`). Dev-only: `vitest` 4.x critical (GHSA-5xrq-8626-4rwp, Vitest UI server) — not reachable in production.
- **Remediation:** `npm audit fix` / scheduled dependency upgrade ticket. `package.json` was not modified by this ticket, so this does not block it.

---

## LOW

### L-1. TOCTOU race on code uniqueness and delete blocks

- **Files:** `src/app/api/dashboard/events/[eventId]/registration-types/route.ts:40-47`, `.../[registrationTypeId]/route.ts:55-66,110-137`, ticket equivalents.
- **Details:** Check-then-write without a transaction: two concurrent creates with the same code both pass `isAdmin*CodeTaken`; a delete racing a ticket-create referencing the type can slip past the block. Same-org integrity impact only; no cross-tenant exposure. Acceptable for M1; consider a transaction or a deterministic uniqueness doc (`{eventId}_{code}`) when registrations go live.

### L-2. Sales-date strings validated by shape only; capacity unbounded above

- **Files:** `src/features/registration/schemas.ts:64-69` (regex `^\d{4}-\d{2}-\d{2}$`), `src/features/registration/utils.ts:66-86` (`Date.UTC` rollover); `schemas.ts:42-46` (no max on capacity).
- **Details:** `"2026-13-40"` passes the regex and rolls over via `Date.UTC` to an unintended instant; capacity accepts any integer up to `1e308`-scale doubles. Data-integrity only (authenticated org editors); no injection or cross-tenant path. Suggest a calendar-validity refine and a sane capacity ceiling (e.g. 1,000,000).

### L-3. No rate limiting / per-event document caps (note-only)

- **Details:** Unbounded creation of registration/ticket type docs per event (list reads are capped at 50, creation is not — also a functional risk: ids beyond the first 50 fail the `registrationTypeIds` membership check). No rate limiting on any route — consistent with every existing dashboard route, so recorded as a note per review policy, not a block.

---

## Verified controls (no findings)

- **AuthN:** every route resolves the session cookie via `decodeUser` → `adminAuth.verifyIdToken`; 401 on missing/invalid token. Server pages use the equivalent `getDashboardScope`/`requireSessionUser` gate.
- **IDOR:** `eventId` resolved through `getAdminEventForOrganization` (404 on cross-org, existence never leaks); item fetches (`getAdminRegistrationTypeForEvent` / `getAdminTicketTypeForEvent`) compare BOTH `eventId` and `organizationId` and return null → 404. `registrationTypeIds` membership is validated against an org+event-scoped query on create and update.
- **Mass assignment:** payload Zod schemas strip unknown keys; DAL create/update use explicit allow-lists — `organizationId`, `eventId`, `registeredCount`, `createdAt` unreachable from any client payload on create and update.
- **Code normalization:** schema transforms to uppercase before route checks; DAL normalizes again on every write and lookup — mixed-case duplicates cannot bypass uniqueness.
- **Delete blocks:** enforced server-side (409) in the DELETE routes; the UI pre-check is UX only. The 409 "blocking tickets" names come from an `eventId + organizationId + array-contains` query — same-org only, no cross-tenant leakage in error responses.
- **XSS:** no `dangerouslySetInnerHTML`/`innerHTML` anywhere in the new code; all user content rendered through JSX text nodes; API error strings rendered as text. New shadcn ui components are clean.
- **CSRF:** session cookie is `httpOnly; secure; sameSite=lax` (`src/app/api/auth/session/route.ts:23-25`); mutating routes take JSON bodies — consistent with existing routes.
- **Secrets:** no env/secret changes; no admin SDK imports in client components (`server-only` on all admin DAL and helpers).

## Verdict

**BLOCKED** on H-1. Return to Developer: add the `write:events` check (one guard in `resolveRegistrationRouteScope` + a viewer-403 test), and address M-1 with the Backend Agent (Firestore rules for the two new collections) either in this ticket or as an immediately scheduled follow-up with orchestrator sign-off.
