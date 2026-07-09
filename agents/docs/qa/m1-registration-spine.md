# QA Report — M1 Registration Data Spine (Registration Types + Ticket Types)

QA Agent, 2026-07-10. Branch `feat/m1-registration-spine`.
Spec: `agents/docs/specs/m1-registration-spine.md` (27 ACs) · Design: `agents/docs/design/m1-registration-spine.md` · Review: `agents/docs/reviews/m1-registration-spine.md` · Security: `agents/docs/security/m1-registration-spine.md`.

## 1. Automated suite (actually executed)

| Check | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS | "✔ No ESLint warnings or errors" |
| `npm run build` | PASS (exit 0) | Both routes compile as dynamic pages: `/dashboard/events/[eventId]/tickets` 9.88 kB / 216 kB first load; registration-types builds in the same run |
| `npm test` | PASS | 10 files, **197 tests passed** in 1.42s — incl. `registration-types-route` (16), `ticket-types-route` (18), `registration-schemas` (44), `registration-utils` (24) |
| QA edge probes (temporary `qa-probe.test.ts`, deleted after run) | PASS (7/7) | DST fall-back day boundaries, both-bounds label precedence, single-day window, round-trips — no defects found, so no regression tests were added |

Runtime browser E2E was not executed: the dev server requires live Firebase credentials and no emulator config exists in the repo (only `firestore.indexes` is declared in `firebase.json`). Coverage below is from the node-mode route tests (which exercise the real route handlers end-to-end against a mocked DAL boundary) plus line-level static verification of every AC.

## 2. Prior-finding fix verification

| Finding | Status | Evidence |
|---|---|---|
| **H-1** (Security, High): mutating routes skipped `write:events` | **FIXED** | `src/features/registration/server/route-scope.ts:45-51` — 403 "Missing write:events permission" after the org check, mirroring the promotions convention. Viewer-403 tests exist AND pass for all 6 mutating handlers: reg-type POST/PATCH/DELETE (`registration-types-route.test.ts:134,232,321`) and ticket POST/PATCH/DELETE (`ticket-types-route.test.ts:312-356`, dedicated "write:events permission gate (H-1)" block) — each asserts the DAL mutation was never called |
| **S-1** (Review): unhandled fetch rejections on 4 mutation paths | **FIXED** | try/catch + `toast.error` with retry description on all four: `registration-type-dialog.tsx:101-123`, `ticket-type-dialog.tsx:126-146`, `registration-types-workspace.tsx:83-119`, `ticket-types-workspace.tsx:130-164` (pending reset kept in `finally`) |
| **S-2** (Review): impossible calendar dates rolled over silently | **FIXED** | `schemas.ts:80-97` — `isRealCalendarDate` UTC round-trip refine; plus `MAX_CAPACITY = 1_000_000` ceiling (`schemas.ts:23,51-56`) mirrored on the form schema. Tested: Feb 31, month 13, non-leap Feb 29, Apr 31, month/day 00 all 400 (`registration-schemas.test.ts:239-261`, `ticket-types-route.test.ts:209-226`); leap day + month ends accepted; capacity 1,000,000 ok / 1,000,001 rejected on both payload and form schemas |
| **S-3** (Review): membership validated against truncated 50-doc list | **FIXED** | `registration-type-membership.ts:23-37` — per-id scoped doc gets (`getAdminRegistrationTypeForEvent`), never a list read; read count bounded by the schema's 25-id cap (`schemas.ts:27,110-113`). Tested: per-id call args asserted, 26 ids → 400 before any reads, unrestricted tickets skip lookups entirely (`ticket-types-route.test.ts:162-207,302-309`) |

## 3. AC-by-AC verification

### Shared decisions

| Criterion | Verdict | Evidence |
|---|---|---|
| Root collections PascalCase, canonical `organizationId`+`eventId`, serverTimestamps | PASS | `adminRegistrationType.ts:20,92-102`, `adminTicketType.ts:22,126-140`; `collection.ts:241-279` |
| Org-scoped queries (no in-memory tenant filter), `createdAt` asc, limit 50 | PASS | `adminRegistrationType.ts:43-48`, `adminTicketType.ts:67-72` |
| Capacity `null`=Unlimited, integer ≥ 1, 0 invalid | PASS | `schemas.ts:51-56`; tested 0/-5/1.5 rejected |
| `registeredCount` server-owned, defaults 0 | PASS | Stamped in DAL create; absent from payload schemas (Zod strips); attacker payload tests assert it never reaches the DAL |
| Code format `^[A-Z0-9][A-Z0-9/-]{1,11}$`, stored uppercase, per-collection per-event uniqueness | PASS | `registrationCode.ts:12-22`; normalize-on-write AND on-lookup in both DALs; 7-case invalid-code test matrix + slash variants |
| Permissions: session + org-owned event, 404 cross-org (no 403 leak) | PASS | `route-scope.ts`; 401/403/404 tests. Note: `write:events` now enforced (H-1) — stricter than the spec's "any org member", per security verdict; `// TODO(M8-T1)` intent preserved via comment |
| Shared states: skeleton under real shell, retryable error, 404 route-level | PASS | `loading.tsx` both routes → `EntityScreenSkeleton` (toolbar variant for tickets); `EntityTableError` with "Try again" → `router.refresh()`; pages `notFound()` on cross-org |

### M1-T1 Registration Types

| AC | Verdict | Evidence |
|---|---|---|
| 1. Columns Registration type/Code(mono)/Capacity/Registered, createdAt asc | PASS | `registration-types-workspace.tsx:159-213`; mono code cell, `tabular-nums` count; DAL orderBy asc |
| 2. `null` → "Unlimited", numeric renders number | PASS | `:180-184` |
| 3. Dialog validation (name ≤80, code regex, capacity), Zod client+server | PASS | Shared `schemas.ts`; boundary tests 80 ok / 81 rejected |
| 4. Auto-uppercase input; server 409 field-level "Code already in use", case-insensitive | PASS | `registration-type-dialog.tsx:171-173` (uppercase onChange); route 409 with `field: "code"`; `applyApiFormError` → `form.setError`; lowercase input normalized before check (tested) |
| 5. `registeredCount: 0` at create; API strips client value | PASS | DAL stamps 0; strip tests (schema + route) |
| 6. Edit updates name/code/capacity, self-excluded uniqueness, `updatedAt` bumps | PASS | PATCH route + `excludeId` (tested); DAL bumps `updatedAt` |
| 7. Capacity < registeredCount rejected server-side | PASS | Route 400 "Capacity cannot be below registered count" (tested at count 5 / capacity 3) |
| 8. Delete confirm; blocked by referencing tickets (409 naming them) and registeredCount>0; never cascade | PASS | `array-contains` reference query; 409 names blocking tickets (tested); Close-only blocked dialog mode; count>0 also pre-blocked client-side |
| 9. Empty state icon/title/explainer/CTA; banner still visible | PASS | `EntityEmptyState` with `Tags` icon, "No registration types yet", "+ Create type"; `InfoNote` renders unconditionally above |
| 10. 404 cross-org events, 401 unauthenticated, typeId IDOR 404 | PASS | Scoped getter compares eventId AND organizationId → null → 404 (tested for PATCH+DELETE) |
| 11. Composite indexes in `firestore.indexes.json` in same change | PASS | `eventId+organizationId+createdAt` and `eventId+code` for both collections + `TicketType` array-contains — all 5 present (`firestore.indexes.json:69-110`) |
| 12. Mutations revalidate; skeleton + retryable error | PASS | `router.refresh()` after every create/edit/delete; states verified above |

### M1-T2 Ticket Types

| AC | Verdict | Evidence |
|---|---|---|
| 1. 7 columns in order (Price "—", Open derived badge), createdAt asc | PASS | `ticket-types-workspace.tsx:276-337` — Ticket/Code/Price/Registered/Capacity/Sales window/Open; Price "—" links to Pricing with "Set in Pricing (coming in M2)" tooltip |
| 2. Dialog fields incl. optional dates, open switch default on, multi-select default none = "All registration types" | PASS | `ticket-type-dialog.tsx`; `isOpen ?? true`; unchecked-all copy labels the unrestricted default |
| 3. Code rules identical incl. self-exclusion | PASS | Same schema/DAL recipe; 409 + `excludeId` tested |
| 4. `salesEnd < salesStart` rejected, equal valid | PASS | Schema refine on `salesEnd` path (payload + form); equal-date test passes |
| 5. `derivedOpen` truth table unit-tested, non-UTC boundaries inclusive | PASS | `registration-utils.test.ts:88-127` — flag-off, no-dates, before-start, at-start (00:00:00.000 SGT), through 23:59:59.999 SGT, +1ms; DST spring-forward pinned; QA probe added fall-back-day + single-day-window checks (pass) |
| 6. Sales-window cell mapping in event tz | PASS | `getSalesWindowLabel` matches spec mapping; "until Jul 31"/"from Aug 1"/Closed/Open + year-suffix + event-tz-vs-UTC divergence all tested; spec prototype rows reproduced exactly |
| 7. `registrationTypeIds` validated same-event server-side | PASS | Per-id scoped gets (S-3 fix); foreign id → 400 on create AND edit (tested) |
| 8. Search name/code case-insensitive substring; filter contains-OR-empty; AND-composed | PASS | `ticket-types-workspace.tsx:82-95` — exact semantics, client-side per spec |
| 9. Badge total; filtered shows M of N; collapses when unfiltered | PASS (with Minor note D1) | Badge "N tickets" always; filtered appends "· M shown" (`:258-263`, `aria-live="polite"`). Wording differs from spec's footer "Showing M of N" — see D1 |
| 10. `registeredCount` server-owned, capacity ≥ count on edit | PASS | Strip + capacity-below-count tests |
| 11. Delete: confirm; 409 when registeredCount>0; else hard delete | PASS | Route tested both branches; blocked dialog Close-only |
| 12. Reg-type delete blocked by referencing tickets (enforced in reg-type DELETE via array-contains) | PASS | `registration-types/[id]/route.ts:110-126` + `getAdminTicketTypesReferencingRegistrationType` |
| 13. Empty vs filtered-empty distinct; toolbar hidden when zero tickets | PASS | True-empty replaces the whole shell (toolbar not rendered); filtered-empty "No tickets match your filters" + "Clear filters" inside the shell |
| 14. AuthZ identical to T1 AC-10; indexes registered | PASS | Same scope helper; 404 IDOR tests on ticketTypeId; indexes verified |
| 15. Loading/error states; mutations revalidate list + badge | PASS | `loading.tsx` with toolbar skeleton; badge derives from props so `router.refresh()` updates it |

### Cross-cutting

| Concern | Verdict | Evidence |
|---|---|---|
| Semantic tokens only (dark/light) | PASS | Grep across `src/features/registration/` for slate/gray/white/black/orange/blue/red/zinc: zero hits (single false positive: `-translate-y-1/2`). Only literal color is the design-specified emerald Open-badge pair with dark variants (`bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200`) |
| Responsive | PASS | `overflow-x-auto` scroll via table shell, `min-w-[36rem]`/`min-w-[52rem]`, first column `min-w-48`; toolbar `flex-wrap` |
| A11y | PASS | `DialogDescription`/`AlertDialogDescription` always present; icon buttons `aria-label="Edit/Delete {name}"`; tables `aria-label`; sr-only actions header; search + filter `aria-label`s; count badge `aria-live="polite"`; checkbox group `role="group" aria-labelledby`; badge text "Yes"/"No" never color-only; `InfoNote` `role="note"` |
| Multi-org isolation | PASS | Org id in every query/scoped get; cross-org 404s tested; serializers omit `organizationId` from client payloads |
| Nav "Soon" badges removed for the two screens | PASS | `event-nav.ts` — `tickets` and `registration-types` items carry no `comingSoon`/`milestone`/`description`; Pricing correctly still M2 |

## 4. Defects

| ID | Severity | Description | Routed to |
|---|---|---|---|
| D1 | **Minor** (cosmetic wording) | Spec M1-T2 AC-9 asks for a footer reading "Showing M of N" when filters hide rows; implementation renders "N tickets · M shown" inside the count badge (`ticket-types-workspace.tsx:258-263`), following the design doc §3, which conflicts with the spec here (already flagged as reviewer nit N2). Both M and N are conveyed and announced via `aria-live`. | ui-ux-designer (reconcile design doc §3 with spec AC-9; if RL wording stands, one-line change for fullstack-developer) |

No Major or Blocker defects. No regression tests were added because no bugs were found (regression tests are written only for bugs, per policy).

Known accepted items (not defects of this ticket): review nits N1–N7 (TOCTOU noted for later hardening; ticket edit lockout at zero reg types follows design §3 as written), security M-1 (no `firestore.rules` in repo — repo-wide pre-existing gap assigned to Backend Agent before M2), M-2 (`npm audit` chain, dependency ticket), L-1–L-3.

## 5. Verdict

**SIGNED OFF.** All 27 acceptance criteria pass; lint, build, and the 197-test suite are green; H-1 and S-1–S-3 fixes are verified in code and locked by tests; the only open item is one Minor cosmetic wording deviation (D1), below the Major threshold.
