# Security Review — M0 Foundations (route-group refactor, starter-cruft removal, baseline docs)

Security Agent, 2026-07-10. Scope: uncommitted working tree on `feat/m0-foundations` — modified files per `git status --short`, new untracked files under `src/app/dashboard/(workspace)/`, `src/app/dashboard/(event)/`, `src/features/event/`, `src/__tests__/`, plus `firestore.indexes.json` and deleted routes.

## Verdict: **PASS**

No Critical or High finding is **introduced by this change set**. The two High findings below are pre-existing, repo-wide debt that this ticket neither introduced nor worsened; they are recorded here as tracked items requiring their own tickets (blocking those tickets, not this one). Ticket proceeds to QA.

---

## Findings

### HIGH (pre-existing — tracked, not introduced by M0)

#### SEC-M0-1 — No `firestore.rules` in repo; client-SDK org isolation unverifiable (baseline R8)
- **Affected:** `firebase.json` (declares only `firestore.indexes`), `src/lib/db/base.ts` and client repos `src/lib/db/event.ts`, `src/lib/db/form.ts`, `src/lib/db/formData.ts`, `src/lib/db/organization.ts`; documented at `agents/docs/data-models/baseline.md:306` (R8) and `:13`.
- **Scenario:** All server-side org scoping (`getAdminEventForOrganization`, in-memory `organizationId` filters) is bypassable for any collection the *client* SDK can reach: an authenticated user takes their Firebase ID token and calls the Firestore REST/gRPC API directly (project ID and API key are public in `apphosting.yaml` `NEXT_PUBLIC_*` values, as designed). If the rules deployed out-of-band are permissive (e.g. test mode `allow read, write: if request.auth != null`), they can read/write any org's `Event`, `Form`, `FormData` (registrant PII) documents — a full multi-tenant isolation break. From this repo we cannot prove or disprove it, which is itself the finding.
- **Severity note:** High as a tracking classification; escalates to **Critical** if deployed rules are confirmed permissive.
- **Remediation:** Add `firestore.rules` + a `"rules"` entry in `firebase.json`; enforce per-collection `organizationId` membership checks; CI-test with the rules emulator; trim unused client write exports (`formData.ts`, `form.ts`). Owner: Backend Agent, scheduled M8-T1 — recommend pulling verification of the *currently deployed* rules forward immediately.

#### SEC-M0-2 — `next@15.0.5` pinned with a large body of known advisories
- **Affected:** `package.json` (`"next": "15.0.5"`, exact-pinned; installed 15.0.5). `npm audit --omit=dev`: 14 vulns (1 critical, 3 high, 10 moderate).
- **Advisories against this version include:** middleware authorization bypass (CVE-2025-29927 — **not currently exploitable here**: no `middleware.ts` exists and auth runs in layouts/pages), cache poisoning / cache-key confusion (several), XSS in App Router with CSP nonces, RSC cache-busting poisoning, SSRF via middleware redirects, image-optimizer content injection, multiple DoS vectors.
- **Scenario:** Cache-poisoning variants can serve one user's RSC payload to another via shared caches on the hosting CDN; the DoS vectors are internet-triggerable against the App Hosting instance.
- **Remediation:** Upgrade to the latest patched Next 15.x line and re-run `npm audit`. File as an immediate follow-up ticket for the Developer; do not let it age to M8. Note: if anyone ever adds a `middleware.ts` for auth before upgrading, this instantly becomes an exploitable Critical.

### MEDIUM (pre-existing — tracked)

#### SEC-M0-3 — Vulnerable transitive dependencies under `firebase-admin`
- **Affected:** `@grpc/grpc-js` (malformed-message server crash, High), `protobufjs` (unbounded recursion / Any-expansion DoS, High), `form-data` (CRLF injection in multipart names, High), `uuid`/`teeny-request` chain (Moderate) — all server-side, reachable only via Firestore admin traffic, so practical exposure is availability rather than confidentiality.
- **Remediation:** `npm audit fix` where non-breaking; bump `firebase-admin` to the current major in the same dependency ticket as SEC-M0-2.

#### SEC-M0-4 — Session cookie holds a raw Firebase ID token verified without revocation check
- **Affected:** `src/lib/auth-utils.ts:33` (`adminAuth.verifyIdToken(token)` — no `checkRevoked`), consumed by `src/app/dashboard/layout.tsx:22`, `src/app/dashboard/(workspace)/layout.tsx:21`, `src/features/dashboard/server/get-dashboard-scope.ts:20`. Pre-existing pattern; M0 only relocated callers.
- **Scenario:** A disabled/signed-out-everywhere user's token remains valid until natural expiry (up to 1 h); disable/revocation is only caught when Firebase flags `auth/user-disabled` at verification. Also, ID tokens in cookies are not Firebase *session cookies* (`createSessionCookie`/`verifySessionCookie`), losing server-controlled lifetime.
- **Remediation:** Migrate to Firebase session cookies with `verifySessionCookie(token, /* checkRevoked */ true)` under M8-T1 IAM work.

### LOW

#### SEC-M0-5 — Stale `GPT_API_KEY` secret binding survives the endpoint it served (introduced-adjacent: cleanup missed by M0)
- **Affected:** `apphosting.yaml:19-20`. The only consumer (`src/app/api/chat/route.ts`) is deleted in this change set; no reference to `GPT_API_KEY`/OpenAI remains anywhere in `src/`.
- **Scenario:** The secret is still mounted into every server instance's environment at runtime — unnecessary standing exposure (any future SSRF/RCE or log-leak exfiltrates a live OpenAI key for no benefit). It is server-only and cannot reach client bundles, hence Low.
- **Remediation:** Delete the `env` entry from `apphosting.yaml` and revoke/rotate the `GPT_API_KEY` secret in Secret Manager since it is no longer needed.

---

## Verified-clean checklist (review scope items with no finding)

1. **Auth gate after route-group refactor** — `src/app/dashboard/layout.tsx` remains the parent of both `(workspace)` and `(event)` groups (route groups do not change the URL/segment tree), so every `/dashboard/**` route is still behind the session-cookie + `decodeUser` gate; the removed `TOKEN_EXPIRED` branch was redundant (both paths `redirect("/login")`) — no behavior change. `(workspace)/layout.tsx` re-runs the same check before mounting `DashboardShell` (harmless duplication, mild defense in depth).
2. **Event IDOR / org scoping** — `(event)/events/[eventId]/layout.tsx:22-33` resolves the event via `getDashboardScope()` (server-derived `organizationId` from the caller's own `User` doc — never from client input) + `getAdminEventForOrganization` (`src/lib/db/adminEvent.ts:47-67`, org check via `eventBelongsToOrganization`). Crucially, every data-fetching page under the group (**overview** `page.tsx:22-29`, **edit** `edit/page.tsx:24-29`, **form** `form/page.tsx:25-30`, **page-builder** `page-builder/page.tsx:19-24`) independently repeats the scope + org check — required, since layouts do not re-execute on soft navigation and are not a security boundary on their own. All related fetches (form, event page, promotions, templates) are keyed by `scope.organizationId`. Behavior locked by `src/__tests__/event-org-scoping.test.ts`.
3. **No existence oracle** — missing event and wrong-org event both yield `null` from the DAL; the layout renders the same `EventNotFound` (`src/features/event/components/event-not-found.tsx`) and pages call the same `notFound()` for both cases. Indistinguishable responses; the streaming `Suspense` fallback renders only chrome + the attacker-supplied `eventId` (no data), identically in both cases.
4. **Deleted routes** — zero residual references to `api/chat`, `api/todos`, `useChatbot`, `ChatSupport`, `lib/db/db`, `TodoDoc`, `event-form-test` in `src/`. The removed `POST /api/chat` was an **unauthenticated** OpenAI proxy (no session/token check — anyone on the internet could burn the org's OpenAI quota); its removal is a security improvement. `api/todos` was bearer-token-gated; removed cleanly. `GPT_API_KEY` never appeared in client code (server route env only); see SEC-M0-5 for the leftover binding.
5. **New event shell components** — `event-shell.tsx`, `event-bar.tsx`, `event-nav-sidebar.tsx`, `event-nav.ts`, `coming-soon.tsx`, `event-not-found.tsx`, `skeleton.tsx`: no secrets, no `process.env`, no `dangerouslySetInnerHTML`/`eval`, no authorization decisions (pure presentation over server-resolved props); all user-influenced strings (`event.name`, `eventId`) rendered through JSX text nodes (auto-escaped) and `encodeURIComponent`-ed in hrefs; `localStorage` stores only a UI-collapse boolean; preview link uses `rel="noopener noreferrer"`.
6. **Moved pages are byte-identical** — every page moved into `(workspace)` and `(event)` diffs clean (modulo CRLF) against its deleted original; no logic drift smuggled into the refactor.
7. **`firestore.indexes.json`** — 6 new composite indexes, all additive and pairing tenant keys (`organizationId`) with query fields; indexes have no authorization semantics and cannot weaken isolation. The two `Organization` composites (`domain+allowDomainAutoJoin`, `inviteCode+inviteCodeEnabled`) serve pre-membership *client* lookups (`src/lib/db/organization.ts:23-43`) — the exposure question is a rules concern, folded into SEC-M0-1.
8. **Test infra** — `vitest.config.mts` `server-only` alias points to an empty test stub; test-only, does not weaken the `server-only` build-time guard in production bundles.

## Routing
- SEC-M0-1: Backend Agent (M8-T1; deployed-rules verification recommended now).
- SEC-M0-2 / SEC-M0-3: Developer — dependency-upgrade ticket, high priority.
- SEC-M0-4: Backend Agent (M8-T1).
- SEC-M0-5: Developer — one-line `apphosting.yaml` cleanup + key revocation.
