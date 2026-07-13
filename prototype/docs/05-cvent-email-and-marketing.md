# 05 · Cvent Deep-Dive — Marketing & Email

## Marketing module (frames 0051–0065)

Sub-nav: `Weblinks · Embedded Widgets · Event Calendar · Custom Data Tags ·
Code Snippets · Language Management · Social Media Content`.

| Feature | What it does | Frame |
|---|---|---|
| **Weblinks** | Trackable registration URLs — one per registration path (e.g. "Sponsor Invoice Path"), each with **UTM parameters + reference ID** and copy-link | `0051` |
| **Embedded Widgets** | Embeddable registration/calendar widgets for external sites | `0056` |
| **Event Calendar** | Publish event to account-wide calendars (was "No" here) | `0058` |
| **Custom Data Tags** | Reusable **merge tokens** (Event Title, Event Date, T&Cs, discount codes) inserted anywhere | `0059` |
| **Code Snippets** | Analytics/tracking `<script>` injection (GTM, Saleswing), with cookie-consent gating | `0060` |
| **Language Management** | Override any UI string (resx keys) on site + registration — full i18n / copy control | `0061` |

**Takeaway:** trackable per-path links + a merge-tag system + injectable
analytics snippets are the marketing backbone. The **merge-tag / data-tag**
concept recurs everywhere (emails, pages, badges) — build it as a shared token
resolver from day one.

## Email module (frames 0066–0107)

Sub-nav: `Invitation Lists · Event Emails · Session Emails · Planner Alerts ·
Registrant Checklist Alerts · Recipient Settings`.

### Email library structure (frames 0067–0068)
Emails are organized by **lifecycle phase**:
- **Pre-Event** (invitations, abandoned-registration reminder)
- **Post-Registration** (approval pending, confirmation — paid / payment-due /
  comp variants)
- **Debt Chase** (4.1/4.2/4.3 — unpaid follow-ups)
- **Countdown** (7. one week to go, 7.1 one day to go, 7.2 have your QR ready)

Each email has an **Active toggle**, a send trigger, and Details / Advanced
Settings / Preview tabs. From address = `events@economist.com`; subject/from use
merge tags like `{[E-CUSTOM TAG:EVENT TITLE]}`, `{[P-FIRST NAME]}`.

### Drag-and-drop Email Editor (frames 0074–0085)
Same builder paradigm as the Site Designer. Right-rail **widget palette**:
`Text, Headline, Image, Button, Order Details, Apple Wallet, Google Wallet,
QR Code, Barcode, My Agenda, Registration Information, Add to Calendar, Code`.
Plus Theme tab, structure blocks (columns, spacer, divider), and a "Switch to
Custom HTML" escape hatch. Rich-text toolbar supports inline merge tags.

Real content seen: branded header, delegate **check-in QR code**, **Add to
Apple/Google Wallet** buttons, agenda times, venue (Convene, 117 W 46th St),
event-app promo with App Store / Play Store buttons, legal footer.

### "Set Up Your Email" wizard (frames 0089–0101)
1. **Creation method** — blank / from template / from existing email.
2. **Basic info** — name, subject (with tag insert), from name/email, active.
3. **Recipients** — audience (All Invitees / Accepted Registrants…) +
   **advanced filters** over Contact / Custom / Registration fields
   (e.g. `Amount Due > 1`, `Admission Item = X`), AND/OR logic.
4. **Send schedule** — Manually / at a date+time (with time-zone, DST-aware) /
   **when an invitee registers** (trigger-based).

### Planner Alerts & Recipient Settings (frames 0104–0107)
- **Planner Alerts** — internal staff notifications (registration submitted,
  registration confirmed, **transaction failed**) routed to named recipients.
- **Recipient Settings** — per-**registration-path** email routing (13 paths:
  Sponsor/GC/Non-GC × CC/Invoice, Speaker, Complimentary, Crew…).

**Takeaways for our app:**
- Model emails as **lifecycle-triggered templates**, not one-off sends.
- Reuse the **same block-based builder** for pages, emails, and badges.
- **Segmented recipients** via a filter engine over attendee fields is essential
  for real campaigns.
- Bake in **QR codes + wallet passes** early — they connect email → on-site
  check-in.
