# 07 · Your Own App, Swapcard & Payments

Beyond Cvent, the video shows three other things directly relevant to your build.

---

## A. Your own app — "Eventa" / "Petri Test" (frames 0221–0263, 0284–0312)

The recording captures **your own work-in-progress app** side-by-side with Cvent.
Observed facts:

- **Branding:** "Eventa" (public) / "Petri Test" (workspace name).
- **Hosting:** Firebase App Hosting
  (`app-router--ai-driven-app-hosting.asia-southeast1.hosted.app`), **Next.js**
  (route.ts / App Router visible in VS Code), **Firestore** backing store.
- **Signed in as:** petricha98@gmail.com.

### What's already built
| Area | State in video | Frame |
|---|---|---|
| **Dashboard** | Sidebar: Overview, Events, Forms, Responses, Promotions, Users & Access. Stat cards (Draft/Published/Total events, Active forms) | `0221`,`0224` |
| **Events** | List reading a Firestore collection; event "petri" (published, capacity 100/1000, timezone, form path). Shows a raw **debug JSON payload** | `0225`–`0227` |
| **Event hub** | Public-readiness checklist (4/4), page modes **Default / Custom / Redirect**, event-level promotion attach | `0228`–`0231` |
| **Page Builder** | **Puck**-based drag-drop editor; components Hero, Highlights, Story, Schedule, FAQ, CallToAction, **RegistrationEmbed**; device previews; draft/publish; starter templates | `0236`–`0238` |
| **Form Builder** | Per-event registration form; palette Short text / Email / Long answer; publish; detach template | `0244`–`0246` |
| **Form Templates** | Reusable templates w/ **versioning**, locked core fields (`first_name`/`last_name`/`email`), "apply to all linked forms" | `0252`–`0256` |
| **Responses** | Live submission inbox reading Firestore FormData; per-event response workspace w/ status (New/Reviewed) | `0286`,`0299` |
| **Promotions** | Promo-template system: percentage discount, promo codes, **conditions** (e.g. Nationality = Singaporean), **inherit-from-parent** | `0300`–`0308` |
| **Settings** | Workspace & profile (org logo, roles & permissions, members) | `0309`–`0312` |

### Honest read of where you are vs Cvent
Your app already mirrors Cvent's **core spine** impressively: event → page builder
→ registration form → responses → promotions, with a template/versioning system.
The main gaps vs the Cvent reference (see other docs) are:
- **Ticketing depth** — no separate Admission Items / Fees / Registration Types /
  multi-path registration yet (you have one form, not typed tickets + pricing).
- **Payments** — not wired (hence the Stripe/Airwallex research below).
- **Email lifecycle** — no triggered email engine (confirmation, reminders, QR).
- **On-site** — no check-in / QR / wallet passes.
- **Reporting** — debug JSON, not report templates/exports.

These are the natural next milestones, roughly in priority order for a real event:
**payments → typed tickets & pricing → confirmation emails w/ QR → check-in →
reports.**

---

## B. Competitor — Swapcard (frames 0195–0214)

Researched as an alternative reference to Cvent. Key notes:

- Positioning: **"revenue-first intelligent event platform"** for trade shows,
  conferences, associations, media events.
- Admin product = **Swapcard Studio** (`studio.swapcard.com`). Its IA:
  **Event builder · Registration · Content · Meetings · Communications ·
  Analytics** (+ Home Page Builder).
- Strong on **engagement analytics** (active users, engagement %, "top
  performing" session/speaker/exhibitor/sponsor) and **session formats**
  (On-demand / Pre-recorded / Simu-live / RTMP) — i.e. more virtual/hybrid &
  networking focused than Cvent.

**Takeaway:** Cvent = depth of registration/logistics; Swapcard = engagement,
networking, virtual sessions & analytics. Decide which pole your app leans toward
— they imply different data models.

---

## C. Payments research — Stripe, Airwallex, Worldpay (frames 0314–0333)

The session ends evaluating how to **take payments** (currently missing from your
app):

- **Stripe** (`stripe.com`) — "financial infrastructure"; checkout with
  Card/Affirm/Cash App/Crypto/US bank; **usage-based billing**. The default
  developer-friendly choice.
- **Airwallex** (`airwallex.com`) — **Payment Links** (no-code, one-time or
  reusable, share via link/email/**QR**), 160+ payment methods, multi-currency
  accounts, FX savings, 3DS/risk controls. Strong for **multi-currency /
  international** events (relevant given SGD/GBP/USD seen across the events).
- **Worldpay** — enterprise processor (knowledge-panel research only).

**Takeaway:** for an events app with international pricing (you saw £/$/SGD),
evaluate **Stripe** (best DX, fastest to integrate) vs **Airwallex** (better
multi-currency + payment-link/QR flows that map naturally to event registration).
Payment **Links + QR** in particular align with how Cvent emails a
pay/registration link — a low-effort way to bolt payments onto your current form.
