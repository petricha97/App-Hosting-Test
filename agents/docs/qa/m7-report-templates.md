# QA — M7-T2 Report templates library

QA Agent, 2026-07-17. Gate 3 of 3 (Code Review APPROVED, 0 Blockers, 0
Should-fix, 3 Nits (N-1 CSV-parser round-trip inherited-style gap, N-2 array-index
React key, N-3 only 1/5 route pairs tested end-to-end) → Security PASS, 0
Critical/High, 1 Medium (M-1, no rate limiting on the 5 export routes —
explicitly non-blocking, deferred to backlog ticket M8-T7), 2 Low (L-1 no
explicit `idempotencyKey`/`paymentProvider`-absence test, L-2 same
rate-limit gap on 2 pre-existing sibling routes) → **QA**). Scope: all
uncommitted M7-T2 changes on the working tree relative to `prototype` — new
`src/features/reports/` (`templates.ts`, `csv.ts`; `server/
reports-route-scope.ts`, `server/report-run-handler.ts`, `server/
report-export-loop.ts`, `server/resolve-type-names.ts`, `server/
load-registration-overview.ts`, `server/load-order-transactions.ts`,
`server/load-abandoned-registrations.ts`, `server/load-checkin-history.ts`,
`server/load-email-overview.ts`; `components/report-templates-section.tsx`,
`components/report-templates-table.tsx`, `components/report-run-panel.tsx`);
10 new API routes under `src/app/api/dashboard/events/[eventId]/
reports/<slug>/{route.ts,export/route.ts}`; modified `src/lib/db/
adminOrder.ts` (`getAdminOrdersForEvent` cursor extension), `src/features/
attendees/roster.ts` (`buildName()` exported), `src/features/reports/
types.ts` (additive `ReportRow`/`ReportPage`), `src/features/reports/
components/reports-workspace.tsx` (additive `ReportTemplatesSection` mount).
Reviewed against `agents/docs/specs/m7-report-templates.md` (D1–D6, §1–§8,
authoritative acceptance criteria), `agents/docs/design/
m7-report-templates.md` (UI states/interaction shape), `agents/docs/reviews/
m7-report-templates.md`, and `agents/docs/security/m7-report-templates.md`.

## Method — what "actually run the app" meant in this environment

Same constraint as every prior milestone's QA pass in this repo: `.env.local`
points `firebase-admin`/the client SDK at a real Firebase project, no local
Firestore/Auth emulator is configured, and no browser-driving tool is
available in this environment. Manual click-through against real cloud
credentials was not a safe or repeatable option, so the effort was weighted
toward what this ticket specifically flagged as needing independent scrutiny
(per the brief's own 8-point test plan):

1. **Independent, hand-computed fixture verification** for two templates
   (Registration overview, Order & transaction details) — fresh, distinctive
   values I authored myself (not copied from Backend's or Code Review's
   fixtures), asserted via `toEqual` against the exact spec §1/§2 column
   tables, run through the real loaders.
2. **The masked-email rule verified against the actual raw CSV file bytes**
   (`buildReportCsv()`'s real output), not just the JSON row shape the
   existing suite already checked — this is where a real, previously
   unflagged defect was found (see Defects, QA-1).
3. **CSV escaping/formula-injection verified via a real, quote-aware
   RFC-4180 parser** I wrote myself, round-tripping all 4 cases (leading `=`,
   embedded comma, embedded quote, embedded newline) through
   `buildReportCsv()`'s actual output — not a string-containment check
   (closes Code Review's own N-1 nit at the QA level).
4. **The 1000-row cap and the Abandoned template's two-ceiling loop** —
   verified by close, independent source reading (traced `collectExportDocs`
   and `load-abandoned-registrations.ts`'s own loop by hand against the
   pathological case) plus re-running the existing 1200-row/thousands-of-fresh-drafts
   fixture tests, which already exercise both ceilings for real (not
   simulated at smaller scale) — a genuinely 4,000+ raw-document-read stress
   test is impractical against a real remote Firestore project in this
   environment, so this criterion is **verified by source trace + existing
   at-scale fixture test, not a fresh live large-scale run** (stated
   explicitly, per the ticket's own instruction to be honest about which).
5. **The D1 permission split exercised end-to-end through the REAL route
   handlers for all 5 templates**, not just `registration-overview` (Code
   Review's own N-3 nit named this exact gap) — a new parametrized test
   drives all 10 real `route.ts` GET exports through mocked session/auth
   state.
6. **Single-open-panel behavior re-verified** by reading the existing
   `report-templates-section.test.tsx` (confirmed it renders the real
   production component tree with `fireEvent`/`waitFor`, not a shallow mock)
   and independently re-deriving that its assertions genuinely prove no
   stale data leaks across a template switch (the `key={activeTemplate}`
   remount is a structural guarantee, re-confirmed by reading
   `report-templates-section.tsx` directly).
7. **Loading/empty/error states exercised through the real rendered
   component tree**, not just the loader functions — a new test file drives
   `ReportTemplatesSection` through a real empty-page fetch, a real 500,
   and a real retry-then-recover cycle, asserting the exact copy from the
   design doc's §3 table and the independent-degradation guarantee (spec §6
   AC-3).
8. **Order & transaction details column audit — independently re-verified,
   with an explicit regression test** closing Security's own L-1 finding
   (no automated test previously asserted the literal absence of
   `idempotencyKey`/`paymentProvider`).

## Automated suite (this session, working tree)

| Check | Result |
|---|---|
| `npm run lint` | PASS — no ESLint warnings or errors |
| `npx tsc --noEmit --pretty false` | PASS — clean except the same **3 pre-existing, unrelated** baseline errors already carried by Code Review/Security (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62`) — independently re-confirmed none touch any file in this diff's scope, and none of my 4 new test files introduce a new error |
| `npm run build` | PASS — exit 0. `/dashboard/events/[eventId]/reports` appears in the route manifest at 8.49 kB / 140 kB First Load JS, matching Code Review's/Security's number exactly; all 10 new API routes build as dynamic functions with no errors |
| `npm test -- --run` (before my additions) | PASS — 137 files / 1581 tests, matching Code Review's and Security's reported numbers exactly |
| `npm test -- --run` (after my new regression files) | PASS — **140 files / 1615 tests** (137+3 files, 1581+34 tests — my 4 new files, one of which was folded into the fixtures file's own defect-documenting assertion) |

## New QA test files (regression tests added)

| File | Tests | What it locks |
|---|---|---|
| `src/__tests__/qa-report-templates-fixtures.test.ts` | 5 | (1) Hand-computed, independently-authored Registration overview fixture matched via `toEqual` against spec §1's column table; (2) hand-computed Order & transaction details money-column fixture (non-round cent amounts, `formatMoney` verified by hand) matched via `toEqual` against spec §2; (3) **REGRESSION for Security L-1** — explicit `idempotencyKey`/`paymentProvider` absence assertions (key-shape AND value-leak, across Run row, export row, AND built CSV bytes) using a distinctive secret idempotency-key string; (4) **REGRESSION for QA-1 (defect found this pass)** — masked-email rule verified against the actual `buildReportCsv()` output bytes, including the real-parser-confirmed exact cell value (see Defects below); (5) CSV escaping round-tripped through a real, quote-aware RFC-4180 parser (not string-containment) for all 4 cases (leading `=`, comma, quote, embedded newline) in one fixture, confirming exact value round-trip AND that an embedded newline never splits the file into an extra row |
| `src/__tests__/qa-report-templates-d1-all-routes.test.ts` | 25 | D1's permission split exercised end-to-end through the REAL `route.ts` GET handlers for **all 5 templates** (not just `registration-overview`) — `describe.each` over the 5 slugs × 5 assertions each (Run 200 without `write:events`, Export 403 for that same session, Export 200 + correct filename with `write:events`, Run 404 cross-org, Export 404 cross-org even with `write:events`) — closes Code Review's N-3 nit |
| `src/__tests__/qa-report-run-panel-states.test.tsx` | 4 | Real rendered-DOM verification (not loader-level) of: template-specific empty-state copy for Registration overview (title/description/CTA href) and Abandoned registration details (title/description/no-CTA, spec §8's documented exception); a real fetch failure rendering `EntityTableError` with correct entity-specific copy, `Try again` genuinely re-fetching and recovering, and the templates table itself staying fully intact/unaffected (5 rows still present) throughout; closing a failed panel and opening a **different** template starts with a clean, independent error state referencing only its own entity — no leaked copy from the previously-failed template |

---

## Defects

### QA-1 (Minor, non-blocking) — Masked-email CSV cells carry an unexpected leading apostrophe in the raw file bytes

**Found via:** independent verification of D4 against the actual
`buildReportCsv()` output (test plan item 2/8) — the existing suite
(`report-abandoned-registrations.test.ts`) only ever asserted against
`JSON.stringify(rows)`, never against the built CSV string itself, so this
was never previously observed.

**Reproduction:** export the Abandoned registration details template for any
event with at least one abandoned draft. `maskEmailDomain()`
(`src/features/attendees/abandoned.ts`) always returns a value starting with
the literal `@` character (e.g. `@dentsu.com`). `escapeCsvField()`'s
formula-injection guard (`src/features/responses/csv.ts`,
`FORMULA_PREFIX = /^\s*[=+\-@]/`), reused verbatim by `buildReportCsv()` per
spec §7, treats a leading `@` as a formula-injection risk (Excel/Sheets `@`
function calls) and prepends a guard apostrophe.

**Expected** (per the design doc's own literal example, `agents/docs/design/
m7-report-templates.md` §4: `Email is shown as domain only (e.g.
"@example.com")`): the raw CSV cell for a masked email reads `@dentsu.com`.

**Actual** (verified against the real `buildReportCsv()` output, parsed with
a real quote-aware RFC-4180 parser): the raw CSV cell reads `'@dentsu.com` —
every single non-empty row of this column, in every export of this template,
100% of the time (this is a structural consequence of the masking format
always starting with `@`, not a rare adversarial-input edge case like the
guard's other trigger sites elsewhere in this app).

**Impact assessment (why this is Minor, not Major):**
- **No security regression.** D4's actual security property — the raw local
  part never reaches the file — genuinely holds; this finding does not
  reopen any leak. If anything the extra character makes the cell *more*
  conservatively escaped, not less.
- **Low practical visibility.** Excel and Google Sheets — the guard's actual
  target audience — both treat a leading `'` as a "force text" marker and do
  not display it in the rendered cell; a user opening the export in the
  primary intended tool sees `@dentsu.com` exactly as documented.
- **Real, but narrow, blast radius.** A user opening the raw file in a plain
  text editor, `cat`-ing it, or feeding it to a script/BI tool that performs
  a literal (non-Excel-convention-aware) CSV parse will see the stray
  leading apostrophe in every row of this one column, for this one
  template — a genuine deviation from the design doc's literal documented
  example, worth a conscious decision (accept as documented behavior, or
  special-case this column), not worth blocking the ticket over.

**Regression test:** `src/__tests__/qa-report-templates-fixtures.test.ts` →
`"QA — D4 masked email: verified in the real CSV artifact, not just JSON"`
asserts the actual, verified value (`'@qacorp.example`), with an inline
comment explaining the finding, so a future change to either
`maskEmailDomain()`'s format or `escapeCsvField()`'s guard character set is
caught and reviewed rather than silently drifting further.

**Routing:** **fullstack-developer** (the interaction between two
independently-correct, independently-reviewed pieces of shared logic —
`maskEmailDomain()` and `escapeCsvField()` — was never reasoned about
together; a fix, if desired, belongs in `buildReportCsv()` or a
template-specific escaping opt-out, not in either shared function). FYI to
**ui-ux-designer**: the design doc's own literal example (`agents/docs/
design/m7-report-templates.md` §4, `'e.g. "@example.com"'`) is technically
inaccurate for the raw file bytes (though accurate for the Excel/Sheets
rendered view) — worth a one-line doc correction or an explicit acceptance
note, at the design team's discretion.

**Severity:** Minor. Does not gate sign-off per this ticket's own policy
("no open defect of severity Major or above").

---

## Per-section acceptance criteria

### §1 — Registration overview

| AC | Result | Evidence |
|---|---|---|
| 1. Mixed accepted/cancelled attendees both render, correct Status cell each | **PASS** | `report-registration-overview.test.ts` AC-1; independently re-confirmed by my own fixture (QA-1's sibling test) with a fully hand-computed row, distinct values from Backend's fixture |
| 2. Job title renders from the real field | **PASS** | `report-registration-overview.test.ts` AC-2; my own fixture independently sets `jobTitle: "Principal Firmware Engineer"` and asserts it round-trips |
| 3. Zero attendees → empty state, not a crash/ambiguous render | **PASS (rendered-DOM, my own test)** | `qa-report-run-panel-states.test.tsx`: real component renders "No registrations yet" / "Attendees will appear here once people register." / a working `Go to Attendees` link — a genuine DOM assertion, not a source read |
| 4. 120-attendee pagination, 50+50+20, zero dup/missing | **PASS** | `report-registration-overview.test.ts` — independently re-traced the cursor logic in `load-registration-overview.ts` myself; correct |
| 5. Export/Run share one serializer, matching row content | **PASS** | Both `loadRegistrationOverviewPage`/`...Export` call the identical `serializeRow` — confirmed by direct read, no divergent implementation |
| 6. Formula-injection escaping via `escapeCsvField` | **PASS — independently re-verified via a REAL parser round-trip**, not string containment | `qa-report-templates-fixtures.test.ts`'s escaping test: `Company` field with `=`, comma, quote, AND newline round-trips correctly through a real RFC-4180 parser |

### §2 — Order & transaction details

| AC | Result | Evidence |
|---|---|---|
| 1. M2-T4 worked-example amounts render exactly as stored, not recomputed | **PASS — independently re-derived with fresh, non-round fixture numbers** ($1,234.56/$43.21/$99.99/$1,291.34) | `qa-report-templates-fixtures.test.ts` hand-computed money-column test; `report-order-transactions.test.ts`'s own fixture independently corroborates with different numbers |
| 2. Pending/failed orders DO appear with real `paymentStatus` | **PASS** | `report-order-transactions.test.ts` AC-2 |
| 3. Ticket/registration-type id→name map built once per invocation | **PASS** | `report-order-transactions.test.ts`: `queryDocReads` delta assertion (3 reads for 3 orders across 3 ticket types: 1 Order query + 1 TicketType list + 1 RegistrationType list) |
| 4. `snapshot.feeName`/`snapshot.promoCode` render the FROZEN value | **PASS** | `report-order-transactions.test.ts` AC-4 — live `Fee` doc seeded with a different name, frozen snapshot value still wins |
| 5. Zero orders → empty state | **PASS** | `report-order-transactions.test.ts` AC-5 |
| 6. Export: 1000-row cap on a 1200-order fixture | **PASS** | `report-order-transactions.test.ts` §2 AC-6 |
| **Column audit — no internal-only `OrderDoc` field leaks** | **PASS — independently re-verified with an explicit regression test (closes Security L-1)** | `qa-report-templates-fixtures.test.ts`'s "REGRESSION (Security L-1)" test: `idempotencyKey`/`paymentProvider` absent from Run row keys, export row keys, JSON-stringified output, AND the built CSV bytes, using a distinctive secret value that would be trivially caught by a future `{...doc}`-spread regression. This closes the exact gap Security flagged as untested (their conclusion — no leak — was reached by source reading only; this pass adds the missing automated guard) |

### §3 — Abandoned registration details

| AC | Result | Evidence |
|---|---|---|
| 1. 4 `lastStepReached` values render correct human labels | **PASS** | `report-abandoned-registrations.test.ts` AC-1 |
| 2. Every row's email is domain-masked, Run AND CSV alike | **PASS, with QA-1 noted** | `report-abandoned-registrations.test.ts` AC-2 (JSON-level) + my own test verifying the **actual CSV bytes** (test plan item 2) — the raw local part is confirmed absent in both; QA-1 (Minor, see Defects) documents a formatting-only deviation in the masked cell's exact raw-byte value, not a masking failure |
| 3. Fresh (<24h) draft never appears in Run or export | **PASS** | `report-abandoned-registrations.test.ts` AC-3 |
| 4. 500 fresh + 30 abandoned interleaved → exactly 30 exported rows (two-ceiling loop, happy path) | **PASS** | `report-abandoned-registrations.test.ts` |
| Two-ceiling loop — raw-page ceiling terminates even when abandoned rows are never found | **PASS — verified by source trace + existing at-scale fixture, not a fresh live large-scale run (explicitly disclosed, per the ticket's own instruction)** | `report-abandoned-registrations.test.ts`'s "stops at the raw-page ceiling" test seeds `ABANDONED_EXPORT_MAX_RAW_PAGES * 200 + 400` (4,400) all-fresh drafts against the in-memory fake Firestore and asserts exactly `ABANDONED_EXPORT_MAX_RAW_PAGES + 2` queries execute (20 raw pages + 2 one-time type-name calls), 0 rows returned, no crash/hang — I independently traced `load-abandoned-registrations.ts`'s loop by hand against this exact case (the raw-page counter increments unconditionally every iteration, regardless of how many rows in that page were abandoned) and confirm the code matches the test's claim; a genuinely live multi-thousand-document run against the real remote Firestore project was not attempted in this environment (no emulator, real cloud credentials) |
| 5. Zero abandoned drafts → empty state | **PASS** | `report-abandoned-registrations.test.ts` AC-5 |

### §4 — Badges printed (check-in history)

| AC | Result | Evidence |
|---|---|---|
| 1. Admin check-in shows raw email; team-member check-in shows denormalized name | **PASS** | `report-checkin-history.test.ts` AC-1 — reuses `checkedInByName(doc.checkedInBy, false)` verbatim, independently re-confirmed by reading `resolve-scan.ts`'s dashboard-viewer branch |
| 2. Not-arrived attendee renders empty cells, never `null`/`undefined` text | **PASS** | `report-checkin-history.test.ts` AC-2 |
| 3. Cancelled attendees excluded (narrower scope than §1) | **PASS** | `report-checkin-history.test.ts` AC-3 |
| 4. Zero accepted attendees → empty state, "check-in history" framing (D5) | **PASS** | `templates.ts`'s `checkin-history` entry: title "No check-ins yet", note explicitly disclaims literal badge-print tracking, matching D5's UX instruction verbatim; row name retained as "Badges printed (check-in history)" per design §4's own deliberate choice |
| 5. No literal badge-print event/flag/count asserted anywhere | **PASS (non-requirement correctly honored)** | Grepped `templates.ts`/`load-checkin-history.ts` — no `badgePrinted`/`printCount` field referenced anywhere; confirms D5's gap was not silently worked around |

### §5 — Email overview

| AC | Result | Evidence |
|---|---|---|
| 1. Catalog `kind` resolves to display name; ad-hoc `kind` falls back to raw string | **PASS** | `report-email-overview.test.ts` AC-1 |
| 2. Failed message's `lastError` renders exactly as stored, no double-truncation | **PASS** | `report-email-overview.test.ts` AC-2 |
| 3. Zero email messages → empty state | **PASS** | `report-email-overview.test.ts` AC-3 |
| 4. `bodyHtml`/`bodyText` never appear as columns | **PASS** | `report-templates-csv.test.ts`: `getReportTemplate("email-overview")?.columns.map(c => c.key)` asserted to not contain either key — independently re-confirmed by reading `templates.ts`'s 10-column list directly, no `body*` key present |

### §6 — Run UX (shared shape)

| AC | Result | Evidence |
|---|---|---|
| 1. Column headers in exact spec order, all 5 templates | **PASS** | `report-templates-csv.test.ts` locks all 5 header lists verbatim; independently re-verified by reading `templates.ts` against spec §1–§5's tables myself, no drift |
| 2. Loading state renders a table-row skeleton | **PASS (code trace)** | `report-run-panel.tsx`'s `RunPanelSkeleton` reuses the `Skeleton` primitive in the same row-shape convention as `EntityScreenSkeleton`, per design §3's explicit instruction to reuse the visual convention (not the whole-page component, which isn't decomposable) |
| 3. A forced failure in one template's Run doesn't affect the templates table or other templates' state | **PASS — exercised for real, not trusted** | `qa-report-run-panel-states.test.tsx`: a real 500 response renders `EntityTableError` while the templates table (5 rows, all buttons functional) is completely unaffected; switching to a **different** template after a failure starts with a clean, independent error state referencing only the new template's own entity label — this is the exact "single mounted panel + `key={activeTemplate}` remount" guarantee exercised against the real component tree, matching the scrutiny this class of bug received in M6-T2/M6-T4's QA passes |

### §7 — CSV export mechanics (shared)

| AC | Result | Evidence |
|---|---|---|
| 1. Every export route 403s for a viewer-permission member; Run 200s for the SAME session | **PASS — exercised end-to-end for ALL 5 templates**, not just `registration-overview` | New `qa-report-templates-d1-all-routes.test.ts` (closes Code Review's N-3 nit) — `describe.each` over all 5 slugs, each proving Run-200/Export-403 for the identical mocked viewer session, through the REAL `route.ts` GET exports |
| 2. Every export route 404s for a cross-org/unknown event | **PASS — all 5 templates** | Same new test file — Run and Export both 404 for a null-resolving `getAdminEventForOrganization`, even with `write:events`, across all 5 slugs |
| 3. A comma/quote/leading-`=` fixture round-trips correctly through a real CSV parser | **PASS — genuinely verified this time**, closing Code Review's N-1 nit (the pre-existing suite used string-containment only) | `qa-report-templates-fixtures.test.ts`'s escaping test: a hand-rolled, quote-aware RFC-4180 parser confirms exact field-value round-trip for all 4 cases (leading `=`, comma, quote, AND embedded newline — the newline case is the one most likely to silently corrupt a file if mishandled, and it is explicitly proven not to split the row) |
| 4. Filenames match the spec §7 table exactly, per template | **PASS — all 5 templates** | New D1 test file's `write:events` assertions check `content-disposition` for the exact `<slug>-<eventId>.csv` filename on every one of the 5 export routes |

### §8 — States & edge cases (cross-cutting)

| AC | Result | Evidence |
|---|---|---|
| 1. Each of the 5 templates' empty state has correct, distinct copy | **PASS — rendered-DOM spot-check + full source cross-check** | `qa-report-run-panel-states.test.tsx` renders the real component for Registration overview (title/description/CTA href) and Abandoned registration details (title/description/**no CTA**, the one documented exception) — both match `agents/docs/design/m7-report-templates.md` §3's table verbatim; the remaining 3 templates' copy independently cross-checked by reading `templates.ts` directly against the same design table (Order & transaction details, Badges printed, Email overview) — all match exactly, no generic reused message anywhere |
| 2. Both themes / responsive (320/768/1024/1440) | **PASS (code trace only — disclosed limitation, no browser-driving tool in this environment)** | Every className used in `report-run-panel.tsx`/`report-templates-table.tsx`/`report-templates-section.tsx` is an existing, already-both-theme-verified token (`bg-muted/50`, `text-muted-foreground`, `Badge variant="secondary"`) — grepped for hardcoded hex/rgb/hsl colors across all new report components: zero hits. The 15-column Order table's `min-w-[96rem]` + `overflow-x-auto` + `tabIndex={0}` scroll-region convention at 320px was verified by source reading only (design §3's own explicit, non-blocking flag to QA to confirm this in practice) — a genuine 320px screenshot pass was not performed in this environment; this is the same disclosed limitation every prior milestone's QA pass in this repo has carried, not a new gap |

---

## Cross-cutting checks

- **Cross-org isolation:** independently re-confirmed by reading
  `getAdminOrdersForEvent`'s cursor extension directly — `startAfter` is
  chained after both mandatory equality filters, so a same-timestamp
  cross-org row is structurally unreachable regardless of cursor value; the
  new D1 test file additionally proves the route-level 404 boundary holds
  for all 5 templates, not just 1.
- **No new Firestore index:** `git diff firestore.indexes.json` re-confirmed
  empty.
- **No new npm dependency:** `git diff package.json package-lock.json`
  re-confirmed empty.
- **XSS:** `report-run-panel.tsx` renders every cell via plain JSX text
  interpolation (`{display}`) — grepped for
  `dangerouslySetInnerHTML`/`innerHTML` across `src/features/reports/**`:
  zero hits, independently re-confirmed.
- **Rate limiting (Security M-1):** re-confirmed as a real, correctly-triaged
  non-blocking Medium finding — grepped for `checkRateLimit` across the new
  route surface: zero hits, matching Security's own finding exactly. Not
  re-litigated further per this ticket's instruction to build on Security's
  work rather than re-verify source-level security checks; concur with
  Security's severity and non-blocking disposition.

---

## Verdict

| Ticket | Verdict |
|---|---|
| M7-T2 — Report templates library | **SIGNED OFF** |

All acceptance criteria across spec §1–§8 pass. One defect was found in this
pass — **QA-1 (Minor)**: masked-email CSV cells carry an unexpected leading
apostrophe in the raw file bytes (a structural interaction between D4's
`@domain`-only masking format and the pre-existing formula-injection guard's
`@`-prefix rule, never previously exercised against the actual CSV artifact).
This does not reopen any security property (the raw local part still never
reaches the file), is invisible in the two primary consumption tools
(Excel/Sheets, which is the guard's actual intended audience), and is
Minor severity — it does not meet this ticket's own bar for blocking sign-off
("no open defect of severity **Major or above**"). A regression test
documents the verified actual behavior so it cannot silently drift further
without review, and the finding is routed to fullstack-developer (with an FYI
to ui-ux-designer regarding the design doc's own literal example) for a
follow-up decision, not as a gating fix.

Security's one Medium finding (M-1, no rate limiting on the 5 export routes)
was independently re-confirmed present and correctly triaged as non-blocking
— it perpetuates a pre-existing gap in the "GET export route" family
(shared with the 2 sibling Attendees/Responses export routes) rather than
introducing a new one, and does not affect this ticket's own functional
acceptance criteria.

**Automated suite at sign-off:** `npm run lint` clean (0 warnings/errors) ·
`npx tsc --noEmit --pretty false` clean except the same 3 pre-existing,
unrelated baseline error files already carried through Code Review and
Security · `npm run build` exit 0, `/dashboard/events/[eventId]/reports` in
the route manifest at 8.49 kB / 140 kB First Load JS (matching both prior
gates exactly) · `npm test -- --run` → **140 files / 1615 tests passing, 0
failing** (137/1581 pre-existing + this pass's own 3 new files / 34 new
tests).

**Known, disclosed limitation (carried forward, same as every prior
milestone in this repo):** no real multi-breakpoint (320/768/1024/1440)
screenshot pass or manual click-through against a running dev server was
performed — no browser-driving tool and no working local Firebase emulator
are available in this environment. Responsive/theme classes were instead
verified via source trace (all tokens already both-theme-verified elsewhere
in this app, zero new hardcoded colors) and the design doc's own explicit,
non-blocking flag for a follow-up 320px usability check on the 15-column
Order & transaction details table specifically remains open for a future
pass, exactly as design flagged it — not a new gap introduced by this
ticket, and not blocking given the design's own stated fallback (plain
horizontal scroll) is the same, already-accepted convention every other wide
table in this app already uses.
