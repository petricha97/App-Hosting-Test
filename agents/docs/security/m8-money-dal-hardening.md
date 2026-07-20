# Security Review — M8-T13 Money DAL Tenancy Hardening

Security Agent, 2026-07-20. Scope: the M8-T13 changes to the Tax, Fee, and
TicketType update/delete DAL mutations, their three existing `[id]` routes,
and the focused DAL/route tests. This was a reviewer-only assessment; no
production or test code was changed.

## Gate result — PASS

**PASS — 0 Critical / 0 High / 0 Medium / 0 Low findings.**

The original bare-id DAL gap was defense-in-depth, not an exploitable live
IDOR through any production caller. All six mutations now independently
enforce stored event and organization ownership in the same transaction as
the write/delete, with no tenancy-field rewrite path and no money-field
regression.

| Severity | Count | Finding |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

## 1. Original-gap severity verdict

**Confirmed: defense-in-depth only; the original gap was not exploitable via
the production call graph.** A scoped production search of `src/app` and
`src/features` (tests excluded), followed by a repository-wide production
search under `src`, found exactly one route module calling each update/delete
pair:

- Tax: `src/app/api/dashboard/events/[eventId]/pricing/taxes/[taxId]/route.ts`.
  PATCH and DELETE resolve the route scope, then fetch the requested tax with
  `{ taxId, eventId, organizationId }` and return 404 before mutation on null
  (`route.ts:28-42,105-119`). The inline toggle and full edit are two branches
  of this same PATCH caller, not separate exposure (`route.ts:46-60,81-102`).
- Fee: `src/app/api/dashboard/events/[eventId]/pricing/fees/[feeId]/route.ts`.
  PATCH and DELETE perform the same scope resolution and scoped row fetch,
  returning 404 before mutation (`route.ts:31-45,122-136`).
- TicketType:
  `src/app/api/dashboard/events/[eventId]/tickets/[ticketTypeId]/route.ts`.
  PATCH and DELETE likewise resolve scope and require a scoped ticket fetch
  before mutation (`route.ts:32-49,131-148`).

`resolveRegistrationRouteScope(eventId)` defaults to requiring
`write:events`, derives the active organization only after server-side roster
membership validation, and loads the event through
`getAdminEventForOrganization(eventId, organizationId)`
(`src/features/registration/server/route-scope.ts:40-44,56-64,76-87`). None of
these three routes opts out. Thus an HTTP caller could not reach the old
bare-id mutation with a cross-event or cross-organization row. No production
caller skipping this gate was found, so escalation to a live IDOR is not
warranted.

## 2. Guard correctness and TOCTOU safety

**No finding.** All six mutations construct the target reference, enter
`adminDb.runTransaction`, read that exact reference with `tx.get`, compare
`snap.data()`'s stored `eventId` and `organizationId` against the trusted
scope, and only then queue `tx.update` or `tx.delete`:

- Tax update/delete: `src/lib/db/adminTax.ts:184-197,208-221`.
- Fee update/delete: `src/lib/db/adminFee.ts:152-165,176-189`.
- TicketType update/delete:
  `src/lib/db/adminTicketType.ts:183-196,209-222`.

The ownership check and mutation therefore share Firestore transaction
conflict/retry semantics; there is no check/write window. Missing documents,
wrong-event documents, and wrong-organization documents return the same
`{ ok: false, code: "NOT_FOUND" }` before a transaction write is queued. The
routes translate that result to the same resource-specific 404. Comparisons
use the real stored snapshot fields, not request-normalized or echoed values.

Focused tests exercise both mismatch dimensions for update and delete and
verify the target remains unchanged/present before permitting the owned
control mutation: tax
`src/__tests__/m8-t13-admin-tax-dal.test.ts:113-127`, fee
`src/__tests__/m8-t13-admin-fee-dal.test.ts:86-100`, and ticket type
`src/__tests__/m8-t13-admin-ticket-type-dal.test.ts:78-92`. For updates the
money/name target value remains unchanged; for deletes the target remains
present. Consequently a cross-tenant attempt leaves the target byte-unchanged
(including no `updatedAt` write).

## 3. Bypass analysis

**No finding.** The only production mutation call sites are the guarded route
calls listed above, and each now supplies the event and organization scope to
the transactional DAL API. There is no retained direct `.update()` or
`.delete()` branch in any of the six exports.

The update inputs cannot rewrite tenancy fields. `UpdateAdminTaxInput`
allow-lists only tax business fields (`src/lib/db/adminTax.ts:130-138`) and its
runtime map writes only those fields plus `updatedAt` (`:153-182`).
`UpdateAdminFeeInput` omits both ownership keys (`src/lib/db/adminFee.ts:116-124`)
and its runtime map does too (`:137-150`). `UpdateAdminTicketTypeInput` omits
both keys (`src/lib/db/adminTicketType.ts:145-153`) and its map writes only the
listed ticket fields plus `updatedAt` (`:168-181`). Extra runtime object
properties are ignored because none of the maps spreads the input. A caller
therefore cannot set `eventId`/`organizationId` to adopt a foreign row before
or during the guarded write.

## 4. Money integrity

**No finding.** The production diff changes the mutation signature/result and
replaces the final direct write/delete with a transaction; it does not change
the amount, rate, or currency mapping logic.

- Tax retains integer `rateMilliPercent`, `fixedAmountMinor`, and
  `fixedCurrency` handling, including nulling the unused fixed/percentage
  group on type changes (`src/lib/db/adminTax.ts:161-182`).
- Fee retains direct allow-listed `currency` and integer `basePriceMinor`
  assignment (`src/lib/db/adminFee.ts:146-149`).
- TicketType has no amount/rate/currency fields; its existing capacity/date and
  registration-type mappings are unchanged (`src/lib/db/adminTicketType.ts:168-181`).

The route diffs only wrap the same parsed values in the new scoped call and
handle `NOT_FOUND`. Coverage reports 100% statements/functions/lines for
`adminFee.ts` and `adminTicketType.ts`, and 100% statements/functions/lines
for `adminTax.ts` (89.09% branches).

## 5. Auth, routes, rules, dependencies, and secrets

**No finding.** Route authorization remains the existing default
`write:events` permission plus roster-validated active organization and
organization-owned event check (`route-scope.ts:40-44,56-87`). Each existing
route retains its scoped `getAdmin{X}ForEvent` 404 check. The ticket modifies
three existing route files and adds no route. `git diff HEAD --
firestore.rules firestore.indexes.json` was empty.

`git diff HEAD -- package.json package-lock.json` was empty, establishing zero
dependency/manifests and zero ticket-caused audit delta. `npm audit --json`
could not reach `registry.npmjs.org` (`getaddrinfo ENOTFOUND`), so no fresh
live advisory count is claimed.

A case-insensitive secret-pattern scan of the changed production files and
focused M8-T13 tests found no API keys, passwords, private keys, client
secrets, bearer tokens, service-account material, or new environment/config
secrets. Existing test-suite development-secret warnings are unrelated to
this diff and fail closed in production as their messages state.

## Commands run and results

- Read-only `git status`, `git diff`, `git diff --name-only/--name-status`,
  complete numbered reads of the DALs/routes/scope/tests, and scoped plus
  repository-wide `rg` caller traces — completed; no bypass caller found.
- `git diff HEAD -- package.json package-lock.json firestore.rules
  firestore.indexes.json` — empty.
- Scoped secret scan — no match.
- `npm run lint` — **PASS**, exit 0, no ESLint warnings or errors.
- `npx tsc --noEmit` — exit 1 with exactly **7 pre-existing test-only errors**:
  `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T13 file produced an error.
- `npm test -- --run` — **PASS, 190 test files / 2,104 tests**, exit 0.
- `npm run test:coverage` — **PASS, 190 test files / 2,104 tests**, exit 0;
  the three hardened DAL files have full statement/function/line coverage.
- `npm audit --json` — registry unavailable due DNS `ENOTFOUND`; unchanged
  manifests independently prove zero ticket dependency delta.

## Report-file confirmation

This report was written as the sole workspace modification made by the
Security Agent at `agents/docs/security/m8-money-dal-hardening.md`.
