# M7-T1 Data Model — Reporting aggregates (registrations by ticket type + finance summary)

Backend Agent, 2026-07-17. Implements the DAL slice of `agents/docs/specs/m7-reporting-summaries.md` §1/§2/§3 under the M1–M6 conventions. Source of truth: `src/types/collection.ts` (`AttendeeDoc`, `OrderDoc`, `TicketTypeDoc`, `EventPromotionDoc`, `RegistrationPathDoc`) + `src/lib/db/adminAttendee.ts` / `adminOrder.ts` (this ticket's additions) + `firestore.indexes.json`. **This slice ships NO UI, NO server orchestration layer, and NO new indexes** — `src/features/reports/**` (components, page, `src/features/reports/server/load-*.ts`) is the Full-Stack Developer's slice, built in parallel against the exact function signatures documented below.

This ticket adds **two** DAL surfaces only — everything else the spec needs (`getAdminTicketTypesForEvent`, `getAdminRegistrationPathsForEvent`, `getAdminEventPromotionsForEvent`) already existed and is reused as-is (spec's own Gap analysis confirms no change needed to `adminTicketType.ts` / `adminRegistrationPath.ts` / `adminEventPromotion.ts`).

## 1. `countAdminAttendeesForEvent` — extended with `ticketTypeId` (`src/lib/db/adminAttendee.ts`)

**Signature (extended, backward-compatible):**

```ts
export async function countAdminAttendeesForEvent(input: {
  eventId: string;
  organizationId: string;
  status?: AttendeeStatus;
  checkInState?: AttendeeCheckInState;
  ticketTypeId?: string | null;   // NEW (M7-T1)
}): Promise<number>
```

- Every existing call site (M5/M6 stat cards) is unaffected — `ticketTypeId` is optional and, like `status`/`checkInState`, distinguished from "not provided" via `!== undefined`, so `ticketTypeId: null` is a real equality filter (`ticketTypeId == null`), not a no-op.
- **Query shape:** `Attendee` where `eventId ==`, `organizationId ==`, [`status ==`], [`checkInState ==`], [`ticketTypeId ==`] → `.count().get()`. Firestore server-side **count() aggregate** — zero full-document reads, same cost model as every existing use of this function.
- **Report usage (spec §1):** one call per `TicketType` (`status: "accepted"`, `ticketTypeId: <id>`), plus one more call with `ticketTypeId: null` for the "No ticket type" bucket. The DAL stays a single-query primitive; the Full-Stack report loader (`src/features/reports/server/load-ticket-type-registrations.ts`) owns the `Promise.all` fan-out across the event's ticket types (≤ `TICKET_TYPE_LIST_LIMIT` = 50, per §3's ceiling) plus the null-bucket call.
- **Cancelled attendees:** `status: "accepted"` on every call excludes `status: "cancelled"` attendees automatically (spec §1 AC-4) — no special-casing needed.
- **Not-yet-accepted submissions:** there is no `Attendee` doc for a `pending`/`reviewed` `FormData` (M5 invariant — an `Attendee` is born only at accept), so it structurally cannot appear in any count here (spec §1 AC-3).

### Index requirement: **none new**

The added filter is a fourth equality clause (`eventId`, `organizationId`, `status`, `ticketTypeId` — all `==`, no `orderBy`). This is the same "equality-only filters served by index merging" convention already documented on this exact function (comment predates this ticket) and on `countAdminAttendeesForEvent`'s sibling calls elsewhere in the codebase. **Empirically confirmed** during Implement (see §3 below) — not just asserted from the existing-convention comment.

## 2. `sumAdminOrderTotalsForEvent` — new (`src/lib/db/adminOrder.ts`)

**Signature:**

```ts
export type OrderAmountSumField = "totalMinor" | "subtotalMinor";

export async function sumAdminOrderTotalsForEvent(input: {
  eventId: string;
  organizationId: string;
  paymentStatus: PaymentStatus;
  currency: Currency;
  field: OrderAmountSumField;
}): Promise<number>
```

One method with an explicit `field` selector (per the spec Gap analysis's "could be one method with a field selector, or two thin wrappers; Backend's call") — chosen over two thin wrappers because the two call shapes are otherwise identical and a selector keeps the sum-field decision visible and required at every call site (no default that could silently pick the wrong field).

- **Query shape:** `Order` where `eventId ==`, `organizationId ==`, `paymentStatus ==`, `currency ==` → `.aggregate({ total: AggregateField.sum(`amounts.${field}`) }).get()`. Firestore server-side **sum() aggregate** over a nested dotted field path — zero full-document reads (same cost model as `count()`).
- **`field` usage (spec §2, the ticket's central non-obvious call):**
  - `paymentStatus: "paid"` → `field: "totalMinor"` (Paid (card) row).
  - `paymentStatus: "outstanding"` → `field: "totalMinor"` (Outstanding (invoice) row).
  - `paymentStatus: "comped"` → `field: "subtotalMinor"` — **never** `"totalMinor"`, which is always `0` for a comped order by construction (M2-T4 AC-5). Summing `subtotalMinor` captures both comp paths correctly: a genuinely-free fee (`subtotalMinor: 0`, correctly $0 "value") and a paid fee fully wiped by a 100%-discount promo (`subtotalMinor` = the real list price, correctly non-zero "value").
- **Excluded statuses:** `pending`/`failed` orders are never summed by any report call — the report loader only ever passes `paymentStatus` in `{"paid", "outstanding", "comped"}` (spec §2's excluded-statuses note); the DAL itself places no restriction on the `paymentStatus` value passed (it's a plain equality filter), so this exclusion is enforced by construction (the caller never asks for `pending`/`failed`) rather than by the DAL rejecting those values.
- **Currency scoping:** `currency ==` is a required, non-optional filter — every call is scoped to exactly one currency (spec §4). A caller must run one call per (paymentStatus, currency) pair actually in use; the report loader (`load-finance-summary.ts`) enumerates the event's distinct currencies from `RegistrationPath` docs and fans out 3 calls (paid/outstanding/comped) per currency via `Promise.all`.
- **Empty result set:** sums to `0` (a `number`, never `null`/`undefined`/`NaN`) — confirmed both against the fake-admin-db test double and empirically against a live Firestore emulator (§3).

### Index requirement: **none new**

Four equality filters (`eventId`, `organizationId`, `paymentStatus`, `currency`), no `orderBy`. Same "equality-only, index-merged" posture as every other DAL method in this codebase that avoids a composite index — **empirically confirmed**, not just asserted (§3). The one existing `Order` composite index (`eventId ASC, organizationId ASC, paymentStatus ASC, createdAt ASC`, M6-T3) is not required by and does not serve this query (no `orderBy`), and is left untouched — `firestore.indexes.json` has **zero changes** in this ticket.

## 3. OQ-2 resolution — `sum()` DOES accept a dotted nested-field path in this SDK version

The spec flagged this as backend's own open question, non-blocking but "not proven," and explicitly asked for verification "against a real/emulated Firestore call, don't assume it works." This was verified two ways during Implement:

**(a) Live Firestore emulator (authoritative).** Spun up the Firestore emulator (`firebase emulators:start --only firestore`, project `ai-driven-app-hosting`, requiring a one-time local JDK 21 install — the sandbox's stock JDK 8 is below firebase-tools' Java floor) and ran a script against `firebase-admin@^13.6.1`'s real `AggregateField.sum("amounts.totalMinor")` / `AggregateField.sum("amounts.subtotalMinor")` through `Query.aggregate(...).get()`:

- A 4-equality-filter query (`eventId ==`, `organizationId ==`, `paymentStatus ==`, `currency ==`) with `sum("amounts.totalMinor")` summed two seeded `paid` orders (`10000 + 5000`) to exactly `15000`, with **zero index errors** (confirms both OQ-2 and the "no composite index needed" claim in one test).
- `sum("amounts.subtotalMinor")` on a `comped` order correctly returned `14500` (the pre-discount subtotal), never the order's `totalMinor: 0`.
- A different-`eventId` order (`99999` minor units) never leaked into the sum — tenancy scoping holds for aggregate queries exactly as it does for regular queries.
- A filter matching zero orders (`paymentStatus: "outstanding"`, none seeded) summed to `0` (a JS `number`), never `null`/`undefined` — no null-coalesce needed at any call site.

**Conclusion: OQ-2 resolved positively.** No denormalized top-level field, no fallback count-and-read-and-reduce path was needed. `AggregateField.sum()` treats a dotted string exactly as `where()` does — both resolve through the same `FieldPath.fromArgument()` dot-splitting in `@google-cloud/firestore` (the library firebase-admin re-exports), so this is expected to hold for any nested field path in this SDK line, not just the two used here.

**(b) In-repo test double (`src/__tests__/helpers/fake-admin-db.ts`).** Extended the existing fake Firestore double — already used by every admin DAL test in this repo — with an `.aggregate(spec)` method that interprets **real** `AggregateField` instances (the same objects the production DAL code constructs via `AggregateField.count()`/`AggregateField.sum(field)`), not a stand-in class: it reads `field.aggregateType` (`"count"` / `"sum"`) and `field._field` (the raw string/`FieldPath` passed to `.sum(...)`) directly off the real firebase-admin object, so `src/lib/db/adminOrder.ts`'s tests exercise the exact call shape production code builds. This keeps the fast unit-test suite (`vitest`, no emulator dependency) able to cross-check aggregate-sum correctness on every CI run, while (a) above is the one-time empirical proof for OQ-2 itself.

The emulator was torn down after verification (`pkill -f "firebase emulators:start"`) — this repo's test suite does not depend on a running emulator; `vitest` uses the in-memory fake exclusively, matching every other admin DAL test.

## 4. Query patterns and indexes — summary table

| Query | Method | Filters (all equality, no `orderBy`) | Index |
|---|---|---|---|
| Registrations per ticket type | `countAdminAttendeesForEvent` | `eventId`, `organizationId`, `status`, `ticketTypeId` | none — index merging (empirically confirmed) |
| "No ticket type" bucket | `countAdminAttendeesForEvent` (`ticketTypeId: null`) | same, `ticketTypeId == null` | none |
| Paid / Outstanding money sum | `sumAdminOrderTotalsForEvent` (`field: "totalMinor"`) | `eventId`, `organizationId`, `paymentStatus`, `currency` | none — index merging (empirically confirmed) |
| Comped value money sum | `sumAdminOrderTotalsForEvent` (`field: "subtotalMinor"`) | same shape | none |
| Currency enumeration | `getAdminRegistrationPathsForEvent` (existing, unchanged) | `eventId`, `organizationId`, `orderBy sortOrder` | existing composite (`RegistrationPath: eventId ASC, organizationId ASC, sortOrder ASC`), unaffected |
| Discount codes used | `getAdminEventPromotionsForEvent` (existing, unchanged) | `organizationId` (subcollection scoped by `eventId` path) | existing, unaffected |

**`firestore.indexes.json`: zero changes in this ticket** (spec §3 AC-1) — verified via `git diff firestore.indexes.json` (empty) and the emulator test in §3(a), which is the strongest possible confirmation that the 4-equality-filter shapes above need no composite index (an emulator query against an unindexed compound shape fails loudly with `FAILED_PRECONDITION`, which did not occur).

## 5. Read/write access rules

No change to `firestore.rules` in this ticket — both `Attendee` and `Order` are already server-only, deny-all-to-clients collections (M5/M2 conventions, unchanged); these two new/extended DAL functions are additional **admin-SDK read shapes** over existing collections, not a new collection and not a new client-reachable surface. Every caller goes through Full-Stack's `reports/page.tsx`, which per spec §7 gates on session → `getDashboardScope()` (org membership) only — no `write:events` gate, since this is a pure read surface (spec §7's deliberate divergence from the M1–M6 mutating-route convention, already reviewed and accepted at the spec layer, not a DAL concern).

## 6. Divergences / notes for the Full-Stack slice

- **No DAL-level batching helper was added** for "count once per ticket type" or "sum once per currency" — both spec §3 and the Gap analysis frame this as the report loader's `Promise.all` responsibility, and Full-Stack's `load-ticket-type-registrations.ts` / `load-finance-summary.ts` (already written in parallel, reviewed against these signatures during Implement) do exactly that. Keeping the DAL a single-query primitive matches every other aggregate method in this codebase (`countAdminAttendeesForEvent`'s pre-existing shape, `countAdminEmailMessagesForEvent`).
- **`sumAdminOrderTotalsForEvent`'s `field` parameter is required, not defaulted.** This is a deliberate choice given spec §2's whole point is that picking the wrong field (`totalMinor` for a comped order) silently produces a plausible-looking wrong answer ($0 instead of the real comped value) rather than an error — a required parameter forces every call site to state its intent.
- **Both new/extended DAL functions were verified against Full-Stack's already-written call sites** (`src/features/reports/server/load-finance-summary.ts`, `load-ticket-type-registrations.ts`, written in parallel per the M7-T1 dispatch) via `tsc --noEmit`: both compile cleanly against the signatures shipped here with no call-site changes needed on Full-Stack's side.
- **Tests:** `src/__tests__/admin-attendee.test.ts` (new `describe` block for the `ticketTypeId` filter: per-ticket-type counts including zero, the null bucket vs. omitted-filter distinction, cancelled-attendee exclusion, cross-org/cross-event isolation, a 200-attendee/5-ticket-type brute-force cross-check per spec §3 AC-3, and a zero-full-document-read assertion per spec §1 AC-7) and `src/__tests__/admin-order-finance-sums.test.ts` (new file: paid/outstanding sums, the comped-sums-subtotal-not-total assertion for both comp paths, pending/failed exclusion, currency non-blending, cross-org/cross-event isolation, zero-orders → 0, and a zero-full-document-read assertion per spec §3 AC-4). `src/__tests__/helpers/fake-admin-db.ts` gained `.aggregate()` support and a `queryDocReads` counter (both additive, no existing test behavior changed) to make these assertions possible.
