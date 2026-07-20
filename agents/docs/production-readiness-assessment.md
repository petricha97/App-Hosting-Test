# Production Readiness Assessment

**Date:** 2026-07-20
**Context:** The Cvent-parity roadmap (M0–M8, 43 tickets) is complete — 0 remaining, 1 Won't-do (deferred Next 16 / React 19 majors). The app has feature parity with its plan. This document captures what remains for a real production launch: hardening what's built and wiring up real integrations. These are **not new features** — the roadmap is finished.

**Current test state:** 2,126 tests across 193 files (Vitest against a fake Firestore double). Honest whole-repo coverage (all-source): ~60.5% statements / ~51.9% branches. Core code (routes, DAL, libs) sits at ~80% branches; the lower global number is the low-risk UI layer. CI (GitHub Actions) enforces lint + typecheck + coverage floors on every push/PR to `prototype`.

---

## ✅ Good news — core things already done right

- **Ticket oversell is prevented correctly.** Checkout (`createAdminOrderWithFinalize`) runs in a Firestore transaction that reads `registeredCount` vs `capacity` and increments atomically, so two people cannot buy the last ticket concurrently (SOLD_OUT / TYPE_FULL). The classic event-app bug is handled.
- **Config fails closed.** A missing secret (e.g. `QR_TOKEN_SECRET`) throws on first use rather than silently misbehaving.
- **Multi-tenant isolation is solid.** This session's deep testing found only *defense-in-depth* gaps — no live cross-tenant/money bugs in the core buying/pricing path. Routes gate ownership; the DAL now re-checks it too.
- **Coverage is honest and CI-enforced.** The core (DAL/routes/libs) is the best-tested part and is held to a high per-directory bar.

---

## 1. Core-correctness gaps — executable in this environment (recommended priority)

These directly serve "core features must not have bugs" and can be both built **and verified** here.

### 1a. Concurrency is correct-by-construction but barely race-tested
The oversell guard, order-finalize, and promotion-usage counters all use transactions, but — like the last-Owner guard before M8-T8 — **nothing simulates concurrent collisions**. A future change swapping a transactional check for a non-transactional one would not be caught by any test. Add race-simulation tests (the M8-T8 fake-db interleave pattern) for the checkout/oversell and order-finalize paths.
**Value: HIGH** — this is exactly where a subtle, hard-to-reproduce production bug (double-charge, oversell) would live.

### 1b. File uploads have no MIME / size limits
The page-assets, logo, and avatar routes accept a valid `File` but do not restrict type or size (flagged during M8-T4). Real abuse vector: huge or malicious file uploads. Add MIME allowlist + size caps.

### 1c. Secrets aren't validated before deploy
Several secrets (`QR_TOKEN_SECRET`, `DRAFT_TOKEN_SECRET`, `SCANNER_SESSION_SECRET`, plus `NEXT_PUBLIC_APP_URL`) are manual pre-deploy tasks that "throw on first use" — so a missing one surfaces as a runtime error **for a real user**, not at deploy. Add a startup / CI check that all required secrets are configured, failing fast instead.

---

## 2. Security-boundary gap — needs the Firebase emulator (same blocker as E2E)

### Firestore rules are tested only as *text*, not executed
`firestore.rules` is the client-side security boundary (deny-all + specific grants). The existing test only asserts the rules **file's** permission list matches the code — it never *runs* the rules to confirm they actually deny/allow correctly at runtime. Real rules tests need `@firebase/rules-unit-testing` against the emulator.

### End-to-end (E2E) tests do not exist
Every test runs against a **fake** Firestore double — logic is verified in isolation, but nothing exercises the real full journey (register → pay → ticket → check-in, publish, IAM) in a browser against a real backend. This is the single biggest structural gap for catching integration bugs. Needs Firebase emulator + Playwright.

> Both of the above require infrastructure not available in the current sandbox (no browser/emulator). Building tests that can't be run here would ship unverified — recommended as a dedicated effort where the emulator can actually execute.

---

## 3. Can't-go-live-without — product / infra decisions (need credentials or a service)

- **Payments are simulated** — no Stripe (or other provider). Going live needs real payment integration, webhooks, and reconciliation.
- **Email is a dev outbox** — no real provider wired. Needs Resend / SendGrid / SES for actual delivery (deliverability, bounce handling).
- **No error tracking / monitoring** — no Sentry or APM. A production bug is invisible until a user complains. For "must not have bugs," *knowing when one happens* is half the battle. Needs a service (signup + DSN).
- **Rate limiter is in-memory per-instance** — on serverless (App Hosting), each instance keeps its own buckets, so the effective limit scales with instance count. Real abuse protection needs a shared store (Firestore / Redis). Documented as a known residual.

---

## 4. Ongoing hygiene

- **Privacy / GDPR** — attendee PII retention + deletion (right to be forgotten); abandoned-registration PII persistence is an open product question.
- **Automated dependency updates** — Dependabot / Renovate; plus the deferred Next 16 / React 19 majors (Won't-do for now, breaking-change risk).
- **Backups / disaster recovery** — Firestore point-in-time recovery / export schedule.
- **Accessibility + performance** on the public registration page — affects conversion and can be a legal requirement (Core Web Vitals, a11y).

---

## Recommendation

Start with the **§1 executable core-correctness items** — highest leverage, and the one category that can be both built and verified here now. The **concurrency race tests (§1a)** are the standout: subtle double-charge/oversell bugs are exactly what they catch.

The §2 (E2E + rules testing) and §3 (payments / email / monitoring) items are real and important but are integration projects that need infrastructure and/or decisions and credentials.

**Suggested order:**
1. Concurrency race tests (checkout/oversell, order-finalize, promotion usage) — §1a
2. File-upload MIME/size limits — §1b
3. Secrets presence validation (fail-fast) — §1c
4. Scope E2E + rules testing setup (emulator + Playwright) as its own effort — §2
5. Go-live integrations: payments, email, monitoring — §3 (require your decisions)
