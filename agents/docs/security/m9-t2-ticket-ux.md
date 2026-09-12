# M9-T2 security review

Verdict: **PASS for this ticket**. No new Critical, High, or Medium security finding identified in the simplified ticket implementation. Existing dependency advisories are tracked separately below; this is not a claim that the whole application has no vulnerabilities.

Scope: default-audience and ticket-sales endpoints, default-audience DAL, wizard payloads and client flows, existing atomic ticket/pricing route and DAL used by the wizard, management dialogs/actions, shared code generation, existing registration scope resolver and relevant Firestore rules. Backend and wizard code were reviewed independently of their implementation. Management code was authored by this agent and independently code-reviewed by the backend agent in `agents/docs/reviews/m9-t2-management.md`.

## Verified controls

- **Authorization and IDOR:** both new routes call `resolveRegistrationRouteScope` before mutation. Session verification, active organization membership, event write permission and event ownership come from existing server-controlled scope. Default document reuse checks organization and event inside the transaction. Sales updates use the existing transactionally scoped ticket updater. Missing and foreign resources share the same failure response.
- **Mass assignment:** default input admits only validated capacity; sales input admits only a boolean. Extra client fields are stripped. Organization, event, counters, timestamps and default identity cannot be selected through request bodies. The sales mutation preserves all saved ticket details and pricing.
- **Default behavior:** deterministic organization/event identity makes overlapping default requests converge. Existing name, code and capacity are returned without overwriting them. Unrelated GENERAL codes are rejected rather than adopted. The default remains an ordinary audience whose ID is validated again by the final ticket/pricing transaction.
- **Ticket and pricing writes:** final payload validates names, identifier format, real calendar dates, capacity, bounded integer prices and row count. Audience membership is rechecked inside the atomic transaction before ticket/fee writes. Client-supplied eligibility arrays and server-owned fields are excluded.
- **Client boundary:** suggested codes are identifiers, not security tokens. The server still checks their format and uniqueness. Names and API messages render as React text. No new unsafe HTML, eval, script construction, cookie access, external redirects or client-side secrets were introduced. Sales URL segments are encoded.
- **Firestore:** all new database operations stay in server-only DAL modules. Existing `RegistrationType`, `TicketType` and `Fee` rules deny direct client writes (`firestore.rules:238`, `:243`, `:252`). The new collision query has both tenant/event filters, a bounded result and an index entry.
- **CSRF posture:** these authenticated mutations retain the app's existing Secure, HttpOnly, explicitly SameSite=Lax session cookie (`src/app/api/auth/session/route.ts:22`). Mutations do not use GET. This review does not claim protection against an already compromised trusted same-site origin; no new cross-origin allowance or session behavior was added.

## Existing dependency follow-up (outside this ticket)

**High / baseline dependency advisories:** `npm audit --omit=dev --json` reports 13 production dependency findings: 4 high, 9 moderate, 0 critical. High package groups are existing `next`, `nanoid`, and transitive `postcss`/`sharp`. Direct manifests include `package.json:26` (nanoid) and `package.json:27` (Next.js). Neither the manifest nor lockfile changed in M9-T2.

Representative scenarios reported by the advisory feed include crafted Server Action requests causing resource exhaustion (Next.js [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj)), invalid sizes reaching non-secure identifier generators (nanoid [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv)), and hostile CSS/source-map input reaching vulnerable PostCSS processing. These are registry findings; exploitability against this deployment was not demonstrated. Review reachable features and upgrade affected dependencies in a separate tested maintenance change. No package upgrades were performed as part of this review.

**Low / baseline resource controls:** the new routes follow existing ticket/registration management routes without dedicated rate limits. An authenticated event writer could repeatedly invoke mutations to consume database operations; this does not bypass tenancy or permissions. Consider common management-route rate limiting separately. Default retries reuse existing records and the new transaction reads are bounded.

## Evidence and limits

- New backend route/DAL tests: **37/37 passed**, including real scope-resolution authorization gates with mocked identity/data dependencies, tenant/event isolation, malformed inputs, narrow write sets and simulated concurrent default creation.
- Management tests: **13/13 passed**, including pending/error behavior, pause/resume payload isolation, and missing/archived/ineligible versus valid free pricing.
- Focused ESLint passed for reviewed new backend and management files.
- This is code review plus mocked test verification, not a Firestore emulator load test or production penetration test. Root owns final combined build, full test suite and browser QA; infrastructure deployment was not performed.

## Final wizard delta re-review

Reviewed the final immediate-save continuity change in `create-ticket-wizard.tsx` and the inline creation callback. The pending audience map exists only in the mounted component, is populated after successful authenticated saves, clears when event scope changes, and removes entries once refreshed server props acknowledge them. No browser storage, cookie or global shared cache was introduced. Cached audience IDs do not authorize writes: the final ticket/pricing transaction continues to validate the current event and organization. The synchronous publish ref blocks duplicate client submissions while preserving retries after failure. Existing security verdict remains **PASS**; no additional finding.
