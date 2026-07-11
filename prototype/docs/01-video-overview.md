# 01 · Video Overview

## What this video is

A **~69-minute screen recording** of a working/research session. The main
thread is a hands-on walkthrough of a real event inside **Cvent** — one of the
largest industry-standard event-management platforms — moving through nearly
every module in the left-hand navigation. But the session is broader than that.
It actually covers **four things**:

1. **Cvent** (the industry reference) — ~40 min, the bulk of the video.
2. **The team's own app** — branded "Eventa" publicly / "Petri Test" workspace,
   a Cvent-inspired clone running on Firebase App Hosting (~8 min).
3. **Competitor research** — Swapcard ("revenue-first" event platform) (~5 min).
4. **Payment-provider research** — Stripe, Airwallex, Worldpay (~3 min at the end).

This is a strong reference for our own event-management app because it shows how
a mature commercial product organises the full event lifecycle: setup →
website → agenda → registration → pricing → marketing/email → attendees →
on-site check-in → reporting — and it captures our own app side-by-side with it.

> The session is driven by a Cvent account **Carlos Lalanda
> (carloslalanda@economist.com, org "Economist Enterprise")**, while the own-app
> workspace is signed in as **petricha98@gmail.com** — i.e. two people/accounts
> comparing the reference product against the app being built.

## The event being built

| Field | Value |
|---|---|
| Event name | **5th annual General Counsel Summit US 2026** |
| Organising account | **Economist Enterprise** (red logo, top-left) |
| Date | **Tuesday, September 15, 2026, 8:00 AM – 6:45 PM ET** |
| Venue | **Convene, 117 West 46th Street** (New York City) |
| Type | Single-day, in-person professional/legal summit |
| Platform | Cvent (`events.app.cvent.com` / `app.cvent.com`) |

## Recording facts (from `metadata/video_info.json`)

| Field | Value |
|---|---|
| Source file | `event-meeting.mp4` |
| Duration | **01:08:56** (4136.25 s) |
| FPS | ~59.9 |
| Total frames | 247,790 |
| Keyframes extracted | **333** (deduplicated) |
| Sampling | 1 frame every 2 s, then perceptual-hash dedupe |
| Transcript | **None provided** |

## Important limitation

There is **no transcript or audio**. Every conclusion in these docs is drawn
purely from the on-screen visuals in the 333 keyframes. We can see *what screens
were visited and what was configured*, but not *what the presenter said*. See
[06-gaps-and-next-steps.md](06-gaps-and-next-steps.md).

## How the screenshots were captured

The recording is a macOS Safari/QuickTime session (visible menu bar and dock).
The browser is pointed at the Cvent web app. This is a browser-based SaaS — a
useful signal that our app can also be a pure web application.
