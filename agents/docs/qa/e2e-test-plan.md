# Full End-to-End Test Plan — Cvent-Parity App (Playwright)

Owner: Claude (Orchestrator). Created 2026-07-26.
Executor: Claude's own `qa-agent` (Agent tool). Originally attempted via OpenAI Codex CLI
(`@openai/codex`); abandoned after two blocked Phase 1 attempts — see Execution model below.

## Objective

Drive a full, real, browser-based Playwright regression across every "Done" ticket in
`agents/docs/BACKLOG.md` (M0 through M8-T9 — everything except the still-`Todo` M8-T10/T11,
which have no shipped feature to test). All prior QA sign-offs for these tickets were done
against mocked/unit-level tests only; nobody has driven the real app in a real browser yet.

## Execution model

- **Claude (this session) is the Orchestrator.** It sequences phases, prepares each phase's
  full self-contained brief, dispatches it, reads back the report + handoff block, and decides
  what (if anything) changes before dispatching the next phase.
- **Executor: Claude's own `qa-agent` (via the Agent tool), not Codex CLI.** Codex CLI
  (`@openai/codex`) was tried first per the user's initial request, but abandoned after two
  failed Phase 1 attempts: `codex exec`'s own execution sandbox (`workspace-write`, its default
  regardless of the user's `~/.codex/config.toml` `[windows] sandbox = "elevated"` setting)
  blocks all outbound network for the Chromium/Node processes it spawns — confirmed directly
  (Claude's own shell reaches `identitytoolkit.googleapis.com` fine; the same probe run through
  `codex exec` fails with a transport-level connection error). The fix (`--sandbox
  danger-full-access`) was blocked by Claude Code's own permission classifier (granting an
  external agent unrestricted disk+network access), and the user chose to drop Codex rather
  than add a permission rule or run it manually. Codex's harness improvements from those two
  attempts were kept (see below) — only the execution engine changed.
- Each phase is one `qa-agent` dispatch (foreground/synchronous, so the orchestrator has the
  handoff block in hand before deciding the next phase's brief) that writes Playwright specs
  under `e2e/`, runs `npm run test:e2e -- --project=chromium` for real, and writes the report.
- **Strictly sequential, never parallel.** Each phase's tests create real data (org, event,
  registration types, tickets, fees, an accepted registration, an attendee, emails, reports…)
  that the next phase's tests depend on. Phase N+1 cannot start until Phase N's handoff block
  (org/event IDs, entity IDs) is in hand.
- After Phase 4, Claude compiles one final cross-milestone summary covering all ~45 tickets.

## Environment facts that shape every phase

- **No Firebase emulator is wired up.** `npm run dev` connects straight to the real Firebase
  project `ai-driven-app-hosting` for both Auth and Firestore — no
  `connectFirestoreEmulator`/`connectAuthEmulator` calls anywhere in `src/`. All testing hits
  real, persistent data.
- **Login:** `petricha98@gmail.com` (the user's real account). The password is supplied
  out-of-band to Codex via environment variable at dispatch time — it is never written into
  this plan, into prompts committed to the repo, or into any generated report.
- **Test-data isolation rule (mandatory in every phase's prompt):** log in first and check what
  organizations already exist on this account; create exactly ONE new, clearly-named dedicated
  test org (e.g. `E2E QA Org 2026-07-26 v2`) to contain all test data; never edit, delete, or
  otherwise touch anything outside that org.
- A first attempt at Phase 1 was already run once under a throwaway synthetic account
  (`e2e-qa-2026-07-26@example.com`) before this plan existed. Per the user's decision, that run
  is discarded and Phase 1 is redone from scratch under the real account above. Its findings are
  still useful reference and are preserved at
  `agents/docs/qa/e2e-regression-m0-m1-m2.md` (superseded, not authoritative).

## Reporting convention

Each phase writes:
- Playwright spec files under `e2e/` (new files; reuse/adapt the Phase-1-attempt specs already
  there — `e2e/m0-foundations.spec.ts`, `m1-registration-types.spec.ts`, `m1-ticket-types.spec.ts`,
  `m2-pricing-{fees,taxes,discounts}.spec.ts` — swapping their signup step for a login step).
- A report at `agents/docs/qa/e2e-regression-<phase-slug>.md`: per-ticket pass/fail table
  against the acceptance criteria in `agents/docs/specs/<milestone>.md` and
  `agents/docs/design/<milestone>.md`, defects found (repro steps, expected vs actual, severity,
  file/line if locatable), Playwright files touched, and how to re-run them. Codex does **not**
  fix application bugs during this pass — only documents them — and does **not** write
  regression tests into `src/__tests__/` (this is live E2E, not unit-test backfill).
- A compact handoff block in the executing agent's final message to Claude: test account
  (already known, not repeated in files), org/event IDs, every entity created (registration
  types, ticket types, fees, taxes, discounts, registration paths, attendees, QR data, etc.)
  that the next phase needs, and overall verdict per ticket.

---

## Phase 1 (redo) — M0 + M1 + M2 — Foundations, Data Spine, Commerce

**Tickets:** M0-T1 (event shell/nav), M0-T2 (cruft cleanup), M0-T3 (index audit — verify no
missing-index console errors while exercising M1/M2 lists; not directly UI-testable beyond
that), M0-T4 (unit-only, skip), M1-T1 (Registration Types CRUD/capacity/empty-state), M1-T2
(Ticket Types CRUD/sales-window Open-Closed derivation), M2-T1 (Fees + 4-tab Pricing shell),
M2-T2 (Discounts tab — validity window, usage cap, level), M2-T3 (Taxes CRUD + Service Fees
empty state), M2-T4 (Orders entity — code-inspection only, no admin UI exists yet; do not
attempt to create an order here, that happens naturally in Phase 2's public registration flow).

**Setup:** log in as `petricha98@gmail.com`, create one new dedicated test org + one event,
then create 2–3 registration types, 2–3 ticket types with sales windows, a fee matrix
(ticket × reg-type × currency), one discount code, and 1–2 tax rates.

## Phase 2 — M3 + M4 — Registration Paths, Public Flow, Page Builder

**Tickets:** M3-T1 (Registration Paths admin), M3-T2 (form-builder commerce fields — ticket
selector + promo code field types), M3-T3 (public multi-step registration flow — a real
attendee walkthrough: Personal Info → Ticket & Options → Summary → Payment → Confirmation,
verify QR renders), M3-T4 (response approval workflow — transition New → Pending → Reviewed →
Accepted, verify acceptance creates an attendee), M3-T5 (abandoned-registration tracking —
start a second public registration and abandon it mid-flow for Phase 3 to pick up), M4-T1
(new Puck blocks: pricing table / countdown / registration embed), M4-T2 (per-path page
customization).

**Depends on:** Phase 1's org, event, registration types, ticket types, fees, discount.

## Phase 3 — M5 + M6 — Attendees, Check-in, Emails

**Tickets:** M5-T1 (attendee entity + QR — verify from Phase 2's accepted registration), M5-T2
(attendee roster — search/filter/export/manual-register), M5-T3 (abandoned tab shows Phase 2's
abandoned record), M5-T4 (check-in configuration screen), M5-T5 (check-in scan flow using the
real QR from Phase 2's confirmation), M6-T2 (emails admin screen — grouped tables, preview,
toggle), M6-T3 (lifecycle triggers — "Email all" on the abandoned record, verify send log),
M6-T4 (email designer).

**Depends on:** Phase 2's accepted registration (attendee + QR) and abandoned record.

## Phase 4 — M7 + M8 — Reports, IAM, Dashboard, Hardening

**Tickets:** M7-T1 (reporting summary cards), M7-T2 (all 5 report templates + CSV export),
M7-T3 (scheduled report delivery UI), M8-T1 (real IAM — invite a second member, verify
Owner/Admin/Editor/Viewer permission matrix), M8-T2 (workspace dashboard real metrics), M8-T3
(event overview parity — stat cards, readiness checklist, publish), M8-T7 (CSV export
rate-limiting spot-check — hit an export route rapidly, expect a 429).

**Depends on:** everything from Phases 1–3 (orders, attendees, check-ins, emails all feed these
aggregates and reports).

---

## Status

- [x] Plan drafted and saved (this file).
- [x] Phase 1 (redo) dispatched (via `qa-agent`, not Codex) — **complete 2026-07-30**.
- [x] Phase 2 dispatched — **complete 2026-07-31**. See
      `agents/docs/qa/e2e-regression-m3-m4.md`.
- [x] Phase 3 dispatched — **complete 2026-07-31**. See
      `agents/docs/qa/e2e-regression-m5-m6.md`.
- [x] Phase 4 dispatched — **complete 2026-07-31**. See
      `agents/docs/qa/e2e-regression-m7-m8.md`.
- [x] Final cross-milestone summary compiled — `agents/docs/qa/e2e-final-summary.md`.

Two Codex-executed Phase 1 attempts on 2026-07-26 were both blocked before any real-account
login could complete: `codex exec`'s own sandbox gave its spawned Chromium/Node processes no
outbound route to Firebase Auth/Firestore, even with the sandbox flag omitted. No real-account
data was created or modified in either attempt. M0-T2's three removed routes were independently
verified as 404 in Chromium, and M2-T4 was code-inspected; all other tickets remain unassessed
from that period.

A third attempt on 2026-07-27, via Claude's own `qa-agent`, confirmed outbound network access to
Firebase is fine in this environment (unlike the Codex attempts) and got as far as actually
submitting the real login form — but Firebase rejected the supplied `E2E_EMAIL`/`E2E_PASSWORD`
combination with "Invalid email or password." This was confirmed as a genuine credential
mismatch (not an environment issue) via a read-only Firebase Admin SDK lookup of the account
(`providerData: ["password"]`, `disabled: false`, recent `lastSignInTime`). The agent
deliberately did not retry with guessed variations to avoid Firebase abuse-detection/lockout on
the user's real account. No org/event/data was created or modified.

**Phase 1 completed successfully on 2026-07-30** once the user supplied the corrected password.
Real login succeeded; one dedicated organization (`E2E QA Org 2026-07-26 v2`) and one event
(`E2E QA Conference 2026 Phase 1`) were created, along with 3 registration types, 3 ticket types,
4 fees (incl. a multi-currency pair), 2 taxes, and 1 discount. The full 39-test Chromium suite
ran to completion: 35 passed outright, 3 passed after an already-configured retry (flaky, not
product defects — real Firestore round-trip timing against the live backend), and 1 test failed
consistently and was left failing/documented as a genuine product defect (QA-6, cross-currency
price-column comparison) per this phase's instructions not to "fix" real bugs to force green.
Two new **Blocker**-severity defects were found and live-confirmed (QA-1 signup/expired-session
infinite redirect loop; QA-1b its ~1-hour session-cookie-expiry root cause) — neither blocks
Phase 2, which authenticates fresh, but both must be fixed before real users rely on signup or
long sessions. The four previously-only-suspected defects (QA-2/3/4, plus the original QA-1
claim) were all re-confirmed with live browser interaction this run. See
`agents/docs/qa/e2e-regression-m0-m1-m2.md` for the full authoritative report. The executor
remains Claude's own `qa-agent`. Phase 2 may now be dispatched.

**Phase 2 completed successfully on 2026-07-31.** All in-scope M3 + M4 acceptance criteria
passed live, including the phase's centerpiece — a real unauthenticated-visitor walk of the
full public multi-step registration flow producing a real Order/FormData/Attendee and a real
scannable QR SVG. One Major defect (QA-8, Registration Path dialog wiping in-progress fields on
a background refresh race) was found and live-confirmed; one Puck drag-and-drop verification gap
(M4-T1's two new blocks) was recorded as a QA/tooling limitation, not an independently confirmed
defect. See `agents/docs/qa/e2e-regression-m3-m4.md`. Phase 3 was dispatched next.

**Phase 3 completed successfully on 2026-07-31.** All in-scope M5 (T1–T5) + M6 (T2–T4)
acceptance criteria passed live, including the phase's centerpiece — a genuine QR check-in scan
using a legitimately re-minted real token, resolved and confirmed through the real scanner UI,
with idempotent re-scan and invalid-token handling both independently server-verified. Zero new
product defects were found; the M6-T4 Puck drag-and-drop gap from Phase 2 was independently
re-confirmed (not newly introduced) and worked around with an equally rigorous authenticated-API
verification of the same storage/render pipeline. See `agents/docs/qa/e2e-regression-m5-m6.md`.
Phase 4 (M7 + M8 — reports, IAM, dashboard, hardening) may now be dispatched.

**Phase 4 completed successfully on 2026-07-31.** All in-scope M7 (T1–T3) + M8 (T1–T3, T7)
acceptance criteria were exercised live, including a genuine second-identity signup and invite
acceptance proving M8-T1's full Owner→Editor→Viewer permission matrix end-to-end with zero
defects. One genuine, **Blocker**-severity defect (QA-9) was found and independently root-caused
via a direct Admin SDK repro: three separate, previously-signed-off money/operational stat
surfaces (M7-T1's Finance card, M8-T2's Revenue stat, M8-T3's Revenue **and** Abandoned stats) are
completely non-functional against real production Firestore because the new `sum()`-over-a-
nested-field and `count()`-with-a-range-filter aggregate queries these tickets added require
composite indexes that were never registered in `firestore.indexes.json` — despite each ticket's
own code comments confidently claiming this was "confirmed empirically against a live Firestore
emulator." This is exactly the class of gap this whole 4-phase live-browser effort was
commissioned to find, and every prior sign-off for these three tickets (unit-test-only,
`fake-admin-db`-backed) could not have caught it by construction. See
`agents/docs/qa/e2e-regression-m7-m8.md`. This was the final phase; the Orchestrator should
compile the final cross-milestone summary next.
