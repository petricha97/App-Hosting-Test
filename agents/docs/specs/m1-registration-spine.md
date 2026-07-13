# M1 — Registration Data Spine (Registration Types + Ticket Types)

Research Lead, 2026-07-10. Screens: `prototype/prototype/event-registration-types.html`, `prototype/prototype/event-tickets.html`. Conventions per `agents/docs/data-models/baseline.md`. Routes already stubbed as ComingSoon at `src/app/dashboard/(event)/events/[eventId]/registration-types/page.tsx` and `.../tickets/page.tsx` — build there, not the flat paths in BACKLOG.md.

## Shared decisions (both entities)

- **Collections:** new root collections `RegistrationType` and `TicketType`, PascalCase singular, auto IDs, fields `organizationId: string` + `eventId: string` + `createdAt`/`updatedAt` (`serverTimestamp()`). Do **not** copy Event's legacy `organizationPath`; new docs use canonical `organizationId`. Server routes resolve the event via `adminEvent` (which handles the 5-format `organizationPath` candidates) and stamp the caller's org id.
- **Indexes (register with the DAL change):** `RegistrationType`: `eventId ASC, organizationId ASC, createdAt ASC`. `TicketType`: same. List queries are event-scoped with org in the `where()` (no in-memory tenant filtering — see baseline R4), ordered by `createdAt ASC` (stable table order matching prototype's curated ordering), `limit` + cursor per baseline R2 policy (default 50).
- **Capacity:** `capacity: number | null`; `null` renders "Unlimited". When numeric: integer ≥ 1. `0` is invalid (use the open flag / delete instead).
- **Registered count:** `registeredCount: number`, required, defaults `0` at create, **read-only in M1** (no UI to edit, API ignores/rejects client-supplied values). It is a denormalized counter, not a query-time aggregate: M2-T4/M3-T3 increment it inside the same transaction that finalizes an order/registration (decrement on cancellation), keyed by the registration's type/ticket. This spec fixes the field name + semantics now so later milestones don't invent a second source of truth. Display never exceeds reality because M1 writes nothing to it.
- **Code format:** required; stored uppercase; regex `^[A-Z0-9][A-Z0-9/-]{1,11}$` (2–12 chars, letters/digits/hyphen/slash — slash reserved for comp variants like `DEL-COMP`, `/C`, `/S` seen in pricing). Input auto-uppercased. **Unique per event within its own collection**, case-insensitive; enforced server-side at create/update by querying `eventId + code` before write (add `eventId ASC, code ASC` composite per collection). A reg-type code and a ticket code may collide (e.g. `PRESS`, `CREW` appear in both in the prototype) — uniqueness is per collection, not global.
- **Permissions:** all admin API routes require an authenticated session whose active org owns the event (verify event → org before any read/write; 404 on cross-org IDs, never 403-leak existence). Any org member may CRUD in M1; per-role gating (Viewer read-only etc.) lands M8-T1 — leave a `// TODO(M8-T1)` at the auth check.
- **States (both screens):** loading = table-shaped skeleton rows under the real toolbar; error = inline retryable error panel in the table region (shell stays interactive); permission-denied/cross-org = route-level 404. Empty states below per screen. Note banners render always, including empty state.

## M1-T1 Registration Types (`event-registration-types.html`)

Who the attendee is (Delegate GC Online/Offline, Guest VIP, Press, Crew, Media Partner…). Join key for pricing (M2), paths (M3), badges/check-in (M5), emails (M6).

**Entity:** `{ organizationId, eventId, name: string (1–80, required), code, capacity, registeredCount, createdAt, updatedAt }`.

**User stories**
- As an event organizer, I define registration types with a code and optional capacity so later pricing/paths/badges can key off them.
- As an event organizer, I see how many people registered under each type (0 for now).
- As an event organizer, I cannot delete a type that tickets depend on, so I don't silently break ticket eligibility.

**Screen:** note banner ("Why separate from tickets?" copy per prototype), table columns exactly: **Registration type | Code | Capacity | Registered** (+ trailing row-actions column: Edit / Delete — prototype omits actions; we need them for CRUD). Topbar `+ Create type`. No search/filter on this screen in the prototype — keep it a plain table. Create/edit via dialog (name, code, capacity with an "Unlimited" toggle).

**Acceptance criteria**
1. Table lists the event's registration types with columns Registration type, Code (mono), Capacity, Registered, ordered by `createdAt` asc.
2. `capacity: null` renders "Unlimited"; numeric capacity renders the number.
3. Create dialog validates: name required (≤80 chars), code required + matches format regex, capacity either Unlimited or integer ≥ 1; Zod on client and server.
4. Code is auto-uppercased on input; submitting a code already used by another registration type in this event fails server-side with a field-level "Code already in use" error (case-insensitive).
5. New types persist with `registeredCount: 0`; the create/update APIs reject or strip client-supplied `registeredCount`.
6. Edit updates name/code/capacity; code uniqueness re-checked excluding self; `updatedAt` bumps.
7. Reducing capacity below current `registeredCount` is rejected server-side ("Capacity cannot be below registered count") — trivially satisfiable in M1 (count is 0) but must be enforced for later milestones.
8. Delete shows a confirm dialog; succeeds only when no `TicketType` in this event references the type **and** `registeredCount === 0`; otherwise the API returns 409 with a message naming the blocking tickets (block, never cascade — cascading would silently widen ticket eligibility and orphan future fees/paths).
9. Empty state: icon + "No registration types yet" + explainer line + "+ Create type" CTA; note banner still visible.
10. All routes 404 for events outside the caller's org and for unauthenticated requests (redirect/401 per existing dashboard API convention); typeId belonging to a different event/org also 404s (IDOR).
11. Composite indexes `eventId+organizationId+createdAt` and `eventId+code` exist in `firestore.indexes.json` in the same change as the queries.
12. Mutations revalidate the list (no stale table after create/edit/delete); loading skeleton and retryable error state render per the shared states above.

## M1-T2 Ticket Types / Admission Items (`event-tickets.html`)

What the attendee registers as. One registration type can buy several tickets (tiers: super early / early / standard).

**Entity:** `{ organizationId, eventId, name (1–80, required), code, capacity, registeredCount, salesStart: Timestamp | null, salesEnd: Timestamp | null, isOpen: boolean (default true), registrationTypeIds: string[] (default []), createdAt, updatedAt }`.

**Relationship decision — `registrationTypeIds: string[]`, empty = unrestricted.** The prototype filter's default option is "All registration types" and comp/crew tickets plausibly apply broadly; a multi-select of eligible types with "empty means everyone" matches Cvent Admission Items (admission items are made available to selected registration types, default all) and keeps M1 usable before paths exist. Filter semantics: selecting type T shows tickets where `registrationTypeIds` contains T **or** is empty (unrestricted tickets are eligible for T too). Implemented as client-side filtering over the fetched page — an `array-contains` query cannot express the OR-empty branch.

**Sales window + Open display.** Stored `isOpen` is the organizer's manual master switch; the **Open column shows the derived state**: `derivedOpen = isOpen && (salesStart == null || now >= salesStart) && (salesEnd == null || now <= salesEnd)`. Boundaries inclusive at both ends. Dates are picked as calendar dates interpreted in the **event's timezone** (`EventDoc.timezone`): salesStart stored as that date 00:00:00.000, salesEnd as 23:59:59.999 event-local, persisted as UTC `Timestamp`s — so "until Jul 31" stays open through Jul 31 anywhere, matching the prototype rows (`GC-EB` until Jul 31 → Yes; `GC-ST` from Aug 1 → No; `GC-SEB` Closed → No). Derivation is pure-function `getTicketOpenState(ticket, now)` in `src/features/registration/` with unit tests; evaluated at render (server) — no scheduled job flips flags. Sales-window cell text: both null → "Open"; ended (`now > salesEnd`) → "Closed"; not started (`now < salesStart`) → "from {salesStart}"; open with end → "until {salesEnd}"; open with only start → "Open". Dates formatted "MMM D" in event timezone (with year when ≠ current year).

**Screen:** note banner ("New concept vs your current single-form model…" per prototype), toolbar = search input ("Search tickets…") + registration-type select ("All registration types" + the event's actual reg types by name) + count badge, table columns exactly: **Ticket | Code | Price | Registered | Capacity | Sales window | Open** (+ row actions Edit/Delete). Price column renders "—" in M1 with a tooltip/link "Set in Pricing (coming in M2)" — fees don't exist yet; do not store price on the ticket. Open renders as badge: green "Yes" / neutral "No". Footer/badge count: badge "N tickets"; when filters reduce the set, footer "Showing M of N" (prototype shows both).

**Acceptance criteria**
1. Table lists the event's tickets with the 7 prototype columns in order; Price is "—" (deferred to M2), Open is a derived badge, ordered by `createdAt` asc.
2. Create/edit dialog fields: name, code, capacity (Unlimited toggle / int ≥ 1), sales start date (optional), sales end date (optional), open switch (default on), eligible registration types multi-select (default none selected = "All registration types", labeled as such). Zod client+server.
3. Code rules identical to reg types (format, auto-uppercase, per-event case-insensitive uniqueness within `TicketType`), incl. field-level duplicate error and self-exclusion on edit.
4. `salesEnd` date earlier than `salesStart` date is rejected ("Sales end must be on or after sales start"); equal dates are valid (single-day window).
5. `derivedOpen` truth table holds (unit-tested): manual flag off → No regardless of window; flag on + no dates → Yes; flag on + `now` before start → No; at/after start same event-local day → Yes; through 23:59:59.999 event-local on end date → Yes; after → No. Boundary tests pinned to a non-UTC event timezone.
6. Sales-window cell renders per the mapping above (Open / Closed / "until {date}" / "from {date}") in the event's timezone.
7. `registrationTypeIds` entries are validated server-side to be registration types of the same event; unknown/foreign IDs rejected.
8. Search filters by name or code, case-insensitive substring; reg-type filter applies contains-or-empty semantics; both compose (AND).
9. Badge shows total ticket count; when search/filter hides rows, "Showing M of N" appears; with no filters M = N and the footer may collapse to the badge alone.
10. `registeredCount` starts 0, is server-owned (same rules as AC-5/7 of M1-T1, incl. capacity ≥ registeredCount on edit).
11. Deleting a ticket: confirm dialog; blocked (409) when `registeredCount > 0`; otherwise hard delete. (M2 must extend the block to tickets referenced by fees.)
12. Deleting a registration type referenced in any ticket's `registrationTypeIds` is blocked (this is M1-T1 AC-8's enforcement point — the check lives in the reg-type delete route querying `TicketType` via `array-contains`).
13. Empty state (no tickets): note banner + toolbar hidden or disabled, icon + "No ticket types yet" + explainer + "+ Create ticket type" CTA. Filtered-empty (N > 0, M = 0): "No tickets match your filters" + clear-filters action — distinct from true empty.
14. AuthZ identical to M1-T1 AC-10 (org ownership, IDOR on eventId/ticketId); indexes registered per shared decisions.
15. Loading/error states per shared section; mutations revalidate list and count badge.

## Gap analysis

- Nothing exists: no `registrationType`/`ticketType` DAL, types in `src/types/collection.ts`, feature module, or API routes. Both dashboard routes render `ComingSoonSection` (`src/app/dashboard/(event)/events/[eventId]/{registration-types,tickets}/page.tsx`) — replace their bodies.
- `src/features/registration/` is a new module; copy patterns from `src/features/event/` + promotion dialogs (RHF + Zod + shadcn Dialog).
- Event docs carry `timezone` already (baseline) — reuse for AC-5/6; no schema change to Event.
- Prototype's "early-bird closes automatically, standard opens next" is fully covered by per-ticket windows evaluated at read time; no cross-ticket "auto-open next tier" linkage is specced (organizer sets adjacent windows manually). Revisit only if M2 pricing demands tier chaining.
- Deferred out of M1: Price column data (M2-T1 fees), any increment of `registeredCount` (M2-T4/M3-T3), role-gated permissions (M8-T1), public-facing ticket visibility (M3-T2/T3).
