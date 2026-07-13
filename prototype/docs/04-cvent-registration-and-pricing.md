# 04 · Cvent Deep-Dive — Registration & Pricing

This is the **ticketing engine** — the most important module to copy well, since
it's where money and attendee data are captured. Cvent splits it into seven
sub-sections (left nav under *Registration*):

`Registration Overview · Admission Items · Optional Items · Pricing ·
Registration Process · Event Vouchers · Advanced Rules`

## Admission Items = ticket types (frames 0029–0032)

The event had **16 admission items** — each a distinct "thing you can register
as", with:

- **Name** (e.g. "General counsel – super early bird", "Sponsor speaker In-person")
- **Code** (e.g. `GC-SEB`, `GC-EB`, `GC-ST`, `Sponsor Speaker IP`)
- **Registered count** (live tally, e.g. 13)
- **Open for Registration** (Yes/No — early-bird tiers close, standard opens)

Examples seen: GC super early bird / early bird / standard; Non-GC equivalents;
Sponsor speaker; Crew; Supplier; Press full access; Media partner; Delegate
transfer; Complimentary delegate (97 registered); Corporate speaker.

**Takeaway:** model a ticket as *(name, code, price tier, capacity, open-window,
registered-count)* and allow many per event. Early-bird logic = time-boxed
open/close windows.

## Optional Items (frame 0028)

Add-ons attendees can select on top of admission (workshops, merchandise, etc.).
Empty for this event, but the slot exists — `name / code / type / registered /
open-for-registration`.

## Pricing (frames 0033–0041)

Tabbed: **Fees · Discounts · Taxes · Service Fees · EU E-invoice**.

- **Fees** — a price attached to an admission item *per registration type*.
  e.g. "General Counsel – SEB" = **base price $750.00**, refund policy None,
  status Active, visibility Visible. Fees are filtered by admission
  item/session/bundle/quantity item.
- **Discounts** — a large list of **promo/discount codes**, each with:
  `code, level (Event/Account), amount-or-%, effective from/to, times used,
  active`. Real examples: `£600GCUS` (£600 off, used 1/3), `GCUS10` (10%),
  `HARVEYAI/C100` (100% comp, partner), `LITTLER/C100`. Note the **per-partner
  comp-code convention** (`/C` = client, `/S` = staff).
- **Taxes** — e.g. UK VAT 20% (percentage, toggle active).
- **Service Fees** and **EU E-invoice** — regional billing compliance.

**Takeaway:** separate *price* (fee) from *ticket* (admission item) so the same
ticket can be priced differently per audience/currency. Discounts are
first-class objects with usage caps and validity windows — build a proper
promo-code table, not ad-hoc.

## Registration Process & Paths (frames 0020, 0282)

The registration flow is built as **Registration Paths** — named journeys for
different audiences (e.g. "3. General Counsel CC path", "Corporate delegate
Online-Offline path"). Each path is a sequence of **pages**:

`Personal Information → Registration Summary → Payment`

Each page is **Customizable** via the **Site Designer** (drag-drop). "CC" vs
"Invoice" paths route paid vs invoiced attendees differently.

**Takeaway:** don't hard-code one signup form. Support multiple *paths* keyed to
registration type / payment method, each a customizable multi-step flow.

## Site Designer — per-field config (frames 0017, 0276–0280)

Editing a registration page, each field exposes:

- **Field Label** + **Label Placement** (Above field, etc.)
- **Display as**: Optional / Read-Only / **Required**
- **Visibility Settings** (e.g. "Show for an Agenda Item")
- Drag handles, insert `+` drop zones, multi-column layout

The right rail palette groups blocks into **Product Selection** (Admission Item,
Sessions, Quantity Items, Membership, Donation) and **Registration Actions**
(Identity Confirmation, Registration Type, Terms & Conditions, Payment, Guest
Registration, Summary, Voucher Code, Attendee-List Opt-In, Forward Invitations).

## Advanced Rules (frames 0043–0047)

Conditional logic on registration:

- **Optional Session Rule** — min/max sessions an attendee may pick.
- **Quantity Item Rule** — limits on quantity items.
- Each rule has a **warning message**, active toggle, and is **associated to
  specific admission items**.

**Takeaway:** a rules layer (constraints tied to ticket types) prevents invalid
carts — worth having even in a v1.

## Registration Types (frame 0052)

A cross-cutting classification (Delegate, Guest, Press, Crew, Media Partner,
Sponsor…) with sub-codes (General Counsel Offline/Online, VIP, Speaker Guest)
and **per-type capacity + registered counts**. Registration types drive
pricing, badges, emails, and access — they are the **join key** across the whole
system.

> **Biggest structural lesson:** Cvent separates four concepts that beginners
> often merge into one "ticket": **Admission Item** (what you register as),
> **Fee** (its price, per type/currency), **Registration Type** (who you are),
> and **Registration Path** (the flow you go through). Keeping these distinct is
> what makes the platform flexible.
