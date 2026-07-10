# QA — M3 Registration Paths & Public Flow

QA Agent, 2026-07-11. Branch `feat/m3-registration-paths` (uncommitted working tree).
Spec: `agents/docs/specs/m3-registration-paths.md` (52 ACs). Design: `agents/docs/design/m3-registration-paths.md`. Inputs: code review (7 should-fixes) + security review (M-1, L-1/2/3), all claimed fixed.

## Verdict: **DEFECTS OPEN** — 1 Major defect (T5 AC-7). 51/52 ACs pass.

---

## Suite results (executed, not inferred)

| Check | Result |
|---|---|
| `npm run lint` | PASS — "No ESLint warnings or errors" |
| `npm run build` | PASS — all routes compile incl. `/events/[eventId]/register` and every new API route |
| `npx vitest run` (pre-QA tree) | PASS — **42 files / 684 tests, all green** (run from uppercase `C:\` cwd per vitest-4-on-Windows note) |
| `npx vitest run` (after QA regression test added) | 42 files green + `registration-drafts-delete-route.test.ts` **FAILS (5/5)** — intentional; it documents open defect QA-M3-D1 and locks the contract once the route lands |

## Review/security fix verification (all 11 landed)

| Fix | Verified at |
|---|---|
| S1 — per-type prices for ambiguous tickets + "From $X" until pick, exact price after pick | `src/features/public-registration/server/tickets.ts:200-252` (per-choosable-type fee resolution, min as card price), `src/features/public-registration/ticket-price.ts` (exact-after-pick / "From min" / uniform collapse); tests in `public-registration-tickets-route.test.ts` ("ambiguous mixed-fee pricing (T2 AC-5, review S1)") + `public-registration-steps.test.ts` (`ticketDisplayPrice`) |
| S2 — finalize denormalizes from the authoritative ORDER, not the mutated draft | `finalize/route.ts:174-205` (`result.order.ticketTypeId` → label; promo from `result.order.snapshot.promoCode`); test "crash-replay after a draft ticket edit records the ORDER's ticket" |
| S3 — rightmost non-private XFF hop | `src/lib/rate-limit.ts:97-112` + private-range filter; tests incl. "spoofed-XFF rotation cannot escape the bucket" |
| S4 — `promoCodeUpper` equality lookup + stamping on create/update/template-cascade | `src/lib/db/adminEventPromotion.ts:63-132,143,214-216`; cascade stamping `adminPromotionTemplate.ts:103,181`; legacy-doc fallback restricted to docs missing the field |
| S5 / M-1 — `DRAFT_TOKEN_SECRET` fails closed in production | `src/lib/draft-token.ts:46-53` throws on `NODE_ENV === "production"`; tests "THROWS in production…" + "still uses the configured env secret in production" |
| S6 — shared responses toolbar + download helper | `src/features/responses/components/responses-toolbar.tsx` (+ `ResponsesFilteredEmptyState`), `src/features/responses/download.ts`; both browsers consume them |
| S7 / L-3 — hygiene | both `debug.log` files deleted; `.gitignore` has `debug.log` + `**/debug.log` (lines 29-30) and `/prototype/contact_sheet.jpg` + `/prototype/metadata/` (lines 56-57) |
| L-2 — CSV guard covers whitespace/tab/CR-prefixed formulas | `src/features/responses/csv.ts:23` (`/^\s*[=+\-@]/`); test "guards a formula char behind a leading CR" |

---

## AC-by-AC results

### T1 — Registration Paths admin (10/10 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 table, 5 columns, sortOrder asc | PASS | `registration-paths-workspace.tsx` (Registration path / Code / Audience / Payment / Currency / Active — Currency is the spec'd divergence); DAL orders sortOrder asc (`admin-registration-path.test.ts`) |
| 2 client+server validation | PASS | `registration-paths-schemas.test.ts` (name 1–120, uppercase code, enums) + route tests (400 foreign audience, 409 dup code with field pointer) |
| 3 flow card 5/4 steps | PASS | `buildFlowSteps` tests ("comp and none paths render 4 steps — Payment omitted and renumbered"); `flow-diagram-card.tsx` + "Payment skipped" badge |
| 4 isActive inline toggle; inactive hidden from picker | PASS | strict `{ isActive }` PATCH test; `getAdminActiveRegistrationPathsForEvent` filters inactive, keeps order |
| 5 delete blocked 409 / hard-delete | PASS | route tests: drafts-block, submissions-block (5+ renders plus), both kinds, hard-delete when unreferenced |
| 6 regType delete names blocking paths | PASS | `registration-types-route.test.ts:393` |
| 7 write:events 403; 404 cross-org/IDOR | PASS | route tests 401/403/404 + foreign pathId 404 |
| 8 composite indexes | PASS | `firestore.indexes.json`: RegistrationPath eventId+organizationId+sortOrder ASC and eventId+code |
| 9 empty/loading/error states | PASS | `EntityEmptyState` (exact copy + CTA), `EntityTableError`, `loading.tsx` present |
| 10 reorder persists, re-sorts admin + picker | PASS | strict `{ sortOrder }` PATCH test; picker reads sortOrder-ordered active list |

### T2 — Commerce form fields (10/10 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 palette entries, "New" badge, canvas subtitle | PASS | `form-builder-workspace.tsx:113-140` ("ticket · from Ticket Types", "promo_code · from Promotions", Commerce section) |
| 2 second field rejected | PASS | builder disabled+tooltip ("Only one … per form") + Zod refine (`form-commerce-fields.test.ts` cardinality) |
| 3 templates reject; cascade never touches | PASS | template schema rejection + both cascade-direction regression tests |
| 4 eligibility × open × priced; sold-out disabled; zero-tickets state | PASS | tickets-route tests; `ticket-options-step.tsx:106-116` empty panel + back-to-picker link, Continue blocked |
| 5 price shown always matches quote | PASS | S1 fix (per-type prices; exact after pick) — mixed-fee config now pinned by tests |
| 6 server-side promo, one generic error | PASS | byte-identical generic response test (quote route); DAL lookup server-only |
| 7 no enumeration; 10/min/IP | PASS | projection exact-key-set test; quote route limit 10; spoofed-XFF bucket test |
| 8 existing forms submit unchanged | PASS | submission-schema exclusion tests + `register-route.test.ts` green |
| 9 zero-TicketTypes save warns, saves | PASS | `form-builder-workspace.tsx:571-578` `toast.warning` |
| 10 unit tests: round-trip / exclusion / template rejection | PASS | `form-commerce-fields.test.ts` |

### T3 — Public multi-step flow (14/14 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 0/1/N routing; inactive `?path=` 404 | PASS | `register/page.tsx:96-136` (0 → redirect to legacy flat form on event page; 1 → server redirect; ≥2 → picker in sortOrder; forced inactive → `notFound()`) + tickets-route 404 tests |
| 2 stepper 5/4 steps; forward-only client+server | PASS | `buildPublicFlowSteps` + navigation-gating tests; static circles (no tamper surface); server out-of-order PATCH/finalize guards tested |
| 3 one draft + signed token; forged 404; bare id useless | PASS | draft POST test (hash-only storage, token returned once); forged-token 404 without store touch; DAL hash+event double-check test |
| 4 per-step server validation | PASS | draft PATCH tests: closed / unpriced / ineligible tickets rejected, choice-required for ambiguous |
| 5 quote = server math, worked example pinned | PASS | `public-registration-quote-route.test.ts` "$50.00 − 10% promo + 8.875% tax = $48.99 exactly"; summary renders server-formatted amounts only |
| 6 method/currency from path; client fields stripped | PASS | finalize schema `{ token }` only + explicit strip test |
| 7 comped / outstanding / paid per method | PASS | method taken from path doc (finalize route:152-164); M2 `placeOrder` contract unchanged (`admin-order-finalize.test.ts` green) |
| 8 double-submit idempotent; declined-card retry | PASS | replay test (same refs, no second order); PAYMENT_FAILED → 402 + attempt++ (only bump) |
| 9 capacity race: friendly SOLD_OUT, no partial writes | PASS | SOLD_OUT/TYPE_FULL → 409 + `refresh:"tickets"`, draft intact (delete only after Order+FormData); error-surface map tests |
| 10 refresh/back re-hydrates; new session = fresh draft | PASS | `use-registration-draft.ts` sessionStorage keyed by eventId; `registration-stepper.tsx:180-210` hydrate → `resumeStepIndex`; GET-by-token tested |
| 11 draft deleted only after Order AND FormData; confirmation refs + QR | PASS | contractual-order test; `confirmation-step.tsx` (REG- short ref, order ref/amount/status, dashed QR placeholder "Your entry pass") |
| 12 32KB cap, unknown-key strip, 429s | PASS | 413 pre-parse test, Zod strip everywhere, 429+Retry-After tests; all 5 public routes call `checkRequestRateLimit` (draft 30, quote 10, finalize 10, tickets 60) |
| 13 mobile 375px; loading/error per step | PASS (code inspection) | `max-w-2xl px-4` single column, stepper labels collapse `hidden sm:block` with current forced visible, light-only; hydrating skeleton, inline `role="alert"` banner + retry. Not exercised in a real 375px browser — noted for the M8 visual pass |
| 14 legacy flat route regression green | PASS | `register-route.test.ts` in the green suite |

### T4 — Response approval workflow (10/10 PASS)

| AC | Result | Evidence |
|---|---|---|
| 1 Ticket + Status columns; legacy reads clean | PASS | `responses-table.tsx` (Name/Email/[Event]/Ticket/Status/Submitted); read-time defaults test (no rewrites) |
| 2 full transition matrix | PASS | 4×4 matrix DAL + route tests; backward/same-status 409 with empty write set |
| 3 accept hook exactly once | PASS | double-click test: second 409, hook once; acceptedAt stamped |
| 4 write:events 403; 404 cross-org | PASS | route gate tests |
| 5 status filter in Firestore query; URL params | PASS | `adminFormData.ts:111,137` `where("status"...)`; composites registered; browsers drive `?status=` via router |
| 6 CSV export: filters, gated, escaping, matches screen | PASS | export-route tests (401/403/404, status honored, event filter); csv tests (formula incl. whitespace-prefix, RFC-4180, CRLF); rows from the same serializer as tables |
| 7 T3 submissions arrive new + orderId/pathId/ticketLabel | PASS | `createAdminFormDataForDraft` test (T4 AC-7); legacy flat arrive as read-time-default "new" with nulls |
| 8 null ticketLabel falls back via orderId join | PASS | export-route test "falls back to the order-snapshot label"; `ticket-labels.ts` for table rows |
| 9 per-event list newest-first, limit 50 + load more | PASS | `event-responses-browser.tsx` cursor paging (limit 50) |
| 10 states + prototype badge colors | PASS | `status-badge.tsx` dot+text (never color-only), emerald/amber/secondary/outline per design §4 incl. dark pairs |

### T5 — Abandoned-registration tracking (7/8 — AC-7 FAIL)

| AC | Result | Evidence |
|---|---|---|
| 1 lastStepReached maps to labels, all 4 values | PASS | DAL step test covering all four; display mapping in responses/abandoned utils |
| 2 name/email denorm at step-1 complete; no pre-step-1 doc | PASS | draft route POST/PATCH denorm (`first_name/last_name/email` → doc fields); draft only created on valid step-1 POST |
| 3 finalize deletes draft; resume-then-complete leaves zero | PASS | contractual order + idempotent delete; replay heals partial crash |
| 4 no payment data / promo text — schema assertion | PASS | "stores EXACTLY the schema fields — no promo code text, no payment keys" (allow-listed DAL writes); PATCH stores resolved `promotionId` only |
| 5 token stored only as hash; bare draftId useless | PASS | hash-only create test + sole-access-path DAL test |
| 6 admin list newest-first, bounded, derived isAbandoned | PASS | `getAdminRegistrationDraftsForEvent` test (flag computed, never stored; strict `>` 24h) |
| **7 manual delete route** | **FAIL — defect QA-M3-D1** | No route exists. `deleteAdminRegistrationDraft` is only referenced by the public finalize route; no `DELETE /api/dashboard/events/[eventId]/drafts/[draftId]` (or equivalent) anywhere under `src/app/api/dashboard`. The DAL pair the data model prescribes (`getAdminRegistrationDraftForEvent` + `deleteAdminRegistrationDraft`) exists and is tested, but nothing wires it |
| 8 24h constant exported once | PASS | `ABANDONED_AFTER_MS` only in `src/lib/db/adminRegistrationDraft.ts:36`; no copies in src |

---

## Cross-cutting

- **Public pages light-only, mobile-first, no dashboard chrome:** zero `dark:` classes across all 8 `public-registration` components; `bg-[#fff8f1]` page + white cards + orange accents per the public convention; rendered under `src/app/events/` (no dashboard shell).
- **A11y:** stepper `nav aria-label` + `ol`, `aria-current="step"` on the current circle, sr-only "completed", static circles (Back is the only backward nav); ticket cards are Radix `RadioGroup`/`RadioGroupItem` with full-card `Label htmlFor` wrap, sold-out disabled + visible badge; focus moves to the step `h2 tabIndex={-1}` with an `aria-live="polite"` step announcement; toolbar count badge `aria-live`.
- **Semantic tokens on admin surfaces:** registration-paths workspace and responses components use `border-border/bg-card/text-muted-foreground` etc.; the only literal palette classes are the design-specified status-badge emerald/amber/sky pairs (with dark variants, dot+text).
- **Nav flag:** `event-nav.ts` "Registration Paths" entry has no `comingSoon`.
- **Multi-org isolation:** every M3 route test includes a cross-org 404 case; new collections deny-all in `firestore.rules:283-289`; all 6 data-model composites registered.
- **PII grep of draft writes:** create/update DAL writes are allow-listed to the T5 schema fields; no IP/user-agent/promo-text/payment keys anywhere in the draft pipeline.

## Defects

| ID | Severity | Summary | Route to |
|---|---|---|---|
| QA-M3-D1 | **Major** | T5 AC-7: manual draft purge route is missing. Spec + data model require `DELETE .../drafts/[draftId]` (`write:events`, 404 cross-org) so organizers can delete an abandoned draft's PII on request — the M3 substitute for the deferred retention/TTL policy. DAL primitives exist and are tested; no route consumes them. Repro: `grep -rln deleteAdminRegistrationDraft src/app` → only the public finalize route. Expected: admin DELETE route per data model §RegistrationDraft. Actual: 404 (route absent). | **fullstack-developer** (route wiring; DAL already done — backend-agent FYI only) |

## Regression tests added

- `src/__tests__/registration-drafts-delete-route.test.ts` — 5 tests locking the T5 AC-7 contract (401 / 403 view-only / 404 cross-org event / 404 cross-org draft / delete via org-scoped lookup). **Currently failing by design** with the message "T5 AC-7 defect QA-M3-D1: the manual draft purge route … does not exist"; goes green when the route lands at `src/app/api/dashboard/events/[eventId]/drafts/[draftId]/route.ts` following the sibling-route conventions (mocks match `registration-paths-route.test.ts`).

## Verdict

**DEFECTS OPEN** — do not merge. 51/52 ACs pass; all 11 review/security fixes verified landed; lint/build green and the pre-existing 684-test suite is green. Sign-off is blocked solely on QA-M3-D1 (Major): implement the manual draft delete route, make `registration-drafts-delete-route.test.ts` pass, and this ticket signs off on re-check.
