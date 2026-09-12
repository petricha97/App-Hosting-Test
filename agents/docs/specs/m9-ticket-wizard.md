# M9-T1 — Create Ticket wizard (Registration Type + Ticket Type + Fee, in one flow)

Research Lead, 2026-08-24. First M9 ticket — `agents/docs/BACKLOG.md` runs M0–M8 (all Done); this file does not renumber or touch any existing milestone.

**Problem:** creating one priced, audience-scoped ticket today requires three separate screens/creates: Registration Types → Ticket Types → Pricing → Fees. This ticket adds a single 3-step wizard that produces the same three Firestore writes (one `RegistrationType` possibly created inline, one `TicketType`, N `Fee` rows) with one atomic final save. **Create only** — editing an existing ticket's audience/price stays on the existing Ticket Types + Pricing screens (out of scope, unchanged).

**Grounded against:** `src/app/api/dashboard/events/[eventId]/registration-types/route.ts`, `src/app/api/dashboard/events/[eventId]/tickets/route.ts`, `src/lib/db/adminRegistrationType.ts`, `src/lib/db/adminTicketType.ts`, `src/lib/db/adminFee.ts`, `src/lib/db/adminBase.ts`, `src/features/registration/schemas.ts`, `src/features/registration/types.ts`, `src/features/registration/utils.ts`, `src/features/registration/server/route-scope.ts`, `src/features/registration/server/registration-type-membership.ts`, `src/features/pricing/schemas.ts`, `src/features/pricing/utils.ts`, `src/features/pricing/components/fee-dialog.tsx`, `src/features/registration/components/{ticket-type-dialog,registration-type-dialog,ticket-types-workspace}.tsx`, `src/types/collection.ts`, `src/__tests__/{ticket-types-route,registration-types-route}.test.ts`.

---

## 0. Currency — open question resolved with a recommendation (no event-level field exists)

Grepped the codebase for any "event default currency" concept: **none exists**. `EventDoc` (`src/types/collection.ts`) has no `currency` field. Every existing currency selection (Fee dialog, Tax dialog) is a per-row `Select` over `SUPPORTED_CURRENCIES = ["USD","GBP","EUR","SGD"]`, defaulting the *form* to `"USD"` (`fee-dialog.tsx buildDefaultValues`) — that's a UI default, not a stored per-event value. `RegistrationPathDoc.currency` is the closest thing to a "the event's currency" concept, but paths are created *after* tickets/fees and there can be several paths with different currencies (one per audience × payment method), so it cannot be read as an input here.

**Recommendation (locked for this spec):** the wizard has **no currency picker in v1**. Every `Fee` the wizard creates uses a fixed constant, `WIZARD_DEFAULT_CURRENCY = "USD"` (matches the existing Fee-dialog default), defined once in the new wizard module and passed explicitly on every created `Fee` row — same field, same `Currency` type, nothing new on `EventDoc`. Organizers who need a second currency for the same ticket still add it the old way, on the full Pricing → Fees screen (unchanged). This is a product-level simplification, not a technical constraint — if multi-currency-at-creation is wanted later, it is a new ticket (adds a currency `Select` to Step 2/3 and threads it through the payload), not a schema change to what's shipped here.

---

## 1. Screen references

- `prototype/prototype/event-registration-types.html` — Step 1/2 borrows the reg-type row shape (name, code, capacity) for the inline quick-add mini-form.
- `prototype/prototype/event-tickets.html` — Step 1 borrows the ticket fields (name, code, capacity, sales window, isOpen) and is the screen the wizard is launched from (new "Create ticket" primary action, additive to the existing "+ Create ticket type" which keeps working for the old single-entity flow — see open question OQ-1 below).
- `prototype/prototype/event-pricing.html` (Fees tab) — Step 2's inline price column and Step 3's review reuse the Fees table's price-cell conventions (`Comp` for 0, currency-formatted otherwise).

No new prototype HTML exists for a 3-step wizard — this is new-to-M9 UI; the UI/UX Designer produces the actual step-by-step layout spec next. This document defines the *behavior and contract*, not pixel layout.

---

## 2. Flow shape (confirmed, not re-litigated)

- **Step 1 — Ticket details:** name, code, capacity toggle + value, sales start/end, isOpen. Identical field set to the existing `ticketTypeFormSchema` minus `registrationTypeIds` (that moves to Step 2, now coupled to price).
- **Step 2 — Audience + price:** a table of the event's `RegistrationType` rows (fetched once when the wizard opens), each row = include-checkbox + inline price input (major units, `WIZARD_DEFAULT_CURRENCY` only, symbol-prefixed like the Fee dialog). Checking a row makes its price input **required** (client-side; see AC-9). Includes an inline "+ New registration type" mini-form (name, code, capacity toggle) that **POSTs to the existing, unmodified** `/api/dashboard/events/[eventId]/registration-types` route the instant "Add" is clicked — a real, immediately-committed write, not deferred to the wizard's final submit (confirmed user decision — see §5).
- **Step 3 — Review:** read-only summary of Step 1 + every checked row's name/code/price, then **one submit** to the new atomic route.

**Design decision (this spec, stated explicitly):** the table in Step 2 lists only *real* `RegistrationType` rows — there is no "All registration types" sentinel row (that concept belongs to `Fee.registrationTypeId === null`, a Fee-level modeling choice, not a registration-type entity). Consequently `TicketType.registrationTypeIds` on the ticket this wizard creates is **always derived server-side** from the checked/priced rows, never sent as a separately-trusted array — see §3 "Why no client-supplied `registrationTypeIds`" for the reasoning. The `prices[].registrationTypeId: string | null` contract still allows `null` for forward compatibility with the Fee model (a future "All types" row could ship without a breaking payload change), but v1 UI never emits it.

---

## 3. New route contract — `POST /api/dashboard/events/[eventId]/tickets/with-pricing`

New file, sibling to the existing `.../tickets/route.ts` and `.../tickets/[ticketTypeId]/route.ts`. Next.js resolves a static segment (`with-pricing`) preferentially over a sibling dynamic segment (`[ticketTypeId]`) at the same path depth, so `POST /tickets/with-pricing` never gets swallowed by the `[ticketTypeId]` route — this is the standard, already-safe Next.js precedence rule, not something this ticket has to work around. **The existing `POST /tickets` route is untouched** — it stays the create/edit target for any caller that isn't this wizard (there is none today, but the M1 spec's "edit stays on the old screen" contract depends on `/tickets` PATCH continuing to exist unchanged, and PATCH is out of scope here entirely).

### 3.1 Request payload (Zod)

New schema module (placement rationale in §7): a *superset* of `ticketTypePayloadSchema` minus `registrationTypeIds`, plus `prices`.

```ts
export const ticketWithPricingPayloadSchema = z
  .object({
    // Identical to ticketTypePayloadSchema's own fields/messages — same
    // entityNameSchema / registrationCodeSchema / capacitySchema, and a
    // locally-rebuilt calendar-date schema using the EXPORTED
    // SALES_DATE_PATTERN + isRealCalendarDate (mirrors how pricing/schemas.ts
    // already rebuilds its own calendarDateSchema rather than importing the
    // registration module's private one — avoids a circular import, §7).
    name: entityNameSchema,
    code: registrationCodeSchema,
    capacity: capacitySchema,
    salesStart: calendarDateSchema, // same shape/messages as ticketTypePayloadSchema.salesStart
    salesEnd: calendarDateSchema,
    isOpen: z.boolean(),
    prices: z
      .array(
        z.object({
          // null reserved for a future "All registration types" row (Fee
          // parity) — v1 UI never sends null; a non-null id must belong to
          // this event (re-verified inside the transaction, §4).
          registrationTypeId: z.string().min(1).nullable(),
          // Same integer-minor-units contract as Fee.basePriceMinor: >= 0,
          // <= MAX_PRICE_MINOR (imported from pricing/schemas.ts). 0 is a
          // valid, deliberate "Comp" price — see AC-8.
          basePriceMinor: z.number().int().min(0).max(MAX_PRICE_MINOR),
        }),
      )
      // Same ceiling as ticketTypePayloadSchema.registrationTypeIds — one
      // price row per eligible registration type, same reasoning (bounds
      // both the payload and the per-id membership reads in §4).
      .max(MAX_TICKET_REGISTRATION_TYPES, REGISTRATION_TYPE_SELECTION_MESSAGE)
      .default([]),
  })
  .refine(
    (v) => !v.salesStart || !v.salesEnd || v.salesEnd >= v.salesStart,
    { message: SALES_WINDOW_ORDER_MESSAGE, path: ["salesEnd"] },
  )
  .refine(
    // Reject duplicate registrationTypeId entries (including two `null`s) —
    // the wizard UI can never produce this (one row per registration type),
    // but the payload is client-controlled, so the route must not silently
    // accept/collapse a tampered duplicate into two Fee docs for the same
    // combination (AC-6).
    (v) => {
      const keys = v.prices.map((p) => p.registrationTypeId ?? "\0null");
      return new Set(keys).size === keys.length;
    },
    { message: "Each registration type can only be priced once", path: ["prices"] },
  );
```

Server-owned fields (`registeredCount`, `organizationId`, `eventId`, timestamps, and — deliberately — `registrationTypeIds` itself) are absent from this schema; Zod strips unknown keys by default, matching every other M1/M2 payload schema's convention.

**Why no client-supplied `registrationTypeIds`:** if the payload carried both a `registrationTypeIds: string[]` *and* `prices[].registrationTypeId`, the two could disagree (a checked-but-unpriced row, or a priced row somehow unchecked) and the route would have to pick a winner or reject the mismatch. Deriving `registrationTypeIds` as `dedupe(prices.map(p => p.registrationTypeId).filter(id => id !== null))` removes that whole class of bug by construction — the ticket's eligibility list and its priced audiences are the same array, always, for tickets created by this route. (A ticket later edited on the old Ticket Types screen can still diverge them, same as today — that's an existing, unrelated capability, not a regression.)

### 3.2 Response

`200 { ticketTypeId: string; feeIds: string[] }` — `feeIds` in the same order as the request's `prices` array (empty array when `prices` was empty). Mirrors the existing `{ ticketTypeId }` / `{ registrationTypeId }` single-id response convention, extended with the list the caller needs to link straight to the Pricing screen if it wants to.

### 3.3 Validation order (route body, before the transaction)

1. `resolveRegistrationRouteScope(eventId)` — session → org → `write:events` → org-owned event. 401/403/404, identical to every sibling route.
2. `ticketWithPricingPayloadSchema.safeParse(body)` — 400 with `{ error: parsed.error.flatten() }` on failure (includes the sales-window-order and duplicate-registrationTypeId refinements above).
3. **Optional fast-fail pre-check** (recommended, not required for correctness): call the existing `findUnknownRegistrationTypeIds` helper (`src/features/registration/server/registration-type-membership.ts`, unmodified) against the deduped non-null ids *outside* the transaction, to 400 quickly on an obviously-bad id without paying for opening a transaction. This is purely a latency optimization — it is **not** a substitute for the in-transaction re-check in §4, because a registration type can be deleted between this pre-check and the transaction's own read (TOCTOU).
4. Sales-date → UTC conversion via the existing `eventLocalDateToUtcMs` / `resolveEventTimeZone` helpers (`src/features/registration/utils.ts`, unmodified) — pure, no DB, same as the existing `/tickets` route.
5. Enter the transaction (§4).

### 3.4 Error cases (exhaustive)

| Case | Status | Body |
|---|---|---|
| No session | 401 | `{ error: "Missing session" }` |
| No org scope / missing `write:events` | 403 | `{ error: "Missing write:events permission" }` |
| Event missing or cross-org | 404 | `{ error: "Event not found" }` |
| Zod failure (bad name/code/capacity/dates, price out of range, >25 price rows, duplicate `registrationTypeId`) | 400 | `{ error: parsed.error.flatten() }` (duplicate-id case: `error.formErrors` carries the custom message at `path: ["prices"]`) |
| `salesEnd < salesStart` | 400 | `{ error: <flattened>, fieldErrors: { salesEnd: ["Sales end must be on or after sales start."] } }` — identical message/shape to the existing `/tickets` route |
| One or more `prices[].registrationTypeId` do not belong to this event (pre-check or in-tx) | 400 | `{ error: "One or more selected registration types do not belong to this event", field: "prices" }` — same message text as the existing `/tickets` route's `registrationTypeIds` case, `field` repointed to `"prices"` since that's where the id lives in this payload |
| Ticket code already used in this event (case-insensitive) | 409 | `{ error: "Code already in use", field: "code" }` — identical to the existing `/tickets` and `/registration-types` 409 shape |
| Negative or non-integer `basePriceMinor`, or `> MAX_PRICE_MINOR` | 400 | Zod `fieldErrors` under `prices` (element-level) |
| Empty `prices` array | **200, allowed** | See AC-8 — this is the deliberate "free/TBD ticket" case, not an error |
| Firestore transaction contention / internal failure | 500 | `{ error: "Failed to create the ticket" }` (repo convention: unhandled internal errors are never surfaced with stack traces to the client — same posture as every other mutating route) |

---

## 4. Transaction contract (the atomic save)

One `adminDb.runTransaction(async (tx) => { ... })` call. Firestore transactions require **every read before any write** in the same transaction — this dictates the internal ordering below; it is not a style choice.

### 4.1 Reads (all before any write)

1. **Ticket-code uniqueness**, read fresh inside the transaction (not the plain `isAdminTicketTypeCodeTaken` helper, which does its own un-transactional `.get()` — that helper is fine for the *optional* pre-check in §3.3 step 3, but the authoritative check must be read inside this transaction to close the race): `tx.get(ticketTypeCol().where("eventId","==",eventId).where("code","==",normalizedCode).limit(2))`.
2. **Registration-type membership**, re-read per unique non-null id in the payload (mirrors `findUnknownRegistrationTypeIds`'s per-id-scoped-get discipline, but via `tx.get(registrationTypeCol().doc(id))` since transactional reads must go through the transaction handle, not a plain query helper): confirm the doc exists **and** `doc.eventId === eventId && doc.organizationId === organizationId`. Any id that fails either check is "unknown" (missing and foreign are indistinguishable, same IDOR-safe convention as every other M1 membership check).

**No Fee-uniqueness read is needed.** This is a deliberate, load-bearing design point: `isAdminActiveFeeCombinationTaken` exists to stop a *second* fee from duplicating an *existing* ticket's `(ticketTypeId, registrationTypeId, currency)` combination. Here the `ticketTypeId` does not exist until this same transaction commits — no `Fee` document anywhere in Firestore can already reference an id that has never been allocated, so the uniqueness invariant holds by construction for every fee this transaction creates (uniqueness *within* the payload itself is instead enforced by the Zod duplicate-id refine in §3.1, which is sufficient — the class of race this DAL check normally guards against, "someone else priced this exact combination between your read and your write," cannot happen for a not-yet-existing ticket).

### 4.2 Decision point (after both reads resolve, before any write)

- Code taken → abort the transaction (return a discriminated failure value, do **not** throw past the transaction into an uncaught 500 — mirror the existing `AdminTicketTypeMutationResult` / `AdminFeeMutationResult` pattern in `adminTicketType.ts` / `adminFee.ts`: `{ ok: false, code: "CODE_TAKEN" }`).
- Any unknown registration-type id → abort, `{ ok: false, code: "UNKNOWN_REGISTRATION_TYPE", ids: string[] }`.
- Otherwise proceed to writes.

### 4.3 Writes (only after every read + the decision point above)

1. `const ticketRef = ticketTypeCol().doc();` (reserve an auto-id ref — transactions cannot use `.add()`, matching the existing `updateAdminTicketType`/`deleteAdminTicketType` transactional-ref pattern already in `adminTicketType.ts`).
2. `tx.set(ticketRef, { organizationId, eventId, name, code: normalizedCode, capacity, registeredCount: 0, salesStart: toSalesTimestamp(...), salesEnd: toSalesTimestamp(...), isOpen, registrationTypeIds: dedupedNonNullIdsFromPrices, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })` — same field list/types as `createAdminTicketType`'s existing `TicketTypeDoc` write.
3. For each entry in `prices` (in array order): `const feeRef = feeCol().doc(); tx.set(feeRef, { organizationId, eventId, name: generateWizardFeeName(ticketName, registrationTypeName-or-"All types", WIZARD_DEFAULT_CURRENCY), ticketTypeId: ticketRef.id, registrationTypeId, currency: WIZARD_DEFAULT_CURRENCY, basePriceMinor, status: "active", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })`.
4. Return `{ ok: true, ticketTypeId: ticketRef.id, feeIds: [...] }`.

**Fee name generation (new, small helper needed):** the wizard collects no free-text "fee name" field — Step 2 is only a checkbox + price per row. `Fee.name` is a required 1–80 char field (`entityNameSchema`), so the route must synthesize one. Recommend mirroring the existing Fee-dialog placeholder convention exactly: `"${ticketName} — ${registrationTypeName} (USD)"`, deterministically truncated to 80 chars if the concatenation would exceed it (truncate the *ticket/reg-type name portion*, never drop the trailing `(USD)` — the currency suffix is what makes two same-named fees on the same ticket distinguishable in the Fees table). This needs its own small pure helper + unit tests (truncation boundary, non-ASCII names, both names empty-string-adjacent edge cases already excluded by `entityNameSchema.min(1)` upstream).

### 4.4 Failure / rollback

Firestore transactions are all-or-nothing by construction: if `tx.set` is never called (decision point returns a failure code before step 4.3) or the transaction is aborted for any reason (including a concurrent conflicting write causing an automatic retry that then re-observes a now-taken code), **nothing is written** — not the ticket, not any fee. There is no partial state to clean up and no compensating-transaction logic needed; this is exactly why the user specified a real transaction over a plain batch (`WriteBatch` has no read capability, so it cannot re-validate before writing).

The route maps the transaction's return value to HTTP status *after* `await runTransaction(...)` resolves — `CODE_TAKEN` → 409 (§3.4), `UNKNOWN_REGISTRATION_TYPE` → 400 (§3.4), a thrown/rejected transaction (Firestore internal error, exhausted retries) → 500.

---

## 5. Inline "+ New registration type" quick-add (Step 2)

**Confirmed: reuses the existing `POST /api/dashboard/events/[eventId]/registration-types` route unmodified.** No new endpoint, no new DAL method. `createAdminRegistrationType` / `isAdminRegistrationTypeCodeTaken` (`src/lib/db/adminRegistrationType.ts`) are untouched.

- **UI-side fields:** name, code, capacity toggle + value — the exact same three fields as `RegistrationTypeDialog`'s form (`registrationTypeFormSchema` / `buildRegistrationTypePayload`, `src/features/registration/schemas.ts`), reused as-is rather than re-implemented, per the repo's existing "shared Zod schema between dialog and route" convention.
- **On "Add":** `POST` fires immediately (not deferred to Step 3's final submit) — a real, committed `RegistrationType` document exists the instant this succeeds, independent of whatever happens to the rest of the wizard afterward. This is the confirmed, deliberate design (§2, §6 edge case E-1).
- **Error handling:** reuse the existing `applyApiFormError` helper (`src/features/registration/components/form-errors.tsx`, already used identically by `RegistrationTypeDialog` and `FeeDialog`) so a 409 duplicate-code response (`{ error: "Code already in use", field: "code" }`) surfaces as a field-level error under the mini-form's code input — the same visual/UX pattern as every other create dialog in this app, not a bespoke toast-only error. A 400 Zod failure (bad code format, name too long) likewise maps field errors onto the mini-form via the same helper.
- **On success:** append the new row to the Step 2 table's in-memory list (constructed client-side from the response `registrationTypeId` + the fields just submitted, matching `SerializedRegistrationType`'s shape — `registeredCount: 0`, `capacity` as submitted), auto-check its include-checkbox, and focus its price input. No full-page refresh/navigation — this is a step inside a client-side dialog/modal, not the standalone Registration Types page.
- **Uniqueness scope:** code uniqueness is checked against the *whole event's* `RegistrationType` collection (existing route behavior, unchanged) — not just the rows currently visible in the wizard's Step 2 table, so a code collision with a type created outside the wizard (e.g., by a teammate, in another tab) is still correctly caught.

---

## 6. States & edge cases (QA test list)

1. **E-1 — Wizard abandoned after inline-creating a registration type.** Close the wizard (or navigate away) any time after a successful quick-add in Step 2. Expected: the created `RegistrationType` is a normal, permanent row — it appears on the real Registration Types screen with `registeredCount: 0`, is fully editable/deletable there under the existing delete-BLOCK rules (blocked only if later referenced by a ticket/fee/path, unaffected by this abandoned wizard session), and is indistinguishable from a type created directly on that screen. This was the user's original motivating question — confirmed intentional, not a bug to fix.
2. **Duplicate ticket code** — entered in Step 1, only discovered at Step 3 submit (the route is the sole source of truth; Step 1 does not pre-check uniqueness live). Expected: 409, `field: "code"`, wizard returns the user to Step 1 with the code field showing the error (do not silently return to Step 3 with a generic toast — the error is actionable only on Step 1's input).
3. **Duplicate registration-type code entered inline (quick-add 409).** Expected: field-level error on the mini-form's code input (§5), mini-form stays open for correction, no partial row added to the Step 2 table, rest of the wizard state (already-checked rows, Step 1 values) untouched.
4. **Zero registration types selected in Step 2** (nothing checked, `prices: []`). Expected: **allowed** (AC-8) — creates a ticket with `registrationTypeIds: []` (today's existing "unrestricted, unpriced" state, same as directly using the old `/tickets` create dialog and never visiting Pricing) and zero `Fee` docs. The ticket appears on Ticket Types with Price `"—"` linking to Pricing, exactly as it does today for any ticket with no fees.
5. **A row checked, price left blank.** Client-side only — Step 2 must block advancing to Step 3 (or block Step 3's submit button) while any checked row's price input is empty/invalid, because the wire contract has no way to represent "included but unpriced" (§2 design decision — `prices` entries are always both id *and* price together). This is a **required client-side validation**, not enforced by the route (the route only ever sees fully-formed `prices` entries).
6. **Zero-priced (Comp) row, `basePriceMinor: 0`.** Expected: allowed (AC-8), creates an `active` Fee with `basePriceMinor: 0`, renders "Comp" everywhere the existing `formatFeePrice` convention already applies (Fees tab, Ticket Types Price column) — no special-casing needed in this route, it's the existing Fee display convention.
7. **Capacity toggle off (unlimited).** `capacity: null` on the created ticket — identical to today's ticket dialog behavior; unaffected by anything price-related.
8. **Sales dates left blank.** `salesStart`/`salesEnd: null` — ticket always "Open" per the existing `getSalesWindowLabel`/`isTicketOpen` derivation (unmodified, reused as-is).
9. **Sales dates set, `salesEnd < salesStart`.** 400 at Step 1's own client validation (mirrors `ticketTypeFormSchema`'s existing superRefine) and again server-side (Zod refine in §3.1) if somehow bypassed.
10. **A registration type is deleted by someone else between Step 2 (row shown/checked) and Step 3 submit.** Expected: the in-transaction re-check (§4.1 step 2) catches this — 400, `"One or more selected registration types do not belong to this event"`, `field: "prices"`. Wizard should return the user to Step 2 with the now-invalid row flagged/unchecked (best-effort — exact UI handling is the UI/UX Designer's call, but the *contract* guarantees the route never silently drops the invalid row into a stale price).
11. **>25 registration types priced in one wizard session.** 400, same `REGISTRATION_TYPE_SELECTION_MESSAGE` ceiling the existing ticket route already enforces (`MAX_TICKET_REGISTRATION_TYPES = 25`) — reused, not duplicated.
12. **Double-submit / network retry on Step 3.** No idempotency key in this contract (unlike `Order`, which uses a deterministic doc id specifically because public double-submits are a real, documented risk). This is an authenticated admin action behind a disabled-while-submitting button (same convention as every other create dialog in this app — `isSubmitting` disables the submit button). A genuine double-fire (e.g., a flaky network causing a client-side retry) would attempt to create a *second* ticket with the *same code* — the second call legitimately 409s on code uniqueness (§4.1 step 1), which is the correct, safe outcome (no duplicate ticket, no duplicate fees), just not a silently-idempotent one. Flagged as an accepted gap, not a defect — matches this repo's existing `/tickets` and `/registration-types` routes, neither of which is idempotent either.
13. **`write:events` missing (viewer-permission member).** 403 before any read — identical gate to every sibling route (`resolveRegistrationRouteScope` default `requireWriteEvents: true`).
14. **Cross-org / foreign event id.** 404 — `getAdminEventForOrganization` returns null, IDOR-safe, same convention as every sibling route.
15. **Event has zero registration types at all when the wizard opens.** Step 2's table is empty except the "+ New registration type" quick-add — same `InfoNote`-style guidance the existing `TicketTypeDialog` already shows when `registrationTypes.length === 0` (reuse that copy/pattern rather than inventing new UI language).

---

## 7. File list (for the changes doc to check implementation against)

### New files

- `src/features/ticket-wizard/schemas.ts` — `ticketWithPricingPayloadSchema` + the wizard-only form schemas (Step 1/2/3 RHF shapes) + `buildTicketWithPricingPayload`. **New feature folder, not added to `src/features/registration/schemas.ts` or `src/features/pricing/schemas.ts`** — it needs constants from *both* (`entityNameSchema`/`registrationCodeSchema`/`capacitySchema`/`SALES_DATE_PATTERN`/`isRealCalendarDate`/`MAX_TICKET_REGISTRATION_TYPES` from registration; `PRICE_MESSAGE`/`MAX_PRICE_MINOR`/`PRICE_MAX_MESSAGE` from pricing), and `pricing/schemas.ts` already imports *from* `registration/schemas.ts` — a new module importing from `registration/schemas.ts` back into `pricing/schemas.ts` would be circular. A fresh leaf module avoids that without touching either existing file's import graph.
- `src/app/api/dashboard/events/[eventId]/tickets/with-pricing/route.ts` — the new `POST` handler (§3).
- `src/lib/db/adminTicketType.ts` — **modified, not new** (see below) — add the transactional create-with-fees function; alternatively a new `src/lib/db/adminTicketWithPricing.ts` if Backend prefers not to grow `adminTicketType.ts` past its current size (either is acceptable; note the choice in the implementation PR since this spec doesn't mandate one).
- `src/features/ticket-wizard/components/create-ticket-wizard.tsx` (+ sibling step components: `step-details.tsx`, `step-audience-pricing.tsx`, `step-review.tsx`, `registration-type-quick-add.tsx`) — the 3-step dialog/flow itself. Exact decomposition is the UI/UX Designer's + Full-Stack's call; listed here only so Backend/Full-Stack know this is new UI, not an extension of `ticket-type-dialog.tsx`.
- `src/lib/fees/wizard-fee-name.ts` (or similar) — the `generateWizardFeeName` truncation helper (§4.3), pure/no Firebase import, unit-testable in isolation like `src/features/registration/utils.ts`'s date helpers.
- `src/__tests__/tickets-with-pricing-route.test.ts` — route-level tests mirroring `ticket-types-route.test.ts`'s mocking conventions (mock `next/headers`, `auth-utils`, `adminUser`, `adminEvent`, `adminRegistrationType`, `adminTicketType`, `adminFee`/or the new transactional module).

### Modified files

- `src/features/registration/components/ticket-types-workspace.tsx` — add the new "Create ticket" entry point (button/menu item) alongside the existing "+ Create ticket type" CTA (see OQ-1 below for whether the old CTA is kept, relabeled, or demoted).
- `src/lib/db/adminTicketType.ts` and/or `src/lib/db/adminFee.ts` — house the new transactional function (`createAdminTicketTypeWithFees` or similar) per whichever placement Backend picks; both files' existing exports (`createAdminTicketType`, `createAdminFee`, all uniqueness/membership helpers) stay **unmodified** — the new function is additive, reusing their existing collection-ref helpers (`ticketTypeCol()`/`feeCol()` are currently module-private `function` declarations in each file — Backend will need to either export them or duplicate the one-liner `adminDb.collection(X)` call in the new module; duplicating is simpler and matches this repo's existing tolerance for that pattern, e.g. `registrationTypeCol()`/`ticketTypeCol()`/`feeCol()` are already three near-identical private helpers, one per file).
- `agents/docs/BACKLOG.md` — add the `M9-T1` row (Milestone `M9`, Status `Todo`) and an `## M9 — Create Ticket wizard` section header; **no existing row renumbered or edited**.

### Explicitly untouched (verified by reading, not assumed)

- `src/app/api/dashboard/events/[eventId]/tickets/route.ts` (existing POST/edit target — PATCH lives in the sibling `[ticketTypeId]/route.ts`, also untouched)
- `src/app/api/dashboard/events/[eventId]/registration-types/route.ts`
- `src/lib/db/adminRegistrationType.ts`
- `src/features/registration/schemas.ts`, `src/features/registration/types.ts`, `src/features/registration/utils.ts`
- `src/features/pricing/schemas.ts`, `src/features/pricing/utils.ts`, `src/features/pricing/components/fee-dialog.tsx`
- `src/types/collection.ts` (no new fields on `TicketTypeDoc`/`FeeDoc`/`RegistrationTypeDoc` — this ticket writes existing shapes only)

---

## 8. Acceptance criteria

1. `POST /api/dashboard/events/[eventId]/tickets/with-pricing` exists as a new file; the existing `POST /api/dashboard/events/[eventId]/tickets` route's file, behavior, and tests are unmodified (regression: `ticket-types-route.test.ts` passes unchanged).
2. Request validated by `ticketWithPricingPayloadSchema`: ticket fields identical to `ticketTypePayloadSchema` (minus `registrationTypeIds`); `prices` is an array of `{ registrationTypeId: string | null; basePriceMinor: number }`, max 25 entries, no duplicate `registrationTypeId` (including duplicate `null`s), `basePriceMinor` integer 0 ≤ n ≤ `MAX_PRICE_MINOR`.
3. Auth/tenancy gate identical to every sibling route: 401 no session, 403 missing `write:events`, 404 cross-org/missing event — via the unmodified `resolveRegistrationRouteScope`.
4. Ticket-code uniqueness (case-insensitive, per event) is re-checked **inside** the transaction, not only via an outer pre-check; a duplicate returns 409 `{ error: "Code already in use", field: "code" }` and creates neither the ticket nor any fee.
5. Every non-null `prices[].registrationTypeId` is re-verified **inside** the transaction to belong to the same event + org; any unknown/foreign/deleted id returns 400 `{ error: "One or more selected registration types do not belong to this event", field: "prices" }` and creates neither the ticket nor any fee.
6. On success, exactly one `TicketType` doc and exactly `prices.length` `Fee` docs are created, all inside one Firestore transaction — verified by a test asserting `tx.set` is called `1 + prices.length` times and that a forced failure after the reads (e.g. a code-taken retry) results in **zero** documents existing (no partial ticket, no partial fees).
7. `TicketType.registrationTypeIds` on the created doc equals the deduplicated non-null `registrationTypeId`s from `prices`, in no particular required order (set-equality, not the request's array order) — never a client-supplied array of eligibility ids independent of `prices`.
8. `prices: []` is a valid submission (not a validation error) and creates a ticket with `registrationTypeIds: []` and zero `Fee` docs — the "free/TBD, price later" case. `basePriceMinor: 0` in an entry is likewise valid and creates an `active` Fee that renders "Comp" via the existing `formatFeePrice` convention (no new display logic).
9. Every created `Fee` has `status: "active"`, `currency: WIZARD_DEFAULT_CURRENCY` ("USD"), a server-generated `name` within `entityNameSchema`'s 1–80 char bound (never a raw, unbounded concatenation), and `ticketTypeId` equal to the newly-created ticket's id.
10. No `isAdminActiveFeeCombinationTaken`-style uniqueness read happens for the created fees (§4.1) — verified by a test asserting that DAL/mock is never called from this route, documenting the "brand-new ticketTypeId can't already have a fee" invariant so a future refactor doesn't accidentally reintroduce a redundant (and subtly wrong, since it'd run against a not-yet-committed id) check.
11. The inline "+ New registration type" quick-add issues a real `POST` to the existing, byte-for-byte unmodified `/registration-types` route the instant "Add" succeeds — verified by a test/inspection that no new registration-type endpoint or DAL function was added. A resulting 409 (duplicate code) surfaces as a field-level error on the mini-form via the existing `applyApiFormError` convention.
12. A `RegistrationType` created via the inline quick-add is a normal, permanent row from the instant of creation — abandoning the wizard afterward does not delete it, hide it, or mark it differently from a type created directly on the Registration Types screen (E-1, §6).
13. Response on success is `200 { ticketTypeId: string; feeIds: string[] }`, `feeIds.length === prices.length`, order-matched to the request's `prices` array.
14. `salesEnd < salesStart` is rejected both client-side (Step 1, mirroring `ticketTypeFormSchema`) and server-side (§3.1 refine), with the identical message text `SALES_WINDOW_ORDER_MESSAGE` already used by the existing ticket route/schema (no new copy).
15. Every acceptance criterion above has a corresponding automated test in `src/__tests__/tickets-with-pricing-route.test.ts` (route-level, DAL mocked at the module boundary, same convention as `ticket-types-route.test.ts`) plus DAL-level transaction tests for AC-6/AC-10 wherever the new transactional function lives.

---

## 9. Gap analysis

**Exists today (reused unmodified):** `RegistrationType`/`TicketType`/`Fee` DAL and routes (M1-T1, M1-T2, M2-T1), `resolveRegistrationRouteScope`, `findUnknownRegistrationTypeIds`, sales-window UTC conversion helpers, `applyApiFormError`, the Fee display conventions (`formatFeePrice`, `getTicketPriceDisplay`), `RegistrationTypeDialog`'s form/payload for the quick-add's field reuse.

**Missing entirely (this ticket builds):** the combined Zod payload schema, the new atomic route, the transactional "ticket + N fees" DAL function, the 3-step wizard UI + its own feature folder, the wizard-fee-name generator, the new entry point on the Ticket Types screen.

**Explicit non-goals / deferred:** editing an existing ticket's audience/price through the wizard (stays on Ticket Types + Pricing, unchanged); multi-currency at creation time (§0 — `WIZARD_DEFAULT_CURRENCY` fixed to `"USD"`, no `Select`); idempotency-key-based double-submit protection (§6 edge case 12, matches existing sibling routes' posture, not a regression); any change to `TicketTypeDoc`/`FeeDoc`/`RegistrationTypeDoc` shapes (all writes use existing fields only — no migration needed).

---

## 10. Open questions (for Design/Orchestrator, not blocking spec completeness)

- **OQ-1:** does the new "Create ticket" wizard entry point *replace* the existing "+ Create ticket type" button on `ticket-types-workspace.tsx`, or do both coexist (e.g., wizard as primary CTA, old dialog demoted to a "Create ticket type only" secondary/menu action for organizers who explicitly want the old unpriced flow)? This spec assumes **coexistence** (§7 file list: "alongside the existing CTA") because nothing in the background instructions says to remove the old dialog, and removing it would also remove the only way to create a ticket with zero registration-type table interaction at all (e.g., bulk-scripted setups). UI/UX Designer should confirm the exact placement/copy.
- **OQ-2 (minor):** whether `adminTicketType.ts` or a new `adminTicketWithPricing.ts` (or `adminFee.ts`) houses the transactional function — flagged in §7 as Backend's call, not pinned here, since it's a file-organization preference with no behavioral consequence.
