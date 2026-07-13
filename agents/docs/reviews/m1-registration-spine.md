# Code Review — M1 Registration Data Spine (registration types + ticket types)

Reviewer: Code Reviewer agent, 2026-07-10. Branch `feat/m1-registration-spine`, uncommitted working tree.
Spec: `agents/docs/specs/m1-registration-spine.md` (27 ACs) · Design: `agents/docs/design/m1-registration-spine.md` · Data model: `agents/docs/data-models/m1-registration-spine.md`.

Checks run: `npm run lint` PASS · `npm test` PASS (177 tests, 82 new: 13 + 13 + 24 + 32) · `npm run build` PASS (exit 0).

## Verdict: CHANGES REQUESTED

No Blockers. Three Should-fix findings must be addressed within this ticket before handoff to Security. Everything else is solid — see "Verified" at the bottom.

---

## Should-fix

### S1 — Network failures on all four mutation paths are unhandled rejections
`fetch` rejects on network failure (offline, timeout, DNS). React Hook Form's `handleSubmit` re-throws errors from the submit callback, and the workspaces' delete handlers use `try/finally` with no `catch`. Result: unhandled promise rejection, pending state resets, dialog stays open with **no user feedback**. Every existing mutation in the codebase wraps fetch in `try/catch` with a `toast.error` (`src/features/event/create-event-workspace.tsx:206`, `src/features/event-promotions/components/event-promotion-manager.tsx:161`, `attach-promotion-dialog.tsx:53`) — this diff breaks that convention.

- `src/features/registration/components/registration-type-dialog.tsx:95-111` — `onSubmit` fetch, no try/catch
- `src/features/registration/components/ticket-type-dialog.tsx:120-136` — same
- `src/features/registration/components/registration-types-workspace.tsx:83-113` — `confirmDelete` try/finally, no catch
- `src/features/registration/components/ticket-types-workspace.tsx:129-159` — same

Fix: wrap in try/catch, `toast.error(...)` in the catch, keep the finally/pending reset.

### S2 — Impossible calendar dates pass validation and are silently rewritten
`SALES_DATE_PATTERN` (`src/features/registration/schemas.ts:64`) checks shape only. `"2026-02-31"` and `"2026-13-01"` pass the schema, then `eventLocalDateToUtcMs` (`src/features/registration/utils.ts:71-81`) feeds the parts to `Date.UTC`, which rolls them over — Feb 31 becomes Mar 3, month 13 becomes Jan of next year. The API returns 200 and persists a **different sales window than the client submitted**. The native date input shields the dialog, but the route is a public validation boundary (spec M1-T2 AC-2: "Zod client+server") and the schema's own error message claims "Use a valid calendar date."

Fix: add a refine to `salesDateSchema` that round-trips the parts (e.g. build `Date.UTC(y, m-1, d)` and confirm `getUTCFullYear/Month/Date` match), rejecting rolled-over dates with 400.

### S3 — `registrationTypeIds` membership is validated against a truncated list
`findUnknownRegistrationTypeIds` (`src/features/registration/server/registration-type-membership.ts:18-23`) calls `getAdminRegistrationTypesForEvent` with the default `REGISTRATION_TYPE_LIST_LIMIT = 50` (`src/lib/db/adminRegistrationType.ts:23`), but nothing caps how many registration types an event can accumulate — the create route (`src/app/api/dashboard/events/[eventId]/registration-types/route.ts:22-58`) has no count check. At 51+ types: valid ids past the first 50 are falsely rejected with "do not belong to this event" (M1-T2 AC-7 violated for those ids), and the 51st type silently never renders in the table or the tickets filter.

Fix (either): enforce a per-event max (e.g. 50, matching the bound) at create with a clear 400/409, or validate membership by direct doc gets (`getAdminRegistrationTypeForEvent` per id — the array is already capped at 50 by the schema). The former is cheapest and consistent with the data model's "per-event lists are small" stance.

---

## Nits (optional)

- **N1 — Code-uniqueness TOCTOU.** `isAdmin*CodeTaken` then write is check-then-act with no transaction (`src/lib/db/adminRegistrationType.ts:147-159`, route callers). Two concurrent creates can both pass. The spec explicitly mandates query-before-write, so this is spec-sanctioned — note it for a later hardening pass (transaction or a deterministic `{eventId}_{code}` uniqueness doc).
- **N2 — Design doc conflicts with the behavior spec; implementation follows the spec (correct precedence), reconcile the design doc:** design §3 says "No Price column in M1" while spec M1-T2 AC-1 requires the Price column rendering "—" (implemented, `ticket-types-workspace.tsx:275,296-306`); design says ticket name max 100 vs spec/impl 80 (`schemas.ts:22-26`); design ticket dialog says "at least one reg type required" vs spec's empty-=-unrestricted (impl follows spec, `ticket-type-dialog.tsx:251-255`); count badge combines "N tickets · M shown" per design vs spec's "Showing M of N" footer wording (`ticket-types-workspace.tsx:252-257`).
- **N3 — Ticket edit locked out with zero reg types.** The dialog disables submit whenever `registrationTypes.length === 0` in both modes (`ticket-type-dialog.tsx:387`). An unrestricted ticket can outlive all reg types (unreferenced types are deletable), after which even toggling its `isOpen` is impossible until a type is recreated. Consider disabling only in create mode.
- **N4 — Sub-second precision loss in the serializer fallback.** `timestampToMillis` (`src/features/registration/types.ts:47-48`) computes `seconds * 1000` in the `{seconds}`-shape branch, dropping the end boundary's `.999` ms. Not exercised by the current server-page path (admin Timestamps expose `toMillis`), but worth `+ nanoseconds/1e6` for safety.
- **N5 — Client repos are currently unreferenced.** `src/lib/db/registrationType.ts` / `ticketType.ts` have no importers yet (repo-pair convention per data model — acceptable). Reminder for Security: `firestore.rules` (baseline R8/M8-T1) must make `registeredCount`/`organizationId`/`eventId`/`createdAt` client-immutable before these repos are ever used from the browser.
- **N6 — `SalesBoundaryInput` wider than needed.** `Timestamp | Date | null` (`src/lib/db/adminTicketType.ts:47`) — no caller passes a `Timestamp`; `Date | null` would be tighter. Harmless.
- **N7 — Pre-existing `tsc --noEmit` errors** in `src/__tests__/event-org-scoping.test.ts:152-154` and `src/__tests__/register-route.test.ts:51` (committed in M0, untouched by this diff; `next build` passes because its type check excludes test files). File a cleanup ticket.

---

## Verified (spec adherence and special-attention items)

- **DAL boundary — clean.** All new `firebase/firestore` / `firebase-admin` imports are confined to `src/lib/db/` (`adminRegistrationType.ts:13`, `adminTicketType.ts:15`, `registrationType.ts:8-14`, `ticketType.ts:7-14`); routes, pages, feature module, and `registrationCode.ts` are Firebase-free.
- **Special attention #1 — `adminTicketType.ts` sales-boundary widening: APPROVED as a DAL change.** `toSalesTimestamp` (`adminTicketType.ts:49-54`) keeps the admin `Timestamp` type from leaking outside the DAL; routes pass plain `Date`s (`tickets/route.ts:69-74`). Applied consistently on create (`:134-135`) and update (`:171-176`, guarded by `!== undefined` so absent keys don't clobber). Matches the repo's invariant-in-the-repo convention. (See N6 for a minor type-tightening.)
- **Special attention #2 — timezone conversion correct.** Two-pass offset resolution (`utils.ts:66-86`) verified by hand for DST-start day (America/New_York 2026-03-08: start → 05:00Z EST, end → next-day 03:59:59.999Z EDT) and pinned by tests (`registration-utils.test.ts:61-70`). Inclusive boundaries at both ends (`utils.ts:123-129`) tested at the exact instants (`registration-utils.test.ts:104-116`). `getSalesWindowLabel` matches the AC-6 mapping; year suffix and event-timezone formatting tested (`registration-utils.test.ts:191-215`).
- **Special attention #3 — route-owned validations complete** (modulo S2/S3): 409 code-dup with `field: "code"` on create and PATCH, self-exclusion via `excludeId` (`registration-types/[registrationTypeId]/route.ts:55-66`, `tickets/[ticketTypeId]/route.ts:75-86`; DAL `limit(2)` + `some(id !== excludeId)`); `capacity >= registeredCount` on both PATCH routes; `salesEnd >= salesStart` in the shared schema with lexicographic date-string compare (`schemas.ts:84-90`, equal dates valid); membership check on ticket create and PATCH; reg-type delete blocked by referencing tickets (naming them, `array-contains` query) then by `registeredCount > 0`; ticket delete blocked by `registeredCount > 0`. All 404s are IDOR-safe (scoped getters return null cross-org/cross-event).
- **Server-owned fields structurally unwritable.** Payload schemas omit them and Zod strips unknown keys; DAL create uses an explicit field list stamping `registeredCount: 0` + `serverTimestamp()`; updates build from an allow-list (`adminRegistrationType.ts:118-131`, `adminTicketType.ts:160-183`). Tests assert attacker-supplied `registeredCount`/`organizationId`/`eventId` never reach the DAL (`registration-schemas.test.ts:137-149`, `registration-types-route.test.ts:184-210`, `ticket-types-route.test.ts:204-240`).
- **Auth path.** `resolveRegistrationRouteScope` mirrors the promotions convention (401 no/invalid session, 403 missing org scope, 404 cross-org event) with the required `// TODO(M8-T1)` (`route-scope.ts:39-40`). Intentionally no `write:events` check per the spec's "any org member may CRUD in M1".
- **Indexes** — all five composites registered in `firestore.indexes.json` in the same change, matching the query shapes in the data model table.
- **Duplication balance** — good: shared `DeleteEntityDialog`, `InfoNote`, `EntityTableStates`, `applyApiFormError`, `route-scope`, schema building blocks; the two workspaces/dialogs keep only screen-specific structure. No copy-paste of the capacity switch or code-field logic.
- **Type safety** — no `any` anywhere in the diff; `Record<string, unknown>` for admin update payloads matches `adminBase` constraints; serialized client shapes keep Timestamps out of the RSC boundary.
- **Tests assert behavior** — status codes, response payloads, DAL call arguments, exact UTC instants, truth-table boundaries pinned to non-UTC zones. No snapshot filler. AC-5's truth table, AC-6's label mapping, both delete blocks, IDOR, and stripping are all locked.
- **UI/spec sweep** — column sets and order per spec (incl. Price "—" with the M2 tooltip/link), `Unlimited` rendering, mono code cells, badge Yes/No never color-only, empty vs filtered-empty distinguished with clear-filters, note banners always render, loading skeletons via `loading.tsx`, retryable error panel, `router.refresh()` after every mutation, nav "Soon" badges removed.

## Handoff

Return to the fullstack dev for S1–S3 (S3 may alternatively land as a documented per-event cap). Re-review will be fast — the fixes are localized to two dialog files, two workspace files, `schemas.ts`, and the reg-type create route/membership helper.
