# Security Review — M8-T7 Export Rate Limits

Security Agent, 2026-07-19. Scope: the complete M8-T7 production diff and its
rate-limit tests. Process files and unrelated working-tree changes were
excluded as directed.

## Gate result — PASS

**PASS — all 8 / 8 CSV export routes are limited; 0 Critical / 0 High / 0
Medium / 1 Low finding.**

The M7-T2 Security M-1 cost/DoS-amplification finding is closed. Every export
route under `src/app/api/dashboard` performs an authenticated, server-derived
scope check, then `checkRateLimit({ limit: 10 })`, then its expensive export
load. No route can reach its CSV scan after its bucket is exhausted, and no
client-supplied query/header field selects a bucket.

## Findings

| Severity | Count | Finding |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 1 | L-1: workspace responses export shares one bucket across all authorized users in an organization |

### L-1 — organization-wide workspace-export bucket (Low)

`src/app/api/dashboard/responses/export/route.ts:36-38` keys the workspace
responses limiter as `export-responses-workspace:<organizationId>:workspace`.
Unlike the other seven routes, it does not include a server-derived user ID.
The corresponding successful scope shape exposes only `organizationId`
(`src/features/responses/server/route-scope.ts:26-28,90-104`). Consequently,
one authorized `write:events` member can consume the ten-request window and
temporarily return 429 to other authorized members of that organization.

This is availability coupling/over-restriction, not a rate-limit bypass: the
organization ID is roster-confirmed on the server, query parameters cannot
change it, another organization receives a distinct bucket, and the scan is
still stopped. It therefore does not reopen M7-T2 M-1 and is non-gating for the
stated PASS/FAIL rule. The clean repair is to return the decoded, lowercased
user identity from `resolveResponsesOrgWriteScope()` and include it in this
key, matching the other seven routes. The M8-T7 test covers per-user isolation
only for attendees (`src/__tests__/m8-t7-export-rate-limits.test.ts:146-158`),
so this workspace-specific behavior is not detected by the regression suite.

## 1. All eight export routes closed

A full `find src/app/api/dashboard -path '*/export/route.ts'` inventory returns
exactly eight routes. A route-by-route read confirmed a limiter in every one:

| Export route | Authz/scope | Limiter | Expensive load starts |
|---|---:|---:|---:|
| attendees | `route.ts:25-28` | `route.ts:30-42` | `route.ts:47` |
| event responses | `route.ts:30-33` | `route.ts:35-47` | `route.ts:52` |
| workspace responses | `route.ts:31-34` | `route.ts:36-48` | `route.ts:54` (event lookup) / `64` (response scan) |
| registration overview | `route.ts:19-24` | `route.ts:25-34` | `route.ts:35` (handler; loader at handler `:60`) |
| order transactions | `route.ts:19-24` | `route.ts:25-34` | `route.ts:35` |
| abandoned registrations | `route.ts:20-25` | `route.ts:26-35` | `route.ts:36` |
| check-in history | `route.ts:19-24` | `route.ts:25-34` | `route.ts:35` |
| email overview | `route.ts:19-24` | `route.ts:25-34` | `route.ts:35` |

The five report wrappers now resolve scope before limiting and pass the
already-authorized organization ID to the shared CSV handler. The handler no
longer performs a second scope resolution, but still performs only the load
and CSV build (`src/features/reports/server/report-run-handler.ts:50-72`).
This preserves the original authorization requirement while placing the
limiter before the scan.

## 2. Bypass resistance

**Closed.** Seven keys contain route prefix + roster-confirmed organization +
decoded lowercased user + event ID. The workspace route contains a unique
prefix + roster-confirmed organization and has the L-1 cross-user coupling,
but remains non-client-selectable. Status/event query parameters are parsed
only after limiting and cannot reset a bucket. Event IDs are path parameters,
but the event-scoped scope resolvers first require ownership; varying IDs can
only select genuinely authorized event buckets and cannot turn one expensive
event export into unlimited requests against that event.

All eight prefixes are distinct, so traffic on attendees, responses, or any
one report template does not consume or escape through another route's
bucket. The shared report handler receives traffic only after each wrapper's
own per-template limiter; it neither creates one accidental shared report
bucket nor bypasses the wrapper key.

No obvious sibling exposes the same full export scan without a limiter. The
attendee and response list routes and five report Run routes are bounded,
paginated interactive reads, not alternate full CSV export paths.

## 3. Authentication, authorization, and 429 ordering

**No 429-before-auth information disclosure.** Each route resolves session,
roster-confirmed organization, `write:events`, and (for event routes) the
organization-owned event before invoking `checkRateLimit`. Unauthorized,
permission-denied, missing, and foreign-event callers therefore retain their
401/403/404 results and cannot observe bucket state or receive a 429 that
signals event existence.

The diff is additive around attendees and response exports. For the five
report exports, the existing `requireWriteEvents: true` scope check moved from
the shared handler into each wrapper before the new limiter; it was not
removed. Organization IDs supplied to loaders still come exclusively from the
successful scope. Existing row limits, tenant predicates, CSV builders,
formula-injection escaping, RFC-4180 quoting, masked-email behavior, and
response headers are unchanged. No authorization, tenant isolation, or CSV
escaping regression was found.

## 4. In-memory limiter residual

**Accepted residual for this finding; not a FAIL.** `src/lib/rate-limit.ts:8-13`
documents that state is in-memory and per server instance, scales with the
instance count, and resets on cold start. Thus 10/minute is not a globally
durable ceiling. M7-T2 M-1 was a Medium cost-amplification finding, not a hard
security-boundary requirement; blocking repeated scans per warm instance
materially blunts that vector. A distributed/durable limiter remains sensible
future hardening but is outside this closure gate.

## 5. Dependencies, audit, and secrets

`git diff HEAD -- package.json package-lock.json` is empty, establishing zero
dependency-graph and audit delta for M8-T7. `npm audit --json` could not reach
`registry.npmjs.org` (`getaddrinfo ENOTFOUND`), so no fresh advisory count is
claimed.

A scoped case-insensitive scan of the production diff and new test found no
API keys, passwords, private keys, bearer credentials, client secrets,
service-account material, or new environment/configuration secrets.

## Commands run and results

- Read-only `git status --short`, `git diff --name-status HEAD`, scoped `git
  diff HEAD`, numbered full-file reads, and `rg`/`find` route, loader, key, and
  sibling-path traces — completed; exactly 8 export routes found and all 8
  limited before their expensive loads.
- `git diff HEAD -- package.json package-lock.json` — empty.
- Scoped secret scan — no secret material found.
- `npm run lint` — **PASS**, exit 0, no ESLint warnings or errors (tooling
  emitted only the existing Next.js deprecation/workspace-root notices).
- `npx tsc --noEmit --pretty false` — exit 1 with exactly 7 documented
  pre-existing test-fixture errors at `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`; no
  M8-T7 file produced an error.
- `npm test -- --run` — **PASS, 186 test files / 2,049 tests**. Existing React
  ref and development-secret warnings were emitted; no test failed.
- `npm audit --json` — registry unavailable due DNS `ENOTFOUND`; unchanged
  manifests independently establish zero ticket-caused delta.

## Report-file confirmation

This report was written as the sole workspace modification made by the
Security Agent at `agents/docs/security/m8-export-rate-limits.md`.
