# Cvent Parity Plan — Executive Summary

Date: 2026-07-09 · Branch: `prototype`
Produced by the agent loop (code audit + prototype screen inventory + orchestrator planning).

Full detail lives in:
- [BACKLOG.md](BACKLOG.md) — 33 tickets across 9 milestones with per-agent task breakdowns and status table
- [specs/_code-audit.md](specs/_code-audit.md) — audit of what exists today in `src/`
- [specs/_screen-inventory.md](specs/_screen-inventory.md) — entity/interaction inventory of all 17 prototype screens

---

## Where the app stands vs. the prototype

**Solid already:** event CRUD, form/template builder, responses, Puck page builder, discount promotions, auth/signup, public event pages.

**Stubbed:** IAM (hardcoded mock members/roles in `src/features/iam/components/iam-dashboard.tsx`), dashboard metrics (partly `src/features/dashboard/mock-data.ts`).

**Entirely missing:** registration types, registration paths, tickets, pricing, attendees, check-in, emails, reports — half the prototype's Event shell has no code behind it.

**Key insight from the screen inventory:** the prototype's data spine is **Registration Type (who) × Ticket (what) × Fee (price) × Path (flow)**, layered on top of the current single-form-per-event model. A second cross-cutting thread is the **QR identity**: minted at confirmation → email → wallet pass → badge → door scan → reports.

---

## The 9 milestones (dependency order)

| # | Milestone | Scope |
|---|-----------|-------|
| M0 | Foundations | Event workspace shell (per-event sidebar nav every new screen needs), starter-cruft cleanup (`api/chat`, `api/todos`, todo page, `event-form-test.tsx`), Firestore index audit, test baseline |
| M1 | Registration data spine | Registration Types, Ticket Types |
| M2 | Pricing & commerce | Fees, discounts (extends existing promotions engine + client `eventPromotion.ts` repo), taxes/service fees, orders & payments |
| M3 | Registration paths & flow | Paths admin, ticket-selector/promo-code form fields, public multi-step stepper, approval workflow (New→Pending→Reviewed→Accepted), abandoned tracking |
| M4 | Event website | New Puck blocks (Ticket & Pricing table, Countdown, Registration Embed), per-path pages |
| M5 | Attendees & check-in | Attendee entity + QR identity service, roster, abandoned tab, check-in config, scan flow |
| M6 | Communications | Email infra (dev outbox default), lifecycle triggers (on-submit / on-accept / +24h abandoned / debt chase / scheduled), email designer (stretch: shared block engine) |
| M7 | Reporting | Aggregates + summary cards, report template library, scheduled delivery |
| M8 | Hardening | Real IAM replacing mock data, real dashboard metrics, event-overview parity (final integration ticket), coverage backfill |

---

## Sprint 1 recommendation

| Ticket | Title | Why first |
|--------|-------|-----------|
| M0-T1 | Event workspace shell | Unblocks every downstream event sub-screen |
| M0-T2 | Starter-cruft cleanup | Cheap, parallel de-risker |
| M0-T3 | Firestore index audit | Cheap, parallel de-risker; current `firestore.indexes.json` only covers EventPromotion |
| M1-T1 | Registration Types | Top of the data spine everything joins through |
| M1-T2 | Ticket Types | Ditto; prerequisite for pricing, paths, attendees, reports |

Suggested dispatch: M0-T2 and M0-T3 immediately (small, parallel); M0-T1 starts with Research Lead; M1-T1 research queues behind it.

---

## Open product questions (human decisions needed)

Defaults were assumed so work isn't blocked, but these need confirmation:

1. **Payments** — real Stripe integration or simulated provider behind an interface? *(default: simulated; blocks M2-T4 final form)*
2. **Email provider** + sending domain? *(default: dev outbox transport; blocks M6-T1 real sending)*
3. **Abandoned-registration tracking** — OK to persist pre-submission PII (name, partial email, last step reached)? Consent/retention requirements? *(blocks M3-T5)*
4. **Wallet passes** — real Apple/Google certs or placeholder buttons?
5. **Multi-currency** — manual per-currency fee rows only, or FX conversion?
6. **Check-in scanner** — web camera scanner acceptable for v1 vs. the prototype's iOS device?
7. **Roles** — is Admin distinct from Owner, and is billing in scope?

---

## How the loop runs (per AGENT_LOOP.md)

Per ticket: Orchestrator assigns → Research Lead spec → UI/UX design spec → Full-Stack Dev implements (Backend Agent owns all DAL/Firestore work) → Code Reviewer → Security Agent → QA Agent → Orchestrator closes against the Definition of Done → GitHub Agent commits and, on feature/milestone completion, merges the feature branch into `prototype`. Status is tracked in the BACKLOG.md table.

**Git policy:** `main` is untouchable — no agent ever commits to, merges into, or pushes it. All work integrates into `prototype` via `--no-ff` merges of `feat/<ticket-id>-<slug>` branches, handled exclusively by the GitHub Agent (merge logs in `agents/docs/git/`).
