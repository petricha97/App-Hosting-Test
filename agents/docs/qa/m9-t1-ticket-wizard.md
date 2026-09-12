# QA Report — M9-T1 Create Ticket Wizard

- QA Agent, 2026-08-24. Branch `prototype-v2` (working tree).
- Spec: `agents/docs/specs/m9-ticket-wizard.md` (15 ACs §8, 15 edge cases §6)
- Inputs: review `agents/docs/reviews/m9-t1-ticket-wizard.md` (APPROVED), security `agents/docs/security/m9-t1-ticket-wizard.md` (PASS, 0 Critical/High/Medium).

## Verdict: **SIGNED OFF**

All 15 acceptance criteria pass. All 15 §6 edge cases verified (13 by pre-existing tests, 2 newly covered by regression tests added in this pass). Zero open defects of severity Major or above. One pre-existing informational carry (missing `M9` `BACKLOG.md` entry, already flagged by Code Review as a should-fix, non-blocking, docs-only).

## 1. Automated suite (executed, actual results)

| Check | Result | Evidence |
|---|---|---|
| `npx vitest run` | **PASS (matches baseline)** | 200/201 files, 2197/2198 tests (2195 baseline + 2 new regression tests). Single failure: `email-render-blocks-pipeline.test.ts` hash tripwire — pre-existing, unrelated to this ticket (confirmed identical to the review's documented baseline). |
| `npm run lint` | **PASS** | `✔ No ESLint warnings or errors` (incl. the edited test file, linted individually) |
| `npm run build` | **PASS** | Route table confirms `/api/dashboard/events/[eventId]/tickets/with-pricing` compiled as its own static segment, never swallowed by `[ticketTypeId]` |

## 2. Priority scenario — §6 edge case E-1 (traced end-to-end)

Traced the full path: `registration-type-quick-add.tsx` POSTs to the existing, unmodified `/registration-types` route the instant "Add & include" is clicked (`registration-type-quick-add.tsx:83-111`), with no deferred/staged write. Read `create-ticket-wizard.tsx` in full: `handleClose`/Cancel only calls `onOpenChange(false)` — there is no cleanup effect, no DELETE call, no compensating request anywhere in the wizard shell or its children on close/unmount/step-back. Since the target route and its DAL (`adminRegistrationType.ts`) are verified byte-for-byte untouched (code review), the created row inherits that route's existing, already-tested "permanent row, normal delete-BLOCK rules" behavior.

Added a new regression test that proves this rather than just asserting the endpoint exists: it performs the quick-add, confirms exactly one `fetch` call fired, then backs out to Step 1 and clicks Cancel, and asserts **no second `fetch` call of any kind occurred** — i.e., abandoning the wizard issues no rollback/delete request. This test would fail if a future change ever introduced compensating cleanup logic.

## 3. AC-6/AC-7 verification (transaction atomicity + server-derived registrationTypeIds)

Read `admin-ticket-type-with-pricing.test.ts` directly (not just the review's summary). Confirmed real assertions, not "no error thrown":
- Success path: `fake.writes.filter(w => w.type === "set")` asserted to have length `1 + prices.length`, split further into exactly 1 `TicketType/` write and N `Fee/` writes.
- Abort paths (code-taken, unknown/foreign registration type, missing id): `expect(fake.writes).toHaveLength(0)` — genuine rollback-to-zero-writes on a forced failure, using an in-memory fake Firestore, not a mocked return value.
- AC-7: `registrationTypeIds` asserted via `new Set(ticketDoc.registrationTypeIds)` equals the deduped non-null ids from `prices` — and the route test separately proves a client-supplied `registrationTypeIds` field never reaches the DAL input object at all.
- AC-10: a collection-name-tracking `.where()` spy proves zero `Fee`-collection queries run (only one `TicketType` query, the code-uniqueness check).

## 4. UI-state assertions verified as real DOM checks, not function-was-called checks

Read `create-ticket-wizard.test.tsx` directly:
- **Edge case 5** (checked-but-unpriced blocks Step 3): asserts `screen.getByText("Step 2 of 3 · Audience & price")` is still present after clicking Continue with an unpriced checked row, plus the price-format error text is visible; then re-asserts `"Step 3 of 3"` only after a valid price is entered.
- **Edge case 2** (409 on submit → Step 1): asserts the DOM shows `"Step 1 of 3 · Ticket details"` and `"Code already in use"` text after a 409, and `onSaved` was never called.
- **Edge case 10** (400 `field: "prices"` on submit → Step 2): asserts the DOM shows `"Step 2 of 3 · Audience & price"` and the exact server error banner text.

These are genuine post-action DOM-state assertions (`screen.getByText` on the step label), not mock-call assertions.

## 5. Edge case 15 (zero registration types at wizard open) — new regression test added

No existing test exercised `registrationTypes={[]}`. Read `step-audience-pricing.tsx`: it renders the same `InfoNote` component `TicketTypeDialog` already uses for its zero-registration-types empty state (bold lead-in sentence + guidance), not a bespoke pattern — matching the spec's "reuse that copy/pattern" requirement. Added a regression test asserting the empty-state text renders, no table is shown, and Continue still advances to Step 3 with `prices: []` (the free/TBD case, AC-8) even when the table started completely empty.

## 6. Full §8 AC / §6 edge case matrix

| # | Item | Result | Evidence |
|---|---|---|---|
| AC-1 | New route file; old `/tickets` route unmodified | PASS | `git diff --stat` empty on `.../tickets/route.ts` (review); `ticket-types-route.test.ts` unaffected in this run |
| AC-2 | `ticketWithPricingPayloadSchema` full validation | PASS | `tickets-with-pricing-route.test.ts` (26-row cap, negative/over-max price, duplicate id incl. duplicate null) |
| AC-3 | 401/403/404 auth/tenancy gate | PASS | Route test auth-ladder describe block |
| AC-4 | Code uniqueness re-checked in-tx, 409, zero writes | PASS | DAL abort test (`fake.writes` length 0) + route 409 mapping test |
| AC-5 | Registration-type membership re-checked in-tx, 400, zero writes | PASS | DAL abort test (unknown/foreign) + route 400 mapping test |
| AC-6 | Exactly 1+N writes / zero on abort | PASS | §3 above |
| AC-7 | `registrationTypeIds` server-derived, set-equality | PASS | §3 above + route test proving client field stripped |
| AC-8 | Empty `prices` valid; `basePriceMinor: 0` valid | PASS | DAL + route + component tests all cover both |
| AC-9 | Fee shape (active/USD/bounded name/ticketTypeId) | PASS | DAL test + 9 dedicated `wizard-fee-name.test.ts` truncation/boundary tests |
| AC-10 | No Fee-uniqueness read | PASS | §3 above (`.where()` spy) + route-level `isAdminActiveFeeCombinationTaken` not-called assertion |
| AC-11 | Quick-add reuses unmodified `/registration-types` route | PASS | Component test asserts exact URL + POST method; grep confirms no new endpoint/DAL added |
| AC-12 | Quick-add row permanent, abandonment-proof | PASS | §2 above (new regression test) |
| AC-13 | `200 { ticketTypeId, feeIds }` order-matched | PASS | Route test |
| AC-14 | `salesEnd < salesStart` rejected, identical message | PASS | Route test, exact message string asserted |
| AC-15 | Every AC has a corresponding test | PASS | Confirmed by direct reading of all 4 test files, not the review's say-so |
| E-1 (priority) | Abandoned wizard leaves quick-add row intact | PASS | §2 above |
| E-2 | Duplicate code at Step 3 → back to Step 1, field flagged | PASS | §4 above |
| E-3 | Duplicate quick-add code → field error, no row, rest of state intact | PASS | Component test |
| E-4 | Zero selected → allowed, `prices: []` | PASS | Component + route + DAL tests |
| E-5 | Checked-unpriced blocks Step 3 | PASS | §4 above |
| E-6 | Comp row (`0`) | PASS | DAL test |
| E-7 | Capacity toggle off → `null` | PASS | `buildTicketWizardDetailsPayload` — identical logic to already-tested `ticketTypeFormSchema` path |
| E-8 | Sales dates blank | PASS | Route test default-null success path |
| E-9 | `salesEnd < salesStart` (client + server) | PASS | Route test (server); client schema is a direct mirror of the already-tested `ticketTypeFormSchema` superRefine |
| E-10 | Reg type deleted mid-flow → 400 back to Step 2 | PASS | §4 above |
| E-11 | >25 priced rows → 400 | PASS | Route test |
| E-12 | Double-submit (accepted gap, not a defect) | PASS (by design) | Spec-documented non-goal, matches sibling routes |
| E-13 | `write:events` missing → 403 | PASS | Route test |
| E-14 | Cross-org/foreign event → 404 | PASS | Route test |
| E-15 | Zero reg types at open | PASS | §5 above (new regression test) |

## 7. Defects & routing

**No defects of severity Major or above.**

| # | Severity | Note | Routing |
|---|---|---|---|
| N-1 | Info (carried, not new) | `agents/docs/BACKLOG.md` still has no `M9`/`M9-T1` entry, as already flagged by Code Review's should-fix. Docs-only gap, no functional impact. | Orchestrator / backlog owner |

## 8. Regression tests added

Both added to `src/__tests__/create-ticket-wizard.test.tsx` (10 tests in file now, up from 8):
1. `"PRIORITY (§6 E-1): abandoning the wizard right after a quick-add issues no follow-up request…"` — proves the quick-add's commit is independent of wizard abandonment by asserting zero additional `fetch` calls after Cancel.
2. `"shows the quick-add-only empty state and still allows advancing with prices: []"` — covers §6 edge case 15 (zero registration types at open), previously untested.

## 9. Final verdict

**SIGNED OFF.** All 15 ACs and all 15 §6 edge cases pass; lint/build/tests green against the known baseline (200/201 files, 2197/2198 tests, one pre-existing unrelated failure). The priority E-1 scenario was traced end-to-end at the code level and is now also pinned by a test that would fail if any future change introduced rollback/cleanup-on-abandon logic.
