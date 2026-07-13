# 08 · Design Takeaways, Gaps & Follow-up Questions

## Top design lessons for your event app (ranked)

1. **Separate the four "ticket" concepts.** Admission Item (what you register
   as) ≠ Fee (its price, per type/currency) ≠ Registration Type (who you are) ≠
   Registration Path (the flow). This separation is what makes Cvent flexible.
   *(See [04](04-cvent-registration-and-pricing.md).)*
2. **One block-based builder, reused everywhere** — pages, emails, and badges all
   share the same drag-drop widget paradigm. You already have Puck for pages;
   extend the same idea to emails/badges.
3. **A shared merge-tag / data-tag system.** Tokens like `{[EVENT TITLE]}` resolve
   across pages, emails, and badges. Build one token resolver early.
4. **Lifecycle-triggered emails, not one-off sends.** Confirmation, payment-due,
   reminders, "one day to go" — each triggered by status/schedule, with segmented
   recipients via a filter engine.
5. **A durable attendee identity (QR / wallet pass)** minted at registration and
   reused in email → wallet → on-site check-in.
6. **Promo codes as first-class objects** with usage caps, validity windows, and
   conditions — you've already started this (SG80). Good.
7. **Templates + shared asset library** (org → template → event) so repeat events
   start pre-configured.
8. **Built-in report templates + CSV export**, not raw JSON.
9. **Multi-path registration** keyed to audience/payment method (CC vs Invoice).
10. **Payments** — pick a provider (Stripe vs Airwallex) and wire checkout; this
    is your biggest current gap. *(See [07](07-your-app-vs-competitors.md).)*

## Suggested next-milestone order for your app
`Payments → typed tickets & pricing → confirmation email w/ QR → check-in →
reports`. Rationale in [07 §A](07-your-app-vs-competitors.md).

---

## Unclear sections / limits of this analysis

- **No audio/transcript** → we can see *what was clicked* but not *what was said*
  (intent, opinions, decisions). Every doc is visual-only.
- **OnArrival is config-only** — no live check-in/scan demo was recorded.
- **Cvent event context switches** — most footage is the "General Counsel Summit
  US 2026", but a few frames jump to other events (EuroFinance Treasury, Asia
  summit). Timestamps note this where visible.
- **Interruptions** — several frames are macOS Mission Control, WiFi/hotspot
  dialogs, and browser login screens (not product content) — skipped in the docs.
- **Own-app internals** — we see the UI and some debug JSON, but not the actual
  code/schema (that lives in your repo, not this video).

## What extra data would sharpen this

- **A transcript** (see below) to capture narration/decisions.
- **The Cvent event export / config** if you want exact field lists.
- **Your app's repo/schema** to map Cvent concepts onto your real data model.

## Follow-up questions someone could ask about this video

1. Which Cvent features are **must-have vs nice-to-have** for your v1?
2. Are you cloning Cvent's registration model (typed tickets + paths) or keeping
   the single-form model your app currently has?
3. Stripe or Airwallex — and single-currency or multi-currency at launch?
4. Do you need **on-site check-in** (QR/wallet) for your first real event, or is
   it online-only?
5. How far do you take the **email lifecycle** (just confirmation, or the full
   reminder/debt-chase/countdown set)?
6. Is **Swapcard-style engagement/analytics** in scope, or are you purely
   registration/logistics like Cvent?
7. What's your **template/reuse** story (org → template → event)?
8. Which **integrations** matter (Salesforce/HubSpot, marketing, calendar)?

---

## How to add a transcript later (recommended)

The folder has no transcript, which is the single biggest missing input. To add
one from `event-meeting.mp4`:

- **OpenAI Whisper** (local, free): `whisper event-meeting.mp4 --model medium
  --output_format srt` → gives timestamped captions you can align to these frames.
- **faster-whisper** for speed on CPU/GPU, or a hosted API (AssemblyAI, Deepgram,
  Azure/Google Speech) if you prefer no local setup.
- Save the result as `metadata/transcript.srt` (or `.vtt`), then a second pass can
  merge narration with each keyframe timestamp for a much richer analysis.

> Since it's a *screen recording of app UIs*, also consider **OCR** on the
> keyframes (e.g. Tesseract) to extract on-screen text into searchable metadata.
