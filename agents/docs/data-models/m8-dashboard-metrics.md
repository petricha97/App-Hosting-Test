# M8-T2 Data Model — Workspace Dashboard Metrics

Backend Agent, 2026-07-19. Implements the Backend slice of `agents/docs/specs/m8-dashboard-metrics.md` sections 4 and 5, plus the UI data contract in `agents/docs/design/m8-dashboard-metrics.md` section 11.

This slice adds org-scoped aggregate/read primitives for the workspace Overview cards and one orchestration loader. It does not change `EventDoc`, Firestore rules, or `firestore.indexes.json`.

## 1 — Collections Read

No new collection is introduced.

| Collection | Purpose | Query |
|---|---|---|
| `Attendee` | Registrations card | `organizationId == input.organizationId`, optional `status == "accepted"`, aggregate `count()` |
| `Order` | Revenue card paid total per currency | `organizationId == input.organizationId`, `paymentStatus == "paid"`, `currency == selectedCurrency`, aggregate `sum("amounts.totalMinor")` |
| `RegistrationPath` | Revenue card currency enumeration | `organizationId == input.organizationId`, bounded list read, no `orderBy` |
| `Event` | Draft/Published counts and quick action target | No new query; caller passes the already-loaded sorted event list |

`EventDoc` still has `organizationPath` rather than canonical `organizationId`, so this ticket deliberately avoids new Event aggregate queries.

## 2 — New DAL Surface

```ts
function countAdminAttendeesForOrganization(input: {
  organizationId: string;
  status?: AttendeeStatus;
}): Promise<number>
```

Counts org-wide attendees via Firestore `count()`. The dashboard calls it with `status: "accepted"`.

```ts
function sumAdminOrderTotalsForOrganization(input: {
  organizationId: string;
  paymentStatus: PaymentStatus;
  currency: Currency;
  field: "totalMinor" | "subtotalMinor";
}): Promise<number>
```

Sums one org-wide `Order.amounts.*` minor-unit field for one payment status and currency. The dashboard calls it with `paymentStatus: "paid"` and `field: "totalMinor"`.

```ts
function getAdminRegistrationPathsForOrganization(input: {
  organizationId: string;
  limit?: number;
}): Promise<WithId<RegistrationPathDoc>[]>
```

Enumerates org-wide registration paths for currency discovery only. Default safety limit is `ORGANIZATION_REGISTRATION_PATH_LIST_LIMIT = 200`.

## 3 — Loader Contract

```ts
function loadWorkspaceSummary(input: {
  organizationId: string;
  events: WithId<EventDoc>[];
}): Promise<WorkspaceSummary>
```

`WorkspaceSummary` is shaped for the dashboard UI:

```ts
interface WorkspaceSummary {
  draftCount: number;
  publishedCount: number;
  registrations: { value: number } | { loadError: true };
  revenue:
    | { kind: "zero-currency" }
    | { kind: "single"; currency: Currency; paidMinor: number }
    | {
        kind: "multi";
        primaryCurrency: Currency;
        primaryPaidMinor: number;
        otherCurrencies: Array<{ currency: Currency; paidMinor: number }>;
      }
    | { loadError: true };
  quickActionEvent: WithId<EventDoc> | null;
}
```

Draft and Published are counted in memory from `events`. `quickActionEvent` is `events[0] ?? null`, relying on the caller’s existing `getAdminEventsForOrganization` ordering.

Registrations and Revenue run through `Promise.allSettled`, so one aggregate failure becomes only that card’s `{ loadError: true }` result.

## 4 — Currency Rule

The Revenue card enumerates currencies from org-wide `RegistrationPath` docs.

Primary currency is the currency with the most registration path docs. Ties are broken alphabetically by currency code. Paid order totals are then fetched once per distinct currency. Multi-currency output never blends totals across currencies.

If the org has zero registration path docs, the loader returns `{ kind: "zero-currency" }` and does not query `Order`.

## 5 — Index Finding

No new composite index entry was added for M8-T2.

What was empirically verified:

- The three new query shapes execute successfully against this repository’s local Firestore test double in `src/__tests__/helpers/fake-admin-db.ts`.
- The attendee and order helpers use aggregate APIs (`count()` / `aggregate().get()`) and transfer zero full documents in the local test double (`fake.queryDocReads === 0`).
- Two-org fixtures verify tenant isolation for all three new query shapes.

What was not empirically verified:

- I did not run these queries against a live Firestore emulator in this environment.

Index inference:

- All three M8-T2 query shapes are equality-only filters with no `orderBy`, range filter, cursor, or array operator. Firestore’s automatic single-field indexes cover these shapes without a composite index.
- The `Order` aggregate uses the same nested `AggregateField.sum("amounts.<field>")` pattern already documented and emulator-confirmed for M7-T1; M8-T2 only removes the `eventId ==` equality filter.
- `RegistrationPath` org enumeration is a single `organizationId ==` filter plus `limit`, with no ordering.

If a future dashboard metric adds a range or ordered dimension, such as “registrations this week” via `createdAt >= ...`, that is a new query shape and should be indexed deliberately in that ticket.

## 6 — Tests

| File | Covers |
|---|---|
| `src/__tests__/m8-dashboard-dal.test.ts` | Org-wide attendee count, org-wide paid order sum, org-wide registration path enumeration, two-org isolation, aggregate-only read path for count/sum |
| `src/__tests__/m8-dashboard-orchestration.test.ts` | Loader contract for single-currency, multi-currency, zero-currency, primary currency tie-break, and independent settled failures |
