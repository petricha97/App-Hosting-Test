# 06 · Cvent Deep-Dive — Attendees, OnArrival, Reports, Integrations

## Attendees module (frames 0108–0119)

Sub-nav: `Attendee List · Audience Segments · Abandoned Registrations ·
Badges and Certificates · Uploaded Files · Internal Information`.

- **Attendee List** — the registrant roster. Columns: Name, Email, Status
  (Accepted…), Company, Admission Item, Title. Filters, advanced search, custom
  views, "Register Attendee" (staff can register on someone's behalf).
- **Abandoned Registrations** — people who started but didn't finish, with the
  **last page completed** (Personal Info / Summary / Payment) → recovery targeting.
- **Audience Segments** — saved filters for reuse in emails/reports.
- **Badges & Certificates** — a **badge Designer** (frames 0111–0117): a gridded
  canvas with merge fields (`{[C-FULLNAME]}`, `{[C-CUSTOM:Job Title]}`,
  `{[C-COMPANY]}`) and a **QR code**, various stock sizes (e.g. 6"×4" double-sided),
  self-printing rules, and a **registration-type → badge mapping** table.
- **Internal Information** — an internal-only question builder (single/multiple
  answer, matrix, text, date, comment) for staff data not shown to attendees.

## OnArrival — on-site check-in (frames 0120–0126)

The **day-of / physical** module (iOS app companion). Sub-items: OnArrival
Settings, Team Members, Barcodes and Passes.

- **Settings** — check-in verification toggles: Secure sync, **Signature
  Collection**, Payment Collection, **Photo Collection**, Photo Identification;
  plus registration/check-in questions and onsite T&Cs.
- **Team Members** — grant staff with iOS devices scoped check-in access.
- **Barcodes & Passes** — **Apple Wallet / Google Wallet / Barcodes & QR** setup
  with branded logo, strip image, and background color (`#E3120B` Economist red).

**Takeaway:** the check-in layer reuses the same **QR/wallet identity** minted at
registration and shown in confirmation emails. Design the attendee's QR/barcode
identity once and reuse it across email → wallet → on-site scan.

## Reports (frames 0129–0151)

Tabbed: **Saved Reports · Report Templates · Scheduled Reports**.

- **Report Templates** — a large, **category-grouped** library: Agenda Item,
  Attendee, Attendee Hub, Email, **Finance** (Order/Transaction/General Ledger),
  Onsite (Badges Printed, Contact Tracing, Device Details), Website Analytics.
- **Interactive summary reports** — filter → chart → table pattern:
  - *Invitee Summary* (by registration status),
  - *Question Summary* (response tallies per question),
  - *Agenda Item Summary* (capacity vs registered; discount-code usage).
- Every report has **Export Table** and can be **scheduled**.

**Takeaway:** ship a few **built-in report templates** (registrations by type,
finance/orders, attendance) plus CSV export, rather than expecting users to build
reports from scratch.

## Integrations (frames 0152–0157)

- **Active: Salesforce** — native two-way sync with detailed settings
  (sync triggers on registration-status change; field/question sync; guest-sync
  filters by registration type; no-show sync after event).
- **Available:** Eloqua (Oracle marketing), LinkedIn, DTCM (Dubai travel), plus
  an **App Marketplace**.

**Takeaway:** CRM sync (esp. Salesforce/HubSpot) is table-stakes for B2B event
tools. Even a v1 benefits from a clean webhook/export path.

## Account-level context (frames 0162–0174)

- **Library › Media Library** — org-wide, folder-based asset manager (Media,
  Videos, Documents, Questions, Custom Fonts, Email Assets) + reusable
  **Template** types (Event, Webinar, Budget, Badge, Task List). Assets are
  **shared across events**, not per-event.
- **Admin** — licenses, account limits, and deep global config (custom fields,
  data tags, ledger codes, tax schedules, session/speaker categories, security).
- **Templates everywhere** — the account's Events list is mostly reusable
  **event templates** (per brand/format), so new events start pre-configured.

**Takeaway:** a **shared asset library** + **event templates** dramatically speed
up repeat events — worth planning the data model for reuse early (org → template
→ event), even if the UI comes later.
