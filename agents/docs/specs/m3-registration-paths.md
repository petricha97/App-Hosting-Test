# M3 — Registration Paths & Public Flow

Research Lead, 2026-07-10. Screens: `prototype/prototype/event-registration-paths.html`, `event-form.html` (commerce palette), `responses.html`, `event-attendees.html` (Abandoned tab data). Conventions per `agents/docs/data-models/{baseline,m1-registration-spine,m2-pricing-commerce}.md`. Open-question default locked: **Q3 = server-persisted draft registration docs** (PII-minimal surface, retention documented, no client analytics).

## Shared decisions

- **New root collections** `RegistrationPath` and `RegistrationDraft` (PascalCase singular, auto IDs), canonical `organizationId` + `eventId`, `serverTimestamp()` timestamps, repo pairs, bounded reads, org id in every `where()`.
- **Permissions:** every admin mutation (path CRUD, status transitions, draft delete, CSV export) enforces `write:events` after session → org → `getAdminEventForOrganization` (403 / 404-IDOR per M1/M2 convention).
- **Public endpoints are unauthenticated:** draft create/update, quote, promo validation, place-order. Rigor instead of auth: strict Zod on every payload (unknown keys stripped, string length caps, request body ≤ 32KB), event must be `Published`, all money/eligibility computed server-side, drafts reachable only via a **signed draft token** (below). **Rate limiting (basic, per-IP):** in-memory token bucket per route (e.g. 30 req/min/IP; promo validation 10/min/IP) — best-effort on serverless instances, documented as such; durable limiter is an M8 hardening item. 429 with `Retry-After`.
- **Fixed 5-step flow in M3** (no custom step editor): 1 Personal Information → 2 Ticket & Options → 3 Registration Summary → 4 Payment → 5 Confirmation + QR. Step 4 is **skipped entirely** for paths whose `paymentMethod ∈ {comp, none}` (flow renders 4 steps). Custom steps/per-path pages are M4-T2.
- **Data flow (text diagram):**

```
public form (step 1 valid) ──POST draft──▶ RegistrationDraft {lastStepReached, step1 answers}
        │ steps 2–3 PATCH draft (ticket, promo, quote shown from server)        │
        ▼                                                                       │ abandoned if
step 4/finalize ──▶ placeOrder (M2 finalize txn: counters + Order doc)          │ >24h stale
        │ ok                                                                    ▼
        ├─▶ create FormData {status:"new", orderId, ticketLabel} (id derived from draftId — idempotent)
        ├─▶ delete RegistrationDraft  (only after Order AND FormData both exist)
        └─▶ Confirmation page {registration ref, order ref, QR placeholder}
FormData.status: new → pending → reviewed → accepted (admin, write:events; accept fires M5 attendee hook stub)
```

## M3-T1 — Registration Paths admin (`event-registration-paths.html`)

**Entity `RegistrationPath`:** `{ organizationId, eventId, name (1–120, free text — organizers include the "2." / "2.1" numbering convention in the name per prototype), code (M1 code regex via normalizeRegistrationCode, unique per event within RegistrationPath), audienceRegistrationTypeId: string | null (null = "Any"; else must belong to event), paymentMethod: "card" | "invoice" | "comp" | "none" (same union as OrderDoc), currency: Currency, isActive: boolean (default true), sortOrder: number (int ≥ 0, default max+1, drives table + picker order), createdAt, updatedAt }`.

- **Currency on the path (divergence — not shown in prototype):** fee resolution requires (ticket, regType, currency); the path is the flow config, so it pins the checkout currency. One audience paying in two currencies = two paths (mirrors the prototype's card/invoice path pairs).
- **Audience → order registration type resolution (fixed rule, used by T3):** audience set → the order's `registrationTypeId` is the audience. Audience = Any → derived from the selected ticket: exactly one entry in `ticket.registrationTypeIds` → that one; multiple or empty (unrestricted) → Step 2 additionally asks the registrant to pick a registration type (from the ticket's eligible set, or all event types when unrestricted).
- **Screen:** example flow-diagram card on top ("Path: {first active path name}", 5 numbered steps, payment step omitted for comp/none, note "Each page is customizable in the Page Builder" — links land in M4-T2). Table columns exactly **Registration path | Code | Audience | Payment | Active** (+ Edit/Delete row actions, drag or up/down for `sortOrder`). Audience cell = regType name or "Any"; Payment = Card/Invoice/Comp/None; Active = green Yes / amber No badge. Create/edit dialog: name, code, audience select (first option "Any"), payment method, currency, active toggle.
- **Delete rule — BLOCK:** 409 when any `RegistrationDraft` or `FormData` references the path (bounded reference queries, limit 5) → "Deactivate instead". Registration-type delete (M1) extends its block: 409 naming paths whose audience pins that type.

**Acceptance criteria**
1. Table lists the event's paths ordered by `sortOrder` asc with the 5 prototype columns; prototype rows reproducible (SPN-CC/Sponsor/Card/Yes … COMP/Any/None/Yes).
2. Create/edit validates client+server (Zod): name 1–120; code uppercase-normalized, per-event unique (field-level dup 409); audience id belongs to this event (foreign ids rejected 400); paymentMethod + currency in their enums.
3. Flow card renders 5 steps for card/invoice paths and 4 steps (no Payment) for comp/none paths.
4. `isActive` toggles inline and persists; inactive paths never appear on the public picker (T3 AC-2) but remain listed here.
5. Delete blocked 409 when referenced by any draft or submission; unreferenced paths hard-delete.
6. Registration-type delete route 409s naming the blocking paths when a path's audience pins it.
7. Mutations require `write:events` (403); all routes 404 cross-org/unknown eventId/pathId.
8. Composite indexes registered with the change: `RegistrationPath eventId+organizationId+sortOrder ASC` (list) and `RegistrationPath eventId+code` (uniqueness).
9. Empty state: "No registration paths yet" + explainer ("A path is the flow a registrant walks through — one per audience × payment method") + create CTA. Loading = skeleton rows; error = inline retry panel.
10. `sortOrder` reordering persists and re-sorts both the admin table and the public picker.

## M3-T2 — Form builder commerce fields (`event-form.html` palette)

Two new field types added to `formFieldTypeSchema`: **`ticket-selector`** and **`promo-code`**.

- **Event-only, never in templates (decision: NO template membership).** Justification: FormTemplates are org-level and reusable across events, but `ticket-selector` binds to event-scoped TicketType docs and `promo-code` validates against event-scoped EventPromotions — a template carrying them would produce dangling bindings on "Apply to all linked" cascade and on new events with no tickets. Enforced three ways: `templateBuilderSchema` rejects the two types; template editor palette omits them; template-sync merge never touches fields with these types (their `origin` is always `"event"`).
- **Cardinality:** at most one field of each type per form (Zod refine + builder guard). `ticket-selector` key fixed `ticket`, `promo-code` key fixed `promo_code`. Ticket selector may be `required` (default true); promo code is always optional.
- **Which tickets show (public render):** tickets of the event where (a) eligibility matches the active path's resolved audience — `registrationTypeIds` contains it OR is empty (Any-audience paths: all tickets); (b) derived-open per M1 (`isOpen` + sales window); (c) an active Fee exists for (ticket, audience-or-null, path.currency) — unpriced tickets are **hidden**. Capacity-full tickets render **disabled with a "Sold out" badge** (not hidden). Each option shows name + fee price ("Comp" when 0, per M2).
- **Promo code semantics:** free-text input; resolution `promoCode` (uppercase-normalized, exact match) → EventPromotion with `enablePromoCode == true`, server-side only, via a new DAL lookup `getAdminEventPromotionByCode(eventId, code)` (bounded limit 2). Validation happens at quote time (T3 step 3) and is re-validated inside the M2 finalize transaction at submit. **Never enumerable client-side:** no public endpoint lists promotions; the validate/quote response returns only `{ valid, discountMinor }` or a generic "This code isn't valid" (identical message for unknown / inactive / expired / exhausted / codeless promotions — no oracle distinguishing them).
- **Backward compatibility:** schema change is additive; `buildFormSubmissionSchema` excludes the two commerce types from the flat string-record validation (their values travel through the draft/order pipeline, not `submission` — the finalized FormData stores the human-readable `ticketLabel` and applied code in the submission map for display). Existing published forms (no commerce fields) parse and submit unchanged; forms with commerce fields still publish/preview in the builder.

**Acceptance criteria**
1. Palette shows both new entries with "new" badge styling per prototype; dragging inserts an event-origin field; canvas row shows `ticket · from Ticket Types` subtitle per prototype.
2. A second ticket-selector or promo-code field is rejected (builder blocks + server Zod rejects on save).
3. Template builder/save rejects both types with a clear message; "Apply to all linked" on a template never inserts/removes/edits commerce fields on linked forms (regression test).
4. Public render lists exactly the tickets passing eligibility × derived-open × priced-in-path-currency; sold-out tickets render disabled "Sold out"; zero eligible tickets renders the designed "No tickets available for this path" state and blocks progression.
5. Ticket prices display from Fees per M2 formatting ("Comp" for 0); price shown always matches the server quote for that selection.
6. Promo validation is server-side only; invalid/expired/exhausted/unknown codes all return the same generic error; valid codes return the discount effect on the quote.
7. No public endpoint enumerates promotions or exposes promo metadata beyond the quote effect; promo validation is rate-limited (10/min/IP).
8. Existing published forms without commerce fields submit successfully after deploy (regression, flat + stepper flows).
9. Form save with a ticket-selector on an event with zero TicketTypes warns in the builder but saves (tickets may come later); public flow AC-4 covers the runtime state.
10. Unit tests: schema round-trip for both types; submission-schema exclusion; template rejection.

## M3-T3 — Public multi-step registration flow

**Routes:** `src/app/events/[eventId]/register/page.tsx` (+ `?path=<pathId>`). No/invalid `path` param: 0 active paths → **legacy fallback**, the existing flat single-page form keeps working exactly as today (backward compat); 1 active path → auto-redirect with its id; ≥2 → **path picker page** listing active paths (name, audience, payment method) ordered by `sortOrder`. Event must be Published with a published form, else the existing "registration not available" state.

- **Steps → form mapping:** Step 1 renders all non-commerce form fields (locked template + event fields, current validation). Step 2 renders the ticket-selector (+ registration-type picker for ambiguous Any-audience paths, T1 rule) and the promo-code field. Step 3 renders a read-only summary: step-1 answers + server-computed quote line items (subtotal / discount / tax lines / total) from a new **GET quote endpoint** that reuses `resolveAdminFeeForOrder` + `deriveEventPromotionAvailability` + `computeOrderTotals` (read-only, zero counter movement — identical math to `placeOrder` steps 2). Step 4 (card: simulated card form; invoice: "You'll receive an invoice" confirmation; skipped for comp/none). Step 5 confirmation.
- **Draft persistence:** completing step 1 POSTs `/api/events/[eventId]/register/draft` → creates `RegistrationDraft` (schema in T5) and returns `{ draftId, draftToken }`. Steps 2–3 PATCH the draft (per-step Zod payloads; server re-validates ticket eligibility/openness and stamps `lastStepReached`). **Signed draft token (decision):** `"{draftId}.{base64url(HMAC-SHA256(secret, draftId + "." + eventId))}"`, secret from env; the token is the sole capability for reading/updating/finalizing a draft (no session). Stored in `sessionStorage` keyed by eventId; resume = re-hydrate stepper from a GET-by-token endpoint. Token never in URLs (referrer leakage); constant-time compare server-side; invalid/mismatched token → 404 (indistinguishable from missing).
- **Finalize:** step 4 submit (or step 3 confirm for comp/none) POSTs place-order: server loads the draft by token, takes `paymentMethod` and `currency` **from the path doc — never from the client**, builds `idempotencyKey = "reg:" + draftId + ":" + attempt` (attempt counter stored on the draft, starts 1, incremented only after `PAYMENT_FAILED` so double-clicks collapse but declined-card retries get a fresh key per the M2 contract), and calls `placeOrder` with the simulated provider. On `ok`: create FormData with **doc id derived from draftId** (idempotent — a crash between order and FormData is healed on retry because placeOrder replays and the FormData write is a deterministic upsert), `status:"new"`, `orderId`, `pathId`, `ticketLabel`; then delete the draft; respond with `{ registrationRef, orderRef }`.
- **Confirmation (step 5):** registration reference (FormData id short-code), order reference + amount/status line, QR **placeholder** block labelled "Your entry pass" (real QR mint is M5-T1 and retrofits here), "check your email" copy (email lands M6).
- **Typed error surfacing:** `SOLD_OUT`/`TYPE_FULL` → toast "That ticket just sold out" + return to step 2 with refreshed availability; `PROMO_EXPIRED`/`PROMO_EXHAUSTED` → return to step 2 with the code cleared + generic message; `PRICE_CHANGED` → auto re-quote and re-show step 3 with "Prices were updated — please review"; `NO_FEE`/`INVALID_REFERENCE` → generic "This selection is no longer available", step 2; `PAYMENT_FAILED` → stay on step 4, show provider reason, allow retry (new attempt key). Raw codes never shown.

**Acceptance criteria**
1. 0 active paths → flat legacy form unchanged; 1 → auto-select; ≥2 → picker with active paths in `sortOrder`; inactive paths 404 when forced via `?path=`.
2. Stepper renders 5 steps (4 for comp/none — Payment never shown) with current-step highlight; steps beyond `lastStepReached+1` are not navigable (client) and their endpoints reject out-of-order writes (server — step tampering cannot skip validation or payment).
3. Step 1 completion creates exactly one draft and returns a signed token; all subsequent draft reads/writes require the token; forged/expired-signature tokens → 404; draft ids are never usable bare.
4. Per-step server validation: step 1 via `buildFormSubmissionSchema` (non-commerce fields); step 2 rejects ineligible/closed/unpriced tickets and (when required) missing registration-type choice — client-side prefilters are advisory only.
5. Summary totals come from the quote endpoint (server math identical to finalize; unit test pins one worked example per M2's table); no client-computed amount is ever displayed or submitted.
6. `paymentMethod` and `currency` are read from the path server-side at finalize; a client-supplied method/currency field is ignored/stripped.
7. Comp/none paths finalize `comped` with no provider call; invoice paths finalize `outstanding`; card paths charge the simulated provider then finalize `paid` (per M2 place-order contract, unchanged).
8. Double-submit on step 4 produces exactly one Order and one FormData (idempotency replay verified); declined card → `failed` order persisted, counters untouched, retry succeeds under the incremented attempt key.
9. Capacity race (two registrants, last seat): loser receives the friendly SOLD_OUT surface per the error table, is returned to step 2, and no partial writes remain (no FormData, draft intact).
10. Refresh/back mid-flow: sessionStorage token re-hydrates the draft at `lastStepReached`; a new browser/session without the token starts a fresh draft (old one becomes an abandoned record, T5).
11. Successful finalize deletes the draft — only after Order and FormData both exist; the confirmation page shows registration ref + order ref + QR placeholder.
12. All public endpoints reject >32KB bodies, strip unknown keys, and are rate-limited per Shared decisions (429 path tested).
13. Mobile-first stepper passes at 375px; per-step loading and error states defined (submitting spinner, inline retry).
14. Legacy flat route regression suite still green (existing register route tests).

## M3-T4 — Response approval workflow (`responses.html`, per-event responses)

**FormData additive fields:** `{ status: "new" | "pending" | "reviewed" | "accepted" (default "new"; legacy docs without the field read as "new" — read-time default, no backfill), orderId: string | null, pathId: string | null, ticketLabel: string | null (denormalized at finalize from the order's fee/ticket snapshot for cheap list rendering), statusUpdatedAt, acceptedAt: Timestamp | null, attendeeCreated: boolean (default false — M5-T1 flips it) }`. Prototype badges show exactly Accepted/Pending/New/Reviewed — **no "rejected" in M3** (decline semantics deferred to M5 alongside attendee lifecycle; documented gap).

- **Transitions:** forward-only along `new < pending < reviewed < accepted`; skipping forward is allowed (e.g. new → accepted); backward moves rejected 409; `accepted` is terminal in M3 (un-accept implies attendee teardown — M5). Who: any member with `write:events` in the owning org. Transition route: `PATCH /api/dashboard/events/[eventId]/responses/[responseId]/status`.
- **Accept side-effect (hook stub):** transition to `accepted` sets `acceptedAt` + leaves `attendeeCreated:false` and calls `onSubmissionAccepted(submission)` — a no-op logging stub in `src/features/responses/` that M5-T1 replaces with attendee creation. Idempotent: re-accepting an accepted doc is a 409, so the hook fires at most once.
- **Screens:** both tables gain **Ticket** (ticketLabel or "—") and **Status** badge columns per prototype (green Accepted, amber Pending, neutral New/Reviewed); status filter select (Any/New/Pending/Reviewed/Accepted) + existing search/event filter; row action menu with the legal forward transitions only. **CSV export**: server-generated (`GET .../responses/export?…filters`), streams name, email, event, ticket, status, submitted date + submission answers; gated `write:events`; workspace and per-event variants.
- **Indexes (register with the change):** `FormData eventId+organizationId+submittedAt DESC` (per-event list — baseline flagged), `FormData eventId+organizationId+status+submittedAt DESC` and `FormData organizationId+status+submittedAt DESC` (status filters in the query, not in memory); baseline composite #6 already covers the unfiltered workspace list.

**Acceptance criteria**
1. Both responses tables render Ticket + Status columns; legacy submissions show "—" ticket and "New" status without read errors or doc rewrites.
2. Every legal forward transition succeeds and persists (`statusUpdatedAt` bumps); every backward transition and accepted→anything returns 409 (full matrix tested).
3. Accept sets `acceptedAt`, fires the hook stub exactly once, and is idempotent under double-click (second call 409, no duplicate hook).
4. Transitions require `write:events` (403) and 404 cross-org/unknown response ids.
5. Status filter queries Firestore (composites registered, no in-memory status filtering); combined event+status filter works on the workspace table.
6. CSV export honors active filters, is `write:events`-gated, escapes correctly (commas/quotes/newlines/formula-prefix `=+-@`), and matches on-screen rows.
7. Finalized T3 submissions arrive `status:"new"` with `orderId`, `pathId`, `ticketLabel` populated; flat legacy submissions arrive `new` with nulls.
8. Ticket cell for a submission whose order exists but ticketLabel is null falls back to a join via `orderId` (server-side) — never a broken cell.
9. Per-event responses page lists that event's submissions only, newest first, bounded (limit 50 + "load more" cursor).
10. Empty/loading/error states per convention; status badges match prototype colors.

## M3-T5 — Abandoned-registration tracking (draft docs double as abandoned records)

**Entity `RegistrationDraft`:** `{ organizationId, eventId, pathId, formId, draftTokenHash: string (SHA-256 of the signed token — raw token never stored), lastStepReached: "personal_info" | "ticket_options" | "summary" | "payment", stepAnswers: Record<string,string> (validated step-1 answers — needed for resume + finalize), ticketTypeId: string | null, registrationTypeId: string | null, promotionId: string | null, attempt: number (finalize attempt counter, T3), firstName / lastName / email: string ("" until entered — denormalized from stepAnswers for the abandoned surface), createdAt, updatedAt }`.

- **Display mapping (prototype badges):** `personal_info` → "Personal Information", `ticket_options` → "Ticket & Options", `summary` → "Registration Summary", `payment` → "Payment".
- **What counts as abandoned:** a draft with `updatedAt` older than **24h** and not completed (completed drafts are deleted at finalize per T3 AC-11 — existence = incomplete). The 24h threshold is the single constant M6-T3's "+24h abandoned" nudge references; M5-T3's tab shows all drafts, flagging those past the threshold.
- **PII minimization (Q3):** drafts store only what completion requires — step-1 answers, selections, name/email denorms. **Never stored:** payment details of any kind (card data never reaches our server; provider is simulated), promo code text beyond the resolved id, IP/user-agent. Admin surfaces (M5-T3, reports) display name + **masked email (domain only, "@dentsu.com" per prototype)** + last page + date — full email is available only via the draft doc to `write:events` holders for legitimate follow-up.
- **Retention (decision): no TTL/auto-delete in M3.** Retention policy is an M6-T3 (send-then-purge consideration) / M8 (compliance) concern — recorded there; M3 ships a manual delete route (`DELETE .../drafts/[draftId]`, `write:events`) so organizers can purge on request. Completed drafts are deleted at finalize, exactly after Order + FormData both exist (T3).
- **Indexes:** `RegistrationDraft eventId+organizationId+updatedAt DESC` (abandoned tab / report reads, register now).

**Acceptance criteria**
1. Abandoning at each step leaves a draft whose `lastStepReached` maps to the prototype label (all four values covered by tests).
2. `firstName/lastName/email` populate as soon as step 1 completes; a draft abandoned mid-step-1 simply does not exist (no pre-submission tracking — consent-light by design).
3. Completing registration deletes the draft; abandon-then-resume-then-complete leaves zero draft docs (QA per backlog).
4. Drafts contain no payment data and no promo code text (resolved `promotionId` only) — schema-level assertion.
5. Draft token is stored only as a hash; possession of a draftId alone grants no access (T3 AC-3).
6. Admin list read (consumed by M5-T3) returns drafts newest-updated first, bounded, with an `isAbandoned` derived flag (`now - updatedAt > 24h`) computed, never stored.
7. Manual delete route removes a draft (`write:events`, 404 cross-org); no auto-delete job exists in M3 (documented).
8. The 24h constant is exported from one module (`src/features/registration/` or `src/lib/db/`) so M5-T3/M6-T3 reference it, not a copy.

## Gap analysis (current code vs. this spec)

- `src/lib/db/` has no `registrationPath`/`registrationDraft` repos; `FormDataDoc` (`src/types/collection.ts`, `src/lib/db/formData.ts`) lacks status/orderId/ticket fields — all additive.
- `src/app/api/events/[eventId]/register/route.ts` is the flat submit — kept as the zero-paths fallback; stepper endpoints are new siblings under `register/`.
- `src/features/form/schema.ts` `formFieldTypeSchema` is `text|email|textarea`; `buildFormSubmissionSchema` assumes all-string flat records — both extended per T2.
- `src/features/responses/` renders cards without status/ticket and has no per-event/status filtering or export; per-event page exists at `src/app/dashboard/(event)/events/[eventId]/responses/page.tsx` to build on.
- `placeOrder` (`src/lib/orders/place-order.ts`) already accepts `submissionId` and carries the `TODO(M3-T3)` void-on-finalize-failure note for real providers — simulated provider needs no change.
- `firestore.rules`: both new collections must be added as **all client access denied** (server-only); drafts especially (PII + token hashes).
