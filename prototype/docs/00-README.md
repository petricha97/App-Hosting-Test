# Video Analysis — `event-meeting.mp4`

Analysis of a **~69-minute screen recording** for an event-management app project.
The recording is a working/research session that walks through **Cvent** (an
industry-standard event platform) as a reference, demos the team's **own app
("Eventa"/Petri)**, and researches a competitor (**Swapcard**) and **payment
providers**.

> Built from the **333 extracted keyframes** + metadata. **No transcript/audio** —
> everything here is from on-screen visuals. See [08](08-takeaways-and-gaps.md).

## TL;DR

- **App under the microscope:** Cvent (`app.cvent.com`), building the event
  *"5th annual General Counsel Summit US 2026"* for org *Economist Enterprise*.
- **Covers the full event lifecycle:** setup → website → agenda → registration →
  pricing → marketing → email → attendees → on-site (OnArrival) → reports →
  integrations.
- **Biggest lesson:** Cvent separates **Admission Item / Fee / Registration Type /
  Registration Path** — four concepts beginners merge into one "ticket".
- **Your app already has** the core spine (events, page builder, forms, responses,
  promotions, templates). **Main gaps:** payments, typed tickets + pricing,
  lifecycle emails w/ QR, on-site check-in, reporting.

## Read in this order

| # | Doc | What's in it |
|---|---|---|
| 01 | [Video Overview](01-video-overview.md) | What the video is, the event, recording facts, limitations |
| 02 | [App & Navigation](02-app-and-navigation.md) | What Cvent is; its layout & nav; UI patterns worth copying |
| 03 | [Timeline](03-timeline.md) | Full chronological walkthrough (8 phases) w/ timestamps + frames |
| 04 | [Registration & Pricing](04-cvent-registration-and-pricing.md) | The ticketing engine — the most important module |
| 05 | [Marketing & Email](05-cvent-email-and-marketing.md) | Trackable links, merge tags, lifecycle email builder |
| 06 | [Attendees, OnArrival, Reports](06-cvent-attendees-onarrival-reports.md) | Roster, badges, check-in, analytics, integrations |
| 07 | [Your App vs Competitors](07-your-app-vs-competitors.md) | Your "Eventa" app, Swapcard, Stripe/Airwallex payments |
| 08 | [Takeaways & Gaps](08-takeaways-and-gaps.md) | Ranked design lessons, unclear bits, follow-up questions, transcript how-to |

## Source files

- `../keyframes/` — 333 screenshots, named `NNNN_HH_MM_SS_mmm.jpg`
- `../metadata/keyframes.json` · `keyframes.csv` — timestamps + paths
- `../metadata/video_info.json` — duration, FPS, extraction settings
- `../contact_sheet.jpg` — thumbnail grid overview
