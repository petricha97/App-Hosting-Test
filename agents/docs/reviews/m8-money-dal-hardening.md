# Code Review — M8-T13 Core Money DAL Hardening

Code Reviewer, 2026-07-20. Scope: the complete uncommitted M8-T13 diff for
`adminTax`, `adminFee`, and `adminTicketType`; their three `[id]` API routes;
the three promoted real-DAL test files; and the associated route-test updates.
Unrelated uncommitted process/local files were not treated as ticket changes.

## Verdict — APPROVED

No Blocker or Should-fix was found. All six mutations implement the requested
TOCTOU-safe defense-in-depth ownership re-check, every production caller passes
and handles the new scope/result contract, the routes preserve their existing
pre-fetch and response behavior, and the update mappings do not change money or
field semantics. This is correctly a hardening change rather than remediation
of a live IDOR: each mutation still has one production `[id]` route caller, and
each route already rejected a non-owned document through its scoped pre-fetch
before this change.

## Guard TOCTOU-safety — all six PASS

- `updateAdminTax` (`src/lib/db/adminTax.ts:149-200`) and `deleteAdminTax`
  (`:203-224`) construct the target ref, enter `runTransaction`, read it with
  `tx.get`, compare both stored `eventId` and `organizationId`, and only then
  enqueue `tx.update`/`tx.delete`. Missing or either-scope mismatch returns
  `{ ok: false, code: "NOT_FOUND" }` before any write.
- `updateAdminFee` (`src/lib/db/adminFee.ts:133-168`) and `deleteAdminFee`
  (`:171-192`) use the same transaction-local read, dual-scope comparison,
  typed not-found no-op, and guarded transaction write.
- `updateAdminTicketType` (`src/lib/db/adminTicketType.ts:164-201`) and
  `deleteAdminTicketType` (`:204-225`) do likewise.
- None of the six uses a read outside its transaction. This matches the
  `markAdminEmailMessageSent` precedent at
  `src/lib/db/adminEmailMessage.ts:173-206`: transaction-local `tx.get`, both
  tenant fields checked, cross-tenant IDs made indistinguishable from missing,
  and no write on rejection. Firestore transaction conflict detection/retry
  makes the read-and-write decision atomic with respect to ownership changes.

## External behavior preserved — PASS

- Tax PATCH/DELETE keeps `getAdminTaxForEvent` as the first document gate and
  retains the same `Tax not found` 404, duplicate-code 409, successful
  `{ taxId }` 200, and delete `{ success: true }` 200 payloads. A DAL
  `NOT_FOUND` now maps to that same existing 404. The order-reference query and
  its exact deactivate-directed 409 remain before `deleteAdminTax` at
  `src/app/api/dashboard/events/[eventId]/pricing/taxes/[taxId]/route.ts:112-145`.
- Fee PATCH/DELETE keeps `getAdminFeeForEvent`, the same validation/duplicate
  responses, the same `Fee not found` 404, and the same success payloads. DAL
  `NOT_FOUND` maps to the existing 404. The order-reference query and exact
  archive-directed 409 still execute before `deleteAdminFee` at
  `src/app/api/dashboard/events/[eventId]/pricing/fees/[feeId]/route.ts:129-162`.
- Ticket-type PATCH/DELETE keeps `getAdminTicketTypeForEvent`, the same
  validation/conflict responses, `Ticket type not found` 404, and success
  payloads. DAL `NOT_FOUND` maps to that 404. Both delete blockers remain ahead
  of the DAL call: registered-count 409 at
  `src/app/api/dashboard/events/[eventId]/tickets/[ticketTypeId]/route.ts:138-159`
  and fee-reference 409 at `:161-178`.

## Money and field semantics unchanged — PASS

Direct comparison with `HEAD` confirms that each update still builds the same
allow-listed write object before the new transaction wrapper. Fee continues to
map `basePriceMinor`, currency, ticket/registration references, status, and the
other mutable fields unchanged. Ticket type retains the same code
normalization, date conversion/null behavior, capacity, open state, and
registration-ID deduplication. Tax retains the exact type-switch behavior:
percentage nulls both fixed fields, fixed nulls `rateMilliPercent`, and updates
without `type` only touch explicitly supplied fields. No pricing calculation,
minor-unit arithmetic, rounding, or money schema was changed; only direct
`.update()`/`.delete()` was replaced by the guarded transaction write.

## Signatures and callers — PASS

Repository-wide `rg` found no dangling production use of the old bare-ID
signatures. The only production callers are the three reviewed `[id]` routes:
tax invokes update in its toggle/full-edit branches and delete once; fee and
ticket type each invoke update/delete once. Every invocation supplies the
document ID, route `eventId`, and resolved `scope.organizationId`; every one
awaits the typed result and maps `!result.ok` to the route's existing not-found
404. The pre-existing scoped reads remain in place.

## Tests — PASS

- The promoted suites import the real modules under test after mocking only
  the Firestore boundary (`@/app/lib/firestore`) with the shared in-memory fake;
  they do not mock `adminTax`, `adminFee`, or `adminTicketType`.
- For each of the six mutations, the tests seed a document, separately submit
  a wrong organization and wrong event, assert the typed `NOT_FOUND`, assert
  the fake store was not changed/deleted, then submit the correctly scoped
  mutation and assert the real store update/delete. These are genuine
  cross-org, cross-event, no-write-effect, and owned-success checks.
- The remaining tests exercise real create/read/list/limit/isolation,
  allow-list, normalization/nulling, uniqueness, reference lookup, resolution,
  date, and exact minor-unit behavior against the fake store. Their assertions
  depend on observable DAL output/state and are not tautological.
- `rg` found zero `it.todo`, `test.todo`, or `describe.todo` in the six scoped
  DAL/route test files.

## Severity framing — PASS

This report classifies the issue as defense-in-depth, not a live vulnerability.
The old bare-ID DAL writes were an undesirable trust boundary, but all six had
exactly one production caller and each caller already performed a scoped
`getAdmin{X}ForEvent` ownership gate returning 404 before mutation. The new
transaction guard closes the DAL-level gap and protects against future caller
mistakes and ownership TOCTOU without overstating existing exploitability.

## Blockers

None.

## Should-fix

None.

## Nits

- The route suites default the new mutation mocks to `{ ok: true }` and verify
  scoped arguments, but do not directly force `{ ok: false, code: "NOT_FOUND" }`
  to exercise the six new post-pre-fetch 404 branches
  (`taxes/[taxId]/route.ts:54-56,98-100,144-146`;
  `fees/[feeId]/route.ts:115-117,161-163`;
  `tickets/[ticketTypeId]/route.ts:121-126,186-190`). Production mapping is
  correct by inspection and the real-DAL rejection behavior is thoroughly
  covered, so this is non-blocking; focused route cases would lock the new
  race/future-caller fallback response contract.

## Independent run results

- `npm run lint` — PASS, exit 0, no ESLint warnings or errors. The command
  emitted only the existing Next.js lint deprecation and multiple-lockfile root
  warnings.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T13 file produced a TypeScript error.
- `npm test -- --run` — PASS: **190 test files / 2104 tests**. Existing React
  ref/`act`, development-secret, and intentionally exercised error-path logs
  were emitted with no failures.
- `npm run test:coverage` — PASS: **190 test files / 2104 tests**, all configured
  floors satisfied. Overall coverage was 60.03% statements, 51.36% branches,
  53.28% functions, and 60.88% lines; `src/lib/db` was 81.51% statements,
  76.54% branches, 78.88% functions, and 82.69% lines. The hardened DALs were:
  `adminTax` 100% statements/functions/lines and 89.09% branches;
  `adminFee` 100% across all four metrics; `adminTicketType` 100% across all
  four metrics.
- `git diff --check` over the scoped tracked diff — PASS. Repository-wide call
  and todo greps produced the results documented above.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-money-dal-hardening.md`.
