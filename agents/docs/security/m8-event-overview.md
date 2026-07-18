# Security Review — M8-T3 Event Overview Parity

Security Agent, 2026-07-19. Scope: the complete uncommitted M8-T3 working-tree
diff, including the five new test files. Process files were excluded as
directed. Reviewed against the spec, design, data model, post-fix Code Review,
and the M8-T2 security-report precedent.

## Gate result — PASS

**PASS — 0 Critical / 0 High / 0 Medium / 0 Low findings.**

No severity-classified security issue was found. Critical or High findings
would block M8-T3; none exist.

## Findings

| Severity | Count | Finding |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

## 1. Cross-tenant isolation

**No finding.** The request tenant key is derived by `getDashboardScope()`
from a verified session and a server-loaded user document, with
`resolveActiveOrganizationId()` validating the active organization against
the server-locked membership roster (`src/features/dashboard/server/get-dashboard-scope.ts:14-35`).
Both layout and page then resolve the requested event through
`getAdminEventForOrganization(eventId, scope.organizationId)` before rendering
or loading related data (`src/app/dashboard/(event)/events/[eventId]/layout.tsx:23-33`,
`page.tsx:17-20`). Missing and wrong-organization events therefore share the
same not-found result.

The new abandoned aggregate unconditionally applies `eventId ==` and
`organizationId ==` before the strict timestamp range and aggregate count
(`src/lib/db/adminRegistrationDraft.ts:267-282`). The new check-in readiness
reader performs one deterministic document read and returns `true` only after
re-checking the stored `organizationId` (`src/lib/db/adminCheckinConfig.ts:98-106`).
Both absent and foreign-organization documents become the same boolean
`false`, then the same readiness shape. A foreign document incurs only the
local data-field comparison after the identical Firestore read; there is no
response-field, status, count, or branch-specific follow-up read that exposes
existence. Any theoretical sub-request timing difference is not a practical
cross-organization oracle, particularly because this value is one member of a
parallel SSR load and is never separately exposed.

Every reused loader reader was traced:

- attendees: event + organization equality filters, then accepted status
  (`src/lib/db/adminAttendee.ts:275-297`);
- invitation messages: event + organization equality filters, then sent and
  invitation filters (`src/lib/db/adminEmailMessage.ts:380-398`);
- orders/revenue: event + organization + paid status + currency predicates
  (`src/lib/db/adminOrder.ts:246-261`);
- registration paths: event + organization predicates
  (`src/lib/db/adminRegistrationPath.ts:57-72`);
- tickets and fees: event + organization predicates
  (`src/lib/db/adminTicketType.ts:62-77`, `src/lib/db/adminFee.ts:44-56`);
- event page and form: direct/path shortcuts are not trusted; returned data is
  checked against event and organization, with foreign candidates ignored
  (`src/lib/db/adminEventPage.ts:44-84`, `src/lib/db/adminForm.ts:37-65`);
- confirmation definitions: the loader passes event + organization into the
  effective-definition reader (`src/features/event/overview/event-overview-loader.ts:121-129`).

The loader constructs one `{ eventId, organizationId }` scope and supplies it
to all these calls (`event-overview-loader.ts:133-173`). The M8 DAL tests also
exercise foreign-organization and foreign-event exclusion
(`src/__tests__/m8-event-overview-dal.test.ts:91-145`).

## 2. Publish-control privilege escalation

**No finding.** The moved status control is constructed in the server layout,
not hidden with client CSS: it exists only when the server-loaded user
document includes `write:events` (`src/app/dashboard/(event)/events/[eventId]/layout.tsx:23-27,46-50`).
That is the same vetted permission source returned by `getDashboardScope()`;
viewer tests confirm the component is never constructed
(`src/__tests__/m8-event-overview-page.test.tsx:104-116`). The additive slot is
merely forwarded by `EventShell` and rendered by `EventBar`
(`src/features/event/components/event-shell.tsx:39-48,81-85`;
`src/features/event/components/event-bar.tsx:120-132`).

The UI is not the security boundary. `EventStatusActions` posts to the
pre-existing **`POST /api/dashboard/events/[eventId]/status`** route
(`src/features/dashboard/components/event-status-actions.tsx:23-33`). That
route independently verifies the session, loads the user, rejects callers
without `write:events` at
**`src/app/api/dashboard/events/[eventId]/status/route.ts:35-43`**, and only
then loads an organization-owned event at lines 45-49 before mutation. The API
route is unchanged in this ticket.

## 3. Invited-count aggregate

**No finding.** The invited metric requests only `kind: invitation` and
`status: sent` while retaining the loader's event and organization scope
(`event-overview-loader.ts:150-156`). The DAL query itself unconditionally
filters both tenant dimensions before adding those predicates
(`src/lib/db/adminEmailMessage.ts:380-398`). It cannot count or infer another
tenant's email activity.

## 4. Error-state leakage and redirect URL rendering

**No finding.** `Promise.allSettled` failures are reduced to fixed
`{ loadError: true }` metric shapes or fixed `unknown` readiness copy; no
exception object, message, stack, collection name, or internal document ID is
returned (`event-overview-loader.ts:30-33,60-71,150-187,299-313`). Components
render fixed `Unable to load`/retry states. Whole-page failures are not caught
and interpolated by this diff; they continue to the existing Next.js error
boundary rather than rendering raw error data.

The restored diagnostic displays `redirectUrl` only inside an ordinary React
text node (`src/features/dashboard/components/organization-event-detail.tsx:37-42`).
React escapes it. No `href`, navigation assignment, raw HTML, HTML parser, or
`dangerouslySetInnerHTML` is constructed from that value anywhere in this
diff, so it is neither an XSS sink nor an unvalidated link target.

## 5. New route and mutation surface

**No finding; explicitly zero new API routes or mutations.** The new page,
layout wiring, and loading boundary are SSR/render-only. Scoped API diff and
status checks were empty. The only POST initiated by the overview is the
pre-existing status route described in §2, and that route is unchanged.

## 6. Server/client boundary

**No finding.** The page serializes the event, form, promotions, and templates
before passing them to their client consumers (`src/app/dashboard/(event)/events/[eventId]/page.tsx:25-34`).
The overview loader is explicitly server-only and its `EventOverviewData`
remains within server components; its raw event/Timestamps are not passed as
props to a client component. Client leaves receive primitive strings, numbers,
booleans, arrays, serialized documents, and React-rendered children. No
Firestore `Timestamp`, `DocumentReference`, snapshot, or Admin SDK object
crosses the new overview client boundary.

## 7. Firestore rules, indexes, and dependencies

**No finding.** `git diff HEAD -- firestore.rules firestore.indexes.json` was
empty. No client-rule or index surface changed.

`git diff HEAD -- package.json package-lock.json` was also empty, proving a
zero dependency-graph delta for M8-T3. A live `npm audit --json` rerun could
not reach `registry.npmjs.org` (`getaddrinfo ENOTFOUND`), so no fresh advisory
count is claimed. Because both manifests are unchanged, M8-T3 introduces zero
packages and zero ticket-caused audit-count delta.

## 8. Secrets hygiene

**No finding.** A scoped case-insensitive scan of all M8-T3 production and
test files found no API keys, passwords, private keys, client secrets, bearer
tokens, service-account material, or new environment/configuration secrets.

## Commands run and results

- Read-only `git status`, `git diff HEAD`, `git diff --name-status`, untracked
  file inventory, numbered full reads, and scoped `rg` traces — completed.
- `git diff HEAD -- firestore.rules firestore.indexes.json package.json
  package-lock.json 'src/app/api/**'` and scoped API status — empty.
- Secret/XSS/error/redirect/authorization/DAL predicate sweeps — no exception
  beyond the safe text-only redirect diagnostic described above.
- `npm run lint` — **PASS**, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected **7
  pre-existing errors**: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T3 file produced an error.
- `npm test -- --run` — **PASS, 174 test files / 1,943 tests**. Existing React
  warnings and development-secret warnings were emitted; no test failed.
- `npm audit --json` — registry unavailable due DNS `ENOTFOUND`; manifest and
  lockfile delta independently verified empty.

## What I independently verified vs inferred

### Independently verified

- Read the complete production diff and every new M8-T3 file/test.
- Traced verified session, roster validation, active organization, event
  ownership, loader scope, and each DAL predicate/re-check.
- Verified server-side omission of the Publish control and independently read
  the unchanged status POST route's own `write:events` and ownership checks.
- Verified generic per-section/whole-page error behavior, text-only redirect
  diagnostics, client serialization boundaries, empty API/rules/index/
  manifest diffs, and absence of secrets.
- Ran lint, TypeScript, the full test suite, and the audit attempt.

### Inferred / environment-limited

- The exact live-registry audit severity counts could not be refreshed because
  registry DNS was unavailable. The zero ticket delta is directly established
  by unchanged package manifests.
- Firestore behavior was verified from code and repository fake-Admin tests,
  not against a live emulator or production project.
- The lack of a usable timing oracle for absent versus foreign check-in config
  is based on the identical single-read/identical-output code path and parallel
  SSR response shape; no network-level statistical timing experiment was run.

## Report-file confirmation

This report was written as the sole workspace modification made by the
Security Agent at `agents/docs/security/m8-event-overview.md`.
