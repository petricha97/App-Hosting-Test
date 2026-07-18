# M8-T3 — Event Overview Data Model

Backend Agent, 2026-07-19. Covers the event-overview loader and the two new
DAL reads specified by `agents/docs/specs/m8-event-overview.md`.

## 1 — Collections Read

The overview does not introduce stored fields or collections. It reads the
owned `EventDoc` supplied by the route and these existing event-scoped roots:

| Collection | Overview use | Scope |
|---|---|---|
| `Attendee` | accepted registration count | `eventId`, `organizationId`, `status` |
| `EmailMessage` | sent invitation count | `eventId`, `organizationId`, `kind`, `status` |
| `Order` | paid `amounts.totalMinor`, once per configured currency | `eventId`, `organizationId`, `paymentStatus`, `currency` |
| `RegistrationDraft` | strict-more-than-24-hours abandoned count | `eventId`, `organizationId`, `updatedAt < cutoff` |
| `RegistrationPath` | currency, active-path, and payment-method derivation | `eventId`, `organizationId` |
| `EventPage`, `Form`, `TicketType`, `Fee`, `EmailDefinition`, `CheckinConfig` | six-item readiness prerequisites | existing tenant/event patterns; deterministic config reads verify tenancy |

No raw registration-draft PII crosses the DAL boundary; only an aggregate
number is returned. Completed registration drafts are deleted by the existing
finalization flow, so document existence represents incompleteness.

## 2 — New DAL Surface

```ts
function countAdminAbandonedRegistrationDraftsForEvent(input: {
  eventId: string;
  organizationId: string;
  nowMs?: number;
}): Promise<number>
```

Computes `cutoff = Timestamp.fromMillis((nowMs ?? Date.now()) - 24h)` and uses
Firestore `count()` with `updatedAt < cutoff`. The strict comparison means a
draft idle for exactly 24 hours is not abandoned.

```ts
function hasAdminCheckinConfigForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<boolean>
```

Reads deterministic document `CheckinConfig/{eventId}` and returns true only
when it exists and its stored `organizationId` matches. In-memory defaults do
not count as saved configuration.

## 3 — Loader Contract

```ts
function loadEventOverview(input: {
  event: WithId<EventDoc>;
  eventId: string;
  organizationId: string;
}): Promise<EventOverviewData>
```

The loader calls only DAL functions. Metrics and readiness prerequisites are
settled concurrently. Shared path data fans into identity, Revenue currency
enumeration, and confirmation-email readiness; a rejected path read degrades
all dependent results without becoming an empty path list. Revenue is either
unconfigured, a stable currency-code-sorted list of paid minor-unit totals, or
a load error. It never adds currencies together.

Readiness always has six ordered entries. Missing documents produce pending
states; rejected reads produce unknown states. Event publication remains known
from the ownership-resolved event.

## 4 — Readiness Derivations

1. Event status is exactly `Published`.
2. Default/redirect page mode needs no custom page; custom mode requires a
   published default `EventPage`.
3. A `Form` exists with status `published`.
4. At least one returned ticket is referenced by an active returned fee.
5. Active card/comp/none paths require `confirmation-paid`; invoice requires
   `confirmation-payment-due`; zero active paths requires both. Every required
   effective definition must be enabled.
6. A tenant-matching `CheckinConfig` document exists.

## 5 — Index Finding

No `firestore.indexes.json` change was made.

What was empirically verified locally:

- The exact abandoned filter semantics (`eventId ==`, `organizationId ==`,
  `updatedAt < cutoff`) execute in the owned DAL test's range-capable in-memory
  Admin Firestore harness.
- Exactly 24 hours is excluded, 24 hours plus 1 ms is included, and other-org
  and other-event rows do not leak.
- The deterministic check-in existence read was verified for missing, owned,
  and cross-org documents.

Limitation of the repository test double:

- `src/__tests__/helpers/fake-admin-db.ts` currently implements `==`, `in`, and
  `array-contains`, but throws for the new `<` operator. It also does not model
  Firestore index selection or missing-index errors. Therefore this environment
  cannot empirically prove production composite-index sufficiency through that
  shared fake, and no live Firestore emulator was run.

Index inference:

- The repository already declares a `RegistrationDraft` composite index on
  `eventId ASC, organizationId ASC, updatedAt DESC` for the existing bounded
  list query. Firestore can scan that indexed `updatedAt` field for a range
  aggregate without requiring the query to specify an `orderBy`; equality
  fields precede the range field in the existing composite.
- The new query adds no second range, array, cursor, or incompatible ordering.
  The existing composite is therefore expected to serve it. A live emulator or
  deployed Firestore missing-index response remains the authoritative check.
- `CheckinConfig/{eventId}` is a direct document read and requires no index.

## 6 — Tests

| File | Covers |
|---|---|
| `src/__tests__/m8-event-overview-dal.test.ts` | strict abandoned boundary, completed/deleted exclusion, event/org isolation, check-in existence and cross-org mismatch |
| `src/__tests__/m8-event-overview-loader.test.ts` | exact metric/identity shapes, all six readiness rules true and false, default/redirect page modes, dependency degradation, Revenue fan-out failure isolation |
