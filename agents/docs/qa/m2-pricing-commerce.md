# QA Report — M2 Pricing & Commerce

- QA Agent, 2026-07-10. Branch `feat/m2-pricing-commerce` (working tree).
- Spec: `agents/docs/specs/m2-pricing-commerce.md` (44 ACs: T1=12, T2=10, T3=8, T4=14)
- Inputs: design `agents/docs/design/m2-pricing-commerce.md`, review `agents/docs/reviews/m2-pricing-commerce.md` (APPROVED after re-review), security `agents/docs/security/m2-pricing-commerce.md` (PASS; R1 medium deferred to owning tickets, NEW-1 deferred with documented TODO in `firestore.rules`).

## Verdict: **SIGNED OFF**

All 44 acceptance criteria pass. Zero open defects of severity Major or above. Two informational notes (both design-adjudicated divergences, no action required for M2). No new bugs found, therefore no new regression tests were required — the existing suite already pins every normative behavior QA checked.

## 1. Automated suite (executed, actual results)

| Check | Result | Evidence (tail) |
|---|---|---|
| `npm run lint` | **PASS** | `✔ No ESLint warnings or errors` |
| `npx vitest run` (from `C:\`, after clearing `node_modules/.vite` stale transform cache per known issue) | **PASS** | `Test Files 24 passed (24) · Tests 417 passed (417) · Duration 2.28s` |
| `npm run build` | **PASS** (exit 0) | Full route table emitted; `/dashboard/events/[eventId]/pricing` = 9.99 kB dynamic route; all 4 org API routes present |

Runtime smoke (dev server booted, `Ready in 1812ms`):
- `GET /login` → 200; `GET /` → 200.
- `GET /dashboard/events/{id}/pricing?tab=taxes` unauthenticated → 307 → `/login` (also with `?tab=bogus`).
- `POST /api/dashboard/events/{id}/pricing/fees` unauthenticated → 401 `{"error":"Missing session"}`.
- `POST /api/organizations/lookup` malformed payload → 400 Zod field error (no Firestore read for short codes per test).
- Authenticated end-to-end browsing was not exercised (no test credentials in this environment); route-level behavior is covered by the 100+ route tests mocked at exactly the DAL boundary plus the unauth smoke above.

## 2. AC-by-AC results

### M2-T1 — Fees + Pricing shell (12/12 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 List: 5 columns, createdAt asc, per-currency, Comp on 0 | PASS | `fees-tab.tsx:203-250` (Fee name/Ticket/Registration type/Base price/Status); `adminFee.ts:44-57` orderBy createdAt asc; `formatFeePrice` Comp-on-0 tested (`pricing-utils.test.ts:50`) |
| 2 Zod client+server; foreign IDs rejected; ≤2dp → minor int | PASS | `feePayloadSchema` + `parsePriceInputToMinor` tests (exact on 19.99, rejects 3dp/negatives); route tests: 400 foreign ticketTypeId/registrationTypeId; null-regType skips lookup |
| 3 Active-combination uniqueness 409, field-level, self-excluded | PASS | `fees-route.test.ts:240,321` (create + edit-into-dup 409 with `ticketTypeId` field pointer, `FEE_DUPLICATE_MESSAGE`), `:297` excludeId |
| 4 Archived: excluded from uniqueness, badge shown, never finalizable | PASS | `fees-route.test.ts:253,337`; Archived badge `fees-tab.tsx:241-244`; `resolveAdminFeeForOrder` filters `status=="active"`; finalize archives → PRICE_CHANGED (`admin-order-finalize.test.ts:409`) |
| 5 Delete blocked 409 → Archive when orders reference | PASS | `fees/[feeId]/route.ts:134-148` + tests `:376` (409) and `:412` (trivially passes pre-T4) |
| 6 Ticket/regType delete 409 naming fees | PASS | `ticket-types-route.test.ts:455` and `registration-types-route.test.ts:366` — 409 with `blockingFeeNames`, org+event-scoped queries |
| 7 Empty state icon + "No fees yet" + explainer + CTA | PASS | `fees-tab.tsx:189-199` (CircleDollarSign; zero-tickets variant swaps CTA to "Create ticket types" per design §2) |
| 8 Tabs shell: 4 tabs, Fees default, T2/T3 empty states | PASS | `pricing-workspace.tsx:71-102`; `resolvePricingTab` default/invalid → fees (tested); Service Fees designed empty state |
| 9 write:events 403; 404 cross-org/feeId IDOR | PASS | `fees-route.test.ts:154-199,285,390,399` (401/403/404 ladder on POST/PATCH/DELETE) |
| 10 Both Fee composite indexes registered | PASS | `firestore.indexes.json:29-47` (list + 5-field uniqueness incl. registrationTypeId) |
| 11 Mutations revalidate; loading/error states | PASS | `router.refresh()` on every mutation success; `pricing/loading.tsx` skeleton (header+4-tab strip+card); `EntityTableError` retry per tab |
| 12 Tickets Price column fee-derived | PASS | `getTicketPriceDisplay` + `ticket-types-workspace.tsx:300-330` (lowest + "+N more" title tooltip, Comp, "—" → Pricing link); 6 unit tests |

### M2-T2 — Discounts tab (10/10 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 7 columns; codeless → "—" | PASS | `discounts-tab.tsx:113-125` (Name/Code/Level/Amount / %/Valid/Used/Active); em-dash + "Auto-apply" badge `:138-153` |
| 2 Valid + Used cell formats | PASS | `formatValidityLabel` all 4 shapes + event-timezone test; `formatUsageLabel` `1 / 3` vs bare `0` (tested) |
| 3 Derived Active badge truth table | PASS | `deriveEventPromotionAvailability` truth table (7 cases, `pricing-math.test.ts:414-481`) + `isDiscountCurrentlyActive` tests (expired/exhausted show "No" while isActive true) |
| 4 Tab edits persist; same values on promotions screen | PASS | Settings route PATCHes the same `EventPromotion` doc via `updateAdminEventPromotion` (persistence test `promotion-settings-route.test.ts:214`); single doc = single source, read path shared (`eventPromotionDefaults`) |
| 5 Pre-M2 docs parse with defaults, no rewrite, cascade intact | PASS | `applyEventPromotionReadDefaults` legacy-doc + malformed-value tests; cascade (`adminPromotionTemplate.ts:170-179`) is `batch.update` of template-owned fields ONLY — the six event-local fields are never in the payload |
| 6 Validation: end ≥ start; cap int ≥ 1/null; cap < used rejected | PASS | `promotion-settings-route.test.ts:161-211` incl. cap==usedCount boundary; impossible calendar dates rejected (`pricing-schemas.test.ts:291`) |
| 7 usedCount rejected/stripped everywhere | PASS | Zod strip test (`pricing-schemas.test.ts:312`), DAL blocklist (`adminEventPromotion.ts:75-79`), `createAdminEventPromotion` force-zeroes, rules `write: if false`, finalize-txn-only increment asserted (`admin-order-finalize.test.ts:312`) |
| 8 write:events; 404 cross-org | PASS | `promotion-settings-route.test.ts:113-158` (401/403/404 event + 404 promotion IDOR) |
| 9 Empty state + explainer + CTA + template reuse pointer | PASS (note N-A) | `discounts-tab.tsx:102-108`; copy references templates; CTA targets event Overview `#promotions` (design §3's chosen attach flow) rather than the org-level templates page — see note N-A |
| 10 No new indexes; client `eventPromotion.ts` exists + exercised | PASS | `client-pricing-repos.test.ts:276-364` (5 tests: org scoping, IDOR null-out, defaults, malformed degradation) |

### M2-T3 — Taxes + Service Fees (8/8 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 5 columns, createdAt asc, prototype rows | PASS | `taxes-tab.tsx:165-172`; `formatTaxRate` reproduces `20.00%` / `8.875%` (tested); amber No / emerald Yes badges |
| 2 Validation: code unique per event (field-level), milli-percent ≤3dp 0–100%, fixed amount+currency | PASS | `taxPayloadSchema` discriminated-union tests (mixed/incomplete groups rejected); 409 duplicate code case-insensitive, self-excluded on edit (`taxes-route.test.ts:191,283,306`) |
| 3 Inline isActive toggle persists | PASS | Switch in table `taxes-tab.tsx:195-199`; lightweight-PATCH route test (`taxes-route.test.ts:271`) |
| 4 Delete 409 → deactivate when orders applied it | PASS | `getAdminOrdersReferencingTax` (taxIds array-contains) + tests `:343,363` |
| 5 Tax math: 7588, exact-.5 up, 20% of 0, currency-mismatch skip, inactive skip, line-rounded sum | PASS | All pinned in `pricing-math.test.ts` incl. explicit line-sum-vs-round-of-sums test (11+11=22, never 21) |
| 6 Service Fees designed empty state, no CTA, no network | PASS (note N-B) | `service-fees-tab.tsx` — pure component, zero fetches, CreditCard icon, no action button (EntityEmptyState action made optional, not forked) |
| 7 write:events; IDOR 404; both Tax indexes | PASS | `taxes-route.test.ts` auth ladder; `firestore.indexes.json:114-130` |
| 8 Loading/error/empty per shared section | PASS | "No taxes configured" + create CTA; `EntityTableError entityLabel="taxes"`; route-level skeleton |

### M2-T4 — Orders & payment records (14/14 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 Server-only totals; tampered amounts ignored | PASS | `placeOrder` accepts no amount inputs; drifted `expectedAmounts` → PRICE_CHANGED with **empty write set** (`admin-order-finalize.test.ts:397`) |
| 2 Worked-examples table verbatim incl. method→status | PASS | Amounts: `pricing-math.test.ts:105-186` (#1 75000, #2 93088 w/ 7588.125↓, #3 clamp 60000→18000, #4 total 0). Statuses: `place-order.test.ts` (card→paid, invoice→outstanding, comp→comped, usedCount cap arithmetic incl. 4th-use PROMO_EXHAUSTED) |
| 3 Fee resolution: specific > All-types; archived/missing → 400 | PASS | `resolveAdminFeeForOrder` (active-only query, specific-first); NO_FEE gate test; archived-at-finalize PRICE_CHANGED test |
| 4 Discount: half-up, clamp at subtotal, PROMO_* gates pre-charge | PASS | 10.5→11 pinned; fixed 600-on-500 clamps to 0; PROMO_EXPIRED (inactive + past-end via injectable clock) and PROMO_EXHAUSTED fire before any charge (`chargeAttempts === 0`) |
| 5 Zero-total → comped, no provider call | PASS | 100%-discount, comp-fee-as-card, and organizer-`none` cases all assert `chargeAttempts === 0`; `none` method preserved |
| 6 Card→paid+providerPaymentId; decline→failed, counters unchanged; invoice→outstanding | PASS | Decline path asserts `createAdminOrderWithFinalize` (the only counter writer) **never called**; `recordAdminFailedOrder` has no counter reads/writes by construction (`adminOrder.ts:199-243`); failed record carries full audit snapshot |
| 7 Idempotency: one doc, one increment set, one charge | PASS | Deterministic sha256 doc ID (3 tests incl. separator-ambiguity + cross-tenant); replay short-circuits everything (both success and failed directions — failed never upgrades); txn replay returns created:false with **zero writes**; provider replays original result per key |
| 8 Atomic 3-counter txn; capacity/cap checked inside | PASS | `FieldValue.increment(1)` on exactly ticket+regType(+promo) asserted; SOLD_OUT losing racer, TYPE_FULL, PROMO_EXHAUSTED at cap all inside txn; `tx.create` ALREADY_EXISTS backstops the create race (mock-level; emulator-level concurrency not exercised — acceptable at this boundary, review concurred) |
| 9 Cancellation deferred with explicit TODO | PASS | `adminOrder.ts:312-313` `// TODO(M3-T4/M5): cancellation — decrement… never below 0` per the AC's deferral clause |
| 10 Snapshot frozen at purchase | PASS | Happy-path test pins snapshot content (feeName, basePriceMinor, promoCode, discountType/Value, taxLines with inactive tax excluded); no code path rewrites Order amounts/snapshot after create |
| 11 usedCount only mutated by this txn | PASS | See T2 AC-7 row (4 layers) + `admin-order-finalize.test.ts:312`; promo-less comp writes only the two capacity counters (tested) |
| 12 AuthZ: server-only finalize; cross-org 404 on every ref | PASS | `place-order.ts` imports `"server-only"`, no route caller exists in M2; cross-org fee INVALID_REFERENCE inside txn, cross-org promo INVALID_REFERENCE in placeOrder, hash-tamper scope guard (tests) |
| 13 Order index registered | PASS | `firestore.indexes.json:73-80` (eventId ASC + organizationId ASC + createdAt DESC) |
| 14 SimulatedPaymentProvider full coverage behind interface | PASS | 8 tests: instant success, amount%100==99 deterministic trigger (documented pure predicate), injected failWhen, idempotent repeat (success AND failure), distinct keys, interface-typed consumption |

## 3. Security-fix regression verification

| Item | Result | Evidence |
|---|---|---|
| User update field lock `hasOnly(['name','avatarUrl','updatedAt'])` | PASS | `firestore.rules:141-142` — organizationId/organizationRole/permissions/organizations all server-only post-create (NEW-2/R3 tightening landed) |
| OWNER_PERMISSIONS drift guard test | PASS | `firestore-rules-owner-permissions.test.ts` — parses rules as text (comments stripped), asserts exactly one literal, order-sensitive equality vs `OWNER_PERMISSIONS` |
| Org lookup/join/switch route tests | PASS | `org-join-routes.test.ts` (19 tests): sanitized preview only, uniform 404s, bearer-token path, token-derived domain, personal-domain 403, idempotent re-join, roster-validated switch 403 |
| Membership verification in scope resolvers | PASS | `resolveActiveOrganizationId` wired in `route-scope.ts` + `get-dashboard-scope.ts:24`; Finding-1 attack shape locked (`route-scope.test.ts:74` spoofed org → 403 before any event lookup; `org-membership.test.ts:66`); legacy roster-less doc fails closed |
| Rules deny surface | PASS | Fee/Tax/TicketType/RegistrationType/EventPromotion read-only for org members + write-denied; Order fully denied; Organization update `if false`; default deny |

Carried non-blocking items (unchanged, tracked): SEC R1 (18 non-M2 routes still trust `userDoc.organizationId` directly — owning tickets), R2–R4 (Low), R5/dependency audit (Medium, pre-existing), rules NEW-1 (org-create domain squatting — documented OPEN TODO in `firestore.rules:171-178`, deferred to M8-T1 per security sign-off).

## 4. Cross-cutting checks

- **`?tab=` deep links**: resolved server-side (`pricing/page.tsx:98`, array-safe), invalid/missing → `fees` (tested); client switches via `router.replace(..., {scroll:false})`, no history spam. Verified unauth deep-link redirects preserve nothing sensitive.
- **Skeletons**: `pricing/loading.tsx` = header + four `h-9 w-24` tab skeletons + card rows, matching design §5.
- **Empty states per tab**: all four present (Fees incl. zero-tickets variant, Discounts, Taxes, Service Fees CTA-less) via shared `EntityEmptyState` with optional action (extended, not forked).
- **Semantic tokens / dark theme**: grep of `src/features/pricing/` + `src/components/ui/tabs.tsx` found zero raw colors (`bg-white`, `bg-gray-*`, hex); emerald/amber badges pair color with text and carry `dark:bg-emerald-950 dark:text-emerald-200` (M1 combo).
- **A11y**: `aria-label` on all tables ("Fees"/"Discounts"/"Taxes") and every icon button (Edit/Archive/Delete/Settings/Open {name}); count badges in `aria-live="polite"` spans; Radix Tabs roving tabindex; labeled inputs throughout dialogs; TabsList `overflow-x-auto`; tables `overflow-x-auto` + min-widths for <768px.
- **Event nav**: Pricing item is a plain entry (`event-nav.ts:55`) — `comingSoon`/`milestone`/`description` removed.
- **Multi-org isolation (user perspective)**: every list/get is org-scoped in the query; single-doc getters null out cross-org (client + admin, both tested); finalize re-checks tenancy on every referenced doc inside the txn.

## 5. Defects & routing

**No defects of severity Major or above. No Minor defects requiring code change.**

Informational notes (no action for M2; recorded for the backlog):

| # | Severity | Note | Routing |
|---|---|---|---|
| N-A | Info | Spec T2 AC-9 says the Discounts empty state "links to org-level Promotion templates"; the shipped CTA targets the event Overview `#promotions` anchor (the actual attach flow) with template reuse mentioned in copy. This follows design §3, which the Code Reviewer approved under the one-source-of-truth decision. Consider adding a secondary link to `/dashboard/promotions/templates` when the Discounts tab next changes. | ui-ux-designer (backlog note, accepted divergence) |
| N-B | Info | Service Fees empty-state copy is the design's wording ("…pass card costs **on** to attendees. Coming in a later milestone.") vs the spec's shorter line — intent identical, design postdates and elaborates. | ui-ux-designer (accepted) |

Pre-existing, non-M2, already-adjudicated carries: review N-1..N-8 (optional nits), security R1–R5 + NEW-1 (deferred with owners documented). None block.

## 6. Regression tests added

None — QA found no new bugs. The mandate "a regression test for every bug found" is satisfied vacuously; every behavior QA verified is already pinned by the existing 417-test suite (24 files), including all four normative worked examples verbatim, both idempotent-replay directions, the failed-charge-no-counters invariant, the usedCount four-layer lock, and the Finding-1/Finding-2 security regressions.

## 7. Final verdict

**SIGNED OFF.** All 44 ACs pass, lint/build/tests green (417/417), security regressions verified in place, no open defects ≥ Major. Ticket M2 may close; hand-off notes for M3-T3 (checkout wiring: void/refund TODO + re-quote-on-retry) and M5/M7 (orders UI/read surfaces) are already embedded in code comments and the review record.
