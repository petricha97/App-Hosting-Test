# M5 — Attendees & Check-in — UI/UX design spec

UI/UX Designer, 2026-07-11. Sources: `agents/docs/specs/m5-attendees-checkin.md`, `prototype/prototype/event-attendees.html`, `event-checkin.html`. Reuse-first: everything composes `src/components/ui/*` + patterns proven in `src/features/responses/` (toolbar, table, StatusBadge) and `src/features/pricing/` (Tabs workspace, dialogs).

## 1. Attendees screen — `/dashboard/events/[eventId]/attendees`

**Component tree** (`src/features/attendees/components/`):
- `attendees-workspace.tsx` — page shell copied from `pricing-workspace.tsx`: h1 "Attendees" (`text-xl font-semibold tracking-tight`) + muted sub, Radix `Tabs` with `?tab=` URL sync via `router.replace(..., { scroll: false })`. Triggers: "Attendee list", "Abandoned" (abandoned trigger carries a small amber count chip when > 0).
- `attendee-list-tab.tsx` → `attendees-toolbar.tsx` + `attendees-table.tsx` + `register-attendee-dialog.tsx`.
- Toolbar: clone `ResponsesToolbar` layout (border-b, `flex flex-wrap items-center gap-2 px-4 py-3`): search input w/ leading `Search` icon ("Search name / email…"), status `Select` (All statuses / Accepted / Pending, sentinel "any"), `flex-1` spacer, count `Badge variant="secondary" rounded-full tabular-nums` "N attendees" inside `aria-live="polite"` (N = accepted count, not row count), `Button variant="outline"` Export CSV (Loader2 spin while exporting), `Button` (default/primary) "+ Register attendee".
- Table: `Table` primitives, columns Name (`font-medium text-foreground`) | Email | Company | Ticket | Status | Check-in. Merged rows: Attendee rows get `StatusBadge`-style green "Accepted" pill; pre-accept FormData rows get amber "Pending" pill (reuse the dot+text pattern from `src/features/responses/components/status-badge.tsx` — new `attendee-status-badge.tsx`, do not overload the FormDataStatus one). Check-in cell: Accepted + not-arrived → `Badge variant="secondary"` "Not arrived" (muted); checked-in → emerald pill "Checked in 09:42" (`bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200`, time `tabular-nums`); Pending rows → `<span className="text-muted-foreground">—</span>` in Ticket/Check-in as data dictates. Load-more button below table per M3 convention (limit 50 cursor).

**Register-attendee dialog** (`register-attendee-dialog.tsx`, `Dialog` `sm:max-w-lg`, fields stacked `space-y-4`):
1. Path `Select` — card-payment paths render as disabled `SelectItem` wrapped in `Tooltip`: "Card payments go through the public flow". Helper text under the field explains offline paths only.
2. Ticket `Select` (path-eligible only; disabled until a path is chosen) and Registration type `Select` (hidden when the path resolves it unambiguously — show a read-only summary line instead: "Registration type: Delegate").
3. Personal fields from the event form's required non-commerce questions (min First name / Last name / Email) — `Label` + `Input`, same field composition as the public flow.
- Footer: `Button variant="outline"` Cancel + primary "Register attendee" (Loader2 + disabled while submitting; the whole form disables). Server errors (SOLD_OUT / TYPE_FULL / validation) render as an inline destructive alert row above the footer (`text-sm text-destructive`, `role="alert"`), not a toast — the dialog stays open. Success: dialog closes, `toast.success("Attendee registered")`, row appears (router.refresh or optimistic prepend).

**States:** empty — centered panel (icon `Users`, "No attendees yet", "Share your registration link to start filling the room", primary "+ Register attendee"); filtered-empty — reuse the `ResponsesFilteredEmptyState` copy pattern with Clear filters; loading — 6 `Skeleton` rows matching column widths (`h-4`, name wider) under a real header row; error — inline panel with Retry `Button variant="outline"`.

## 2. Abandoned tab

- `abandoned-tab.tsx` + `abandoned-table.tsx`. Toolbar right-aligned per prototype: spacer, amber `Badge` "N abandoned", `Button variant="outline" size="sm"` "Email all" **disabled**, wrapped in `Tooltip` ("Email campaigns arrive with the Emails module") — disabled buttons don't fire pointer events, so wrap in a `<span tabIndex={0}>` trigger so the tooltip works via hover and keyboard.
- Columns: Name ("—" when blank) | Email (domain-only, render as `text-muted-foreground`, e.g. `@dentsu.com`) | Last page reached (`Badge`: amber classes for Registration Summary/Payment, `variant="secondary"` for Personal Information/Ticket & Options) | Date (`toLocaleDateString` medium) | row action: icon `Button variant="ghost" size="icon"` `Trash2` with `aria-label="Delete draft from {name or email domain}"` opening `AlertDialog` ("Delete abandoned registration?" / "This permanently removes the draft. The visitor can always start again." / Cancel + destructive Delete). On confirm: DELETE purge route, remove row, decrement badge, `toast.success("Draft deleted")`; failure → `toast.error` + row stays.
- Helper copy under the table: `p.text-sm.text-muted-foreground.mt-3` "Knowing the last page reached tells you whether to nudge on info, ticket choice, or payment."
- States: empty — "No abandoned registrations" + "Registrations idle for more than 24 hours land here."; loading — 4 skeleton rows; error — Retry panel.

## 3. Check-in screen — `/dashboard/events/[eventId]/checkin`

`src/features/checkin/components/checkin-workspace.tsx`; layout `space-y-6`: stat row → `grid gap-4 md:grid-cols-3`; below → `grid gap-6 lg:grid-cols-2` (badge card | settings+team column, stacking at <lg). Header row includes primary `Button` "Open scanner" (links to `/dashboard/events/[eventId]/checkin/scan`, icon `ScanLine`).

- `checkin-stat-cards.tsx` — three `Card`s (`CardHeader` tight): caption `text-sm text-muted-foreground` ("Checked in" / "Expected" / "Badges ready", lucide icons `CheckCircle2`/`Ticket`/`Printer` instead of emoji), value `text-3xl font-semibold tabular-nums`. Checked-in card: sub-caption `text-xs text-muted-foreground` "event not started" only when count is 0 and event start is future.
- `badge-preview-card.tsx` — `Card` "Badge & pass design". Preview: centered column `rounded-lg border p-6 text-center`, portrait aspect (vertical 4×6 feel: `mx-auto w-56 aspect-[2/3] flex flex-col items-center justify-center gap-3`): QR SVG block (`h-28 w-28`, `aria-hidden="true"` — whole preview `role="presentation"`; sample-attendee fallback shows a muted `QrCode` glyph), `{full_name}` `text-lg font-semibold`, `{job_title} · {company}` `text-sm text-muted-foreground`, reg-type pill (violet badge per prototype: `bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200`). Footnote `text-xs text-muted-foreground`: Merge fields `{full_name}`, `{job_title}`, `{company}` in `font-mono` + "Stock: 6"×4" double-sided."
- `checkin-settings-card.tsx` — `Card` "Check-in settings", 5 rows (`flex items-center justify-between gap-4 py-3` + `Separator` between): left = `Label` (`font-medium`) + one-line description `text-xs text-muted-foreground` (write real descriptions, e.g. Signature collection — "Capture a signature at the desk"); right = `Switch` bound to the config, `id` linked to the Label. Persist on flip (optimistic; PATCH; on failure flip back + `toast.error("Couldn't save setting")`). Defaults Off/Off/On/On/On before any doc exists. Wallet-passes row description notes passes themselves ship later.
- `team-members-card.tsx` — `Card` "Team members (door scanners)" + `Button size="sm"` "Add team member". Empty state per prototype: dashed panel "No team members yet — add staff devices to scan at the door." Rows: name `font-medium`, device label + last-seen (`text-xs text-muted-foreground`, "Never used" when null), revoke `Button variant="ghost" size="sm"` "Revoke" → `AlertDialog` ("Revoke access? This device can no longer scan."). Revoked rows disappear (or render struck with "Revoked" secondary badge if BE returns them — prefer removal).
- `add-team-member-dialog.tsx` — two-phase `Dialog`: phase 1 = Name + Device label inputs, Cancel/Add. Phase 2 (success, same dialog swaps content) = access code display: `font-mono text-2xl tracking-widest` in a bordered panel, copy `Button variant="outline"` (Copy icon → Check + "Copied" 2s, `navigator.clipboard`), amber warning row (`TriangleAlert` icon): "Save this code now — it won't be shown again." Only a "Done" close button; Esc/overlay close allowed but the warning makes the one-time nature explicit. Focus moves to the code panel container (`tabIndex={-1}`) on phase swap.

**States:** loading — 3 stat skeleton cards + 2 card skeletons; error — page-level retry panel; permission — existing 403/404 dashboard handling (no new UI).

## 4. Scanner — `/scan/[eventId]` (public) + `/dashboard/events/[eventId]/checkin/scan`

Mobile-first (design at 375px). Public route renders standalone (no dashboard chrome): full-height `bg-background` column, small header (event name `text-sm font-medium` + "Check-in scanner" muted). Dashboard route reuses the same `scanner-surface.tsx` inside the dashboard shell.

- `access-code-gate.tsx` (public only): centered `Card` `max-w-sm`: title "Scanner access", `Input` `inputMode="text" autoCapitalize="characters"` `font-mono text-center text-lg tracking-widest` placeholder "XXXX-XXXX-XXXX-XXXX", full-width primary "Start scanning" (h-12). Wrong code → generic inline error "That code didn't work. Check with the event organizer." (`role="alert"`); 429 → "Too many attempts — wait a minute." Session token in sessionStorage; expiry/401 mid-session returns here with "Session expired — enter your code again."
- `scanner-surface.tsx`: camera viewport `Card` — `aspect-square w-full max-w-md mx-auto rounded-xl overflow-hidden bg-black` hosting the `qr-scanner` video, with a corner-bracket overlay (decorative, `aria-hidden`). Below: manual fallback — collapsible "Enter code manually" (`Button variant="ghost"` toggle, always visible) revealing `Input` (font-mono) + "Look up" button; **camera-permission-denied state** replaces the viewport with a slate panel (`CameraOff` icon, "Camera unavailable — allow camera access or enter the code manually") and auto-expands manual entry. All touch targets ≥ 44px (`h-12` buttons).
- `scan-result-card.tsx` — full-screen takeover (fixed inset overlay on mobile) wrapped in `role="status" aria-live="polite"` so results are announced. Variants (icon circle `h-16 w-16` + headline `text-xl font-semibold` + detail lines):
  - **Success** — emerald wash (`bg-emerald-50 dark:bg-emerald-950/40`), `CheckCircle2`, attendee name, reg-type pill + ticket label, primary h-14 "Check in" (resolve ≠ confirm: success first shows the attendee card with a confirm button; after confirm the card flips to "Checked in" with time).
  - **Already checked in** — amber, `Clock`, "Already checked in" + "at 09:42 by Maria (Door A)".
  - **Invalid / cancelled** — red (`bg-red-50 dark:bg-red-950/40`), `XCircle`, "Invalid pass" / "Registration cancelled".
  - **Wrong event** — slate, `CircleSlash`, "This pass belongs to a different event." No other data.
  - **Not accepted** — blue (`bg-sky-50 dark:bg-sky-950/40`), `Info`, "Registration not yet accepted — direct to the help desk."
  - Every variant: full-width outline "Scan next" (h-12) resetting to the viewport and returning focus to it; network failure → generic retry variant.

## 5. Confirmation QR retrofit — `confirmation-step.tsx`

Replace the dashed placeholder block: render `result.qrSvg` inside `mx-auto h-40 w-40 rounded-2xl border border-slate-200 bg-white p-3` (white backing keeps scan contrast in dark surroundings) via `dangerouslySetInnerHTML` on a div with `role="img"` `aria-label="Your entry QR code"`. Keep "Your entry pass" label + reference; sub-copy becomes "Show this QR at the door — it's also in your confirmation email." Below: wallet placeholder row — two disabled pill buttons ("Add to Apple Wallet" / "Add to Google Wallet", `variant="outline" size="sm"`, wallet icons), each in a `<span tabIndex={0}>` Tooltip trigger: "Wallet passes are coming soon." If `qrSvg` is absent (legacy responses), keep the current dashed placeholder as fallback.

## Accessibility & interaction summary

- Tabs: Radix `Tabs` gives roving tabindex + `aria-selected`; panels labelled by triggers (built-in).
- Tables: real `<th>` headers; check-in pills carry text, never color-only (dot+label pattern); timestamps `tabular-nums`.
- Dialogs/AlertDialogs: Radix focus trap + return focus; destructive confirms use `AlertDialog`, never bare `Dialog`.
- Disabled-with-tooltip (Email all, card paths, wallet buttons): keyboard-reachable wrapper `<span tabIndex={0}>` so tooltip content is available without a mouse; also mirror as `aria-describedby` text.
- Scanner: result region `role="status"`; primary actions h-12/h-14 for gloved thumbs; high contrast on result variants meets 4.5:1 in both themes (use the -900/-200 dark pairs above); access-code input `autoComplete="one-time-code"`.
- Badge preview and QR blocks in admin UI are decorative → `aria-hidden`; the attendee-facing confirmation QR is content → `role="img"` + label.

## New components (all else is reuse)

`src/features/attendees/components/`: attendees-workspace, attendees-toolbar, attendees-table, attendee-status-badge, register-attendee-dialog, abandoned-tab, abandoned-table. `src/features/checkin/components/`: checkin-workspace, checkin-stat-cards, badge-preview-card, checkin-settings-card, team-members-card, add-team-member-dialog, access-code-gate, scanner-surface, scan-result-card. Modified: `src/features/public-registration/components/confirmation-step.tsx`, `src/features/event/event-nav.ts` (drop coming-soon flags for Attendees + Check-in).
