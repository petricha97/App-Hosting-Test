# Prototype Screen Inventory

Source: `prototype/prototype/*.html` (17 screens). Compact inventory to seed the backlog — not behavioral specs.
Two nav shells exist: **Workspace shell** (Overview, Events, Forms & Templates, Responses, Promotions, Users & Access) and **Event shell** (Overview / Build: Pages, Form / Registration: Tickets, Pricing, Reg Types, Reg Paths / Engage & Manage: Emails, Attendees, Check-in, Reports).

---

## 1. index.html — Workspace Overview
- **Purpose:** Workspace-level dashboard summarizing all events at a glance.
- **UI regions:** Workspace sidebar w/ workspace switcher + user chip; topbar actions; 4 stat cards; quick-actions card; setup checklist card.
- **Entities:** Workspace (name), aggregate stats: draft events, published events, registrations (148), revenue ($74,250).
- **Interactions:** "Browse forms", "+ Create Event"; deep links into event sub-screens (tickets, pricing, emails, check-in); checklist notes new modules (ticketing, paths, emails, check-in, reports).
- **Cvent concept:** Org-level home / dashboard.

## 2. events.html — Events List
- **Purpose:** List and manage all events in the active organization.
- **UI regions:** Table with tools row (search filter, status select, date select, count badge).
- **Entities:** Event: title, code (`MYNKL2KSYL3`), category, status (Published/Draft), date+time range, timezone, venue, registered count, capacity (number or Unlimited).
- **Interactions:** Search (client filter via `data-filter`), status/date filters, "+ Create Event", per-row "Open" → event-overview; status badges (green/amber dot); tip: start events from a reusable template.
- **Cvent concept:** All Events list.

## 3. forms.html — Forms & Templates
- **Purpose:** Manage reusable registration form templates and the event forms linked to them.
- **UI regions:** Note banner (template-first flow), template cards grid, "Event forms" table.
- **Entities:** Template: name, version (v1), status (Active/Draft), linked-form count, field count; locked core fields (`first_name`, `last_name`, `email`). Event form: name, event, template+version link, status.
- **Interactions:** "+ New template", "Open template", "Apply to all linked" (version propagation), per-form "Edit" → event-form.
- **Cvent concept:** Event/registration templates (template versioning + sync is more form-centric than Cvent's event templates).

## 4. responses.html — Responses (workspace-wide)
- **Purpose:** Cross-event feed of live registration submissions.
- **UI regions:** Table with tools (search, event filter, status filter, count badge); Export CSV in topbar.
- **Entities:** Submission: name, email, event, ticket (nullable "—"), status (Accepted/Pending/New/Reviewed), submitted date.
- **Interactions:** Search/filter, CSV export; status badges imply an approval workflow (New → Pending → Accepted).
- **Cvent concept:** Registrations/invitee list across events (with registration approval).

## 5. promotions.html — Promotion Templates
- **Purpose:** Org-level reusable discount definitions attachable to any event.
- **UI regions:** Templates table + inline "Edit template" detail card.
- **Entities:** Promotion template: name, promo code, type (Percentage/Fixed), value, conditions (e.g. Nationality = Singaporean, partner list), linked-event count, promo-code enabled flag, inherit-from-parent flag.
- **Interactions:** "+ New template", per-row "Apply to events", edit card with Save / Add condition; event instances inherit from parent template.
- **Cvent concept:** Discount/promo codes, elevated to reusable org-level templates.

## 6. users.html — Users & Access
- **Purpose:** Workspace member management and role assignment.
- **UI regions:** Members table; three role-description cards (Owner, Editor, Viewer).
- **Entities:** Member: name, email, role (Owner/Admin/Editor/Viewer), status (Active/Invited).
- **Interactions:** "+ Invite member"; role semantics: Owner = full incl. billing/members; Editor = build events/forms/emails, no member mgmt; Viewer = read-only reports/attendees/responses.
- **Cvent concept:** Account users & roles (permission profiles).

## 7. event-overview.html — Event Overview
- **Purpose:** Per-event command center: stats, identity, readiness checklist.
- **UI regions:** Event sidebar (grouped nav), event bar (logo, title, date/venue/code, status badge), 4 stat cards, quick actions, "Event identity" key-values, "Public readiness" checklist (5/6).
- **Entities:** Event: title, code, date/time, venue, status, category, timezone, visibility (Public/listed), registration state (Open · 8 paths), payment provider (Stripe: card + invoice); stats: registered 148, invited 158, revenue, abandoned 31.
- **Interactions:** Preview / Publish changes; deep links to builder, form, tickets, attendees, check-in; readiness items (published event/page/form, tickets+pricing, confirmation email, check-in warning).
- **Cvent concept:** Event overview/details page with launch checklist.

## 8. event-tickets.html — Ticket Types (Admission Items)
- **Purpose:** Define what an attendee registers as: multiple typed tickets per event.
- **UI regions:** Note banner (vs single-form model), table with search + registration-type filter, count badge (16 tickets, 9 shown).
- **Entities:** Ticket: name, code (GC-SEB), price display ($750/Comp/$0), registered count, capacity (number/Unlimited), sales window (Closed / until Jul 31 / from Aug 1 / Open), open flag (Yes/No).
- **Interactions:** "+ Create ticket type", filter by registration type; time-based tier automation (early-bird closes by date, standard opens next); price itself lives in Pricing screen.
- **Cvent concept:** Admission Items.

## 9. event-pricing.html — Pricing
- **Purpose:** Attach fees, discounts, taxes, service fees to tickets.
- **UI regions:** 4 tabs: Fees / Discounts / Taxes / Service Fees (empty state).
- **Entities:** Fee: name, ticket code, registration type, base price, currency (USD/GBP variants of same ticket), status. Discount: name, code, level (Event/Partner), amount or %, validity date, usage (used/cap), active. Tax: name, code, type, rate, active.
- **Interactions:** "+ Create"; tab switching; per-registration-type & per-currency pricing of the same ticket; code conventions (`/C` client comp, `/S` staff comp); usage caps + validity windows; empty state for service fees.
- **Cvent concept:** Pricing (fees per admission item x registration type), discount codes, taxes, service fees.

## 10. event-registration-types.html — Registration Types
- **Purpose:** Classify who the attendee is — the join key for pricing, badges, emails, access.
- **UI regions:** Note banner (why types are separate from tickets), simple table.
- **Entities:** Registration type: name (Delegate GC Online/Offline, Guest VIP, Press, Crew, Media Partner...), code, capacity (number/Unlimited), registered count.
- **Interactions:** "+ Create type"; one type can buy several tickets (tiers); emails/badges/check-in rules key off the type.
- **Cvent concept:** Registration Types.

## 11. event-registration-paths.html — Registration Paths
- **Purpose:** Define the multi-step registration flows per audience/payment method.
- **UI regions:** Example path card with 5-step flow diagram (Personal Info → Ticket & Options → Summary → Payment → Confirmation + QR); paths table (8 paths).
- **Entities:** Path: numbered name (2. Sponsor — Credit Card / 2.1 Sponsor — Invoice), code, audience (Sponsor/Delegate GC/Speaker/Any), payment method (Card/Invoice/Comp/None), active flag.
- **Interactions:** "+ Create path"; each path page is customizable in Page Builder; parallel card/invoice variants per audience.
- **Cvent concept:** Registration Paths.

## 12. event-page-builder.html — Website / Page Builder
- **Purpose:** Drag-and-drop builder for the event website page.
- **UI regions:** 3-pane builder: component palette (Hero, Highlights, Story, Schedule, FAQ, CTA, Registration Embed, Ticket & Pricing table [new], Countdown timer [new]) | canvas (hero + countdown + dashed drop zone) | settings panel (Hero props, device preview toggles).
- **Entities:** Page: mode (Custom page / Default / Redirect), draft vs published; block props (headline, background color, button target).
- **Interactions:** Drag blocks to canvas, Save draft / Publish page, page-mode select, mobile/tablet/desktop preview; same block engine powers emails and badges.
- **Cvent concept:** Event website designer (Site Designer). Maps to existing Puck builder in-app.

## 13. event-form.html — Registration Form Builder
- **Purpose:** Build the event's registration form, extending a locked shared template.
- **UI regions:** 3-pane builder: field-type palette (short text, email, long answer, single/multiple choice, date/time, Ticket selector [new], Promo code [new]) | canvas with field rows | field-settings panel (key, label placement, required, placeholder).
- **Entities:** Form: name, status (Published), linked template+version; field: label, key (`job_title`), required, origin (locked template field vs event field), ticket-selector field bound to Ticket Types.
- **Interactions:** Preview / Publish form; "Manage template"; drag fields; locked template fields sync from template; ticket + promo-code fields wire form to commerce.
- **Cvent concept:** Registration questions / process designer.

## 14. event-emails.html — Emails
- **Purpose:** Lifecycle-triggered email campaigns per event.
- **UI regions:** Grouped tables: Pre-event, Post-registration, Debt chase & countdown; confirmation-email preview card (QR + wallet buttons); "Open Email Designer" button.
- **Entities:** Email: name, trigger (Manual / Auto on submit / Auto on accept / +24h abandoned / +7-14-21d unpaid / scheduled datetime), audience segment (invitees, abandoned, pending approval, accepted paid vs invoice), active flag; from address; merge tags `{event_title}`, `{first_name}`.
- **Interactions:** "+ Create email", designer, toggle active; audience segmentation keyed to registration/payment status; QR + Apple/Google Wallet in confirmation.
- **Cvent concept:** Event emails (invitation, confirmation, reminders) + marketing automation.

## 15. event-attendees.html — Attendees
- **Purpose:** Manage the event's registrant list and recover abandoned registrations.
- **UI regions:** Tabs: "Attendee list" / "Abandoned"; tables with search + status filter; topbar Export CSV + "+ Register attendee".
- **Entities:** Attendee: name, email, company, ticket, status (Accepted/Pending), check-in state (Not arrived). Abandoned record: name, partial email, last page reached (Personal Information/Registration Summary/Payment), date.
- **Interactions:** Search/filter, CSV export, admin-side manual registration, "Email all" abandoned; last-page-reached drives targeted nudges.
- **Cvent concept:** Invitee/attendee management + abandoned-registration recovery.

## 16. event-checkin.html — On-site Check-in
- **Purpose:** Configure on-site QR check-in, badge design, and scanner staff.
- **UI regions:** 3 stat cards (checked-in 0 "event not started", expected 148, badges ready); badge preview card; check-in settings key-values; team-members empty state.
- **Entities:** Badge: QR + merge fields `{full_name}`, `{job_title}`, `{company}`, reg-type pill, stock spec (6"x4" double-sided). Settings: signature collection, photo capture, photo ID verification, self-print badges, wallet passes. Team member: iOS scanner device.
- **Interactions:** "Add team member"; toggles for settings; same QR from confirmation email → wallet → door; empty state for staff.
- **Cvent concept:** OnArrival (check-in app, badge printing, kiosk).

## 17. event-reports.html — Reports
- **Purpose:** Per-event reporting: charts, finance summary, runnable report templates.
- **UI regions:** Two summary cards (bar-chart registrations by ticket type; finance key-values), report-templates table; topbar Schedule + Export table.
- **Entities:** Chart datum: ticket type → count. Finance: paid (card), outstanding (invoice), comped value, discount codes used. Report template: name, category (Attendee/Finance/Onsite/Email).
- **Interactions:** "Run" per template, Export CSV, Schedule (recurring delivery); templates: Registration overview, Order & transaction details, Abandoned registration details, Badges printed, Email overview.
- **Cvent concept:** Standard reports library + scheduled report delivery.

---

## Cross-cutting observations (backlog seeds)
- **Data model spine:** Registration Type (who) x Ticket/Admission Item (what) x Fee (price per type+currency) x Path (flow) — currently absent as distinct entities in `src/features/`; today's model is single-form-per-event.
- **Statuses seen:** Event: Draft/Published. Form/template: Draft/Active/Published (+version). Submission: New/Pending/Accepted (Reviewed in filter). Discount: active + usage cap + validity. Ticket: open/closed by sales window. Member: Active/Invited. Check-in: Not arrived / Checked in.
- **QR identity thread:** minted at confirmation → email → wallet pass → badge → door scan → "badges printed" report.
- **Shared block engine:** page builder blocks are said to also power emails and badges.
- **Abandoned registrations:** tracked with last-page-reached; feeds auto-reminder email and a report.
- **Empty states shown in mockups:** service fees (pricing), check-in team members. Loading/error states are not depicted anywhere — specs must define them.
