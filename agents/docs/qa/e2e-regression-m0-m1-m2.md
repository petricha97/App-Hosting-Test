# E2E Regression — Phase 1 (M0 + M1 + M2), real-account run

Executor: `qa-agent` (Claude Code, via the Agent tool). Completed 2026-07-30 in
`App-Hosting-Test`, on branch `feat/m8-t9-template-apply-atomicity`.

## Outcome

**PHASE COMPLETE — real login succeeded, real org/event/entities were created
against the live Firebase project, and the full Chromium suite ran to
completion.** This supersedes both prior attempts (the discarded throwaway
run and the two credential-blocked runs, whose findings are preserved in git
history for this file).

- Login: **Yes**, with the corrected password (no leading "s" typo from the
  first credential-blocked attempt).
- Dedicated test organization created: **Yes** — `E2E QA Org 2026-07-26 v2`.
- Event created: **Yes** — `E2E QA Conference 2026 Phase 1`.
- Registration types, ticket types, fees, taxes, one discount: **all
  created**, listed in full under Entities below.
- Existing organizations/events: **untouched** (verified — see Pre-existing
  data below).
- 39 tests executed (1 setup + 38 Chromium): **35 passed outright, 3 passed
  after retry (flaky, self-healed), 1 genuinely and consistently failed (a
  real product defect, left failing/documented per this task's instructions,
  not "fixed" to go green)**.

## Login and account inventory

`inventoryOrganizationsForUser` ran immediately after login and before any
mutation. It found exactly **one** pre-existing organization on this account:

| id | name | role | status |
|---|---|---|---|
| `XmFjWCQWrEt1RHCFyx6I` | Petri Test | owner | pending |

Neither this org nor anything inside it was read, written, or modified at
any point in this session (the harness only ever wrote to the new dedicated
org below). No other organization or event belonging to this account was
touched. (The wider Firebase project is shared with several unrelated test
accounts/orgs from prior development sessions — e.g. `petricha96@gmail.com`,
`petricha97@gmail.com`, `chromeeagle99@gmail.com`, `koeyubei@...` — none of
those were read, written, or enumerated beyond a single read-only Admin SDK
listing used to sanity-check that our new org id/name were unique; nothing
under them was touched.)

## Entities created (Phase 2 must reference these)

- **Organization**: `E2E QA Org 2026-07-26 v2` — id `Z8i7pK5sAzSHDwLKXCZF`.
- **Event**: `E2E QA Conference 2026 Phase 1` — id `2EKaIZZuik8ITwWqBHnA`,
  dashboard URL `/dashboard/events/2EKaIZZuik8ITwWqBHnA`, timezone
  `Asia/Singapore`, published, Nov 15–16 2026, registration window
  2026-07-30 → 2026-11-14.
- **Registration types** (`registration-types`):
  - Delegate — code `DEL`, capacity 200.
  - VIP Guest — code `VIP`, Unlimited.
  - Press — code `PRESS`, capacity 60 (created at 50, edited to 60 during the
    CRUD check).
  - (Throwaway `THROW` type created and deleted as part of the delete-flow
    check — does not persist.)
- **Ticket types** (`tickets`):
  - Early Bird — code `EB`, capacity 100, Delegate-only, sales close Sep 30
    2026.
  - Standard — code `STD`, Unlimited, all registration types, sales open
    from Oct 1 2026.
  - Press Pass — code `PRESS-T`, capacity 50, Press-only, manually closed
    (`isOpen: false`).
  - (Throwaway `QA-TEMP` ticket created, edited, deleted — does not
    persist.)
- **Fees** (`pricing` → Fees tab):
  - Early Bird — Delegate (USD): $750.00.
  - Early Bird — Delegate (GBP): £600.00.
  - Standard — All types (USD): $950.00.
  - Press Pass — Press (USD): $0.00 → displays "Comp".
  - (Throwaway EUR 125.00 fee created, edited, deleted — does not persist.)
- **Taxes** (`pricing` → Taxes tab):
  - NY Sales Tax — code `TAX-NY`, percentage, 8.875%, active.
  - UK VAT — code `VAT-UK`, percentage, 20.00%, **inactive** (deactivated via
    the inline toggle, matching the spec's worked example).
  - (Throwaway `QA-FIX` fixed tax created, edited, deleted — does not
    persist.)
- **Discount** (`pricing` → Discounts tab, via org-level Promotion Template
  attached to the event):
  - Template/discount name `QA10`, code `QA10OFF`, type percentage, value
    10%, Level **Partner**, validity `2026-07-30` → `2026-12-31`, usage cap
    50, used 0/50, active.

## Ticket-by-ticket verdicts

| Ticket | Verdict | Notes |
|---|---|---|
| M0-T1 Event workspace shell | **PASS** | Sidebar groups (Build/Registration/Engage & Manage), event bar (breadcrumb, title, Published badge, event code), all 12 nav items deep-link to real rendered pages with no 404s, dark theme + mobile drawer works, cross-org/unknown-event-id access shows the not-found card without leaking data. |
| M0-T2 Starter-cruft cleanup | **PASS** | `/api/chat`, `/api/todos`, `/todo` all return 404 (confirmed via unauthenticated `request` calls). |
| M0-T3 Firestore index audit | **PASS** | No `FAILED_PRECONDITION`/"requires an index" console errors while loading `registration-types`, `tickets`, `pricing` for real. |
| M0-T4 Test harness baseline | **N/A — intentionally skipped** | Unit-only per Phase 1 brief. |
| M1-T1 Registration Types | **PASS** | Empty state, CRUD, capacity (number vs Unlimited), auto-uppercase code, duplicate-code field error, edit persists, delete blocked while referenced (via M1-T2 ticket association) and allowed for an unreferenced throwaway type. Two of this spec's assertions were flaky-but-self-healed on the final run (see Flaky tests below) — not a functional failure. |
| M1-T2 Ticket Types | **PASS** | CRUD, reg-type eligibility (Delegate-only / Press-only / unrestricted), capacity, sales-window-derived Open/Closed (`Yes`/`No`/"from Oct 1"), search + reg-type filter compose correctly, duplicate-code rejection, throwaway create/edit/delete, registration-type delete correctly blocked while a ticket references it. |
| M2-T1 Fees + Pricing shell | **PASS with 1 confirmed defect** | 4-tab shell renders with Fees active by default; fee CRUD, duplicate (ticket, regType, currency) rejection, Comp display for a 0-price fee, multi-currency (USD+GBP) fee rows all work. **QA-6 below is a genuine, 100%-reproducible defect** in the Ticket Types Price-column projection when multiple currencies exist for the same ticket. |
| M2-T2 Discounts tab | **PASS** | Org-level Promotion Template creation, event attachment, Discounts tab projection (Name/Code/Level/Amount/Valid/Used/Active columns), Discount settings dialog (Level → Partner, validity window, usage cap) all persist and display correctly. |
| M2-T3 Taxes & Service Fees | **PASS** | Tax CRUD, inline Active toggle, duplicate-code rejection, fixed-amount tax CRUD, Service Fees tab renders its designed empty state with no create affordance. |
| M2-T4 Orders & payment records | **PASS — code inspection only, by design** | `OrderDoc` type exists in `src/types/collection.ts`; server-only DAL in `src/lib/db/adminOrder.ts`; deterministic order-id helper in `src/lib/orders/order-id.ts`; `PaymentProvider`/`SimulatedPaymentProvider` exist under `src/lib/payments/`. No order created, as directed — that happens naturally in Phase 2's public registration flow. |

## Flaky tests (self-healed by existing retry config, not product defects)

Three assertions failed on their first attempt but passed on retry within
the same run (each spec file already has `test.describe.configure({ mode:
"serial", retries: 2 })`, authored before this session):

1. `m1-registration-types.spec.ts` — "rejects a duplicate code (case-insensitive)".
2. `m1-registration-types.spec.ts` — "edit updates name/capacity and delete is blocked..." (specifically the `await expect(page.getByText("Registration type deleted")).toBeVisible()` assertion, observed once with both alertdialog buttons still in a disabled/pending state, i.e. the delete request was genuinely still in flight past the default 5s expect timeout).
3. `m2-pricing-taxes.spec.ts` — "rejects a duplicate tax code (case-insensitive)".

All three share the same shape: a real Firestore round-trip (server-side
uniqueness pre-check or a delete transaction) occasionally takes longer than
Playwright's default 5s assertion timeout against the real dev server +
real Firestore, not an emulator. This is an environment/timing
characteristic of testing a real backend, already absorbed by the specs'
own retry configuration — not a product defect, and no code or spec change
was made for it.

Separately, on an earlier attempt in this session (documented for
completeness, not reproduced on the final confirmation run):
`m2-pricing-discounts.spec.ts`'s "creates the QA10 promotion template"
failed once with a server-side `SyntaxError: Unexpected end of JSON input`
at `POST /api/dashboard/promotions/templates` (route.ts:46), then passed on
retry. Investigated below as **QA-7** — a real, independently-confirmed
defect (missing try/catch around `request.json()`), even though the
triggering race itself is rare.

## New defects found and confirmed live this session

### QA-1 — CONFIRMED LIVE (supersedes the previously-suspected "signup never syncs a server session cookie" claim) — Blocker — signup and any expired-session navigation trap the user in an infinite `/login` ↔ `/dashboard` redirect loop

This is a more severe, more precisely root-caused version of the
previously-suspected claim, now reproduced end-to-end with real browser
interaction (an isolated, unauthenticated browser context — never our real
account).

- **Repro** (reproduced live twice, independently):
  1. **Fresh signup path**: complete email/password signup
     (`/signup/credentials` → `/signup/organization` → `/signup/complete`),
     click "Go to Dashboard".
  2. **Expired-session path** (also reproduced this session, see QA-1b
     below): reuse a saved browser session whose server-side "session"
     cookie's embedded Firebase ID token has expired (~1 hour), then
     navigate to any `/dashboard/*` route.
- **Expected**: the user lands on a real, rendered dashboard.
- **Actual**: in both cases, the server-side `requireSessionUser()` gate
  (`src/lib/session.ts`) correctly finds no valid session cookie and
  redirects to `/login`. `/login`'s client-side `onAuthStateChanged`
  listener (`src/components/auth/login-form.tsx:70-84`) detects that
  Firebase's **client-side** auth state is still signed in (true for a
  freshly-signed-up user, and true for any user whose client SDK token
  auto-refreshed even though the server cookie didn't), so it renders the
  "You're already logged in" card with a 5-second countdown to
  `router.push(redirectTo)`. **Neither the countdown's auto-redirect
  (`login-form.tsx:109-113`) nor the "Go now" button
  (`login-form.tsx:191`) ever calls `syncSessionCookie()`** — that function
  is only wired to the real credentials-submission path
  (`onSubmit`/`loginWithGoogle`, lines 145-154 and 156-165). The
  `router.push("/dashboard")` therefore hits the exact same missing-cookie
  gate again, redirects back to `/login`, which detects the client user
  again, and restarts the countdown — **forever**. Live-captured evidence
  (countdown value across repeated 2s polls while the URL stayed on
  `/login` throughout): `5 → 3 → 1 → 4 → 2 → 5 → 3 → …`, confirming a
  genuine, observed infinite loop, not a one-time redirect.
- **Impact**: any brand-new signup is unable to ever reach the dashboard
  through the normal "Go to Dashboard"/countdown/"Go now" UI (the only
  escape is manually retyping credentials on the plain login form, which
  isn't shown once `currentUser` is truthy — so the user would have to
  explicitly click "Log out" first, which is not an obvious next step from
  a stuck countdown screen). The same trap re-catches **any** existing user
  whose tab has been open long enough for the session cookie to expire
  (see QA-1b) — this is not a signup-only edge case.
- **Severity**: **Blocker**. This is the most severe defect found this
  session.
- **Routing**: **fullstack-developer** (auth/session logic across
  `src/components/auth/login-form.tsx`,
  `src/features/signup/components/{organization-form,complete-form}.tsx`,
  `src/app/api/auth/session/route.ts`) + **security-agent** (session
  lifecycle: indefinite client-side trust in a stale/soon-to-expire ID token
  with no refresh path is a session-management concern worth a dedicated
  look, independent of this specific loop bug). Minimal fix: call
  `syncSessionCookie()` (or equivalent) before `router.push(redirectTo)` in
  both the countdown effect and the "Go now" handler.

### QA-1b — Blocker (root cause shared with QA-1, confirmed live this session, previously undocumented) — server "session" cookie holds a raw ~1-hour Firebase ID token with a 24h cookie `maxAge` and no client-side refresh, so any session left open >1 hour silently breaks

- **Repro**: authenticate normally, wait roughly an hour (or reuse a
  Playwright `storageState` captured over an hour earlier, as happened
  organically in this session), then navigate to any `/dashboard/*` route.
- **Expected**: either the session stays valid for close to its cookie
  `maxAge` (24h), or the user is cleanly re-prompted to log in.
- **Actual**: `src/app/api/auth/session/route.ts:22-29` sets the `session`
  cookie to the **raw Firebase ID token** (`res.cookies.set(COOKIE_NAME,
  token, { ..., maxAge: 60 * 60 * 24 })`) — but Firebase ID tokens are
  always short-lived (~1 hour) regardless of the cookie's `maxAge`. Nothing
  in the codebase refreshes this cookie after initial login — grepping the
  whole `src/` tree for `onIdTokenChanged` finds **zero** usages;
  `syncSessionCookie()` is called only twice total, both at explicit
  credential-submission time (`login-form.tsx`,
  `accept-invitation-view.tsx`). After the embedded ID token expires,
  `decodeUser()` (`src/lib/auth-utils.ts:33`) throws
  `auth/id-token-expired`, `requireSessionUser()` treats that identically to
  "no session" and redirects to `/login` — which then falls straight into
  the QA-1 infinite-loop trap described above, because the client Firebase
  SDK's own token silently auto-refreshed in the background and still
  reports the user as signed in.
- **Severity**: **Blocker** (shares the same user-facing symptom as QA-1 —
  an indefinite redirect loop — but is reachable by every returning user
  with a tab open past ~1 hour, not just fresh signups, so it is likely
  higher-frequency in practice).
- **Routing**: **fullstack-developer** + **security-agent** (same as QA-1;
  recommend either switching to Firebase Admin's dedicated
  `createSessionCookie`/`verifySessionCookie` pair with an appropriately
  long `expiresIn`, or adding an `onIdTokenChanged` listener that reposts to
  `/api/auth/session` on every token refresh).

### QA-6 — Major — Ticket price column compares `basePriceMinor` across different currencies as if they were the same unit

- **Repro**: create two active fees for the same ticket in different
  currencies where the numerically smaller minor-unit amount is NOT actually
  the cheaper price in real terms (e.g. Early Bird/Delegate: $750.00 USD =
  75000 minor units, £600.00 GBP = 60000 minor units). Open Ticket Types and
  look at the Price cell for that ticket.
- **Expected** (per `agents/docs/specs/m2-pricing-commerce.md` §M2-T1 AC-12
  and the Shared Decisions' explicit "Q5 = manual per-currency fee rows, no
  FX conversion"): since currencies are never converted, "lowest price"
  across different currencies is not a meaningful comparison; at minimum the
  display should not present a smaller-magnitude foreign-currency number as
  authoritatively "the" price without qualification.
- **Actual**: `src/features/pricing/utils.ts:174-195`
  (`getTicketPriceDisplay`) does `fees.filter(...).sort((a, b) =>
  a.basePriceMinor - b.basePriceMinor)` and picks `active[0]` as "the" price
  — comparing raw minor units across currencies with no normalization. Live
  reproduction (`e2e/m2-pricing-fees.spec.ts:244`, ran 3/3 times, failed
  identically every time): the Early Bird row displays **"£600.00 +1
  more"** as the headline price, even though the USD fee ($750.00) was
  created first and is the "primary"/first-listed currency in the Fees tab.
  A real organizer glancing at the Ticket Types list would see a GBP amount
  presented as if it were simply "the price," with no currency-mismatch
  framing.
- **Impact**: misleading price display wherever `getTicketPriceDisplay` is
  used (Ticket Types Price column here; also feeds a tooltip). Not a
  security or data-integrity issue (no money math is affected — Fees remain
  correctly separated by currency in Firestore), but a real
  organizer/end-user-facing correctness bug.
- **Routing**: **fullstack-developer** (logic defect in
  `src/features/pricing/utils.ts`) — the fix likely needs a currency-aware
  tie-break (e.g., prefer the event/org's default currency, or show "Multiple
  currencies" instead of picking one arbitrarily) rather than raw numeric
  sort. Regression test to add once fixed: two fees, same ticket, different
  currencies, assert the display does not imply direct comparability.

### QA-7 — Minor/Major (confirmed via live reproduction, not just code read) — 18 API routes crash with an unhandled 500 instead of a clean 400 on empty/malformed JSON bodies

- **Repro** (reproduced live, not just statically): started the dev server
  standalone and sent an empty-body `POST` (real session cookie attached) to
  `/api/dashboard/promotions/templates`:
  ```
  curl -X POST http://127.0.0.1:3000/api/dashboard/promotions/templates \
    -H "Content-Type: application/json" -H "Cookie: session=<real token>" --data ""
  ```
  Result: `HTTP_STATUS:500` with an **empty response body** — no error
  message, no diagnostic.
- **Expected**: a controlled `400 { error: "Invalid JSON body" }` (or
  similar), matching the pattern already used correctly in 19 other routes
  in this codebase that wrap `request.json()` in a `.catch(...)`.
- **Actual root cause**: `src/app/api/dashboard/promotions/templates/route.ts:46`
  — `const body = await request.json();` — has no try/catch. Any malformed
  or empty body throws an uncaught `SyntaxError`, which Next.js turns into a
  bare 500. This exact pattern (bare `await request.json()`, no `.catch`)
  exists in **18 API routes total**:
  `src/app/api/dashboard/events/[eventId]/checkin/{config,confirm,resolve,team-members}/route.ts`,
  `src/app/api/dashboard/events/[eventId]/form/submit/route.ts`,
  `src/app/api/dashboard/events/[eventId]/page/{publish,}route.ts` (both
  `page/route.ts` and `page/publish/route.ts`),
  `src/app/api/dashboard/events/[eventId]/promotions/{,[promotionId]/}route.ts`,
  `src/app/api/dashboard/events/[eventId]/route.ts`,
  `src/app/api/dashboard/events/[eventId]/status/route.ts`,
  `src/app/api/dashboard/forms/templates/{,[templateId]/,[templateId]/apply/}route.ts`,
  `src/app/api/dashboard/promotions/templates/{,[templateId]/,[templateId]/apply-to-events/}route.ts`,
  `src/app/api/events/[eventId]/register/route.ts`.
- **How this surfaced in the suite**: `m2-pricing-discounts.spec.ts`'s
  template-creation test hit this exact 500 once (visible in the dev server
  log: `SyntaxError: Unexpected end of JSON input ... at POST
  src/app/api/dashboard/promotions/templates/route.ts:46:30`), most likely
  triggered by a transient Next.js dev-mode fast-refresh recompile racing
  the in-flight request — an environment-only trigger condition — but the
  underlying missing-catch defect is real and independently reproducible via
  the curl repro above, regardless of what triggers an empty/malformed body
  in production (a flaky client, a proxy timeout, a buggy future caller).
- **Severity**: Minor-to-Major. Not exploitable (no data is written on a
  parse failure) but a real robustness/observability gap across 18 routes —
  any of them can 500 opaquely instead of failing predictably.
- **Routing**: **backend-agent** (API input-validation boundary) +
  **fullstack-developer** (these are Next.js route handlers, some also owned
  by feature teams). Suggested fix: a shared `parseJsonBody(request)` helper
  used consistently, or a top-level try/catch per route returning 400.

## Prior-attempt defects — CONFIRMED LIVE this session (previously only static/suspected)

### QA-2 — Major, CONFIRMED — Fee/Tax dialog "Base price"/"Rate" inputs are not associated with their labels

- Live check: `feeDialog.getByLabel("Base price").count()` → **0**;
  `taxDialog.getByLabel("Rate").count()` → **0** (both against the real,
  live Create Fee / Create Tax dialogs, not a static read).
- Root cause (confirmed in code): `fee-dialog.tsx` and `tax-dialog.tsx` wrap
  the `<Input>` in an extra `<div className="relative">` between
  `FormControl` and `Input` (to position a currency/percent affix);
  `FormControl` (a Radix `Slot.Root`) forwards `id={formItemId}` to that
  wrapper `<div>`, not the real `<input>`, so `<FormLabel
  htmlFor={formItemId}>` never actually associates with the input. This is
  the same defect the harness already worked around via
  `e2e/fixtures/dom-helpers.ts`'s `getInputByFormItemLabel` — every M2 spec
  in this run used that workaround successfully, which is itself further
  confirmation the direct label association is broken.
- Routing: **ui-ux-designer + fullstack-developer**.

### QA-3 — Major, CONFIRMED — Promotion Template "Discount Type" is unconstrained free text

- Live check: `discountTypeControl.evaluate((el) => el.tagName)` → **"INPUT"**
  (a plain text input, not a `<select>`/listbox) on the real New Template
  dialog.
- Root cause (confirmed in code): `promotion-templates/schema.ts:22` is
  `z.string().optional()`, rendered as a plain `<Input>` in
  `promotion-template-form-dialog.tsx`. Pricing's
  `formatDiscountAmount`/downstream rendering
  (`src/features/pricing/utils.ts:88-106`) only recognizes the exact
  lowercase strings `"percentage"` or `"fixed"` — any other casing/spelling
  silently renders "—" everywhere the discount amount is shown.
- Routing: **ui-ux-designer + fullstack-developer** (constrain to a
  `<Select>`/enum at both the schema and UI layer).

### QA-4 — Minor, CONFIRMED — "Enable promo code" switch has no accessible label

- Live check: `templateDialog.getByLabel("Enable promo code").count()` →
  **0**; `templateDialog.getByRole("switch").count()` → **1** (the switch
  exists and is the only one in the dialog, but has no label-for
  association) — against the real, live New Template dialog.
- Root cause (confirmed in code):
  `promotion-template-form-dialog.tsx:176-194` renders "Enable promo code"
  as a plain sibling `<p>`, and the `<Switch id="enablePromoCode">` has no
  `<Label htmlFor="enablePromoCode">` or `aria-label`.
- Routing: **ui-ux-designer + fullstack-developer**.

### Bonus finding (confirmed via code read, not independently live-verified this session; low severity, noted for completeness)

`src/lib/auth-utils.ts:34-37` — `decodeUser()` serializes a missing
`name`/`picture`/`email`/`uid` from the decoded Firebase token as the
literal strings `"No name"` / `"No picture"` / `"No email"` / `"No uid"`
instead of `null`/`undefined`. Minor data-hygiene issue (these placeholder
strings could end up persisted or displayed verbatim). Routing:
**fullstack-developer**.

## Harness changes made this session

- `e2e/fixtures/test-data.ts`: `REGISTRATION_START_DATE` bumped from
  `2026-07-26` to `2026-07-30` — the original value was in the past by the
  time this rerun actually executed, which silently failed the create-event
  form's client-side Zod validation ("Registration cannot start before
  today") with no visible error, causing event creation to no-op. This was a
  stale-fixture bug in the harness itself, now fixed and confirmed working.
- `e2e/auth.setup.ts`: added a `waitForActiveOrgBadge()` helper (reload-once
  fallback) used both after org creation and before filling the create-event
  form. Root cause: `AuthContext`'s org-loading path
  (`src/contexts/AuthContext.tsx`) intermittently never flips
  `initializing` to `false` on a full page load (~2 of 5 attempts this
  session), leaving the "Loading workspace..." badge stuck indefinitely even
  though server-rendered, session-derived content on the same page (e.g.
  event counts) reflects the correct data — a real, separate, unconfirmed
  intermittent client-state bug worth a follow-up ticket, but not chased
  further this session since a single reload reliably recovers it and it did
  not block any acceptance criterion.
- `e2e/m0-foundations.spec.ts`: added `test.setTimeout(150_000)` to "every
  nav section deep-links..." — this test walks 11 distinct routes against
  the real `next dev` server, each needing an on-demand first compile; that
  routinely exceeds the global 60s default on a cold route cache even though
  every individual navigation succeeds. Confirmed fix: reran this single
  test in isolation after the change and it passed cleanly (58.9s warm,
  1.0m in the full final run).
- No `src/` application code was modified. No regression tests were added to
  `src/__tests__/` (out of scope for live E2E per this task's brief).
- Three one-off temporary verification specs
  (`e2e/_qa-signup-check.spec.ts`, `e2e/_qa-defect-recheck.spec.ts`) were
  created to live-reproduce QA-1/QA-1b/QA-2/QA-3/QA-4, then deleted
  immediately after use — they are not part of the committed suite.

## How to re-run

```bash
E2E_EMAIL=petricha98@gmail.com E2E_PASSWORD=<redacted> \
  npx playwright test --project=chromium --reporter=list
```

The setup project is idempotent — it detects and reuses the existing
`E2E QA Org 2026-07-26 v2` organization and `E2E QA Conference 2026 Phase 1`
event rather than creating duplicates. All M1/M2 specs are similarly
idempotent (they skip creation when the named row already exists), so
Phase 1's specs can be safely rerun as a smoke check before Phase 2 begins.

## Final verdict

**SIGNED OFF for Phase 1 with defects open.** All in-scope acceptance
criteria for M0-T1, M0-T2, M0-T3, M1-T1, M1-T2, M2-T1, M2-T2, M2-T3, M2-T4
pass. Two **Blocker**-severity defects exist (QA-1 signup/expired-session
infinite redirect loop, QA-1b its ~1-hour-session-expiry root cause) but
neither blocks Phase 1's own scope or Phase 2's planned admin-authenticated
flows (Phase 2 will start from its own fresh login, same as this phase did).
They must be fixed before any real end user relies on signup or a
long-lived session, and should be prioritized ahead of Phase 4's IAM work.
One **Major** defect (QA-6, cross-currency price display) and one
**Minor/Major** systemic gap (QA-7, 18 unhandled-JSON-parse routes) are
functional/robustness issues, not blockers. Three Major/Minor UI defects
(QA-2, QA-3, QA-4) were re-confirmed live and remain open from the prior
report.
