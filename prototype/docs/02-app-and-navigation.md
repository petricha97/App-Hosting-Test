# 02 · The App & Its Navigation

## What app is this?

**Cvent** — a leading enterprise event-management platform. Confirmed from the
browser address bar (`events.app.cvent.com`, `app.cvent.com`) and the footer
links (Cvent Solutions: Conference, Internal events, Sales kickoff, Trade show,
Networking events).

Knowing the competitor by name lets us benchmark our feature set against a
category leader.

## Overall layout (worth copying)

Cvent's event-builder uses a **three-zone layout**:

1. **Far-left icon rail** (thin, dark blue) — global/product-level switches:
   search, events (calendar icon), venues, reports, address book, etc.
2. **Left navigation panel** (wider, white) — the event's modules, top to bottom:
   - Overview
   - Details → *Event Information, Event Features, Registration Types, Event Settings*
   - Event Website
   - Agenda → *Session Overview, Session List, Session Groups, Session Bundles, Session Locations*
   - Registration → *Registration Overview, Admission Items, Optional Items, Pricing, Registration Process, Event Vouchers, Advanced Rules*
   - Marketing
   - Email
   - Attendees
   - OnArrival *(on-site check-in)*
   - Reports
   - Integrations
   - "View all items" (expander)
3. **Main content area** — the form/table/config panel for the selected module.

A **persistent event header bar** sits across the top of the content area
showing: org logo, event name, date range, venue, a "Search this event" box, and
a **Preview** button. This context-bar-that-never-leaves pattern is good UX for
keeping the user oriented inside one event.

## Cross-cutting UI patterns observed

- **List + "Create" pattern**: most modules show a data table with an empty
  state ("You do not have any …") and a primary **Create** button top-right.
- **Tabs within a module**: e.g. Event Settings has *Visibility / Credits /
  Security / Privacy* tabs.
- **View → Edit toggle**: pages open read-only with an **Edit** button top-right,
  rather than being editable inline by default.
- **Add-on "Features" marketplace**: the Event Features screen presents optional
  capabilities as cards (Planning, Venues, Credits, Website, Speakers,
  Exhibitors, Agenda, Surveys…) each with **Add** / **Remove** — modular,
  toggleable feature set rather than everything-on-by-default.
- **Hover fly-out submenus** on the left nav (e.g. hovering "Registration"
  reveals its sub-items in a floating panel).
- **AI/assistant button**: a floating purple sparkle button (bottom-right) —
  Cvent's in-product AI helper.
- **"New navigation experience" banner** — Cvent was mid-redesign at recording
  time (June 2026 per the macOS clock), so some screens may reflect a newer UI.

## Top-level module map (our feature checklist)

| Module | Purpose | Relevance to our app |
|---|---|---|
| Overview | Event dashboard / setup progress | Landing page per event |
| Details | Core event info, feature toggles, reg types, settings | Foundational config |
| Event Website | Public event site builder | Attendee-facing marketing |
| Agenda | Sessions, groups, bundles, locations | Schedule management |
| Registration | Admission/optional items, pricing, flow, vouchers, rules | Ticketing & sign-up engine |
| Marketing | Promotion tools | Growth |
| Email | Attendee communications | Lifecycle messaging |
| Attendees | Registrant management | CRM / roster |
| OnArrival | On-site check-in / badging | Day-of operations |
| Reports | Analytics | Post-event insight |
| Integrations | 3rd-party connectors | Ecosystem |

> Detailed screen-by-screen walkthrough with timestamps is in
> [03-timeline.md](03-timeline.md). Feature deep-dive is in
> [04-modules-and-features.md](04-modules-and-features.md).
