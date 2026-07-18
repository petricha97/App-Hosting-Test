# Security Review — M8-T2 Workspace Dashboard Real Metrics

Security Agent, 2026-07-19. Scope: the complete uncommitted M8-T2 Backend
and Full-Stack working-tree change listed in the dispatch, including all four
new test files. Process files (`HANDOVER.md`, `agents/docs/BACKLOG.md`,
`.claude/settings.json`, `CLAUDE.md`, and `memory/`) were excluded. Reviewed
against the spec, design, data model, and the post-fix Code Review, with
`agents/docs/security/m8-real-iam.md` used as the report-format precedent.

## Gate result — PASS

**PASS — 0 Critical / 0 High / 0 Medium / 0 Low findings.**

Critical or High findings block M8-T2. None were found. There are no
severity-classified findings requiring application-code changes.

## Findings

| Severity | Count | Finding |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

## 1. Cross-tenant data leakage (Spec §4 AC-4)

**No finding.** The complete tenant-key provenance is:

1. `requireSessionUser()` reads only the `session` cookie and verifies the
   Firebase token (`src/lib/session.ts:17-46`).
2. `getDashboardScope()` uses the verified token email to load the user doc,
   then calls `resolveActiveOrganizationId(userDoc)`
   (`src/features/dashboard/server/get-dashboard-scope.ts:14-35`).
3. `resolveActiveOrganizationId()` returns the active ID only when the
   server-locked `organizations[]` roster contains that exact organization;
   otherwise it fails closed (`src/lib/org-membership.ts:25-57`).
4. The page passes that scope value to both the event query and loader
   (`src/app/dashboard/(workspace)/page.tsx:22-35`).
5. Every new DAL query unconditionally filters by that value:
   `Attendee.organizationId == input.organizationId`
   (`src/lib/db/adminAttendee.ts:303-314`),
   `Order.organizationId == input.organizationId`
   (`src/lib/db/adminOrder.ts:267-280`), and
   `RegistrationPath.organizationId == input.organizationId`
   (`src/lib/db/adminRegistrationPath.ts:77-89`). The order query additionally
   fixes payment status and currency before summing.

The overview page accepts no props or request argument and reads no query
parameter, path parameter, header, or body. No client-suppliable
`organizationId` reaches the loader or any of the three DAL functions. A user
can change their active organization through the pre-existing switcher, but
the server-side roster check ensures that it must be an organization of which
they are actually a member. The two-organization DAL fixtures independently
exercise exclusion of foreign-org attendees, orders, and registration paths
(`src/__tests__/m8-dashboard-dal.test.ts:116-272`).

## 2. Aggregate count/sum surface and Firestore rules

**No finding.** `git diff HEAD -- firestore.rules firestore.indexes.json`
was empty. This ticket neither loosens client rules for `Attendee`, `Order`, or
`RegistrationPath` nor changes indexes.

The aggregate operations execute only through Admin SDK DAL modules. Each
affected DAL begins with `import "server-only"` and imports
`firebase-admin/firestore` (`adminAttendee.ts:19-21`, `adminOrder.ts:15-21`,
`adminRegistrationPath.ts:23-25`). The orchestrator also begins with
`import "server-only"` (`load-workspace-summary.ts:1`) and calls only those
DAL helpers. Attendee count uses `query.count().get()`; order revenue uses
`AggregateField.sum(...).get()`; neither performs document reads. The tests
assert zero query-document reads for these aggregate paths
(`src/__tests__/m8-dashboard-dal.test.ts:151,244`). Registration paths are
intentionally enumerated with an organization filter and a default limit of
200, server-side only.

Admin aggregates bypass client rules by design, but the verified tenant-key
chain above and unconditional DAL filters prevent that privilege from
widening the result set.

## 3. Error-state information leakage

**No finding.** Loader rejections are reduced to `{ loadError: true }` after
`Promise.allSettled` (`src/features/dashboard/server/load-workspace-summary.ts:121-136`).
The client receives no error object, message, stack, collection name, document
ID, or tenant ID. Per-card errors render only `—`, `Couldn't load`, and a
retry control (`src/features/dashboard/components/workspace-stat-card.tsx:81-95`).

For initial scope/event-list failure, `page.tsx:22-31` discards the caught
exception and returns `WorkspaceLoadError`, whose fixed client copy is
`Something went wrong on our side. Try again in a moment.`
(`workspace-load-error.tsx:19-28`). Authentication/authorization redirects are
not converted into that error page: `NEXT_REDIRECT` objects are rethrown
unchanged so Next.js completes the redirect (`page.tsx:8-15,25-28`), with a
dedicated regression test at `src/__tests__/m8-dashboard-page.test.tsx:91-99`.

## 4. XSS and link construction

**No finding.** Event names are rendered as ordinary React JSX text in the
quick-action label (`organization-event-overview.tsx:87,186-190`). Currency
codes and formatted money are also JSX text nodes
(`workspace-stat-card.tsx:150-164`). There is no `dangerouslySetInnerHTML`,
HTML parser, raw DOM injection, or organizer-controlled styling in the new
surface; React escapes these strings.

All quick-action URLs are fixed same-origin route templates under
`/dashboard/events/` with fixed suffixes (`organization-event-overview.tsx:84-117`).
The interpolated ID comes from a server-loaded Firestore event document, and
normal event creation uses Firestore auto-generated document IDs
(`src/lib/db/adminBase.ts:20-23`). The code does not call
`encodeURIComponent` explicitly, but this is not an XSS or open-redirect path:
the value is not client input on this request, cannot replace the fixed
leading origin-relative path, Firestore document IDs cannot contain `/`, and
the normal producer emits safe auto IDs. Encoding the segment would be a
defense-in-depth robustness improvement if manually assigned event IDs are
ever introduced, not a vulnerability in this ticket.

## 5. New route and mutation surface

**No finding; explicitly zero new API routes or mutating endpoints.**
`git status --porcelain -- 'src/app/api/**'` and
`git diff --name-only HEAD -- 'src/app/api/**'` were both empty. The only new
route file is the workspace segment's `loading.tsx`, which is a render-only
Next.js loading boundary. M8-T2 is a session-gated SSR page read and introduces
no HTTP mutation, scheduled trigger, public read endpoint, or API handler.
Therefore it creates no new endpoint-specific rate-limiting obligation.

## 6. Server/client serialization boundary

**No finding.** The page serializes the full event list with
`serializeEvents(events)` and separately serializes `quickActionEvent` with
`serializeEvent(...)` before passing either into the client component
(`page.tsx:38-47`). `serializeEvent` replaces `createdAt` and `updatedAt`
Firestore Timestamp instances with plain `{ seconds, nanoseconds, isoString }`
objects (`src/features/event/utils.ts:166-198`).

The rest of the summary is composed only of numbers, strings, booleans,
literal discriminants, arrays, and `null`. RegistrationPath documents remain
inside the server-only loader and are reduced to currency strings; order and
attendee aggregates return numbers. No Firestore Timestamp, DocumentReference,
DocumentSnapshot, or Admin SDK object crosses into `OrganizationEventOverview`.

## 7. Dependency surface / npm audit

**No ticket-introduced finding.** `git diff HEAD -- package.json
package-lock.json` is empty, so M8-T2 changes neither direct nor locked
transitive dependencies. The independently attempted `npm audit --json` could
not reach `registry.npmjs.org` in this sandbox (`getaddrinfo ENOTFOUND`) and
therefore did not produce a fresh advisory response.

The current locked dependency graph's latest successful full (`dev+prod`)
audit recorded **24 pre-existing findings** in
`agents/docs/security/m7-report-templates.md`; the older M6-T3 baseline named
in this dispatch was **23**, so the historical count delta is **+1**, already
present before M8-T2. The latest production-only audit recorded 15 findings.
Because both manifests are byte-unchanged in this ticket, the M8-T2 dependency
delta is independently verified as **0 new packages / 0 ticket-introduced
findings**. The exact live registry count is inferred from the latest
successful repository audit rather than falsely presented as a successful
network rerun.

## 8. Secrets hygiene

**No finding.** A scoped case-insensitive search of every M8-T2 production and
test file found no API keys, passwords, private keys, service-account JSON,
client secrets, bearer tokens, or hardcoded Firebase configuration. No new
environment variable or configuration file is introduced by the ticket.

## Commands run and results

- `git status --porcelain`; `git diff --stat HEAD`; `git diff --name-status
  HEAD`; full tracked diffs and numbered reads of every untracked M8-T2 file —
  completed. Process files were inventoried but excluded from code review.
- `git diff HEAD -- firestore.rules firestore.indexes.json package.json
  package-lock.json` — empty.
- `git status --porcelain -- 'src/app/api/**'` and `git diff --name-only HEAD
  -- 'src/app/api/**'` — empty.
- Scoped `rg` sweeps for `organizationId`, request/query/header/body inputs,
  Admin/client Firestore imports, `server-only`, error messages/stacks,
  `dangerouslySetInnerHTML`, link construction, serialization, and common
  secret patterns — no security-relevant exception beyond the documented
  fixed-template event-ID interpolation.
- `npm run lint` — **PASS**, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected **7
  pre-existing errors**: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T2 file produced an error.
- `npm test -- --run` — **PASS, 168 test files / 1,917 tests**. Existing React
  test warnings and development-secret warnings were emitted; no test failed.
- `npm audit --json` — **environmentally unavailable**: registry DNS lookup
  failed. Counts are reported in §7 with provenance; manifest/lockfile delta
  was independently verified empty.

## What I independently verified vs inferred

### Independently verified

- Read the complete M8-T2 production diff and new files, plus the new DAL,
  orchestration, component, and page tests.
- Traced `organizationId` from verified session through roster validation,
  page, loader, and every Firestore filter; confirmed no client input enters
  that chain.
- Confirmed the rules/index/API-route/dependency-manifest diffs are empty.
- Confirmed Admin SDK and `server-only` boundaries, aggregate query shapes,
  generic error rendering, React text-only rendering, fixed same-origin link
  templates, complete event serialization, and absence of secrets.
- Ran lint, TypeScript, and the complete test suite with the results above.
- Confirmed no package or lockfile change, which proves M8-T2 adds no
  dependency and cannot itself change the resolved audit graph.

### Inferred / environment-limited

- The precise live-registry `npm audit` count could not be independently
  refreshed because outbound registry DNS failed. The 24 combined count and
  15 production-only count come from the latest successful repository security
  reports; the zero M8-T2 delta is independently established by the empty
  manifest/lockfile diff.
- Aggregate behavior and zero document reads were verified through the
  repository's fake Admin Firestore tests, not against a live Firestore
  emulator or production project. Query isolation itself was also established
  directly from the unconditional equality filters.
- Link safety relies in part on the existing Firestore auto-ID event producer;
  no manually assigned ID producer exists in this ticket.

## Report-file confirmation

This report was written as the sole workspace modification made by the
Security Agent at `agents/docs/security/m8-dashboard-metrics.md`.
