# Code Review — M7-T2 Report templates library

Code Reviewer, 2026-07-17. Scope: all uncommitted changes in the working tree
relative to `prototype` that belong to M7-T2 — new `src/features/reports/`
(`templates.ts`, `csv.ts`; `server/reports-route-scope.ts`,
`server/report-run-handler.ts`, `server/report-export-loop.ts`,
`server/resolve-type-names.ts`, `server/load-registration-overview.ts`,
`server/load-order-transactions.ts`, `server/load-abandoned-registrations.ts`,
`server/load-checkin-history.ts`, `server/load-email-overview.ts`;
`components/report-templates-section.tsx`, `components/report-templates-table.tsx`,
`components/report-run-panel.tsx`); 10 new API routes under
`src/app/api/dashboard/events/[eventId]/reports/<slug>/{route.ts,export/route.ts}`;
modified `src/lib/db/adminOrder.ts` (`getAdminOrdersForEvent` cursor
extension), `src/features/attendees/roster.ts` (`buildName()` exported,
additive), `src/features/reports/types.ts` (additive `ReportRow`/`ReportPage`),
`src/features/reports/components/reports-workspace.tsx` (additive
`ReportTemplatesSection` mount); new test files
`admin-order-list.test.ts`, `report-abandoned-registrations.test.ts`,
`report-checkin-history.test.ts`, `report-email-overview.test.ts`,
`report-order-transactions.test.ts`, `report-registration-overview.test.ts`,
`report-templates-csv.test.ts`, `report-templates-section.test.tsx`,
`reports-route-scope.test.ts`, `reports-run-export-routes.test.ts`. Reviewed
against `agents/docs/specs/m7-report-templates.md`,
`agents/docs/design/m7-report-templates.md`,
`agents/docs/data-models/m7-report-templates.md`, and `agents/AGENT_LOOP.md`'s
Code Reviewer checklist. (`HANDOVER.md`, `agents/docs/BACKLOG.md`, `memory/`
excluded — orchestration bookkeeping, not code, matching prior review
precedent.)

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the same
  **pre-existing, unrelated** baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62` (3 files),
  matching the Orchestrator's and M7-T1's reported baseline exactly. None
  touch any file in this diff's scope.
- `npm run build` — PASS, exit 0. `/dashboard/events/[eventId]/reports`
  appears in the route manifest at 8.49 kB / 140 kB First Load JS —
  comfortably inside the `< 300kb` app-page JS budget; all 10 new API routes
  build as dynamic functions with no errors.
- `npm test -- --run` — PASS, **137 files / 1581 tests**, matching the
  Orchestrator's reported numbers exactly. All 10 new M7-T2 test files pass.

---

## Mandatory-check results

1. **The permission split (spec D1) — verified file-by-file across all 10
   routes, not just the shared helper — HOLDS, no reversed wiring anywhere.**
   `resolveReportsRouteScope()` (`src/features/reports/server/reports-route-scope.ts:35-79`)
   defaults `requireWriteEvents` to `false` and only applies the
   `write:events` check when a caller opts in (`:62-71`).
   `handleReportRunRequest` (`report-run-handler.ts:15-48`) calls it with
   **no** `options` argument (org-membership only); `handleReportExportRequest`
   (`:50-81`) calls it with `{ requireWriteEvents: true }` explicitly. I then
   read every one of the 10 `route.ts` files individually (not just the two
   shared handlers) and confirmed each is wired to the correct handler, with
   no copy-paste reversal:
   - `registration-overview/route.ts:14` → `handleReportRunRequest`; `registration-overview/export/route.ts:17-22` → `handleReportExportRequest`.
   - `order-transactions/route.ts:14` → `handleReportRunRequest`; `order-transactions/export/route.ts:17-22` → `handleReportExportRequest`.
   - `abandoned-registrations/route.ts:13` → `handleReportRunRequest`; `abandoned-registrations/export/route.ts:16-21` → `handleReportExportRequest`.
   - `checkin-history/route.ts:14` → `handleReportRunRequest`; `checkin-history/export/route.ts:17-22` → `handleReportExportRequest`.
   - `email-overview/route.ts:14` → `handleReportRunRequest`; `email-overview/export/route.ts:17-22` → `handleReportExportRequest`.
   All 5 Run routes call `handleReportRunRequest`; all 5 export routes call
   `handleReportExportRequest`. Zero routes reuse the wrong handler. This is
   locked by both a direct unit test on the scope helper
   (`reports-route-scope.test.ts`: 401/403/404 ladder for Run, plus the
   `requireWriteEvents` 403/200 split) and an end-to-end route test through
   the real `route.ts` exports
   (`reports-run-export-routes.test.ts`: Run 200s for a viewer-permission
   member, the SAME member gets 403 on export on the same event, both 404 on
   cross-org). The end-to-end route test only exercises the
   `registration-overview` pair directly (not all 5) — acceptable given every
   pair is a byte-for-byte structural clone verified by direct reading (same
   posture as M7-T1's own N-1 nit), not a gap that changes the verdict.

2. **The masked-email rule (D4) — VERIFIED, no raw-email leak path anywhere.**
   `templates.ts`'s `abandoned-registrations` column config (`:136-143`) has a
   `maskedEmail` key, never `email` — grepped the whole column list, confirmed
   no other column key could resolve to a raw address. `load-abandoned-registrations.ts`'s
   `serializeRow` (`:41-64`) only ever calls `maskEmailDomain(item.email ?? "")`
   into the `maskedEmail` field; the raw `item.email` value is never assigned
   to any other `ReportRow` key, never logged, never returned elsewhere. This
   holds identically for both `loadAbandonedRegistrationsPage` and
   `loadAbandonedRegistrationsExport` (same `serializeRow` call, not two
   diverging implementations). Locked by dedicated tests asserting the raw
   local part is absent from the **entire serialized row** (`JSON.stringify(page.rows)`/`JSON.stringify(rows)`
   containment checks, not just the masked field's own value) in both Run
   (`report-abandoned-registrations.test.ts:90-101`) and export
   (`:130-141`) — exactly the D4 acceptance criterion the spec names.

3. **Order & transaction details — the first UI surface rendering individual
   `Order` docs — VERIFIED clean, no internal-only fields leaked.**
   `load-order-transactions.ts`'s `serializeRow` (`:30-56`) maps exactly the
   15 spec §2 columns (Order ID, Submission ID, Ticket type, Registration
   type, Fee name, Currency, Subtotal, Discount, Tax, Total, Promo code,
   Payment method, Payment status, Provider payment ID, Created at) — no
   `idempotencyKey`, no `paymentProvider`, no `feeId`/`taxIds`/`promotionId`
   raw ids, no `snapshot.taxLines`/`snapshot.basePriceMinor` beyond what the
   spec names. `idempotencyKey` is seeded in the test fixture
   (`report-order-transactions.test.ts:81`) but never asserted as present in
   any output row — confirmed by direct read that `serializeRow` simply never
   references `doc.idempotencyKey` anywhere. `promoCode`/`feeName` correctly
   read `doc.snapshot.*` (frozen at purchase), not a live re-join, matching
   AC-4's audit-trail-correctness requirement (test at `:176-203`).

4. **Cross-org isolation — PASS on every new DAL/loader path.** Every one of
   the 5 loaders threads `eventId`+`organizationId` from the route scope
   (server-resolved via `resolveReportsRouteScope`, never client-supplied)
   straight into the underlying DAL call with no intermediate trust of any
   client value. The one new DAL surface, `getAdminOrdersForEvent`'s
   `startAfterCreatedAtMs` extension (`adminOrder.ts:61-93`), applies the
   cursor via `.startAfter(Timestamp.fromMillis(...))` **after** the
   `eventId ==`/`organizationId ==` equality filters are already chained —
   cross-org isolation is structural, not cursor-dependent. Locked by a
   dedicated test (`admin-order-list.test.ts:154-170`) seeding a same-timestamp
   row in a different org and confirming it never leaks in via the cursor
   path, plus the existing base cross-org/cross-event test
   (`:88-105`) re-verified unchanged. The `resolveReportsRouteScope` helper
   itself never trusts the client-writable `userDoc.organizationId` directly —
   it re-derives the active org via `resolveActiveOrganizationId()` against
   the server-locked `organizations[]` roster (`reports-route-scope.ts:50-58`,
   carrying forward the SEC M2 Finding 1 fix verbatim), locked by
   `reports-route-scope.test.ts:76-92` (spoofed-switcher 403 test).

5. **1000-row export cap and the Abandoned template's two-ceiling loop —
   VERIFIED real, tested, and not bypassable by a pathological data shape.**
   The shared `collectExportDocs()` helper (`report-export-loop.ts:21-47`),
   reused verbatim by Registration overview / Order & transaction details /
   Badges printed / Email overview, stops at `rowLimit` (1000) OR query
   exhaustion (`page.length < batchSize`), whichever first — each of those 4
   templates has its own 1200-row-fixture test asserting exactly 1000 rows
   (e.g. `report-order-transactions.test.ts:231-244`,
   `report-checkin-history.test.ts:121-134`). Abandoned registration details
   does **not** use this helper (documented explicitly in the helper's own
   header comment) — its own loop in `load-abandoned-registrations.ts:106-134`
   independently enforces **both** ceilings: `collected.length < REPORT_EXPORT_ROW_LIMIT`
   AND `rawPages < ABANDONED_EXPORT_MAX_RAW_PAGES` (=20) in the `while`
   condition. I traced the pathological case by hand (thousands of
   non-abandoned drafts, few/no abandoned ones near the end) against the
   code: the raw-page counter increments unconditionally every iteration
   regardless of how many (if any) rows in that page were abandoned, so the
   loop terminates at 20 raw pages (4,000 raw reads) even if zero abandoned
   rows are ever found — this exact scenario is asserted, not just reasoned
   about, by `report-abandoned-registrations.test.ts:165-187` (a fixture
   engineered to be "well beyond the ceiling," all fresh, asserting the loop
   exits after exactly `ABANDONED_EXPORT_MAX_RAW_PAGES + 2` doc-reading
   queries — the `+2` being the one-time id→name join calls — and returns
   0 rows, not an error, not an infinite loop). The interleaved "30 abandoned
   among 500 fresh" case (spec §3 AC-4) is also directly tested
   (`:144-163`), confirming the loop correctly collects all 30 without
   truncation when the raw-page ceiling isn't actually hit.

6. **CSV escaping — genuinely reused, not reimplemented.**
   `buildReportCsv()` (`src/features/reports/csv.ts:19-32`) imports
   `escapeCsvField` directly from `@/features/responses/csv` (`:5`) — no
   local re-implementation of the formula-injection guard or RFC-4180
   quoting logic anywhere in `src/features/reports/`. Spot-checked by test:
   `report-templates-csv.test.ts:151-170` seeds a `Company` value containing
   both a leading `=` and an embedded comma+quote (`'=SUM(A1),"weird"'`) and
   asserts the exact escaped output (`'=SUM(A1)` prefix, then RFC-4180
   double-quote-wrapped with doubled inner quotes) — correctly escaped.

7. **DAL boundary — PASS.** `grep -rn "firebase/firestore\|firebase-admin"`
   across `src/features/reports/**` and the 10 new API route files returns
   zero hits. Every loader imports only from `@/lib/db/*`. The one DAL change
   (`getAdminOrdersForEvent`'s cursor extension) lives in the correct
   pre-existing DAL file, is backward-compatible (new param optional, zero
   pre-existing callers per Backend's own grep, confirmed independently),
   and needed no new Firestore index (`git diff firestore.indexes.json` is
   empty).

8. **Structure / file size / naming — PASS.** All new files are well under
   the 800-line ceiling — largest is `report-run-panel.tsx` at 271 lines,
   `templates.ts` at 225 lines (a data catalog, not logic), every loader
   80-140 lines. No dead code found (`grep` for `console.log`/`TODO`/`FIXME`
   across the new surface returns nothing). Naming matches both the spec's
   D6 slug table and the design doc's file list exactly. The shared
   `handleReportRunRequest`/`handleReportExportRequest` pair correctly
   centralizes the permission gate, cursor parsing, and CSV response shape
   in one place, exactly as `report-run-handler.ts`'s own header comment
   states — each of the 10 route files is a thin, near-identical wrapper
   supplying only its own loader + column config + filename, which is what
   makes finding #1 above tractable to verify by inspection.

9. **Column-header order per template — PASS, exact spec match.**
   `report-templates-csv.test.ts:31-106` locks all 5 templates' header lists
   verbatim against spec §1–§5's ordered tables (10/15/6/7/10 columns
   respectively) — independently re-verified by reading `templates.ts`
   directly against the spec's own tables, no drift found.

10. **UX/accordion behavior (design §0/§3) — PASS.** Single-open panel via
    `key={activeTemplate}` forcing a clean remount on template switch
    (`report-templates-section.tsx:61-70`), Export CSV always visible with
    no client-side role gate (matches design §5's deliberate,
    already-reasoned posture), focus/scroll-into-view on open
    (`report-run-panel.tsx:108-115`). Locked by
    `report-templates-section.test.tsx`: only one panel region ever exists
    at a time when switching templates (`:57-97`), Run↔Hide label toggle and
    close behavior (`:99-119`), unconditional per-row Export CSV button
    presence (`:41-54`).

---

## Findings

### Should-fix

*(none)*

### Nits (optional)

- **N-1 — Spec §7 AC-3 asks for CSV escaping correctness to be proven via "a
  real CSV parser" round-trip, not a string-equality check on the raw escaped
  output; the actual test (`report-templates-csv.test.ts:151-170`) is a
  string-containment assertion, same as every other escaping test in this
  codebase.** This is not a regression introduced by this ticket — the
  pre-existing `escapeCsvField` test suite it reuses
  (`src/__tests__/responses-csv.test.ts`) uses the identical string-equality
  style, and no CSV-parser library is installed anywhere in this repo to do
  a genuine round-trip. Flagging because the spec names this explicitly as
  an AC, but it's inherited scope, not new risk — the escaping function
  itself is unmodified, already-reviewed code (M3-T4).
- **N-2 — `report-run-panel.tsx:220` uses the row's array `index` as the
  `TableRow` key**, rather than a stable per-row id. `ReportRow` is a plain
  `Record<string, string>` with no guaranteed-unique id across all 5
  templates (only `order-transactions` happens to carry `orderId`), so this
  is a reasonable, if not ideal, choice given the shared-component
  constraint — rows are only ever appended (never reordered/removed) during
  a session, so this carries no correctness risk in practice, just a minor
  React-key hygiene note.
- **N-3 — `reports-run-export-routes.test.ts` only exercises the
  `registration-overview` route pair end-to-end (not all 5)** to prove the
  D1 split holds through the real `route.ts` handlers. This is compensated
  for by finding #1's direct file-by-file reading of all 10 route files
  (each a near-identical, verifiably-correct wrapper) and by the
  route-scope-level unit test's full coverage of the permission logic
  itself — same proportionality precedent as M7-T1's own N-1 nit (mocked
  IDOR coverage rather than a fresh fixture per surface). Not a gap that
  changes the verdict, but a full 5-route parametrized version of this test
  would remove the need for a human reviewer to manually verify the other 4
  pairs' wiring by inspection on every future change to this file.

---

## Verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M7-T2 — Report templates library | **APPROVED** | No blockers, no should-fix items. Three optional nits, none of which touch correctness or security. The ticket's two central security decisions are both independently re-derived from source and confirmed correct: (1) **D1's permission split genuinely holds across all 10 routes individually** — every one of the 5 Run `route.ts` files calls `handleReportRunRequest` (org-membership-only gate) and every one of the 5 export `route.ts` files calls `handleReportExportRequest` (`write:events` gate), verified by reading each of the 10 files' source directly, not just the two shared handlers — zero reversed wiring, zero route that quietly reuses the weaker gate; (2) **D4's masked-email rule has no leak path** — the Abandoned template's `ReportRow` shape carries only `maskedEmail`, never a raw-email key, in both the Run and export code paths (same `serializeRow` function), locked by tests that scan the entire serialized row/JSON for the raw local part, not just the masked field's own value. The Order & transaction details template (first-ever UI surface for individual `Order` docs) was checked column-by-column against `OrderDoc`'s real fields and carries no internal-only field (no `idempotencyKey`, no raw `paymentProvider`/`feeId`/`taxIds`). The Abandoned export's two-ceiling loop (`REPORT_EXPORT_ROW_LIMIT` + `ABANDONED_EXPORT_MAX_RAW_PAGES`) was traced by hand against the pathological "thousands of fresh drafts, abandoned ones sparse/absent" case and is directly exercised by a test engineered for exactly that shape. `npm run lint` (clean), `npx tsc --noEmit` (3-file pre-existing baseline, unchanged), `npm run build` (exit 0, reports route in the manifest at 8.49 kB / 140 kB First Load JS), and `npm test -- --run` (137 files / 1581 tests passing) all independently re-verified, not copied from the Orchestrator's report. |

Overall: **APPROVED** — hands off to the Security Agent. Given D1's own
framing (Security's job is verifying correct enforcement of an
already-chosen gate, not choosing the gate), this review's file-by-file
confirmation that all 10 routes are wired correctly should let Security
focus its attention on: (1) independently re-confirming the same 10-route
wiring claim (do not take this review's word for it — it's exactly the kind
of copy-paste-across-10-files mistake that warrants a second set of eyes);
(2) the Order & transaction details template's exposure class, per D1's own
named flag (first-ever individual `Order` doc rendering) — this review found
no leaked internal field, but Security may want to independently assess
whether `providerPaymentId`/`promoCode` exposure to any org member (not just
Editors) is the intended final posture, given OQ-2's own open question about
whether this template specifically should have a stricter Run gate than the
other four; (3) the generic, non-permission-specific `403` toast UX (design
§5's own named consequence) — confirm this is acceptable defense-in-depth
framing, not a usability gap that undermines the gate in practice.
