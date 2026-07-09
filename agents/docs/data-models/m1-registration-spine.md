# M1 Data Model — Registration Types + Ticket Types

Backend Agent, 2026-07-10. Implements `agents/docs/specs/m1-registration-spine.md` under the conventions of `agents/docs/data-models/baseline.md`. Source of truth: `src/types/collection.ts` + `src/lib/db/{registrationType,adminRegistrationType,ticketType,adminTicketType,registrationCode}.ts` + `firestore.indexes.json`.

## Collections

Two new **root collections**, PascalCase singular, auto IDs, canonical `organizationId` + `eventId` tenancy (no legacy `organizationPath` — server routes resolve the event via `adminEvent` and stamp the caller's org id).

### `RegistrationType`

```ts
interface RegistrationTypeDoc {
  organizationId: string;          // canonical tenant key
  eventId: string;                 // -> Event doc id
  name: string;                    // 1–80 chars (route Zod)
  code: string;                    // UPPERCASE, ^[A-Z0-9][A-Z0-9/-]{1,11}$, unique per event (this collection)
  capacity: number | null;         // null = Unlimited; else integer >= 1 (0 invalid)
  registeredCount: number;         // SERVER-OWNED counter, 0 at create
  createdAt / updatedAt: Timestamp | FieldValue;  // serverTimestamp()
}
```

### `TicketType`

```ts
interface TicketTypeDoc {
  organizationId: string;
  eventId: string;
  name: string;                    // 1–80 chars (route Zod)
  code: string;                    // same rules, unique per event WITHIN TicketType only
  capacity: number | null;
  registeredCount: number;         // SERVER-OWNED counter, 0 at create
  salesStart: Timestamp | null;    // UTC; event-local date 00:00:00.000 (EventDoc.timezone)
  salesEnd: Timestamp | null;      // UTC; event-local date 23:59:59.999
  isOpen: boolean;                 // manual master switch, default true
  registrationTypeIds: string[];   // eligible RegistrationType ids, deduped; [] = unrestricted
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

## Relationships

- `TicketType.registrationTypeIds[] -> RegistrationType.id` (same event, same org). **Empty array = unrestricted** — the ticket is eligible for every registration type. Filter semantics ("show tickets for type T" = contains T OR empty) are computed client-side over the bounded list page; an `array-contains` query cannot express the OR-empty branch.
- Both collections reference `Event` by `eventId`; no field on `Event` changed. Route authz path: session -> active org -> `getAdminEventForOrganization(eventId, orgId)` -> 404 if null, then query/write these collections with that verified pair.
- Displayed "Open" for a ticket is **derived, never stored**: `isOpen && (salesStart == null || now >= salesStart) && (salesEnd == null || now <= salesEnd)` — pure function in `src/features/registration/` (fullstack dev), evaluated at render.

## Denormalization / counter ownership

- `registeredCount` is a denormalized counter, **not** a query-time aggregate. M1 writes it exactly once (0 at create) and never again. M2-T4 / M3-T3 increment it with `FieldValue.increment(±1)` **inside the same transaction** that finalizes or cancels an order/registration, keyed by the registration's type/ticket — one source of truth, display can never exceed reality.
- Server-owned fields (`organizationId`, `eventId`, `registeredCount`, `createdAt`) are structurally unwritable through the repos: create builds the doc from an explicit field list; update builds from an allow-list (`name`, `code`, `capacity` [+ `salesStart`, `salesEnd`, `isOpen`, `registrationTypeIds` for tickets]) and always bumps `updatedAt`. Anything else the caller passes is dropped.
- `code` is normalized (`trim().toUpperCase()`) on every write and every lookup via `normalizeRegistrationCode` (`src/lib/db/registrationCode.ts`, pure module — safe for client, server, and Zod schemas; also exports `REGISTRATION_CODE_PATTERN`). Since stored codes are always uppercase, the `eventId + code` equality query is effectively case-insensitive.

## Delete rules — BLOCK, never cascade

- **RegistrationType delete** succeeds only when (a) no `TicketType` in the event references it (`getAdminTicketTypesReferencingRegistrationType` — returns the blocking tickets so the route's 409 can name them) and (b) `registeredCount === 0`. Cascading would silently widen ticket eligibility (removing the last restriction turns a ticket unrestricted) and orphan future fees/paths.
- **TicketType delete** succeeds only when `registeredCount === 0`; otherwise 409. Hard delete. M2 must extend the block to tickets referenced by fees.
- Enforcement point is the API route (it owns the 409 response); the repos supply the check queries and plain hard-delete methods.

## Query patterns and indexes

| Query | Repo method (admin / client) | Index |
|---|---|---|
| `eventId == AND organizationId == ORDER BY createdAt ASC LIMIT 50` | `getAdminRegistrationTypesForEvent` / `getRegistrationTypesForEvent` | composite #1 below |
| `eventId == AND code == LIMIT 2` (uniqueness, excludeId on edit) | `isAdminRegistrationTypeCodeTaken` / `isRegistrationTypeCodeTaken` | composite #2 |
| `eventId == AND organizationId == ORDER BY createdAt ASC LIMIT 50` | `getAdminTicketTypesForEvent` / `getTicketTypesForEvent` | composite #3 |
| `eventId == AND code == LIMIT 2` | `isAdminTicketTypeCodeTaken` / `isTicketTypeCodeTaken` | composite #4 |
| `eventId == AND organizationId == AND registrationTypeIds array-contains X LIMIT 20` | `getAdminTicketTypesReferencingRegistrationType` / `getTicketTypesReferencingRegistrationType` | composite #5 |
| doc get by id + in-memory event/org match (IDOR-safe null) | `get*ForEvent` variants | n/a |

Registered in `firestore.indexes.json` (all `COLLECTION` scope):

1. `RegistrationType`: `eventId ASC, organizationId ASC, createdAt ASC`
2. `RegistrationType`: `eventId ASC, code ASC`
3. `TicketType`: `eventId ASC, organizationId ASC, createdAt ASC`
4. `TicketType`: `eventId ASC, code ASC`
5. `TicketType`: `eventId ASC, organizationId ASC, registrationTypeIds CONTAINS`

Notes: #2/#4 (pure equality pairs) and #5 (equalities + single array-contains) are the kinds of shapes Firestore can sometimes serve by single-field index merging, but merging is best-effort on zig-zag joins; registering the composites makes the plans deterministic and is required in the same change as the queries per baseline convention. #1/#3 (equality + equality + orderBy) strictly require their composites.

- **Bounded reads:** list methods take `limit` (default `*_LIST_LIMIT = 50`) — a safety bound, not pagination (per-event lists are small in M1; add cursors if that changes). Uniqueness checks `limit(2)`; reference check `limit(20)` (enough names for the 409 message).
- **No in-memory tenant filtering:** `organizationId` is in the `where()` on every list/reference query (baseline R4).

## Read/write access rules

- **Authoritative path is server-only:** all dashboard CRUD goes through admin API routes using `adminRegistrationType.ts` / `adminTicketType.ts` after event->org verification (404 on cross-org, IDOR-safe `null` from the scoped getters). Any org member may CRUD in M1; role gating lands M8-T1.
- Client repos (`registrationType.ts`, `ticketType.ts`) mirror the method set per repo-pair convention. When `firestore.rules` lands (baseline R8/M8-T1), rules must scope both collections to org members and make `registeredCount`, `organizationId`, `eventId`, `createdAt` immutable from the client.
- Route-level validations the DAL deliberately does NOT own (they need cross-doc context): code uniqueness 409/field error, `capacity >= registeredCount`, `salesEnd >= salesStart`, `registrationTypeIds` membership in the same event (validate against `getAdminRegistrationTypesForEvent`), and both delete blocks.
