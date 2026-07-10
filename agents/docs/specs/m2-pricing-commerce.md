# M2 — Pricing & Commerce (Fees, Discounts, Taxes, Orders)

Research Lead, 2026-07-10. Screens: `prototype/prototype/event-pricing.html` (all 4 tabs); orders feed `event-overview.html` / `event-reports.html` later. Conventions per `agents/docs/data-models/baseline.md` + `m1-registration-spine.md`. Open-question defaults locked in: **Q1 = simulated payment provider behind an interface**, **Q5 = manual per-currency fee rows, no FX conversion**. Pricing route is stubbed ComingSoon at `src/app/dashboard/(event)/events/[eventId]/pricing/page.tsx` — build there.

## Shared decisions

- **Money is integer minor units everywhere.** No floats in stored amounts or math. `type Currency = "USD" | "GBP" | "EUR" | "SGD"` (extensible constant + `CURRENCY_MINOR_DIGITS` map — all 2 for the initial set; 0-decimal currencies like JPY are out of scope until added to the map). Display formatting uses `Intl.NumberFormat` with the currency's symbol (`$750.00`, `£780.00`).
- **Rounding: half-up, per currency, at each derivation step** (discount amount, then each tax line). `roundHalfUp(numerator, denominator)` implemented in integer math (no `Math.round` on floats), unit-tested including exact-.5 cases (e.g. 10% of 105 minor units = 10.5 → 11).
- **Application order (fixed):** fee base price → discount → taxes. Precisely, for one order: `subtotal = fee.basePriceMinor`; `discount = min(subtotal, computedDiscount)` where percentage `computedDiscount = roundHalfUp(subtotal × pct, 100)` and fixed `computedDiscount = discountValue × 10^minorDigits` interpreted **in the order's currency** (no FX — a £600 code applied to a USD fee deducts $600; organizers scope codes to the right currency, flagged in UI copy); `taxableBase = subtotal − discount`; each percentage tax line = `roundHalfUp(taxableBase × rateMilliPercent, 100000)`, each fixed tax line applies only when its currency matches the order's; `taxTotal = Σ lines`; `total = taxableBase + taxTotal`. Service fees do not participate in M2 (entity stubbed, tab is empty state).
- **New root collections** `Fee`, `Tax`, `Order` (PascalCase singular, auto IDs except Order — see T4), canonical `organizationId` + `eventId`, `createdAt`/`updatedAt` via `serverTimestamp()`, repo pairs (`fee.ts`/`adminFee.ts`, `tax.ts`/`adminTax.ts`, `order.ts`/`adminOrder.ts`), bounded list reads (limit 50), org id always in the `where()`.
- **Permissions (established convention, per M1 security H-1):** every mutating route enforces `write:events` from `userDoc.permissions` (403 with the standard message) after session → org → `getAdminEventForOrganization` (404 cross-org, IDOR-safe). Reads require session + org ownership of the event. Order finalize is server-only; **no client-trusted amounts anywhere** — the finalize route ignores any client-supplied prices/totals and recomputes inside the transaction.
- **States (all tabs):** tab shell (4 tabs) always renders; loading = skeleton rows per tab; error = inline retryable panel inside the tab; cross-org/unauthed = 404/401 per convention. Tab switching preserves each tab's loaded state. Empty states per tab defined below.

## M2-T1 — Fees + Pricing screen shell (`event-pricing.html`, Fees tab)

A **Fee attaches a price to a ticket, per registration type and currency**. Prototype rows show the point: `GC-EB × Delegate × USD = $950.00` and `GC-EB × Delegate × GBP = £780.00` are two separate fee rows for the same ticket; `NGC-EB × Delegate × USD = $1,450.00` prices a different audience.

**Entity `Fee`:** `{ organizationId, eventId, name (1–80, required), ticketTypeId (required, must belong to event), registrationTypeId: string | null (null = all registration types; else must belong to event), currency: Currency, basePriceMinor: number (integer ≥ 0), status: "active" | "archived", createdAt, updatedAt }`.

- **Uniqueness:** at most one **active** fee per `(eventId, ticketTypeId, registrationTypeId-or-null, currency)` — enforced server-side by pre-write equality query (register composite `eventId + ticketTypeId + registrationTypeId + currency + status`; store `registrationTypeId: null` explicitly so the equality works). Archived fees never block. A null-regType ("All types") fee and a specific-regType fee for the same ticket+currency may coexist; resolution rule (fixed now, used by T4/M3): **specific regType fee wins over the "All types" fee**.
- **Comp conventions:** `basePriceMinor === 0` renders **"Comp"** wherever a fee price displays (Fees tab, ticket Price column, order summary) — never "$0.00". The `/C` (client comp) `/S` (staff comp) suffix convention lives in **codes** (ticket or discount codes like `HARVEYAI/C100`); the M1 code regex already permits `/`. No comp enum — display keys on 0.
- **Screen:** Pricing page = event-bar header + 4 tabs **Fees / Discounts / Taxes / Service Fees** (this ticket ships the shell + Fees tab; T2/T3 fill the rest; until then those tabs show their designed empty states). Fees table columns exactly: **Fee name | Ticket | Registration type | Base price | Status** (+ row actions Edit/Archive/Delete). Ticket cell = ticket **code** (mono, joined from `TicketType`); Registration type cell = name or "All types". Topbar `+ Create` scoped to the active tab (on Fees → create fee). Create/edit dialog: name, ticket select, registration-type select (first option "All registration types"), currency select, price input in major units (parsed to minor, 2dp max), status.

**Acceptance criteria**
1. Fees tab lists the event's fees with the 5 prototype columns, ordered `createdAt` asc; prices formatted per currency; `basePriceMinor 0` renders "Comp".
2. Create validates (Zod client+server): name 1–80; ticketTypeId + optional registrationTypeId belong to this event (server-checked, foreign IDs rejected); currency in the enum; price a non-negative amount with ≤ 2 decimals, stored as integer minor units.
3. Creating/editing a fee that would duplicate an existing **active** `(ticket, regType-or-null, currency)` combination fails server-side with a field-level "A fee for this ticket, registration type and currency already exists" (self excluded on edit).
4. Archived fees: excluded from uniqueness, shown with "Archived" badge (list still shows them), never selectable by order finalize (T4 rejects archived feeId).
5. Delete: hard delete allowed only when no `Order` references the fee, else 409 directing to Archive. (Enforced from T4 onward; in T1 the check trivially passes.)
6. Ticket-type delete (M1) is extended: blocked with 409 naming fees when any Fee references the ticket; same for registration-type delete when a fee pins that regType.
7. Empty state: icon + "No fees yet" + explainer ("A fee attaches a price to a ticket — per registration type / currency") + `+ Create fee` CTA.
8. Tabs shell: 4 tabs render with Fees active by default; Discounts/Taxes show their empty states until T2/T3 land; Service Fees shows its designed empty state (T3).
9. Mutations require `write:events` (403 otherwise); all routes 404 cross-org/unknown eventId or feeId (IDOR).
10. Composite indexes registered with the change: `Fee eventId+organizationId+createdAt` (list) and `Fee eventId+ticketTypeId+registrationTypeId+currency+status` (uniqueness).
11. Mutations revalidate the tab; loading/error states per shared section.
12. M1 tickets screen Price column upgrades from "—" to the fee-derived display: single active fee → that price; multiple (currencies/regTypes) → lowest price + "+N more" tooltip; zero → "Comp"; none → "—" linking to Pricing.

## M2-T2 — Discounts tab (promotions integration)

**No new entity.** The Discounts tab is a second read surface over `Event/{eventId}/EventPromotion` — the same docs managed by the existing event promotions screen and org-level `promotions.html` templates. One write path, one source of truth.

**Gap: existing `EventPromotionDoc` vs. prototype discount columns**

| Prototype column | Exists today? | Action |
|---|---|---|
| Name, Code | `name`, `promoCode`/`enablePromoCode` | none |
| Amount / % | `discountType` (string), `discountValue` | none (render `10%` vs `£600.00` by type; 100% renders as `100%`) |
| Level (Event/Partner) | ✗ | add `level: "event" \| "partner"` (default `"event"`) |
| Valid (`→ Aug 31`) | ✗ | add `validityStart: Timestamp \| null`, `validityEnd: Timestamp \| null` (event-timezone day bounds, same storage rule as M1 sales windows) |
| Used (`1 / 3`) | ✗ | add `usageCap: number \| null` (null = uncapped, else int ≥ 1) and `usedCount: number` (**server-owned**, only ever written by T4's finalize transaction / cancellation decrement) |
| Active (Yes/No) | ✗ | add `isActive: boolean` (default true, manual toggle). Displayed badge = **derived**: `isActive && withinValidity(now) && !capExhausted` |

- **Migration-safe defaults:** all six fields optional in the Zod read schema with defaults (`level:"event"`, `validityStart/End:null`, `usageCap:null`, `usedCount:0`, `isActive:true`) — existing docs and template-inherited docs parse unchanged, no backfill. Template cascade ("Apply to all", `inheritFromParent`) continues to overwrite only the template-owned fields; the six new fields are **event-local** and never overwritten by cascade.
- **Missing client repo (audit):** create `src/lib/db/eventPromotion.ts` mirroring the admin methods per repo-pair convention (authoritative CRUD stays on admin routes).
- **Tab ↔ promotions screens:** tab table columns exactly **Name | Code | Level | Amount / % | Valid | Used | Active**; row edit opens the same promotion edit dialog component used by the existing event-promotions screen (extended with the new fields), not a fork. `+ Create` on this tab = the existing create-event-promotion flow. Helper line under the table: the `/C` = client comp, `/S` = staff comp convention, per prototype.

**Acceptance criteria**
1. Discounts tab lists this event's EventPromotion docs with the 7 columns; codeless (auto-apply) promotions render Code "—".
2. Valid cell: `→ {end}` / `{start} →` / `{start} → {end}` / `—` (event timezone, "MMM D"). Used cell: `used / cap` when capped, bare `used` when uncapped (prototype: `1 / 3`, `0`).
3. Active badge derives from `isActive && validity && cap` (unit-tested truth table); expired or exhausted codes show "No" even when `isActive` is true.
4. Editing from the tab persists the new fields; the existing promotions screen shows the same values (single source verified by test).
5. Existing pre-M2 promotion docs render with defaults (uncapped, no window, Event level, Active) — no read errors, no rewrite on load (regression: template inherit still works).
6. Validation: `validityEnd ≥ validityStart` when both set; `usageCap` int ≥ 1 or null; cap below current `usedCount` rejected ("Cap cannot be below times used").
7. `usedCount` is rejected/stripped from every client/admin edit payload — only T4's transaction mutates it.
8. Mutations require `write:events`; routes 404 cross-org (existing promotion routes already do — extend tests to the new fields).
9. Empty state: "No discount codes yet" + explainer + create CTA; also links to org-level Promotion templates for reuse.
10. No new indexes needed (subcollection reads by `organizationId` are auto-indexed); client `eventPromotion.ts` exists and is exercised by at least one test.

## M2-T3 — Taxes + Service Fees tabs

**Entity `Tax`:** `{ organizationId, eventId, name (1–80), code (M1 code regex, unique per event within Tax, e.g. VAT-UK, TAX-NY), type: "percentage" | "fixed", rateMilliPercent: number | null (int ≥ 0, percentage only; 20.00% → 20000, 8.875% → 8875 — exact integer storage, no float), fixedAmountMinor: number | null + fixedCurrency: Currency | null (fixed only), isActive: boolean (default true), createdAt, updatedAt }`. Exactly one of the type-specific field groups is set (Zod discriminated union).

- **Application:** every **active** tax applies to every order's `taxableBase` (post-discount); fixed taxes apply only when `fixedCurrency === order.currency`; percentage taxes are currency-agnostic. Inactive taxes never apply. Math + order per Shared decisions; each tax line rounds half-up independently, then sums (matches invoice-line presentation; document this so QA doesn't expect round-of-sums).
- **Screens:** Taxes tab columns exactly **Name | Code | Type | Rate | Active** (+ actions). Rate cell: `20.00%` / `8.875%` (trim trailing zeros beyond 2dp) or the fixed amount formatted in its currency. Active = amber "No" / green "Yes" per prototype. **Service Fees tab = designed empty state only**: 💳 icon + "No service fees configured. Add a per-order processing fee if you pass card costs to attendees." — no create button, no entity, no API in M2.

**Acceptance criteria**
1. Taxes tab lists the event's taxes with the 5 columns, ordered `createdAt` asc; prototype rows reproducible (VAT-UK 20.00% inactive, TAX-NY 8.875% active).
2. Create/edit validates: name, code (uppercase, per-event unique within Tax, field-level dup error), type-specific fields (percentage: rate as decimal input ≤ 3dp parsed to integer milli-percent, 0–100%; fixed: amount ≥ 0 + currency).
3. `isActive` toggles inline from the table and persists.
4. Delete: allowed when no Order references the tax, else 409 directing to deactivate (enforced from T4).
5. Tax math unit tests: 8.875% of 85500 = 7588 (7588.125 half-up down); exact-.5 rounds up; 20% of 0 = 0; fixed tax skipped on currency mismatch; inactive tax skipped; multiple taxes sum line-rounded values.
6. Service Fees tab renders the prototype empty state verbatim; no network calls.
7. Mutations require `write:events`; 404 cross-org/IDOR on taxId; index `Tax eventId+organizationId+createdAt` (+ `eventId+code` for uniqueness) registered.
8. Loading/error/empty (Taxes: "No taxes yet" + create CTA) per shared section.

## M2-T4 — Orders & payment records (engine only)

**Scope decision:** M2 ships the **order engine + provider interface + tests, no new UI**. Manual admin order creation ("+ Register attendee") is deferred to **M5-T2**; the public checkout wires in at **M3-T3**. Recommended: no admin Orders list screen in M2 — nothing in the Pricing tabs needs it, and reports (M7) will define the read surfaces. (If Orchestrator wants smoke visibility, a dev-only JSON route is acceptable; not an AC.)

**Entity `Order`** (root collection; **doc ID = deterministic hash of `idempotencyKey`** so create-if-absent is atomic): `{ organizationId, eventId, submissionId: string | null (null until M3 wires registration), ticketTypeId, registrationTypeId, feeId, promotionId: string | null, taxIds: string[], currency: Currency, amounts: { subtotalMinor, discountMinor, taxMinor, totalMinor } (all server-computed integers), snapshot: { feeName, basePriceMinor, promoCode: string | null, discountType/discountValue: as-applied | null, taxLines: [{ taxId, code, rateMilliPercent | fixedAmountMinor, amountMinor }] } (audit trail — later fee/tax edits never rewrite history), paymentMethod: "card" | "invoice" | "comp" | "none", paymentStatus: "pending" | "paid" | "outstanding" | "comped" | "failed", paymentProvider: "simulated", providerPaymentId: string | null, idempotencyKey: string, createdAt, updatedAt }`.

- **Provider interface (`src/lib/payments/`):** `interface PaymentProvider { createPayment(input: { orderId, amountMinor, currency, idempotencyKey, method: "card" }): Promise<{ status: "succeeded" | "failed"; providerPaymentId: string; failureReason?: string }> }`. `SimulatedPaymentProvider`: instant `succeeded` by default; deterministic failure trigger for tests (e.g. `amountMinor % 100 === 99` or an injected flag — implementer's choice, documented); **idempotent** — repeat call with same `idempotencyKey` returns the original result, never double-charges. Real Stripe later = new implementation, zero call-site changes (Q1).
- **Lifecycle:** (1) server computes pricing (fee resolution: specific-regType fee, else "All types" fee, in the requested currency; archived/missing → 400) and validates the promotion (code match, derived-active per T2, currency sanity) → (2) **card**: order written `pending`, `createPayment` called, then **finalize** on success (→ `paid`) or mark `failed` on failure (order kept, counters untouched, retry allowed with a new attempt under the same idempotency semantics); **invoice**: finalize immediately → `outstanding`; **comp** (`totalMinor === 0` via comp fee or 100% discount): finalize → `comped`, method `comp` (organizer-recorded free orders use `none`). (3) **Finalize is one Firestore transaction:** re-read ticketType, registrationType, promotion; check `capacity` vs `registeredCount` on both (null capacity = unlimited) and `usedCount < usageCap` (when promo + cap); recompute totals from the re-read docs and require they equal the quoted amounts; then increment `ticketType.registeredCount`, `registrationType.registeredCount`, `promotion.usedCount` (if promo) and set the order's final status. Any check fails → transaction aborts, **no counter moves, order not finalized**, typed error (SOLD_OUT / TYPE_FULL / PROMO_EXHAUSTED / PROMO_EXPIRED / PRICE_CHANGED).

**Acceptance criteria**
1. Totals are computed exclusively server-side from Firestore state; any client-supplied amounts are ignored (test: tampered payload still yields correct totals).
2. Computation follows Shared-decisions math exactly; the worked-examples table below is implemented as unit tests verbatim.
3. Fee resolution: specific-regType fee preferred over "All types"; archived fee → 400; no fee for the ticket×regType×currency → 400.
4. Discount application: percentage rounds half-up; fixed clamps at subtotal (`discountMinor ≤ subtotalMinor`, total never negative); expired / cap-exhausted / `isActive:false` promo → PROMO_* error, order not created.
5. `totalMinor === 0` orders finalize as `comped` with no provider call.
6. Card success → `paid` with `providerPaymentId`; simulated failure → `failed`, counters unchanged; invoice → `outstanding` with no provider call.
7. Idempotency: two concurrent/repeat finalize calls with the same `idempotencyKey` yield exactly one order doc, one set of counter increments, one provider charge (deterministic doc ID + create-if-absent transaction; test double-submit).
8. Finalize transaction increments all three counters atomically with the status write; ticket/regType capacity and promo cap are checked **inside** the transaction (test: two racing orders for the last seat — exactly one succeeds).
9. Cancellation (admin-only stub API acceptable): decrements the same counters in one transaction and sets a terminal state — or, if deferred, an explicit `// TODO(M3-T4/M5)` note; counters must never go below 0 either way.
10. Snapshot fields frozen at purchase: editing the fee/tax/promo afterwards does not change any existing order's amounts (test).
11. `usedCount` on EventPromotion is only ever mutated by this transaction (satisfies T2 AC-7).
12. AuthZ: finalize/cancel routes server-only; admin-triggered mutations require `write:events`; 404 cross-org on every referenced ID (event, fee, ticket, regType, promo must all belong to the same event+org — mixed-event references rejected).
13. Indexes registered: `Order eventId+organizationId+createdAt DESC` (future lists); `submissionId` lookups are single-equality (auto).
14. Full unit coverage for `SimulatedPaymentProvider` (success, failure, idempotent repeat) behind the `PaymentProvider` interface.

## Worked examples (normative — implement as tests)

| # | Case | Fee (minor) | Discount | discountMinor | taxableBase | Tax (active) | taxMinor | totalMinor | method → status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Plain card | GC-SEB×Delegate×USD 75000 | — | 0 | 75000 | none | 0 | 75000 | card → paid |
| 2 | % + tax | GC-EB×Delegate×USD 95000 | GCUS10 10% | 9500 | 85500 | TAX-NY 8.875% | 7588 (7588.125 ↓) | 93088 | card → paid |
| 3 | Fixed + cap | GC-EB×Delegate×GBP 78000 | £600GCUS fixed 600 → 60000 | 60000 | 18000 | none | 0 | 18000 | invoice → outstanding; usedCount 1→2 (cap 3); 4th use → PROMO_EXHAUSTED |
| 4 | Partner comp | NGC-EB×Delegate×USD 145000 | HARVEYAI/C100 100% | 145000 | 0 | TAX-NY 8.875% | 0 | 0 | comp → comped; usedCount 0→1 (cap 7) |

Extra pinned cases: fixed 60000 on a 50000 fee clamps to 50000 (total 0 → comped); 10% of 105 = 10.5 → 11 (half-up); fee `basePriceMinor 0` (comp fee, no promo) → total 0, comped, displays "Comp".

## Gap analysis

- **Exists:** EventPromotion engine (`src/features/event-promotions/`, `src/lib/db/adminEventPromotion.ts`, template cascade) — T2 extends, does not replace. M1 `TicketType`/`RegistrationType` with server-owned `registeredCount` awaiting T4's increments (`agents/docs/data-models/m1-registration-spine.md`).
- **Missing entirely:** `Fee`/`Tax`/`Order` types, DAL pairs, `src/features/pricing/`, `src/lib/payments/`, pricing route body (ComingSoon stub), client `src/lib/db/eventPromotion.ts` (audit gap), all indexes above.
- **Divergences to watch:** `EventPromotionDoc.discountType` is a loose `string` — T2 should narrow to `"percentage" | "fixed"` at the Zod boundary with `.catch` fallback; promotion `conditions[]` (nationality/partner rules) are **not** evaluated by T4 in M2 — only code match + validity + cap (conditions evaluation lands with M3-T2 form data; note in code).
- **Deferred:** service-fee entity/charging (post-M2), manual admin order creation + Orders UI (M5-T2), public checkout + submissionId wiring (M3-T3), refunds/partial payments (unspecced), real Stripe (Q1 swap), currency conversion (Q5 — never in scope), role-refined permissions beyond `write:events` (M8-T1).
