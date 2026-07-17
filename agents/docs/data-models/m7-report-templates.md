# M7-T2 Data Model — Report templates library (DAL slice)

Backend Agent, 2026-07-17. Implements the DAL slice of
`agents/docs/specs/m7-report-templates.md` (Gap analysis) under the M1–M6
conventions, informed by the client-facing pagination contract in
`agents/docs/design/m7-report-templates.md` (§3 "Load more", §5 CSV export).
Source of truth: `src/types/collection.ts` (`OrderDoc`, `AttendeeDoc`,
`RegistrationDraftDoc`, `EmailMessageDoc`) + `src/lib/db/adminOrder.ts` (this
ticket's one extension) + `firestore.indexes.json`. **This slice ships NO UI
and NO report-loader/route code** — `src/features/reports/**` (the 5
`load-<template>.ts` loaders, the 5 export routes, `report-run-panel.tsx`,
etc.) is the Full-Stack Developer's slice, built in parallel against the
exact function signatures documented below. Per the dispatch, nothing under
`src/features/reports/` was touched by this agent.

## 0. Per-template DAL audit — what each of the 5 templates' Run/export
   surfaces actually calls, and whether it already supports cursor pagination
   + a limit large enough for the 1000-row export cap

| # | Template | DAL call | Cursor param (already present?) | Configurable `limit` (already present?) | Verdict |
|---|---|---|---|---|---|
| 1 | Registration overview | `listAdminAttendeesForEvent` (`src/lib/db/adminAttendee.ts:218`) | `startAfterCreatedAtMs`, yes | `limit?: number`, yes, no internal cap beyond the `ATTENDEE_LIST_LIMIT=50` **default** | **Sufficient, unchanged.** Confirmed by reading the function body: `limit(input.limit ?? ATTENDEE_LIST_LIMIT)` — a caller passing `limit: 200` (export batch) or `limit: 1000` gets exactly that many rows, no hidden ceiling. |
| 2 | Order & transaction details | `getAdminOrdersForEvent` (`src/lib/db/adminOrder.ts`) | **No** (pre-existing signature had no cursor param at all) | `limit?: number`, yes, same no-hidden-cap shape | **Extended in this ticket** — see §1 below. This was the one genuine gap the spec's own Gap analysis named, and the only DAL change in this ticket. |
| 3 | Abandoned registration details | `getAdminRegistrationDraftsForEvent` (`src/lib/db/adminRegistrationDraft.ts:224`) | `startAfterUpdatedAtMs`, yes (added M6-T3 for the abandoned-reminder trigger's paged sweep — already a *second*, non-Run consumer proving the cursor shape is real and load-bearing, not a one-off) | `limit?: number`, yes | **Sufficient, unchanged.** |
| 4 | Badges printed (check-in history) | `listAdminAttendeesForEvent` filtered `status: "accepted"` | same as #1 | same as #1 | **Sufficient, unchanged.** No dedicated DAL method needed — per spec D5, this is client-side/loader-side filtering of the same attendee list #1 uses (the report loader's own choice of which `AttendeeDoc` fields to project into columns), not a new query shape. No new DAL function was added for this template. |
| 5 | Email overview | `listAdminEmailMessagesForEvent` (`src/lib/db/adminEmailMessage.ts:337`) | `startAfterCreatedAtMs`, yes | `limit?: number`, yes | **Sufficient, unchanged.** |

Supporting id→name join calls for templates #2/#3 (`getAdminTicketTypesForEvent`,
`src/lib/db/adminTicketType.ts:62`; `getAdminRegistrationTypesForEvent`,
`src/lib/db/adminRegistrationType.ts:38`) are unchanged, already-bounded
(`TICKET_TYPE_LIST_LIMIT`/`REGISTRATION_TYPE_LIST_LIMIT = 50`) list calls —
reused as-is, confirmed by reading both function bodies. No DAL change.

**Conclusion: the spec's own Gap analysis was accurate.** Of the 5 templates,
4 needed zero DAL changes (verified empirically by reading each function's
actual signature and body, not assumed from the spec's claim) and 1
(`getAdminOrdersForEvent`) needed the extension below.

## 1. `getAdminOrdersForEvent` — extended with `startAfterCreatedAtMs` (`src/lib/db/adminOrder.ts`)

**Signature (extended, backward-compatible):**

```ts
export async function getAdminOrdersForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
  startAfterCreatedAtMs?: number;   // NEW (M7-T2)
}): Promise<WithId<OrderDoc>[]>
```

- **Chosen approach: extend the existing function in place, not fork a
  sibling.** Confirmed via `grep -rn "getAdminOrdersForEvent" src` before
  editing: **zero existing callers** anywhere in the codebase (it was added
  in M2-T4 as a "reports/M7 will define real read surfaces" placeholder — see
  the pre-existing comment on `ORDER_LIST_LIMIT` — and never wired up before
  this ticket). With no existing call sites to protect, extending in place
  is strictly simpler than forking a second function, and matches the exact
  shape every other admin list in this codebase already uses when a cursor
  is added to a previously-bounded-only read (`getAdminRegistrationDraftsForEvent`'s
  own `startAfterUpdatedAtMs`, added the same way in M6-T3 for a second,
  unrelated consumer).
- **Ordering:** preserved exactly as the pre-existing function already had
  it — `createdAt DESC` (newest first). This was a deliberate "preserve, not
  invent" choice per the ticket's own instruction: the function already had
  a real, documented ordering (`// Lists the event's orders, org-scoped in
  the query, newest first`), so there was no ordering decision left to make
  — only a cursor needed adding on the *same* field the query already
  orders by, which is the only shape Firestore's `startAfter` supports
  without introducing an unrelated composite-index shape.
- **Cursor semantics:** identical convention to `listAdminAttendeesForEvent`/
  `listAdminEmailMessagesForEvent` — the cursor is the last row's `createdAt`
  in epoch milliseconds; the caller re-derives it from the last row of the
  previous page (`Timestamp.fromMillis(...)` internally). Every existing
  caller (there are none in production code, but the M2-T4 finalize/failed-order
  paths never call this read function) is unaffected; the parameter is
  optional and additive.
- **Serves both consumers named in the design doc** (`agents/docs/design/m7-report-templates.md`
  §3 "Load more"): the Run panel's `limit: 50` + cursor "Load more" clicks,
  and the export route's internal 200-row-batch loop up to the
  `REPORT_EXPORT_ROW_LIMIT = 1000` ceiling (§7 of the spec) — one DAL method,
  two calling conventions, exactly as `listAdminAttendeesForEvent` already
  demonstrates for Registration overview / Badges printed.

### Index requirement: **none new**

The query shape is unchanged (`eventId ==`, `organizationId ==`,
`orderBy createdAt DESC`) — only a `startAfter` cursor was added on the
*same* field the query already orders by. Confirmed against
`firestore.indexes.json` (lines 184–192): the composite index
`Order: eventId ASC, organizationId ASC, createdAt DESC` already exists and
already serves this exact query shape; `startAfter` never changes what
index a query needs (it only bounds the result set below wherever the query
would otherwise start), so this is a genuinely zero-index-impact change.
`git diff firestore.indexes.json` for this ticket is empty by construction
— no edit was made to that file.

## 2. 1000-row bounded read safety — verified, not assumed

Per the ticket's instruction to verify empirically (the same posture M7-T1
took toward its own `sum()` question), the following was checked directly
against the DAL and the fake Firestore double used by every admin DAL test
in this repo (`src/__tests__/helpers/fake-admin-db.ts`):

- **The query stays equality/single-field-order at every row count.**
  `getAdminOrdersForEvent`'s filters are `eventId ==` and `organizationId ==`
  (two equalities) plus `orderBy("createdAt", "desc")` (one field) —
  regardless of how large `limit` is set (50, 200, or 1000), the *shape* of
  the query sent to Firestore never changes; only the `limit(...)` value and
  the presence/absence of `startAfter(...)` change. A composite index's
  applicability is a function of query shape, not of `limit`'s value, so a
  1000-row read is exactly as safe, index-wise, as the existing 50-row
  default — confirmed by inspection of the function body (§1 above), not
  inferred.
- **A `limit: 1000` call actually returns up to 1000 rows, no smaller hidden
  cap.** Added `src/__tests__/admin-order-list.test.ts` (describe block
  "export-volume limit (M7-T2 D2/D3)") which seeds 1000 `Order` docs and
  asserts `getAdminOrdersForEvent({ ..., limit: 1000 })` returns all 1000 —
  this rules out a latent internal `Math.min(limit, 50)`-style clamp that a
  naive read of "`ORDER_LIST_LIMIT = 50`" might suggest exists but does not
  (the code only uses `ORDER_LIST_LIMIT` as the *default* via `?? `, never as
  a ceiling).
- **A single Firestore query for 1000 documents (bounded by `limit(1000)`,
  no pagination-within-a-single-call) is a bounded, single-round-trip read**
  — the same shape `ATTENDEES_EXPORT_LIMIT = 1000` / `RESPONSES_EXPORT_LIMIT
  = 1000` already rely on elsewhere in this codebase (`src/features/attendees/csv.ts`,
  `src/features/responses/csv.ts`), except per spec D2 the Order export loop
  calls this DAL method repeatedly at a 200-row internal batch size (5 calls
  worst-case to reach 1000), not once at `limit: 1000` — either shape is
  safe from the DAL's perspective; the choice of batch size is the Full-Stack
  report loader's concern (spec D2), not a DAL constraint.
- **No composite index required at 1000 rows any more than at 50** — same
  index (`eventId ASC, organizationId ASC, createdAt DESC`) serves the query
  at every `limit` value; Firestore's `limit()` and `startAfter()` do not
  change which composite index a query needs.

**Conclusion: a bounded, ≤1000-row read of `Order` docs for the CSV export
path is safe and requires no new index** — matching the spec's own Gap
analysis claim, now empirically confirmed rather than assumed.

## 3. Pagination contract every report loader can rely on (client-facing shape, per the design doc)

All 5 templates' underlying DAL methods now share the exact same contract:

```ts
// Run (on-screen preview): page size 50, "Load more" cursor
const page1 = await dalMethod({ eventId, organizationId, limit: 50 });
const lastRow = page1[page1.length - 1];
const page2 = await dalMethod({
  eventId, organizationId, limit: 50,
  startAfter<Field>Ms: <lastRow's ordering field as epoch ms>,
});

// CSV export: loop at a 200-row internal batch size up to
// REPORT_EXPORT_ROW_LIMIT = 1000, stopping when either the cap is hit or
// page.length < batchSize (query exhausted) — whichever comes first.
```

| Template | DAL method | Ordering field | Cursor param | Default limit constant |
|---|---|---|---|---|
| Registration overview | `listAdminAttendeesForEvent` | `createdAt` DESC | `startAfterCreatedAtMs` | `ATTENDEE_LIST_LIMIT = 50` |
| Order & transaction details | `getAdminOrdersForEvent` | `createdAt` DESC | `startAfterCreatedAtMs` **(new)** | `ORDER_LIST_LIMIT = 50` |
| Abandoned registration details | `getAdminRegistrationDraftsForEvent` | `updatedAt` DESC | `startAfterUpdatedAtMs` | `REGISTRATION_DRAFT_LIST_LIMIT = 50` |
| Badges printed (check-in history) | `listAdminAttendeesForEvent` (`status: "accepted"`) | `createdAt` DESC | `startAfterCreatedAtMs` | `ATTENDEE_LIST_LIMIT = 50` |
| Email overview | `listAdminEmailMessagesForEvent` | `createdAt` DESC | `startAfterCreatedAtMs` | `EMAIL_MESSAGE_LIST_LIMIT = 50` |

**Abandoned registration details' extra wrinkle (spec §3, D2):** its DAL
call returns *all* drafts (fresh + abandoned); the `isAbandoned` filter is
applied by the caller in memory per page, exactly as the existing Abandoned
tab already does. This means the export loop for that one template needs a
*second*, independent stopping ceiling (a hard raw-page-fetch count,
`ABANDONED_EXPORT_MAX_RAW_PAGES = 20` per the spec) in addition to the
1000-abandoned-row cap — that ceiling lives in the Full-Stack report loader
(`load-abandoned-registrations.ts`), not in the DAL, since it's a
loop-termination policy over an unfiltered read, not a query-shape change.
No DAL change was needed to support this — `getAdminRegistrationDraftsForEvent`
already returns the raw, unfiltered page the loader filters.

## 4. `firestore.indexes.json` — confirmed zero changes needed

Verified directly against the file (lines 184–202):

```json
{
  "collectionGroup": "Order",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "eventId", "order": "ASCENDING" },
    { "fieldPath": "organizationId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

This is the exact index `getAdminOrdersForEvent`'s extended signature needs
— it existed before this ticket (M2-T4) and required no edit. The other four
templates' underlying queries (`Attendee`, `RegistrationDraft`, `EmailMessage`)
were not modified in this ticket and their existing indexes are untouched.
`git diff firestore.indexes.json` for this ticket is empty.

## 5. Read/write access rules

No change to `firestore.rules` in this ticket — `Order` (like `Attendee`,
`RegistrationDraft`, `EmailMessage`) is already a server-only, deny-all-to-clients
collection (M2/M5/M6 conventions, unchanged). The one DAL extension here is
an additional **admin-SDK read shape** (a cursor param) over an existing
collection and an existing query filter set, not a new collection and not a
new client-reachable surface. Per spec D1, every report route built on top
of this DAL (Run list/paginate routes and the 5 export routes) is the
Full-Stack Developer's concern — gating (org-membership-only for Run,
`write:events` for export) is enforced at the route layer via
`resolveReportsRouteScope()`, not in the DAL.

## 6. Divergences / notes for the Full-Stack slice

- **No new DAL method was added for "Badges printed (check-in history)."**
  Per spec D5, this template's data source is `listAdminAttendeesForEvent`
  filtered `status: "accepted"`, exactly like Registration overview's query
  minus the status filter — the report loader is responsible for selecting
  which `AttendeeDoc` fields to project (check-in columns vs. registration
  columns), not the DAL. If a future ticket adds real per-badge print
  tracking (D5's named open gap), that would be a new field/collection and
  a new DAL method — out of scope here.
- **`getAdminOrdersForEvent`'s extension was verified to have zero existing
  callers to protect**, so no call-site audit across the rest of the
  codebase was needed beyond the `grep` confirming that.
- **Tests:** `src/__tests__/admin-order-list.test.ts` (new file) — base
  shape (newest-first, org-scoped, default-limit) unchanged-behavior lock,
  cursor-pagination correctness across a page boundary with a
  duplicate/missing-row assertion (120-row fixture, 3 pages), cross-org
  cursor-scoping isolation, and the export-volume limit tests (200-row
  batch size, full 1000-row ceiling) proving no hidden internal cap.
  Existing `src/__tests__/admin-order-payment-status.test.ts` /
  `admin-order-finance-sums.test.ts` / `admin-order-finalize.test.ts` were
  run unchanged to confirm the extension didn't regress sibling `adminOrder.ts`
  exports.
