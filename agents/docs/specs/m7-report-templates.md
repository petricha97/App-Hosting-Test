# M7-T2 — Report templates library

Research Lead, 2026-07-17. Screen reference: `prototype/prototype/event-reports.html` — the "Report templates" table below the two summary cards (`event-reports.html` lines 69–81: `Report | Category | Run` columns, 5 rows: Registration overview / Attendee, Order & transaction details / Finance, Abandoned registration details / Attendee, Badges printed (check-in history) / Onsite, Email overview / Email). Same screen as **M7-T1** (`agents/docs/specs/m7-reporting-summaries.md`, Done/merged) — this ticket adds the templates table *below* T1's summary cards on the existing `/dashboard/events/[eventId]/reports` route, not a new route for the table shell itself (each template's "Run" output may be its own sub-route or panel, see §6).

Grounded against real, shipped code — no column invented without a source field:
`src/types/collection.ts` (`AttendeeDoc`, `OrderDoc`, `RegistrationDraftDoc`, `EmailMessageDoc`, `CheckinConfigDoc`), `src/lib/db/adminAttendee.ts`, `adminOrder.ts`, `adminRegistrationDraft.ts`, `adminEmailMessage.ts`, `src/features/attendees/{roster,abandoned,csv}.ts`, `src/features/responses/csv.ts` (the CSV escaping primitive), `src/features/checkin/server/resolve-scan.ts` (`checkedInByName`, the L-5 admin-identity-display precedent), `firestore.indexes.json`, `agents/docs/specs/m7-reporting-summaries.md` + `agents/docs/data-models/m7-reporting-summaries.md` (aggregate-query conventions, permission precedent), `agents/docs/specs/m5-attendees-checkin.md` + the M5 L-4 carried note (read-surface permission convention), `agents/docs/specs/m6-lifecycle-triggers.md` §7 (abandoned-reminder trigger, the one legitimate full-email-use path).

## Shared decisions

These are the ticket's central calls — stated once here, referenced by number from each template section below.

**D1 — Two distinct read shapes exist on this screen, and they get two distinct permission gates (the ticket's central security question, answered here, Security to make the final enforcement call per the backlog's own agent assignment):**
- **"Run" (on-screen tabular preview):** gates the **same as every other PII-bearing read surface in this codebase** — session → `getDashboardScope()` (org membership), **no `write:events` check**. This is not a new posture: the M5 attendee roster page already renders full attendee names/emails at this exact gate (M5 L-4 carried note, `agents/docs/specs/m5-attendees-checkin.md`: "M5 read pages gate org membership, not write:events"), and M7-T1 (same screen) already applies this gate to its two summary cards. A report's on-screen preview is a *read*, not a mutation — gating it more strictly than the roster screen it's built from would be an inconsistent, un-argued-for restriction, not a security improvement.
- **CSV export (a route, not a page):** gates on **`write:events`**, reusing the *exact* precedent this codebase already shipped for the sibling PII export: `src/app/api/dashboard/events/[eventId]/attendees/export/route.ts` goes through `resolveRegistrationRouteScope()` (`src/features/registration/server/route-scope.ts`), which requires `write:events` even though the HTTP verb is `GET` — the route-scope helper's own comment states the rule explicitly: *"Every consumer of this helper is a mutating route... reads go through the server pages, which gate on org membership only."* A CSV **download** is treated by this app's existing convention as belonging to the *mutating-route-adjacent* tier, not the plain-page-view tier — likely because a downloaded file is a data **exit** (forwardable, storable outside the app, outside this app's own future audit/visibility) in a way an on-screen render inside the authenticated dashboard is not. **This spec reuses that exact, already-reviewed split rather than inventing a third permission tier**: Run = org-membership gate (matches every sibling on-screen PII surface); Export = `write:events` gate (matches the one sibling PII *export* route that exists today). Every new report API route in this ticket (list/paginate for Run, and the 5 export routes) is built against a `resolveReportsRouteScope()` helper mirroring `resolveRegistrationRouteScope()`'s shape 1:1 (session → user → active org → **for export only**: `write:events` check → `getAdminEventForOrganization` → 404 on null) — Run's own list/paginate routes (if any exist beyond the initial server-rendered page) skip the `write:events` check, matching `getDashboardScope()`'s org-membership-only shape.
- **Why this is the central, non-punted decision (not deferred to Security wholesale):** the backlog flags "export contains PII — role gate" as Security's job, but *which* gate to use is a product/architecture decision this spec is positioned to make, because the codebase already answers it — Security's remaining job (per backlog) is to verify the chosen gate is *correctly enforced* (IDOR, cross-org, no route that quietly reuses the weaker Run gate for the export path), not to invent the gate from scratch.
- **One genuinely new consideration flagged for Security's attention, not resolved here:** the **Order & transaction details** template is the **first UI surface ever to render individual `Order` line items** — every `Order` doc has been server-only, zero-UI, audit-trail-only through M2–M7-T1 (`OrderDoc`'s own file comment: "Orders are SERVER-ONLY... no client repo pair... firestore.rules denies all client access"; M7-T1 only ever *aggregates* `Order` amounts, never lists rows). This template is a materially new exposure class (individual transaction detail, `snapshot.promoCode`, `providerPaymentId`) — Security should give this one specific, named attention during review, not just the generic "does export contains PII" checklist item. See §2.

**D2 — Pagination (Run) vs. export-volume (CSV) are two different mechanisms, not the same query at two page sizes:**
- **Run (on-screen preview): bounded, cursor-paginated, page size 50** — reusing the *exact* "load more" convention already shipped for every list in this codebase (`ATTENDEE_LIST_LIMIT`/`ORDER_LIST_LIMIT`/`EMAIL_MESSAGE_LIST_LIMIT`/`REGISTRATION_DRAFT_LIST_LIMIT` are all `50`; cursor = the last row's relevant timestamp field in milliseconds, `startAfter<Field>Ms`). No template invents a new page size or cursor shape — every one of the 5 templates' underlying DAL methods already supports (or, per §7's gap list, needs a small backward-compatible extension to support) exactly this shape.
- **CSV export: the FULL dataset up to a hard, documented row ceiling — `REPORT_EXPORT_ROW_LIMIT = 1000`** — reusing the *existing, already-shipped* precedent verbatim: `ATTENDEES_EXPORT_LIMIT = 1000` (`src/features/attendees/csv.ts`) and `RESPONSES_EXPORT_LIMIT = 1000` (`src/features/responses/csv.ts`, whose own comment already states the fallback posture this spec adopts: *"Larger events need filtered exports (status/event) until a streaming/batched exporter lands (M7 reports)"*). **This ticket is that "M7 reports" moment, and the decision is: still no streaming/batched exporter — same bounded, synchronous, single-HTTP-response CSV, same 1000-row ceiling, for all 5 templates.** Rationale: (a) consistency — a different cap per surface with no principled reason would be an arbitrary inconsistency; (b) YAGNI — this app has no event-size data suggesting >1000 rows in any one report category is a real, current need, and the existing two export routes already accepted this exact tradeoff; (c) a genuine streaming/chunked exporter is real, non-trivial infrastructure (response streaming, or an async job + polling + storage + signed-download-link, none of which exist anywhere in this codebase) that this ticket's scope does not justify building speculatively.
- **How the export loop reaches "full dataset up to the cap" without hand-waving:** each export route internally loops the same list DAL method used by Run, at a **larger internal batch size (200 rows per Firestore call, not the 50 used on-screen)** — purely a server-side implementation parameter, invisible to the client, reducing round-trips for a background export computation vs. a user-facing "next page" click — accumulating rows until **either** `REPORT_EXPORT_ROW_LIMIT` (1000) rows are collected **or** the underlying query is exhausted (`page.length < batchSize`), whichever comes first. **One template (Abandoned registration details, §3) needs an extra wrinkle documented explicitly in that section**, because its underlying query returns *all* drafts (abandoned and fresh) and the abandoned subset is filtered in memory per page — so the loop must also cap the number of *raw* pages fetched (a hard ceiling independent of the 1000-abandoned-row cap) to bound worst-case reads on an event with thousands of fresh (non-abandoned) in-flight drafts and comparatively few actually-abandoned ones.
- **Explicit non-goal, stated plainly:** no async export job, no email-the-file-when-ready flow, no progress bar for a long export — the whole export is one bounded, synchronous request/response, same as the two existing CSV exports in this app. If a future event's real usage exceeds 1000 rows in one report category, that is a **new ticket** (streaming/chunked/async export), not a silent scope-creep item here — same posture `RESPONSES_EXPORT_LIMIT`'s own comment already took.

**D3 — "Run" is synchronous, page-load/API-call speed, no background job, for this ticket's scope.** The largest single unit of work this ticket ever performs is the CSV export loop (§D2, ≤1000 rows via ≤5 sequential 200-row Firestore page reads) — well within a typical serverless function's request timeout, and consistent with every other synchronous route in this codebase (no route in M0–M7-T1 uses a background job or queue). **Explicit ceiling, not an open-ended promise:** if a future event's export genuinely needs more than 1000 rows or the per-call latency at that ceiling proves unacceptable in practice, that is Backend's job to measure and escalate during a later ticket — not speculatively solved here (same posture M7-T1 §3 took toward its own aggregate-query ceiling).

**D4 — Abandoned registration details shows the MASKED email, never the full address — in the on-screen Run preview AND in the CSV export alike (the ticket's other flagged, deliberately-decided PII question).**
- The Abandoned tab (M5-T3, `src/features/attendees/abandoned.ts`) already established the rule and its own reasoning in code: *"the FULL email is never rendered — or even serialized — on this surface. Masking happens server-side... so the local part never crosses the RSC/API boundary."* The **one** legitimate path where the full email is used is M6-T3's abandoned-reminder send (`src/features/attendees/components/abandoned-tab.tsx`'s "Email all" → `POST .../drafts/email-all`), which resolves and uses the address **server-side only**, inside the transport — it is never returned to any client, ever, for any reason, in the current app.
- **Decision: this report template inherits that exact rule, unchanged, for both Run and CSV.** A downloaded CSV is, if anything, a *higher*-risk exposure surface than the already-reviewed masked on-screen table (a file can be forwarded, stored on a laptop, attached to an unrelated email, retained indefinitely outside this app's own access logs) — so there is no principled argument for the export to carry *more* PII than the screen it mirrors. The "easiest" implementation choice would be to read `RegistrationDraftDoc.email` directly and put the raw value in the CSV cell (nothing technically stops that) — this spec explicitly rejects that as the wrong call: **no legitimate operational need requires a human staff member to hold the literal email address in a spreadsheet** — the one legitimate use of the real address (the reminder send) already happens entirely server-side without any person ever needing to see it. Reusing `maskEmailDomain()` (`src/features/attendees/abandoned.ts`) verbatim for the CSV cell is therefore both the more consistent AND the more conservative choice, and this spec picks it deliberately, not by default.
- **Consequence for QA/Security:** any test fixture asserting "the CSV never contains a full email address for this template" is a real, intended acceptance criterion (§3 AC), not an incidental one.

**D5 — "Badges printed (check-in history)" has a real, hard data gap: no per-attendee badge-print event exists anywhere in this codebase today.** Grounded by exhaustive search, not assumption:
- `AttendeeDoc` (`src/types/collection.ts`) has no `badgePrinted`/`printedAt`/`printCount` field of any kind.
- `CheckinConfigDoc.selfPrintBadges` (`src/types/collection.ts`, `src/lib/db/adminCheckinConfig.ts`) is a **manual organizer settings toggle** ("does self-print badge printing exist as an option at this event"), not a per-attendee event log — flipping it does not record who printed what, when.
- `src/features/checkin/components/badge-preview-card.tsx` is a **design preview** (what the badge *would* look like for the first accepted attendee) — decorative, not a print-tracking mechanism.
- The only real, timestamped, per-attendee event this codebase has that is even adjacent to "badge printed" is **check-in** itself (`AttendeeDoc.checkedInAt` / `checkedInBy`, M5-T5) — a physically different real-world action (scanning someone in at the door) from printing their badge (which, per the prototype's own settings screen, may happen self-service at a kiosk, or be handed out pre-printed, independent of when/whether that person is later scanned in).
- **Decision (per this ticket's own non-goal instruction — flag, don't silently invent): ship this template using check-in history as the real, existing, grounded data source, exactly as the prototype's own parenthetical already names it ("Badges printed **(check-in history)**")** — i.e., treat the prototype's own subtitle as licensing this substitution, not as two different things this ticket must reconcile. The report's columns (§4) are 100% grounded in `AttendeeDoc`'s check-in fields; **no new field, no new collection, no new tracking infrastructure is added by this ticket.** The report's own on-screen copy/description (a UX-layer decision, flagged for UX) should say "check-in history," not claim to literally count badges printed, so organizers are not misled about what the number represents.
- **Open question / forward dependency, explicitly not solved here:** if a future ticket needs literal badge-print counts (e.g., distinguishing "checked in but never printed because the printer jammed" from "printed twice by mistake"), that requires **new** tracking — a `badgePrintedAt`/`printCount` field on `AttendeeDoc` or a new event-log collection, written from wherever the self-print/kiosk flow eventually gets built (no such flow exists yet either — `selfPrintBadges` is a bare boolean toggle with no consuming UI beyond the settings screen itself). This spec does **not** propose that infrastructure — it is out of scope per the ticket's own non-goals, and is named here as an explicit gap for the Orchestrator to decide whether it warrants a new backlog ticket, not something Backend should build unprompted during this ticket's Implement step.

**D6 — Category badges and template identifiers** (prototype-matched, needed for routing/testing):

| Template | Category badge (prototype) | Slug (`ReportTemplateId`) |
|---|---|---|
| Registration overview | Attendee | `registration-overview` |
| Order & transaction details | Finance | `order-transactions` |
| Abandoned registration details | Attendee | `abandoned-registrations` |
| Badges printed (check-in history) | Onsite | `checkin-history` |
| Email overview | Email | `email-overview` |

## 1 — Registration overview

*As an event organizer, I want a full, row-level list of every registrant record (accepted or cancelled) with their ticket/type/check-in detail, so I can audit or hand off the complete registration list — not just the ticket-type counts M7-T1's chart already gives me.*

**Data source: `Attendee` docs** via `listAdminAttendeesForEvent` (`src/lib/db/adminAttendee.ts`, already exists, already cursor-paginated by `createdAt` descending) — **not** `FormData`/pending submissions (those are a materially earlier lifecycle stage, already covered by the Responses screen's own CSV export, M3-T4; duplicating them here would blur "registration overview" into "everything that was ever submitted," which is a different report).

**Deliberate divergence from M7-T1's "Registered = accepted only" convention, stated explicitly (not silent):** this template's query is **unfiltered by `status`** — it returns both `"accepted"` and (the currently-unreachable-but-model-real) `"cancelled"` attendees, with the row's own **Status** column showing which. M7-T1's chart is a curated "who currently counts as registered" metric; this report is a row-level **audit** list, and an audit list's whole purpose is completeness — hiding a cancelled registrant from a detail report an organizer might use for reconciliation would be the wrong call, even though `status: "cancelled"` is model-only today (no cancel UI ships anywhere through M6 — see M5's own documented gap). The query itself needs no new filter logic to support this: omitting the `status` argument to `listAdminAttendeesForEvent` already returns every attendee, unfiltered, served by the existing base composite index (`Attendee: eventId ASC, organizationId ASC, createdAt DESC`) — zero new index, zero new DAL method for this template's core query.

### Column spec (ordered, exact)

| # | Column | Type | Source field | Notes |
|---|---|---|---|---|
| 1 | Name | string | `firstName` + `lastName` (joined; falls back to `email`, then `"Unnamed attendee"` — reuse `buildName()`, `src/features/attendees/roster.ts`, verbatim) | |
| 2 | Email | string | `AttendeeDoc.email` | **Full, unmasked** — `Attendee` is not the PII-minimized record `RegistrationDraft` is (Q3 locked only applies to drafts); the Attendee roster (M5-T2) already renders and exports this in full today (`buildAttendeesCsv`'s existing "Email" column) — no new exposure. |
| 3 | Company | string | `AttendeeDoc.company` | Empty string, never `null`/`undefined`, rendered as `""` in CSV. |
| 4 | Job title | string | `AttendeeDoc.jobTitle` | **New relative to the existing attendees CSV** (`buildAttendeesCsv` omits it) — the field is real and already denormalized onto every `Attendee` doc; adding it here is not a gap, just a column the sibling export happened not to include. |
| 5 | Registration type | string | `AttendeeDoc.registrationTypeLabel` | `"—"` fallback per the existing `ROSTER_LABEL_FALLBACK` convention when empty. |
| 6 | Ticket type | string | `AttendeeDoc.ticketLabel` | Same fallback convention. |
| 7 | Status | string | `AttendeeDoc.status` | Rendered `"Accepted"` / `"Cancelled"` (title-cased display, not the raw enum value). |
| 8 | Check-in state | string | `AttendeeDoc.checkInState` | Rendered `"Checked in"` / `"Not arrived"`. |
| 9 | Checked-in at | ISO datetime string or empty | `AttendeeDoc.checkedInAt` | `timestampToIso()` (`src/features/attendees/roster.ts`), empty string when `null`. |
| 10 | Registered at | ISO datetime string | `AttendeeDoc.createdAt` | The attendee's accept-time timestamp — the report's own "when" column, distinct from `checkedInAt`. |

**Acceptance criteria**
1. An event with a mix of accepted and cancelled (hand-seeded) attendees renders both in the Run table and the CSV, each with its own correct Status cell — proves this template does not silently reuse M7-T1's accepted-only filter.
2. Job title renders from the real `AttendeeDoc.jobTitle` field for a fixture with a non-empty value — proves this is a real column, not a placeholder.
3. Zero attendees for the event → the template's empty state (§8), not a crash, not a phantom "0 rows" table render with headers only left ambiguous about whether data failed to load vs. is genuinely absent.
4. Run pagination: a 120-attendee fixture returns page 1 (50 rows) + "Load more" cursor pointing at row 50's `createdAt`; clicking through yields the remaining 70 across 2 more calls with zero duplicate/missing rows (standard cursor-pagination correctness test, same shape as the M5 roster's own precedent test).
5. Export: the same 120-attendee fixture's CSV contains all 120 data rows (under the 1000 cap) in one file, matching the Run table's row content exactly (proves Run and export share one source-of-truth serializer, not two divergent implementations).
6. CSV values pass through `escapeCsvField` (`src/features/responses/csv.ts`) — a `Company` value starting with `=` (formula-injection attempt) is prefixed with `'` in the exported cell (reuses the existing, reviewed escaping rule verbatim, not a new implementation).

## 2 — Order & transaction details

*As an event organizer or finance reviewer, I want row-level transaction detail — not just M7-T1's aggregate totals — so I can reconcile individual payments, discounts applied, and tax lines.*

**This is the first UI surface in this app's history to render individual `Order` documents** (see D1's flagged Security note) — `OrderDoc` has been a server-only, zero-client-repo, audit-trail-only collection through every milestone from M2 to M7-T1. Grounded strictly in `OrderDoc`'s real fields (`src/types/collection.ts`).

**Data source:** `Order` docs via `getAdminOrdersForEvent` (`src/lib/db/adminOrder.ts`) — **needs one small, backward-compatible DAL extension** (see §7 gap list: add `startAfterCreatedAtMs`/`limit` cursor params, mirroring the exact shape `listAdminAttendeesForEvent`/`listAdminOrdersForEventByPaymentStatus` already use). No new index: the function already orders by the existing composite index (`Order: eventId ASC, organizationId ASC, createdAt DESC`) — adding a `startAfter` cursor on the same already-ordered field needs nothing new.

**Human-readable labels require one join, not a new denormalization:** unlike `Attendee`, `OrderDoc` does **not** carry a registration-type/ticket-type display label — only `ticketTypeId`/`registrationTypeId` (raw ids) plus `snapshot.feeName` (the fee's name, frozen at purchase — already real and free). The report loader resolves ticket-type/registration-type **names** via one bounded, already-existing list call each (`getAdminTicketTypesForEvent`, `getAdminRegistrationTypesForEvent` — both ≤ `TICKET_TYPE_LIST_LIMIT`/similar small per-event bound, same convention M7-T1 §3 already uses for its own ticket-type enumeration), built into an in-memory `id → name` map **once per Run/export call**, not once per row — avoiding an N+1 read pattern for what would otherwise be a per-row document fetch.

### Column spec (ordered, exact)

| # | Column | Type | Source field | Notes |
|---|---|---|---|---|
| 1 | Order ID | string | `Order` doc id | Opaque deterministic hash (`orderIdFromIdempotencyKey`) — included as the row's unique reference key, not a secret (no capability is derivable from it; `firestore.rules` already denies all client reads regardless of id knowledge). |
| 2 | Submission ID | string or empty | `OrderDoc.submissionId` | Empty when `null` (legacy/no-submission orders). |
| 3 | Ticket type | string | resolved via `ticketTypeId → TicketType.name` map | Falls back to `"—"` if the id no longer resolves (deleted ticket type — currently unreachable per M1-T2 AC-11's delete-block-while-referenced rule, documented the same way M7-T1 §1 documents its own unreachable case). |
| 4 | Registration type | string | resolved via `registrationTypeId → RegistrationType.name` map | Same fallback rule. |
| 5 | Fee name | string | `OrderDoc.snapshot.feeName` | Frozen at purchase — never re-joins to the live `Fee` doc, which may have since changed name/price (audit-trail correctness, same principle as every other `snapshot.*` field). |
| 6 | Currency | string (ISO code) | `OrderDoc.currency` | |
| 7 | Subtotal | money (minor units, formatted) | `OrderDoc.amounts.subtotalMinor` | `formatMoney()` (`src/features/pricing/utils.ts`), reused verbatim — no new formatter, matching M7-T1 §2 AC-6's own rule. |
| 8 | Discount | money | `OrderDoc.amounts.discountMinor` | |
| 9 | Tax | money | `OrderDoc.amounts.taxMinor` | |
| 10 | Total | money | `OrderDoc.amounts.totalMinor` | |
| 11 | Promo code | string or empty | `OrderDoc.snapshot.promoCode` | Empty when `null` — this is the **frozen code text at purchase**, not a live re-lookup; already an existing, reviewed field (M2-T2). |
| 12 | Payment method | string | `OrderDoc.paymentMethod` | Title-cased (`Card`/`Invoice`/`Comp`/`None`). |
| 13 | Payment status | string | `OrderDoc.paymentStatus` | Title-cased (`Paid`/`Outstanding`/`Comped`/`Pending`/`Failed`) — **unlike M7-T1's finance card, this report includes `pending`/`failed` orders** (a transaction-detail audit report's job is completeness, the same reasoning as §1's cancelled-attendee inclusion — an organizer reconciling payments needs to see the declined/abandoned attempts too, not just the settled ones). |
| 14 | Provider payment ID | string or empty | `OrderDoc.providerPaymentId` | Simulated-provider reference (M2-T4); empty when `null`. |
| 15 | Created at | ISO datetime | `OrderDoc.createdAt` | |

**Acceptance criteria**
1. The M2-T4 worked-examples fixtures (same 4-row fixture set M7-T1 AC §2 AC-1 reuses: plain card → paid, %+tax → paid, fixed+cap → outstanding, partner comp → comped) render as 4 rows with amounts matching the stored `amounts.*` fields exactly (not recomputed, not re-derived — proves the report reads stored data, doesn't re-run pricing math).
2. A `pending` and a `failed` order (seeded fixtures) **do** appear in this report (unlike M7-T1's finance card, which excludes them) — with their real `paymentStatus` value shown, not omitted.
3. Ticket-type/registration-type names resolve correctly for a fixture with 3 distinct ticket types across the exported rows — proves the id→name map is built once and applied per-row correctly, not a per-row query (spy-based assertion: at most one `getAdminTicketTypesForEvent`/`getAdminRegistrationTypesForEvent` call per Run/export invocation, regardless of order count).
4. `snapshot.feeName`/`snapshot.promoCode` render the **frozen** value even after the underlying `Fee`/`EventPromotion` doc's name/code has since changed (audit-trail correctness test, mirroring the existing `OrderSnapshot` guarantee).
5. Zero orders for the event → the template's empty state (§8).
6. Export: 1000-row cap enforced via the internal 200-row-batch loop (§D2) — a fixture with 1200 orders exports exactly 1000 rows, not 1200, with no error (documents the cap is a silent, correct truncation, not a crash).

## 3 — Abandoned registration details

*As an event organizer, I want the full list of abandoned registrations (not just the Abandoned tab's on-screen table) available as a report — the same masked-PII rules the Abandoned tab already established must hold here too (D4).*

**Data source:** `RegistrationDraft` docs via `getAdminRegistrationDraftsForEvent` (`src/lib/db/adminRegistrationDraft.ts`, already exists, already cursor-paginated by `updatedAt` descending, already computes `isAbandoned` per item) — **the exact same DAL method and the exact same in-memory `isAbandoned` filter** the Abandoned tab (M5-T3) already uses, reused verbatim, not reimplemented.

**PII rule: masked email only, in Run AND export alike (D4) — reuses `maskEmailDomain()` (`src/features/attendees/abandoned.ts`) verbatim, never the raw `RegistrationDraftDoc.email` field.**

**Pagination wrinkle (the one template where D2's export loop needs an extra bound, stated explicitly, not hand-waved):** `getAdminRegistrationDraftsForEvent` returns *all* drafts (fresh in-flight + genuinely abandoned) ordered by `updatedAt`, and `isAbandoned` is filtered **in memory** per page — exactly as the existing Abandoned tab already does and documents ("a page of mostly-fresh drafts yields few abandoned rows per click"). This means the export loop's stopping condition needs **two** independent ceilings, not one:
1. Stop once `REPORT_EXPORT_ROW_LIMIT` (1000) **abandoned** rows have been accumulated (the normal D2 rule), **or**
2. Stop once a **hard raw-page-fetch ceiling** is hit — **`ABANDONED_EXPORT_MAX_RAW_PAGES = 20`** (at the export loop's 200-row internal batch size, this bounds the worst case to 4,000 raw `RegistrationDraft` document reads even if an event has thousands of fresh, non-abandoned, still-in-progress drafts and comparatively few actually-abandoned ones) — **whichever comes first.**
- **Why this ceiling is necessary and why it's not the same as D2's generic rule:** every other template's underlying query returns *only* rows that belong in the report (an equality filter does the selection at the Firestore layer); this is the one template where the "is this row even in scope" decision happens in application memory, after the document is already read — so a naive "loop until 1000 matching rows" could, in the worst case, read the *entire* `RegistrationDraft` collection for an event with a huge number of fresh (non-abandoned) drafts and never reach 1000 abandoned ones. The raw-page ceiling caps that worst case explicitly, the same way M7-T1 §3 named an explicit ceiling for its own aggregate-query fan-out rather than leaving it open-ended.
- **Consequence, stated plainly (documented, not silently swallowed):** on an event that hits the raw-page ceiling before accumulating 1000 abandoned rows, the export returns fewer than the true total of abandoned drafts. This is an acceptable, documented truncation for this ticket's scope (matching `RESPONSES_EXPORT_LIMIT`'s own precedent posture) — not expected to occur in this product's realistic per-event abandonment volumes, and revisited only if real usage proves otherwise.

### Column spec (ordered, exact)

| # | Column | Type | Source field | Notes |
|---|---|---|---|---|
| 1 | Name | string | `firstName` + `lastName` (same join/fallback rule as `serializeAbandonedDrafts`, `src/features/attendees/abandoned.ts`) | `"—"` when both parts are blank. |
| 2 | Email (masked) | string | `maskEmailDomain(RegistrationDraftDoc.email)` | **Never the raw address** — domain-only (`"@dentsu.com"`) or `"—"` (D4). |
| 3 | Last step reached | string | `DRAFT_STEP_LABELS[lastStepReached]` (`src/features/attendees/abandoned.ts`) | Human label ("Personal Information" / "Ticket & Options" / "Registration Summary" / "Payment"), not the raw enum. |
| 4 | Ticket type selected | string or empty | resolved via `ticketTypeId → TicketType.name` map (same join technique as §2) | Empty when `ticketTypeId` is `null` (not yet reached step 2). |
| 5 | Registration type selected | string or empty | resolved via `registrationTypeId → RegistrationType.name` map | Same rule. |
| 6 | Last activity | ISO datetime | `RegistrationDraftDoc.updatedAt` | The field the abandonment threshold itself is measured against (`ABANDONED_AFTER_MS`) — this is the report's "date" column the prototype names. |

**Acceptance criteria**
1. A fixture with abandoned drafts at each of the 4 `lastStepReached` values renders 4 rows with the correct human-readable step labels — never the raw enum string.
2. Every row's email column is domain-masked in both Run and CSV — a test asserting the exported CSV's raw bytes contain **zero** `@`-preceded full local-parts from the seeded fixture emails (only the masked `@domain` form) is a real, required assertion (D4).
3. A fresh (non-abandoned, <24h) draft fixture never appears in either Run or export, even though the underlying DAL call returns it in the raw page (proves the `isAbandoned` in-memory filter is applied correctly, reusing the exact same filter the Abandoned tab already ships).
4. A stress fixture with 500 fresh drafts interleaved with 30 abandoned ones (across enough raw pages to require several internal export-loop iterations) exports exactly 30 rows — proves the two-ceiling loop (row count vs. raw page count) terminates correctly on the "abandoned rows are sparse" case, not just the happy path where every row qualifies.
5. Zero abandoned drafts (whether zero drafts at all, or drafts that are all still fresh) → the template's empty state (§8) — not an empty-array silently rendering nothing, and not confused with "failed to load."

## 4 — Badges printed (check-in history)

*As an onsite/check-in lead, I want a per-attendee check-in history list — who has and hasn't arrived, and when — for reconciliation at the door or after the event.* (Per D5: this is a real check-in-history report, not a literal badge-print-event report — that data does not exist.)

**Data source:** `Attendee` docs via `listAdminAttendeesForEvent` filtered `status: "accepted"` (unlike §1's audit-everything scope, this template's framing is "who is expected to arrive and did they" — a cancelled registrant was never going to be checked in, so including them here would add noise without audit value; this is a **deliberate, narrower scope** than §1, stated so it isn't read as an inconsistency).

**"Checked-in by" resolution reuses the existing, already-reviewed `checkedInByName()` helper verbatim** (`src/features/checkin/server/resolve-scan.ts`, M5-T5 / M6-T2 L-5 fix): called with `viewerIsTeamSession = false` (its default) — **this is not a new decision**, it is the exact same call shape already used everywhere a dashboard-admin (as opposed to a team-scanner session) views a `checkedInBy` value. The function's own doc comment already states the applicable rule: *"The dashboard admin surface is unaffected (an admin viewing their own dashboard already has that identity)"* — since the Reports screen is dashboard-only (never reachable from a team-member scanner session, which has no navigation into `/dashboard/events/[eventId]/reports` at all), the raw admin email (`checkedInBy.userId`) renders as-is for `kind: "admin"` check-ins, and the team member's denormalized `name` renders for `kind: "team-member"` check-ins — **no new join, no new masking logic, no new gap.**

### Column spec (ordered, exact)

| # | Column | Type | Source field | Notes |
|---|---|---|---|---|
| 1 | Name | string | `firstName` + `lastName` (same `buildName()` join/fallback as §1) | |
| 2 | Email | string | `AttendeeDoc.email` | Full, unmasked — same justification as §1 column 2 (Attendee is not PII-minimized the way drafts are). |
| 3 | Registration type | string | `AttendeeDoc.registrationTypeLabel` | |
| 4 | Ticket type | string | `AttendeeDoc.ticketLabel` | |
| 5 | Check-in state | string | `AttendeeDoc.checkInState` | `"Checked in"` / `"Not arrived"`. |
| 6 | Checked-in at | ISO datetime or empty | `AttendeeDoc.checkedInAt` | Empty when `null` (not yet arrived). |
| 7 | Checked-in by | string or empty | `checkedInByName(AttendeeDoc.checkedInBy, false)` | Empty when `checkedInBy` is `null`. Team-member name or admin email, per the reused helper (see above). |

**Acceptance criteria**
1. A fixture with both an admin-recorded check-in (`kind: "admin"`) and a team-member-recorded check-in (`kind: "team-member"`) renders the admin's raw `userId` (email) for the first row and the team member's denormalized `name` for the second — proves the reused helper's dashboard-viewer branch, not the team-session-masked branch, is the one wired in on this screen.
2. A `"not-arrived"` attendee renders empty `Checked-in at`/`Checked-in by` cells, never `null`/`"null"`/`undefined` literal text.
3. `status: "cancelled"` attendees (hand-seeded, model-only) do **not** appear in this report (the narrower scope decision above) — a test seeding one alongside accepted attendees confirms it's excluded, distinguishing this template's scope from §1's.
4. Zero accepted attendees → the template's empty state (§8), with copy that names this as "check-in history," not "badges printed," per D5's UX-facing framing note.
5. **Explicit non-requirement, stated so QA doesn't invent a test for data that doesn't exist:** no acceptance criterion in this section requires or asserts anything about a literal "badge printed" event, flag, or count — that data source does not exist (D5) and this ticket does not add it.

## 5 — Email overview

*As an event organizer, I want a send-log-style overview of every email this event has sent (or attempted), so I can audit delivery without opening the Emails screen's own send-log tab per definition.* This is the most straightforward of the 5 templates — `EmailMessageDoc` (M6-T1) already carries everything needed; zero gaps.

**Data source:** `EmailMessage` docs via `listAdminEmailMessagesForEvent` (`src/lib/db/adminEmailMessage.ts`, already exists, already cursor-paginated by `createdAt` descending) — unfiltered by `status`/`kind` for this report (the Emails screen's own send-log tab already offers per-definition filtering; this report's job is the full event-wide overview, matching the prototype's own "Email overview" naming).

**"Email name" resolution:** `EmailMessageDoc.kind` is a free-text join key, not a display name (M6-T1's own doc comment: *"kind is the free-text join key T2 uses to attach history to definitions"*). The report loader resolves a human name via `mergeEmailDefinitions()` (`src/features/emails/default-definitions.ts`) — the **same** virtual-catalog-merge function the M6-T2 Emails screen already uses to reconcile stored `EmailDefinition` docs with the 8 virtual (never-seeded) defaults — falling back to the raw `kind` string verbatim if no catalog entry matches (covers ad-hoc/manual sends whose `kind` doesn't correspond to any definition, e.g. `"manual"`).

**Scope boundary, stated explicitly:** this report does **not** include `bodyHtml`/`bodyText` (the full rendered message content) as a column — an "overview" is a send-log audit (who/what/when/status), not a message-content export; including full HTML markup per row would bloat the CSV without adding audit value the Subject column doesn't already give. This is a deliberate scope limit, not an oversight.

### Column spec (ordered, exact)

| # | Column | Type | Source field | Notes |
|---|---|---|---|---|
| 1 | Recipient name | string | `EmailMessageDoc.recipient.name` | |
| 2 | Recipient email | string | `EmailMessageDoc.recipient.email` | Already lowercased at enqueue (M6-T1 convention) — full, unmasked (this is the system's own send record, not a PII-minimized draft; the recipient already received an email at this exact address). |
| 3 | Email | string | resolved `kind → name` (see above) | Falls back to the raw `kind` string. |
| 4 | Subject | string | `EmailMessageDoc.subject` | The frozen, rendered subject snapshot — never re-rendered from a possibly-since-edited template (audit parity, same principle as `OrderSnapshot`). |
| 5 | Status | string | `EmailMessageDoc.status` | Title-cased (`Queued`/`Sent`/`Failed`). |
| 6 | Attempt count | integer | `EmailMessageDoc.attemptCount` | |
| 7 | Last error | string or empty | `EmailMessageDoc.lastError.message` | Empty when `null`. Already bounded to 500 chars at write time (`EMAIL_LAST_ERROR_MAX_CHARS`) — no additional truncation needed for the CSV cell. |
| 8 | Queued at | ISO datetime | `EmailMessageDoc.queuedAt` | |
| 9 | Sent at | ISO datetime or empty | `EmailMessageDoc.sentAt` | Empty when `null`. |
| 10 | Failed at | ISO datetime or empty | `EmailMessageDoc.failedAt` | Empty when `null`. |

**Acceptance criteria**
1. A fixture with `queued`, `sent`, and `failed` messages across 2 different `kind` values (one matching a virtual-catalog default, one ad-hoc `"manual"` kind with no catalog match) renders correct resolved names for the first and the raw `kind` string verbatim for the second.
2. A `failed` message's `lastError.message` renders in the Last error column exactly as stored (already-truncated value, no double-truncation, no raw stack trace — the truncation already happened at write time per M6-T1).
3. Zero email messages for the event → the template's empty state (§8).
4. Export: `bodyHtml`/`bodyText` never appear as columns in the exported CSV (grep-style assertion on the header row) — proves the scope boundary above is enforced, not accidentally included by a naive "export the whole doc" implementation.

## 6 — Run UX (shared shape, cross-template)

**Interaction shape flagged for UX to finalize (not decided here beyond the required behavior), same posture as M7-T1's OQ-1:** the prototype shows only a bare "Run" button per row with no further mockup of the output surface. This spec requires, but does not visually design:
- Clicking "Run" produces a **bounded, cursor-paginated table** (§D2: page size 50, "Load more") scoped to that one template, with a header row matching the exact column spec above, in the same order.
- Whether this renders as (a) a dedicated sub-route per template (`/dashboard/events/[eventId]/reports/[templateSlug]`), (b) an inline expandable panel below the templates table, or (c) a modal/dialog, is **UX's call** — all three satisfy this spec's behavioral requirements equally; recommend (a) as the most consistent with this app's existing routing style (every other admin surface is its own route, not a modal), but this is a recommendation, not a mandate.
- Each template's result view carries its own independent loading/empty/error states (§8) and its own "Export CSV" action (§7) — a failure loading one template's Run output must not affect the templates table itself or any other template's state (same "independent card degradation" principle M7-T1 §5 already established for its two summary cards).
- **No column customization, no sorting UI, no report-specific filter controls in this ticket's scope** (explicit non-goal) — every template renders its fixed column list in its natural DAL order (newest-first by the relevant timestamp field in every case). A future ticket may add filtering/sorting; this ticket does not.

**Acceptance criteria**
1. Every one of the 5 templates' Run output renders its column headers in the exact order specified in §1–§5 above — a header-order regression test per template.
2. A Run-in-progress state (loading) renders a table-shaped skeleton (reuse `EntityScreenSkeleton`-style row skeletons, `src/features/registration/components/entity-table-states.tsx`, not a new skeleton component).
3. A forced failure loading one template's Run output leaves the templates table and every other template's state unaffected (independent-degradation test, mirroring M7-T1 §5 AC-3's pattern).

## 7 — CSV export mechanics (shared, cross-template)

**Escaping: reuses `escapeCsvField()` (`src/features/responses/csv.ts`) verbatim, for every column of every template, no new escaping implementation.** Its two existing rules apply unchanged:
1. Formula-injection guard (cells starting with `=`/`+`/`-`/`@`, including behind leading whitespace, are prefixed with `'`).
2. RFC-4180 quoting (cells containing commas, double quotes, CR, or LF are wrapped in double quotes with inner quotes doubled).

**Line endings:** CRLF (`\r\n`) per RFC 4180, matching `buildAttendeesCsv`/`buildResponsesCsv`'s existing convention exactly (`[header, ...rows].join("\r\n") + "\r\n"`).

**Row cap:** `REPORT_EXPORT_ROW_LIMIT = 1000` per template per export call (§D2) — a single new shared constant in `src/features/reports/csv.ts`, not five separately-hardcoded numbers, so the ceiling is changeable in one place if a future ticket revisits it.

**Filename convention** (matches the existing `<entity>-${eventId}.csv` pattern from `attendees/export/route.ts` and `responses/export/route.ts` exactly):

| Template | Filename |
|---|---|
| Registration overview | `registration-overview-${eventId}.csv` |
| Order & transaction details | `order-transactions-${eventId}.csv` |
| Abandoned registration details | `abandoned-registrations-${eventId}.csv` |
| Badges printed (check-in history) | `checkin-history-${eventId}.csv` |
| Email overview | `email-overview-${eventId}.csv` |

**Response headers** (matches the existing export routes exactly): `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="..."`, `Cache-Control: no-store`.

**Column headers:** the exact ordered list from each template's column spec table above (§1–§5), human-readable (e.g. `"Checked-in at"`, not `"checkedInAt"`) — matching `buildAttendeesCsv`'s existing header-naming style.

**Permission gate:** `write:events`, per D1 — every export route is a **new** API route (5 routes, one per template, e.g. `src/app/api/dashboard/events/[eventId]/reports/registration-overview/export/route.ts`), each going through the new `resolveReportsRouteScope()` helper (mirrors `resolveRegistrationRouteScope()` 1:1 — see D1).

**Acceptance criteria**
1. Every one of the 5 export routes returns `403` for an org member without `write:events` (viewer-tier), even though that same member **can** view the Run preview for the same template on the same page (D1's split, tested explicitly so a future regression doesn't quietly weaken the export gate back down to org-membership-only).
2. Every one of the 5 export routes returns `404` for a cross-org/unknown `eventId` (IDOR convention, unchanged from every other route in this codebase).
3. A cell value containing a comma, a double quote, and a leading `=` in the same fixture (across at least one column per template) round-trips correctly through a real CSV parser (not just a string-equality check on the raw escaped output) — proves the escaping is genuinely correct, not just "looks right."
4. Filenames match the table above exactly, per template.

## 8 — States & edge cases (cross-cutting, applies to every template)

- **Empty (zero rows for that template):** each template gets its own `EntityEmptyState` (`src/features/registration/components/entity-table-states.tsx`, reused verbatim — no new empty-state component) with template-specific copy + CTA:
  - Registration overview → "No registrations yet" / links to Attendees.
  - Order & transaction details → "No orders yet" / links to Pricing (where Fees live) or Registration Paths.
  - Abandoned registration details → "No abandoned registrations" (matches the Abandoned tab's own existing copy verbatim) / no CTA needed (nothing to configure).
  - Badges printed (check-in history) → "No check-ins yet" / links to Check-in.
  - Email overview → "No emails sent yet" / links to Emails.
- **Loading:** table-row skeleton per §6 AC-2.
- **Error:** `EntityTableError` (reused verbatim) with a `Try again` retry, independent per template per §6 AC-3.
- **Permission-denied (export only, per D1):** a `403` JSON response from the export route — no bespoke UI page (this is an API route, not a page); the Run preview itself never 403s for any org member (only `notFound()` for non-members, matching M7-T1 §7's existing convention for the whole reports page).
- **Both themes / responsive (320/768/1024/1440):** the templates table itself follows the same responsive table conventions as every other admin table in this app (M1–M6 precedent) — no new pattern. Each template's Run output table follows the same convention.
- **Never:** a raw Firestore error, an unhandled promise rejection, `NaN`/`undefined`/`null` literal text in any rendered or exported cell (every column above has an explicit empty-string/fallback rule).

**Acceptance criteria**
1. Each of the 5 templates' empty state renders with correct, template-specific copy — not a single generic "No data" message reused unchanged across all 5 (that would fail to communicate what's actually missing to the organizer).
2. Both themes, all 4 breakpoints verified for the templates table and at least one representative Run output table (UX/QA to confirm all 5 if time allows, but the shared shape means one thorough pass plus a spot-check of the other 4 is sufficient — same proportionality M7-T1 QA used).

## Non-goals for T2 (explicit)

- **No new badge-printing tracking infrastructure** — D5 is the final word for this ticket; a real "badges printed" data source is an explicitly-named open dependency for a future ticket, not built here.
- **No scheduled report delivery** — that is M7-T3 in full (the prototype's "Schedule" button, same as M7-T1's Non-goals already stated).
- **No async/streaming/chunked export job** — D2/D3's synchronous, bounded (1000-row), no-background-job posture is final for this ticket's scope.
- **No report-specific filter/sort/column-customization UI** — §6's fixed-column, natural-DAL-order posture is final for this ticket's scope; a future ticket may add this.
- **No changes to M7-T1's summary cards** — this ticket only adds the templates table below them on the same page; the two summary cards (`ticket-type-bar-chart-card.tsx`, `finance-summary-card.tsx`) are untouched.
- **No new payment/order/attendee/draft state machine changes** — every column in every template reads existing fields exactly as prior milestones already write them; this ticket adds zero new statuses, zero new lifecycle transitions.
- **No real-time/live-updating Run output** (no `onSnapshot` listeners) — Run is a page-load/API-call-time snapshot, consistent with every other admin screen and with M7-T1's own explicit non-goal.

## Gap analysis (current code vs. this spec)

- `src/features/reports/` currently contains only M7-T1's summary-card components (`ticket-type-bar-chart-card.tsx`, `finance-summary-card.tsx`, `load-report-summary.ts`-family) — the templates table and all 5 Run/export surfaces are entirely new.
- **DAL additions needed** (all small, backward-compatible extensions of existing methods — no new indexes required anywhere in this list):
  - `src/lib/db/adminOrder.ts`: extend `getAdminOrdersForEvent` with optional `limit`/`startAfterCreatedAtMs` cursor params (mirrors `listAdminAttendeesForEvent`'s exact shape) — served by the existing `Order: eventId ASC, organizationId ASC, createdAt DESC` composite index, already registered.
  - No change needed to `adminAttendee.ts` (`listAdminAttendeesForEvent` already supports everything §1/§4 need — status filter, or its omission, plus cursor pagination).
  - No change needed to `adminRegistrationDraft.ts` (`getAdminRegistrationDraftsForEvent` already supports everything §3 needs).
  - No change needed to `adminEmailMessage.ts` (`listAdminEmailMessagesForEvent` already supports everything §5 needs).
  - No change needed to `adminTicketType.ts`/`adminRegistrationType.ts` — existing bounded list methods (`getAdminTicketTypesForEvent`, `getAdminRegistrationTypesForEvent`) are reused as-is for §2/§3's id→name join maps.
- **New:** `src/features/reports/csv.ts` (shared `escapeCsvField` re-export/`REPORT_EXPORT_ROW_LIMIT` constant + one `build<Template>Csv()` function per template, mirroring `buildAttendeesCsv`'s shape), `src/features/reports/server/load-<template>.ts` (one Run-page loader per template, each a thin wrapper composing the reused DAL call + the shared id→name join helper where needed), `src/features/reports/server/reports-route-scope.ts` (`resolveReportsRouteScope()`, mirroring `resolveRegistrationRouteScope()`'s shape per D1), `src/features/reports/components/report-templates-table.tsx` (the new templates table itself, below M7-T1's cards), plus 5 new pairs of API routes (list/paginate for Run if the interaction shape needs a client-fetchable route beyond an initial server render, and export, per template) under `src/app/api/dashboard/events/[eventId]/reports/<slug>/{route.ts, export/route.ts}`.
- **No `firestore.indexes.json` change expected** — every underlying query already has a serving composite index (confirmed above per template); this ticket adds cursor params to existing ordered queries, not new filter/order combinations.
- **No new npm dependency expected** — this is server-side CSV string-building (same as the two existing export features) plus reused table/skeleton/empty-state UI primitives.
- **D5's gap (badges printed) is the one genuine data-model gap this ticket surfaces** — everything else is either already-shipped DAL reused as-is, or a small backward-compatible extension of an already-shipped DAL method.

## Open questions

- **OQ-1 (for UX, non-blocking — §6):** exact Run interaction shape (dedicated sub-route vs. inline panel vs. modal). Default assumption if UX doesn't weigh in before Design: dedicated sub-route per template (`/dashboard/events/[eventId]/reports/[templateSlug]`), matching this app's existing per-screen routing convention.
- **OQ-2 (for Security, flagged explicitly in D1, non-blocking but important):** confirm the `write:events`-for-export / org-membership-for-Run split (D1) is the correct final posture, given the Order & transaction details template is a genuinely new class of exposure (first-ever UI rendering of individual `Order` docs) — Security's own backlog assignment ("export contains PII — role gate") is the natural place to make this final call; this spec's position is that the existing `resolveRegistrationRouteScope()` precedent already answers "which gate," and Security's remaining job is verifying correct enforcement, not choosing a different gate from scratch.
- **OQ-3 (product, non-blocking — D5):** should "badges printed" literal tracking (distinct from check-in history) become a new backlog ticket? This spec does not decide that — it is named here as an explicit, surfaced gap for the Orchestrator.
- **Carried, still open elsewhere:** M8-T1 (real Viewer-vs-Editor role enforcement — today "org membership" and "write:events" are the only two real gates this codebase enforces anywhere; a true read-only Viewer role, once it exists, may need Run itself to require more than bare org-membership for the higher-sensitivity templates here, particularly Order & transaction details — flagged for M8-T1 to reconsider, not solved here).

## Q&A log (append answers to other agents here)

*(empty — first entry when another agent asks a report-templates question)*
