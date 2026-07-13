# Eventa Prototype (static HTML)

A clickable, **no-backend** prototype of our event app — the Eventa/Petri
dashboard we already have, extended with the Cvent concepts from the video
analysis (see `../docs`).

## Run it
Just open **`index.html`** in a browser (double-click). No build, no server.
Everything is plain HTML/CSS + a tiny bit of vanilla JS (`assets/app.js`) for
tabs and table search.

## Pages
**Workspace level** (our existing app):
- `index.html` — Overview dashboard
- `events.html` — Events list
- `forms.html` — Forms & reusable templates
- `responses.html` — Submissions inbox
- `promotions.html` — Promotion templates
- `users.html` — Users & access

**Event level** — open an event to see the modules. *Bold = new, Cvent-inspired:*
- `event-overview.html` — event hub + readiness checklist
- `event-page-builder.html` — page builder (adds Ticket table / Countdown blocks)
- `event-form.html` — registration form builder (adds Ticket selector / Promo field)
- **`event-tickets.html`** — Ticket Types (Admission Items)
- **`event-pricing.html`** — Fees / Discounts / Taxes
- **`event-registration-types.html`** — Registration Types
- **`event-registration-paths.html`** — multi-step Registration Paths
- **`event-emails.html`** — lifecycle email engine + QR/wallet confirmation
- **`event-attendees.html`** — attendee list + abandoned registrations
- **`event-checkin.html`** — on-site check-in, badges, wallet passes
- **`event-reports.html`** — report templates + charts

## What changed vs our current app
Our app today has one registration form per event. This prototype splits that into
the four Cvent concepts — **Ticket Type**, **Fee/Price**, **Registration Type**,
**Registration Path** — and adds **payments, lifecycle emails, check-in/QR, and
reports**. Data is seeded from the real "General Counsel Summit US 2026" event so
it reads like a live product. All data is hard-coded — nothing is saved.
