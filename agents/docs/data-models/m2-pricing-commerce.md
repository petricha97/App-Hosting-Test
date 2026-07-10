# M2 Data Model — Pricing & Commerce (Fees, Taxes, Orders, Promotion extension)

Backend Agent, 2026-07-10. Implements `agents/docs/specs/m2-pricing-commerce.md` under the conventions of `agents/docs/data-models/baseline.md` and `m1-registration-spine.md`. Source of truth: `src/types/collection.ts` + `src/lib/db/{fee,adminFee,tax,adminTax,adminOrder,eventPromotion,adminEventPromotion,eventPromotionDefaults}.ts` + `src/lib/orders/{pricing-math,order-id}.ts` + `firestore.indexes.json` + `firestore.rules`.

## Money model

- **Integer minor units everywhere.** `Currency = "USD" | "GBP" | "EUR" | "SGD"` (`SUPPORTED_CURRENCIES` in `src/types/collection.ts`), `CURRENCY_MINOR_DIGITS` map in `src/lib/orders/pricing-math.ts` (all 2; 0-decimal currencies out of scope until added to both). No FX conversion anywhere (Q5 locked).
- **Rounding: half-up, per step**, in pure integer math (`roundHalfUp(numerator, denominator)` — never `Math.round` on a float quotient). Applied at the discount step, then at EACH tax line independently; lines are summed (never round-of-sums).
- **Application order (fixed):** `subtotal = fee.basePriceMinor` → `discount = min(subtotal, computed)` (percentage: milli-percent integer math; fixed: `discountValue × 10^minorDigits` in the ORDER's currency) → `taxableBase = subtotal − discount` → active tax lines (fixed taxes only on currency match) → `total = taxableBase + Σ lines`.
- `computeOrderTotals(fee, promotion?, taxes[])` is the single computation entry point, used by quote routes and re-used verbatim inside the finalize transaction. The spec's worked-examples table is pinned in `src/__tests__/pricing-math.test.ts`.
- `promotionToPricingInput(...)` narrows the legacy loose `discountType?: string` to `"percentage" | "fixed"`; anything else degrades to "no discount" (never throws on legacy docs).
- Percentage boundary: stored percent values (possibly fractional, e.g. `8.875`) convert ONCE to integer milli-percent (`Math.round(value * 1000)`); all subsequent math is integer.

## Collections

### `Fee` (root, auto IDs)

```ts
interface FeeDoc {
  organizationId: string;
  eventId: string;
  name: string;                      // 1–80 (route Zod)
  ticketTypeId: string;              // must belong to event (route-checked)
  registrationTypeId: string | null; // null = ALL registration types — stored EXPLICITLY as null
  currency: Currency;
  basePriceMinor: number;            // int >= 0; 0 renders "Comp"
  status: "active" | "archived";
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

- **Uniqueness:** at most one ACTIVE fee per `(eventId, ticketTypeId, registrationTypeId-or-null, currency)`; archived never blocks. Enforced by pre-write `isAdminActiveFeeCombinationTaken` (limit 2, excludeId on edit) — route owns the 409/field error.
- **Fee resolution rule (fixed, used by T4/M3):** among active fees for (ticket, currency), a fee pinned to the buyer's registration type **wins over the "All types" (null) fee**. Implemented in `resolveAdminFeeForOrder` (bounded equality query, specific-vs-null picked in memory) and re-validated inside the finalize transaction.
- **Delete rules:** hard delete only when no `Order` references the fee (`getAdminOrdersReferencingFee`), else 409 → Archive. M1 ticket/regType delete routes extend their blocks via `getAdminFeesReferencingTicketType` / `getAdminFeesReferencingRegistrationType` (bounded, return blocking fees for the 409 message; "All types" fees never block a regType delete).

### `Tax` (root, auto IDs)

```ts
interface TaxDoc {
  organizationId: string;
  eventId: string;
  name: string;                      // 1–80
  code: string;                      // UPPERCASE (normalizeRegistrationCode), unique per event WITHIN Tax
  type: "percentage" | "fixed";
  rateMilliPercent: number | null;   // percentage only; 20.00% -> 20000, 8.875% -> 8875 (exact int)
  fixedAmountMinor: number | null;   // fixed only
  fixedCurrency: Currency | null;    // fixed only; line applies only when === order currency
  isActive: boolean;                 // inactive taxes never apply
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

- Exactly one type-specific group is set; the DAL forces the unused group to null on create AND on any update that changes `type` (no stale values after a percentage↔fixed switch). Route owns the Zod discriminated-union validation.
- Every active tax applies to every order's post-discount `taxableBase`; each line rounds half-up independently. `getAdminActiveTaxesForEvent` = bounded list + in-memory `isActive` filter (per-event tax counts are tiny; no extra composite).

### `Order` (root, **deterministic doc IDs**, server-only)

```ts
interface OrderDoc {
  organizationId; eventId;
  submissionId: string | null;       // null until M3-T3
  ticketTypeId; registrationTypeId; feeId;
  promotionId: string | null;
  taxIds: string[];                  // ids of taxes that produced snapshot.taxLines
  currency: Currency;
  amounts: { subtotalMinor; discountMinor; taxMinor; totalMinor };  // server-computed ints
  snapshot: {                        // frozen at purchase — later edits never rewrite history
    feeName; basePriceMinor;
    promoCode: string | null;
    discountType: "percentage" | "fixed" | null; discountValue: number | null;
    taxLines: { taxId; code; rateMilliPercent | null; fixedAmountMinor | null; amountMinor }[];
  };
  paymentMethod: "card" | "invoice" | "comp" | "none";
  paymentStatus: "pending" | "paid" | "outstanding" | "comped" | "failed";  // "pending" has NO writer — never persisted (see finalize contract below)
  paymentProvider: "simulated";
  providerPaymentId: string | null;
  idempotencyKey: string;
  createdAt / updatedAt;
}
```

- **Doc ID = `sha256(JSON([organizationId, eventId, idempotencyKey]))`** (`src/lib/orders/order-id.ts`). Deliberately scoped to (org, event), not the raw key alone: idempotency keys are namespaced per tenant, so a caller in org A can never occupy/probe the order slot org B would derive from the same key. JSON tuple encoding removes separator ambiguity.
- **No client repo exists** and `firestore.rules` denies all client access — Order is Admin-SDK-only by construction.

### `EventPromotion` (existing subcollection) — six additive fields

`level ("event"|"partner")`, `validityStart/End (Timestamp|null)`, `usageCap (int>=1|null)`, `usedCount (int, SERVER-OWNED)`, `isActive (boolean)` — all **optional in the type** for migration safety. Read defaults (`level:"event"`, no window, uncapped, `usedCount:0`, `isActive:true`) applied by the pure module `src/lib/db/eventPromotionDefaults.ts` in BOTH repos — legacy docs parse unchanged, no backfill, never rewritten on load. Malformed values degrade to defaults rather than erroring.

- `updateAdminEventPromotion` **strips** `usedCount`, `organizationId`, `createdAt` from every payload (spec T2 AC-7); `createAdminEventPromotion` forces `usedCount: 0`. The ONLY `usedCount` writer is the finalize transaction (and the future cancellation decrement).
- Template cascade safety: `applyTemplateToInheritingEvents` / apply-to-events take a typed `fields` param restricted to template-owned fields (`adminPromotionTemplate.ts:70-78`), so the six event-local fields can never be overwritten by cascade — verified, no change needed.
- Derived "Active" badge = `deriveEventPromotionAvailability(...) === "available"` (pure: isActive → validity window inclusive → cap); truth-table unit tested. Never stored.
- **Client repo `eventPromotion.ts` created** (closes the baseline audit gap): read-only mirror of the admin read surface (`getEventPromotionsForEvent` org-scoped + bounded, `getEventPromotionById` org-checked), same defaults applied.

## Finalize transaction contract (`createAdminOrderWithFinalize`, adminOrder.ts)

One `adminDb.runTransaction`, reads strictly before writes:

1. **Idempotency (create-if-absent):** read the deterministic order doc; if it exists (matching org/event/key) → `{ ok: true, created: false, order }` — nothing else happens, counters untouched. `tx.create` (not `set`) backstops the race: the losing concurrent writer aborts and retries as a repeat.
2. **Re-reads:** fee, ticketType, registrationType, promotion (if any), and the event's taxes (bounded query inside the txn).
3. **Checks (any failure aborts — no counter moves, no order doc):**
   - fee missing / wrong event-org / wrong ticket / regType-pinned mismatch → `INVALID_REFERENCE`; fee archived or currency mismatch → `PRICE_CHANGED`;
   - ticket `capacity != null && registeredCount >= capacity` → `SOLD_OUT`; regType same → `TYPE_FULL` (null capacity = unlimited);
   - promotion derived availability: inactive/not-started/expired → `PROMO_EXPIRED`; `usedCount >= usageCap` → `PROMO_EXHAUSTED`;
   - recompute `computeOrderTotals` from the RE-READ docs and compare all four amounts to the caller's quoted `expectedAmounts` → any drift `PRICE_CHANGED`. Client-supplied amounts never reach this input — the quote itself is server-computed.
4. **Writes (atomic):** `tx.create(order)` with frozen snapshot + `FieldValue.increment(1)` on `ticketType.registeredCount`, `registrationType.registeredCount`, and `promotion.usedCount` (if promo). Server timestamps throughout.

**Result union:** `{ ok: true, orderId, order, created }` | `{ ok: false, code, message }` with `code: "SOLD_OUT" | "TYPE_FULL" | "PROMO_EXHAUSTED" | "PROMO_EXPIRED" | "PRICE_CHANGED" | "INVALID_REFERENCE"` (`INVALID_REFERENCE` extends the spec union for reference races between route pre-checks and the txn; routes map it to 400/404).

`paymentStatus` accepted here is terminal-success only (`paid | outstanding | comped`). No `pending` order doc is ever persisted (review N-6): `pending` exists in the `PaymentStatus` union for forward-compat but has **no writer** — the quote and the card charge happen in-memory in `place-order.ts` before any Order doc exists. A declined card IS persisted, as a terminal `failed` record via `recordAdminFailedOrder` (`adminOrder.ts:188` — deliberately outside the finalize transaction, zero counter increments), so counters never move for a failed charge and M3-T3 implementers should not hunt for a pending-order writer. Cancellation (counter decrement, floor 0) is `// TODO(M3-T4/M5)` in adminOrder.ts. The `PaymentProvider` interface / `SimulatedPaymentProvider` (`src/lib/payments/`) is the fullstack pass's deliverable and consumes this contract unchanged.

## Query patterns and indexes

| Query | Method (admin / client) | Index |
|---|---|---|
| Fee: `eventId == AND organizationId == ORDER BY createdAt ASC LIMIT 50` | `getAdminFeesForEvent` / `getFeesForEvent` | composite #1 |
| Fee uniqueness: `eventId == ticketTypeId == registrationTypeId == currency == status=="active" LIMIT 2` | `isAdminActiveFeeCombinationTaken` / client advisory `isActiveFeeCombinationTaken` | composite #2 (null regTypeId indexed — stored explicitly) |
| Fee resolution: `eventId == org == ticketTypeId == currency == status LIMIT 50`, specific-vs-null in memory | `resolveAdminFeeForOrder` | equality-only → auto (merge) |
| Fee reference checks: `eventId == org == ticketTypeId/registrationTypeId == LIMIT 20` | `getAdminFeesReferencing*` | equality-only → auto (merge) |
| Tax: `eventId == AND organizationId == ORDER BY createdAt ASC LIMIT 50` | `getAdminTaxesForEvent` / `getTaxesForEvent` (+ active filter in memory) | composite #3 |
| Tax code uniqueness: `eventId == code == LIMIT 2` | `isAdminTaxCodeTaken` / `isTaxCodeTaken` | composite #4 |
| Order: `eventId == AND organizationId == ORDER BY createdAt DESC LIMIT 50` | `getAdminOrdersForEvent` | composite #5 |
| Order reference checks: `eventId == org == feeId ==` / `taxIds array-contains LIMIT 5` | `getAdminOrdersReferencingFee/Tax` | equality(+contains)-only → auto (merge) |
| Order by idempotency key | `getAdminOrderByIdempotencyKey` (doc get on derived id) | n/a |
| EventPromotion: subcollection `organizationId == LIMIT 50` | `getEventPromotionsForEvent` (client, NEW) | auto (collection scope) — spec T2 AC-10: no new index |

Registered in `firestore.indexes.json` this change (all COLLECTION scope):

1. `Fee`: `eventId ASC, organizationId ASC, createdAt ASC`
2. `Fee`: `eventId ASC, ticketTypeId ASC, registrationTypeId ASC, currency ASC, status ASC`
3. `Tax`: `eventId ASC, organizationId ASC, createdAt ASC`
4. `Tax`: `eventId ASC, code ASC`
5. `Order`: `eventId ASC, organizationId ASC, createdAt DESC`

Equality-only (and equality+array-contains) queries can never throw missing-index (served by single-field merging); #2/#4 are registered anyway per spec AC + M1 determinism convention. Bounded reads everywhere (list 50, uniqueness 2, reference checks 5–20); `organizationId` in the `where()` on every list/reference query (baseline R4).

## Read/write access rules — `firestore.rules` (LOCKED DOWN per SEC M2 review)

`firestore.rules` wired into `firebase.json`. **Default deny**; the Admin SDK bypasses rules by design. Revised after the M2 security review (Findings 1–4): the User doc's authorization/tenancy fields and the Organization collection are no longer client-writable/-readable at large.

| Collection | Client rule | Why (code path) |
|---|---|---|
| `User/{email}` | get own doc; **create own doc ONLY in the owner-of-a-brand-new-org shape** (email/uid match token, `status:'active'`, exactly one `{role:'owner', joinMethod:'created'}` membership pointing at an Organization whose `ownerId == caller`, permissions == exact `OWNER_PERMISSIONS` list); **update own doc restricted by field-diff to `{name, avatarUrl, updatedAt}`** (review NEW-2/R3: `organizationId`/`organizationRole` removed from the allow-list — org switching goes through `POST /api/organizations/switch`, which roster-verifies and re-stamps the permissions mirror via the Admin SDK); no list/delete | AuthContext get/subscribe (`user.ts`); `signupCreateOrgAndUser` (`user-organization.ts:66`). `organizationId`, `organizationRole`, `permissions`, `organizations`, `email`, `uid`, `status`, `emailVerified`, `createdAt`, `lastLoginAt` are SERVER-ONLY after create — closes SEC Findings 1 & 2 and NEW-2 at the rules layer |
| `Organization` | **get: roster members only** (caller's `organizations[]` contains the org); **list: only the caller's-own-domain auto-join query** (`allowDomainAutoJoin == true && domain == caller email domain` — provable from the query filters, so `getOrganizationByDomain` still works and nothing else does); create only with `ownerId == caller && memberCount == 1 && status == 'pending' && domainVerified == false`; **update/delete denied** (memberCount is server-owned, SEC Finding 4 / review S-3) | AuthContext active-org get/subscribe (`organization.ts:45,63`), signup domain suggestion (`organization.ts:23`), signup org create. Invite-code lookup (`organization.ts:34`) is DENIED — closes SEC Finding 3 (invite secret enumeration) |
| `Event` | read + create when `organizationPath` ∈ the 5 legacy candidates of the caller's ACTIVE org (now roster-backed, see User update rule); update/delete denied | `create-event-workspace.tsx:21` client create; client repo org-scoped reads |
| `Event/*/EventPromotion` | READ for active-org members; **all writes denied** | client `eventPromotion.ts`; usedCount server-owned |
| `RegistrationType`, `TicketType`, `Fee`, `Tax` | READ for active-org members; **all writes denied** | client repo pairs; counters/uniqueness/money invariants are admin-DAL-owned |
| `Order` | **all access denied** | server-only entity, payment records |
| `Form`, `FormData`, `FormTemplate`, `EventPage`, `PromotionTemplate` | all access denied (explicit) | no production client-SDK access exists |

**Server trust contract (the other half of the Finding-1 fix):** because `organizations[]` and `permissions` are now rules-locked, server code derives tenancy via `src/lib/org-membership.ts` (`resolveActiveOrganizationId`: active org valid ONLY when the roster confirms membership, else 403/redirect). Wired into `resolveRegistrationRouteScope` (all M1/M2 mutating routes), `getDashboardScope` (all dashboard pages), and the promotions `[promotionId]` route's local scope. `userDoc.permissions` remains the authz gate and is stamped exclusively by `adminUserOrganization.ts`. Other legacy routes with local `resolveScope` copies are protected by the rules-layer roster constraint; migrate them onto the shared helper opportunistically.

**Rules-layer limits (documented, accepted):**

1. `rosterHas` is unrolled over the first 10 memberships (rules cannot loop). A user in >10 orgs cannot client-read the 11th+'s Organization doc (switching is server-side and unaffected — `setAdminUserActiveOrganization` checks the full roster).
2. The User-create owner shape compares `permissions` by exact list equality (order-sensitive) against `OWNER_PERMISSIONS` — kept in sync with `src/types/collection.ts` by a CI unit test (`src/__tests__/firestore-rules-owner-permissions.test.ts`, review R4).
3. The domain-scoped Organization `list` still exposes the full org doc (incl. invite code) to signed-in users **of that same email domain** — equivalent exposure to what domain auto-join already grants; replace with a projection route in M8-T1 if domains stop implying entitlement.
4. ~~`organizationRole` stays client-writable on update~~ closed by NEW-2: the update allow-list is now `{name, avatarUrl, updatedAt}` only.
5. **OPEN (review NEW-1):** the Organization create shape does not constrain `domain`/`allowDomainAutoJoin` — it cannot yet, because the live signup flow (`user-organization.ts:63`) client-creates company orgs with `allowDomainAutoJoin: true`. Target end-state: clients create with `false` and enabling auto-join becomes a server-side, verification-gated operation.

**Client flows the rules now intentionally BREAK — fullstack must move these server-side (new DAL: `src/lib/db/adminUserOrganization.ts`):**

| Broken client flow | Where | Replacement |
|---|---|---|
| Invite-code org lookup | `organization.ts:34` via `organization-form.tsx:77`, `join-organization-dialog.tsx:91`, signup | server route returning an opaque/sanitized match (name, type, memberCount — NEVER inviteCode/inviteLinkToken) that validates the submitted code with the Admin SDK |
| Signup join (invite code AND domain auto-join) | `signupJoinOrg` (`user-organization.ts:28`), `createNewUserAndJoinOrg` (`:155`) | server route validating the entitlement, then `addAdminUserToOrganization({ userEmail, organizationId, joinMethod, profile })` — atomic roster + permissions + memberCount |
| Existing-user invite join | `addExistingUserToOrg` (`user-organization.ts:129`), `join-organization-dialog.tsx:141-172` (incl. its `createUser` + `updateOrganizationMemberCount`) | same server route / `addAdminUserToOrganization` (idempotent: `already-member` no-op) |
| Client memberCount increments | `organization.ts:56`, `user-organization.ts:59,148,185` | owned by `addAdminUserToOrganization` inside the same transaction |
| Client org switch (`organizationId`/`organizationRole` update) | old `AuthContext.switchOrganization` direct write | `POST /api/organizations/switch` → `setAdminUserActiveOrganization` (roster-verified, re-stamps permissions mirror) — the User update rule now allows `{name, avatarUrl, updatedAt}` only |
| (unchanged, still works client-side) | `signupCreateOrgAndUser`, domain lookup, active-org get/subscribe | rules allow these exact shapes; `createAdminOrganizationWithOwner` exists as the server-side alternative when signup consolidates |

Note: the switcher now runs server-side (`/api/organizations/switch` → `setAdminUserActiveOrganization`), so the `permissions` mirror is re-stamped atomically with the active-org change — the stale-mirror caveat that applied to the old client switcher is gone.

Client repos for server-mutated collections (`fee.ts`, `tax.ts`, `eventPromotion.ts`) are **read-only by construction** (no write methods exported), unlike the M1 pairs which carry rule-dead write methods — new-code convention going forward.

## `adminUserOrganization.ts` — server-side membership DAL (NEW, closes baseline R7 + audit gap)

All membership mutations are Admin-SDK transactions (roster write + `memberCount` increment can no longer drift apart):

- `addAdminUserToOrganization({ userEmail, organizationId, joinMethod, role?, profile? })` → `{ok:true, status:"joined"|"already-member"} | {ok:false, reason}` — appends the roster membership, switches the active org, stamps `permissions` from the role, increments `memberCount`, all in ONE transaction; creates a member-shaped User doc when none exists (requires `profile`). Idempotent on re-join. **Entitlement validation (invite code / domain match) is the calling route's job.**
- `createAdminOrganizationWithOwner({ ownerEmail, orgName, emailDomain, isPersonalEmail, profile? })` → org create + owner membership in one transaction (server mirror of `signupCreateOrgAndUser`).
- `setAdminUserActiveOrganization(userEmail, organizationId)` — roster-validated active-org switch that also re-stamps the `permissions` mirror.
- Reads: `getAdminUserMembership`, `isAdminUserOrganizationMember` (doc-id reads, no query/index needs).
- `permissionsForOrganizationRole(role)` — owner/admin → `OWNER_PERMISSIONS`, member → `MEMBER_PERMISSIONS` (no admin-specific set until M8-T1; documented divergence).

`updateAdminEventPromotion` (review S-2) now accepts `validityStartMs`/`validityEndMs` (epoch ms or null) and stamps `updatedAt` itself — routes no longer need `firebase-admin/firestore` imports or admin↔client Timestamp casts. Legacy call forms (pre-cast Timestamps, explicit `updatedAt` sentinel) remain accepted; the DAL's server timestamp always wins. Fullstack: switch the settings route to the `*Ms` form and drop its `firebase-admin` import when wiring B-1.

## Divergences / notes for reviewers

- `INVALID_REFERENCE` added to the spec's finalize error union (documented above).
- `getAdminEventPromotionsForEvent`/`getAdminEventPromotionById` now return `EventPromotionWithDefaults` (six fields non-optional after defaulting) — additive, existing callers unaffected.
- Fee/Tax/Order repos never trust caller-supplied `organizationId`/`eventId`/`createdAt` on update (allow-list pattern per M1); creates stamp explicit field lists.
- Order `taxIds` stores the taxes that actually produced lines (currency-mismatched fixed taxes are absent) — delete protection matches "this tax affected this order".
