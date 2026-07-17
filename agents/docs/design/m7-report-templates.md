# M7-T2 — Report templates library — UI/UX design spec

UI/UX Designer, 2026-07-17. Sources: `agents/docs/specs/m7-report-templates.md` (authoritative behavior — section numbers below reference it as "spec §N"/"D_n_"), `prototype/prototype/event-reports.html` (authoritative visual reference for the "Report templates" table — lines 69–81), `agents/docs/design/m7-reporting-summaries.md` (the M7-T1 screen shell this ticket extends — same page, same reuse-first posture, same format for this doc). Reuse-first: `src/components/ui/*` (Table, Card, Badge, Button, Skeleton — nothing new needed), `src/features/registration/components/entity-table-states.tsx` (`EntityEmptyState`, `EntityTableError`), the **Attendees roster's own established conventions** (`src/features/attendees/components/attendees-table.tsx`, `attendees-toolbar.tsx`, `attendee-list-tab.tsx`) as the closest sibling "wide table + CSV export + cursor load-more" pattern in this codebase, `src/features/responses/download.ts` (`downloadCsvExport`, verbatim).

## 0. OQ-1 resolved — Run interaction shape

**Decision: an inline expanding panel below the templates table — one panel open at a time (accordion-style, single-select) — NOT a dedicated sub-route, NOT a modal.**

The spec (§6, OQ-1) recommends a dedicated sub-route as its own default but explicitly leaves the call to UX. I checked this codebase's actual routing precedent before deciding, not just the spec's suggestion:

- **There is no dedicated sub-route anywhere in this dashboard for "view a data table/detail."** Every event sub-screen in `src/app/dashboard/(event)/events/[eventId]/*` is a single flat page (`attendees`, `checkin`, `emails`, `pricing`, `reports`, `responses`, `registration-paths`, `registration-types`, `tickets` — nine sibling screens, zero nested dynamic sub-routes among them). The **only** nested dynamic routes in the entire dashboard are `forms/templates/[templateId]` and `forms/templates/new` — a full-page **editing** surface (a template builder), not a "view this table" pattern. A Run output view is a read, not an editor; it has no precedent asking for its own route.
- **Every existing multi-view read surface in this app stays on one page**, using tabs (`attendees-workspace.tsx`'s "Attendee list" / "Abandoned" `Tabs`) or an inline panel with its own toolbar and "Load more" (`attendee-list-tab.tsx`, `abandoned-tab.tsx`). Five templates behaving the same way — one page, one panel that swaps content — is the consistent choice, not the outlier.
- **A modal is ruled out for the stated reason the ticket itself raises**: Order & transaction details has 15 columns; a `Dialog` in this app (`src/components/ui/dialog.tsx`) is a centered, width-capped surface designed for forms, not a wide data table — squeezing a 15-column table into a modal would force either a cramped modal or a modal that defeats the purpose of being a modal (near-fullscreen). No existing modal in this codebase hosts a data table at all — there's no precedent to extend, and inventing one here for a single ticket is exactly the kind of one-off this role is meant to avoid.
- **Tabs (`Tabs`/`TabsList`) are ruled out too**, even though `attendees-workspace.tsx` uses them: a tab strip implies "pick one of N views, the others are hidden but always reachable," which reads correctly for 2 tabs (List/Abandoned) but is the wrong metaphor for a **template catalog with per-row category badges and a Run action** — the prototype's own markup (`event-reports.html:70-81`) is a table with per-row `Run` buttons, not a tab bar. Converting that table into tab triggers would also drop the Category badge column with no obvious place to put it back.
- **Why one panel, not five independently-expandable panels:** the ticket names its own concern — "an inline expanding panel keeps the organizer in context but could make the page very tall." A single-open accordion (opening a new template's panel closes whatever was open) bounds the page to at most one panel's height at any time, while still never leaving the templates table — the organizer always sees the full catalog and can pivot to a different template with one click, without ever leaving `/dashboard/events/[eventId]/reports`.

This satisfies spec §6's behavioral requirements (bounded cursor-paginated table per template, independent loading/empty/error state per template, independent "Export CSV" action) without adding a new route, a new modal precedent, or a mismatched tab metaphor.

## 1. Screen shell — extending `reports-workspace.tsx`

`src/features/reports/components/reports-workspace.tsx` (M7-T1, unmodified above the fold) gains one new section **below** the `grid gap-6 lg:grid-cols-2` cards grid, matching the prototype's own vertical order (`event-reports.html`: cards, then `<h3>Report templates</h3>`, then the table):

```
<div className="space-y-6">
  {/* M7-T1 header — unchanged */}
  {/* M7-T1 cards grid — unchanged */}

  <ReportTemplatesSection eventId={eventId} />
</div>
```

`src/features/reports/components/report-templates-section.tsx` (new, Client Component — the only interactive piece this ticket adds to the page) owns:
- Section heading: `h2 className="text-base font-semibold text-foreground"` **"Report templates"** (`h2`, not `h3`, despite the prototype's `<h3>` — this app's heading hierarchy reserves `h3`/`CardTitle` for card-level titles; a section heading sitting directly under the page's `h1` "Reports" is the correct next level, matching how other multi-part dashboard screens step their headings) + `p className="text-sm text-muted-foreground"` **"Run a template for row-level detail, or export it straight to CSV."**
- `report-templates-table.tsx` (the catalog).
- `report-run-panel.tsx` (the single active output panel, rendered only when a template is active — `null` otherwise).

No new client-side data fetching happens for the templates table itself — the 5 rows (name, description, category, slug) are a **static, hardcoded array** (`REPORT_TEMPLATES` in `src/features/reports/templates.ts`, no Firestore round-trip needed to know the catalog exists) — only clicking "Run" or "Export CSV" ever hits the network. This mirrors D6's own framing of the 5 templates as fixed identifiers, not event-configurable data.

## 2. Templates table — `report-templates-table.tsx`

`src/features/reports/components/report-templates-table.tsx` — a `Card` (`overflow-hidden rounded-2xl border border-border bg-card`, same chrome as every other admin table shell in this app) wrapping a `Table`:

| Report | Category | (actions) |
|---|---|---|
| **Registration overview**<br><span className="text-sm text-muted-foreground">Every registrant, accepted or cancelled, with ticket and check-in detail.</span> | `Badge variant="secondary"` **Attendee** | `Run` · `Export CSV` |
| **Order & transaction details**<br>Row-level payments, discounts, and tax lines behind the finance totals above. | **Finance** | `Run` · `Export CSV` |
| **Abandoned registration details**<br>The full abandoned list — masked email, last step reached, last activity. | **Attendee** | `Run` · `Export CSV` |
| **Badges printed (check-in history)**<br>Per-attendee arrival status and check-in time, based on check-in records. | **Onsite** | `Run` · `Export CSV` |
| **Email overview**<br>Every email this event has sent or attempted, across all definitions. | **Email** | `Run` · `Export CSV` |

No category **grouping** (no section headers splitting the table by category) — the prototype's own markup is a flat table with a per-row Category badge column, not grouped sections (`event-reports.html:72-79` — one `<tbody>`, no category-header rows). This design follows the prototype exactly; grouping would be an invented structure the mockup doesn't show and the spec doesn't ask for.

**Column shape:**
- **Report** column: `TableCell className="min-w-56"` → template name `font-medium text-foreground`, description directly below as a second line `text-sm text-muted-foreground` (two-line cell, same "name + secondary line stacked in one cell" pattern already used for `deleteLabel`-style rows elsewhere in this app — no new cell composition invented, just a `<div className="space-y-0.5">` wrapper).
- **Category** column: `Badge variant="secondary" className="rounded-full"` — plain secondary badge, no color-coding per category (the prototype's own `.badge` class is a single flat style for every category; inventing 4 distinct badge colors for 4 categories is a decoration the mockup doesn't ask for and would need its own semantic-color justification this spec has no grounds for).
- **Actions** column: `TableCell className="text-right"`, two buttons `flex justify-end gap-2`:
  - **Run** — `Button variant={isActive ? "secondary" : "outline"} size="sm"`, label toggles **"Run"** ↔ **"Hide"** once that template's panel is the active one (`aria-expanded={isActive}` `aria-controls="report-run-panel"`).
  - **Export CSV** — `Button variant="outline" size="sm"`, `Download`/`Loader2` icon exactly like `AttendeesToolbar`'s existing Export CSV button (§6 below) — **always rendered, never conditionally hidden by role** (§6's permission-visibility call).
- **Active-row highlight:** the row whose panel is currently open gets `className="bg-muted/50"` (via `TableRow`'s existing `data-[state=selected]:bg-muted` styling — pass `data-state="selected"` on the active row rather than inventing a new highlight class) — the visual link between "this row" and "the panel below" that a screen-reader user also gets via `aria-controls`/`aria-expanded`.

**Table wrapper:** this table is short (5 fixed rows, no pagination, no wide columns) — no `min-w`/horizontal-scroll concern at any breakpoint; it behaves like every other narrow-column admin table in this app.

## 3. Run output — `report-run-panel.tsx` (shared shape, cross-template)

`src/features/reports/components/report-run-panel.tsx` — renders directly below `report-templates-table.tsx`'s `Card` (its own separate `Card`, `id="report-run-panel"`, `tabIndex={-1}` so focus can move to it programmatically on open — `ref.current?.focus()` in the effect that fires when `activeTemplate` changes). One instance, parameterized by `templateSlug` — the same component renders all 5 templates' output, differing only by the column-header list and row-cell renderer it's given (a small per-template config object, not five near-duplicate components).

```
<Card ref={panelRef} tabIndex={-1} id="report-run-panel" aria-label={`${template.name} — report output`}>
  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
    <div className="space-y-1">
      <CardTitle className="text-base font-semibold">{template.name}</CardTitle>
      <CardDescription>{template.description}</CardDescription>
      {/* masked-email note — Abandoned registration details only, see §4 */}
      {/* badges-printed framing note — Badges printed (check-in history) only, see §4 */}
    </div>
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        Export CSV
      </Button>
      <Button variant="ghost" size="sm" onClick={close}>Hide</Button>
    </div>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* loading | error | empty | table + Load more — see states below */}
  </CardContent>
</Card>
```

- **Opening:** clicking a row's "Run" button sets `activeTemplate = slug`, triggers the panel's first page fetch (`GET /api/dashboard/events/[eventId]/reports/[slug]?limit=50`), and scrolls the panel into view (`panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })`) then focuses it — same "move focus to the thing that just appeared" courtesy this app already extends to dialogs, applied here to a non-modal panel.
- **Switching templates:** clicking a different row's "Run" replaces `activeTemplate` — the panel's own internal state (rows, cursor, hasMore) resets for the new template; no stale data flashes from the previous template (implemented as a `key={activeTemplate}` on the panel's data-holding subtree, forcing a clean remount rather than a manual reset-every-field effect).
- **Closing:** "Hide" (or clicking the same row's Run button again, which now reads "Hide") sets `activeTemplate = null`, panel unmounts, focus returns to that row's Run button (`return`-focus, matching this app's dialog-close focus convention).

### Table (per template)

Reuses the exact `Table`/`TableHeader`/`TableRow`/`TableHead`/`TableCell` primitives and the exact **"scroll inside the box, never blow out the page"** convention already shipped for `AttendeesTable`/`AbandonedTable`/`ResponsesTable`: an `overflow-x-auto` wrapper + an explicit `min-w-[Xrem]` on the `<table>` so columns keep their natural width and the **container**, not the page, scrolls horizontally.

| Template | Columns | `min-w` |
|---|---|---|
| Registration overview | 10 | `min-w-[70rem]` |
| Order & transaction details | 15 | `min-w-[96rem]` |
| Abandoned registration details | 6 | `min-w-[54rem]` |
| Badges printed (check-in history) | 7 | `min-w-[58rem]` |
| Email overview | 10 | `min-w-[72rem]` |

**The 15-column Order & transaction details table at 320px** is the extreme case named in the brief — handled with the **same mechanism as every other wide table in this app, not a new one**: at 320px the panel's own bordered `Card` stays full-viewport-width, the `<table>` inside it holds its full `min-w-[96rem]`, and the *inner* `overflow-x-auto` div is what scrolls — the outer page layout, header, and templates table above never move or clip. This is a deliberate reuse decision, not an oversight: this codebase has zero precedent anywhere for sticky/frozen first columns, column virtualization, or a "collapse to cards on mobile" table transform (`AttendeesTable` at 6 columns and `ResponsesTable` at up to 7 columns both already accept plain horizontal scroll at 320px with no special mobile layout) — inventing one of those techniques for exactly one template, one ticket, would be a one-off pattern this design explicitly avoids per the reuse-first mandate. **Non-blocking flag for QA/FS:** if a 320px usability pass on the Order & transaction details table specifically proves the plain-scroll convention insufficient in practice (unlike the narrower existing tables), a sticky first column (`Order ID`) is the natural, scoped follow-up — not built preemptively here.

Column-level notes:
- **Order & transaction details:** money columns (Subtotal/Discount/Tax/Total) render `tabular-nums`, right-context but left-aligned like every other table cell in this app (no new right-aligned-money-column convention introduced — the finance card's `justify-between` KV rows are a different component shape, not a table; tables in this app have never right-aligned a money column, so this design doesn't start here). `Promo code`/`Provider payment ID` render `text-muted-foreground` when empty-string, never a bare blank cell with no visual marker — reuse the `<EmDash />`-style helper (`row.value || <EmDash />`) already established in `AttendeesTable`.
- **All templates:** every ISO-datetime column renders via the same short, locale-formatted display already used elsewhere (`formatCheckInTime`/`Intl.DateTimeFormat` precedent in `abandoned-table.tsx`), not the raw ISO string — table cells show human dates, the CSV cell (§7's own rule) keeps the raw ISO string; these are two different serializations of the same field, by design, matching how `checkedInAtIso` already renders as `formatCheckInTime` on-screen while the CSV column spec (§1, m7-report-templates.md) calls for the ISO string in the file.

### Pagination — "Load more" (Run only, page size 50)

Identical shape to `attendee-list-tab.tsx`'s existing `loadMore()`: a centered `Button variant="outline"` **"Load more"** below the table, `Loader2` spinner swapped in while `loadingMore`, hidden entirely once `hasMore` is `false`. No infinite-scroll, no numbered pagination — this app has exactly one paginate-more idiom already, reused verbatim.

### Loading (first page and "load more" both)

- **First load (panel just opened, no rows yet):** `CardContent` renders a lightweight table-row skeleton reusing the same visual primitives `EntityScreenSkeleton` already uses internally (`Skeleton h-5 w-1/3 min-w-32` + a few narrower `Skeleton h-5` cells per simulated row, `flex items-center gap-4`, 5 rows) — not a new skeleton component, the same row-skeleton *shape* composed inline for the panel's narrower context (per §6 AC-2's "reuse `EntityScreenSkeleton`-style row skeletons," read as "reuse the visual convention," since `EntityScreenSkeleton` itself is a whole-page skeleton and isn't decomposable into a panel-sized fragment as-is).
- **"Load more" in flight:** existing rows stay rendered, only the "Load more" button shows its spinner (identical to `attendee-list-tab.tsx`) — never a full-panel skeleton replacing already-loaded data.

### Empty (zero rows for that template — spec §8)

`EntityEmptyState` (reused verbatim) inside `CardContent`, template-specific copy exactly per spec §8:

| Template | Icon | Title | Description | CTA |
|---|---|---|---|---|
| Registration overview | `Users` | "No registrations yet" | "Attendees will appear here once people register." | "Go to Attendees" → `/dashboard/events/[eventId]/attendees` |
| Order & transaction details | `Receipt` | "No orders yet" | "Transactions will appear here once someone completes checkout." | "Go to Pricing" → `/dashboard/events/[eventId]/pricing` |
| Abandoned registration details | `Timer` | "No abandoned registrations" | "Registrations idle for more than 24 hours land here." (verbatim match to the Abandoned tab's own existing copy, spec §8) | none (nothing to configure, matching spec) |
| Badges printed (check-in history) | `QrCode` | "No check-ins yet" | "Arrivals will appear here once attendees are checked in." | "Go to Check-in" → `/dashboard/events/[eventId]/checkin` |
| Email overview | `Mail` | "No emails sent yet" | "Sent and queued emails will appear here." | "Go to Emails" → `/dashboard/events/[eventId]/emails` |

### Error (spec §8)

`EntityTableError entityLabel="<template's own entity phrase>"` (e.g. `"order transactions"`, `"abandoned registrations"`) in place of the table/empty-state, `onRetry` re-fetches only this panel's first page — never `router.refresh()` for a panel-scoped failure (that would also refetch the two M7-T1 cards above, an unrelated blast radius). This is the concrete mechanism behind spec §6 AC-3's "a failure loading one template's Run output must not affect the templates table itself or any other template's state" — since only one panel is ever mounted at a time, "any other template's state" in practice means: closing this panel and opening a different one must start that other template completely fresh, unaffected by the failed one's error flag (guaranteed by the `key={activeTemplate}` remount named above).

## 4. Template-specific notes

### Abandoned registration details — masked-email explanatory note (D4)

Directly under the panel's `CardDescription`, a small note (not an alert, not a warning-colored callout — this is expected behavior, not a problem):

> `<p className="text-xs text-muted-foreground">Email is shown as domain only (e.g. "@example.com") to protect registrant privacy — the same masking applies to the CSV export.</p>`

Placed at the **panel** level (not repeated per-row, not a tooltip on the Email column header) so it's read once, in context, before the organizer scans the table or exports — the same "one explanatory line above the data, not a decoration on every cell" posture the existing `AbandonedTab` already uses for its own helper copy ("Knowing the last page reached tells you whether to nudge on info, ticket choice, or payment," rendered once below that table). This directly prevents the failure mode the ticket names ("an organizer doesn't think the export is broken/incomplete") by explaining the masking *before* the organizer opens the CSV, not after they've already emailed IT asking why the export is "missing data."

No icon, no `Tooltip` component invented for this — plain muted text is the minimum-viable, precedent-matching treatment; an `Info` icon + `Tooltip` would work too but adds an interactive affordance (hover/focus target, ARIA describedby wiring) for a sentence that's already always-visible and short enough to just read.

### Badges printed (check-in history) — honest framing (D5)

**Decision: keep the template's row name in the templates table exactly as the prototype names it — "Badges printed (check-in history)" — do not rename it.** D5 itself argues the prototype's own parenthetical already licenses the check-in-history substitution; renaming the row (e.g. to plain "Check-in history") would silently drop the one piece of the prototype's own copy that tells a returning user "this is the row your prototype called Badges printed." The **description line** underneath the name in the templates table (§2 above) is where the honest framing actually lives: *"Per-attendee arrival status and check-in time, based on check-in records."* — no mention of "badges" in the description at all, so a first-time reader who reads past the row name immediately gets the accurate framing without needing to infer it from the parenthetical alone.

Inside the open panel, one additional line repeats the framing at the point the organizer is actually looking at rows (same placement pattern as the masked-email note above, same muted, non-alarming styling):

> `<p className="text-xs text-muted-foreground">This reflects check-in records, not a literal count of badges printed — no per-badge print tracking exists in this product yet.</p>`

This satisfies D5's own instruction ("the report's own on-screen copy/description... should say 'check-in history,' not claim to literally count badges printed") at both of the two places an organizer would read it (table row, open panel) without touching the row name the prototype itself already established.

## 5. CSV export UX (spec §7, D1, D2)

**Two entry points, same action:** the templates table's own **Export CSV** button (§2, always visible per-row, works whether or not that template's panel is currently open) and the panel header's **Export CSV** button (§3, visible only while that template's panel is open, for convenience once already viewing the data) — both call the identical client function, `exportTemplateCsv(slug)`, which is a thin wrapper around `downloadCsvExport()` (`src/features/responses/download.ts`, reused verbatim — same fetch → blob → temporary-anchor-download sequence, same `toast.error("Export failed — try again.")` on any non-OK response or network failure). No new download mechanism.

**Loading indication for up to 1000 rows (spec D2/D3 — synchronous, no progress bar):** the clicked button (whichever of the two was clicked) shows its own `Loader2` spinner and becomes `disabled` for the duration of the request — the **other** Export CSV button (if both are visible, i.e. the panel for that same template happens to be open) also disables via one shared `exporting` boolean scoped to that template slug, so a double-click from either entry point can't fire two overlapping export requests for the same template. This is the entire loading affordance — **no progress bar, no percentage, no "generating your export…" toast**, per D2/D3's explicit non-goal (the whole export is one bounded synchronous request; a progress bar would imply an async job this ticket deliberately does not build). A slow export (near the 1000-row/15-column ceiling) is communicated only by the spinner staying visible until the browser's download fires — acceptable given the existing Attendees/Responses exports already accept the identical UX for the identical 1000-row cap with zero complaints precedent in this codebase's history.

**Permission-visibility call (the prompt's explicit design question): the Export CSV button renders unconditionally for every org member, on both entry points, with no client-side role check.** This matches the **exact existing posture** this codebase already ships for the one sibling PII export that exists today: `AttendeesToolbar`'s own "Export CSV" button (`src/features/attendees/components/attendees-toolbar.tsx:89-96`) renders unconditionally regardless of the viewer's role, even though its route (`attendees/export/route.ts`) is `write:events`-gated exactly like every route this ticket adds — I verified this is the actual shipped behavior (not an assumption) by reading the toolbar's source: there is no `session`/`role`/`permission` prop threaded into it anywhere. Reasons to keep this consistent rather than differ "since it's PII-bearing":
1. **This codebase has zero precedent for client-side role-gating any UI element, anywhere** (grep across `src/` for role/permission-conditional rendering turns up nothing outside server-side route guards) — introducing the first one here, for this one button, on this one ticket, would be a new UI pattern with no design system backing it (no "insufficient permission" button state, no disabled-with-tooltip convention established anywhere to reuse).
2. **A hidden button is a worse experience than a clear failure.** An org member without `write:events` who never sees the button has no way to learn "I could get this if I had different access" — a visible button that fails with `toast.error("Export failed — try again.")` on click at least surfaces that *something* is blocking them, prompting them to ask an org admin, which is strictly more informative than silent absence (even though the failure copy itself is generic, not permission-specific — see below).
3. **Server-side enforcement is the actual security boundary regardless of what the client renders** (D1's own framing: this is a defense-in-depth non-issue — hiding the button is UX polish, not a security control; the route's `write:events` check is what actually protects the data either way).

**Consequence, stated plainly:** a `403` response from an export route surfaces through the shared `downloadCsvExport()` helper as the same generic `"Export failed — try again."` toast every other failure reason produces (network error, 500, etc.) — **not** a permission-specific message ("You don't have access to export this report"). This is a deliberate reuse decision, not a gap: customizing the message per status code would mean forking `downloadCsvExport()` or adding response-body inspection this shared helper doesn't currently do for its two existing callers (Attendees, Responses) — both of which already accept the same generic-failure-toast behavior for their own `write:events`-gated export routes. If a future ticket wants permission-specific export error copy across the board, that's a shared-helper enhancement benefiting all three export surfaces at once, not a one-off special-case introduced only here.

**Filenames, headers, escaping:** per spec §7, unchanged from Backend's mechanics — nothing for design to add beyond confirming the download filename (`<slug>-<eventId>.csv`) requires no UI surfacing beyond what the browser's own download affordance already shows.

## 6. States & edge cases summary (cross-cutting)

| Surface | Loading | Empty | Error | Permission-denied |
|---|---|---|---|---|
| Templates table (§2) | N/A — static array, no fetch | N/A — always exactly 5 rows | N/A — nothing to fail | N/A — page itself already gates on org membership at the route level (§7 below); table always renders if the page renders |
| Run panel, per template (§3) | Row-skeleton (first load) / button spinner (load more) | `EntityEmptyState`, per-template copy (§3 table) | `EntityTableError`, panel-scoped retry (§3) | Run never 403s for any org member (spec D1 — org-membership gate only); no permission-denied state exists for Run |
| Export CSV, per template (§5) | Button spinner, both entry points disabled together | N/A (an export of zero rows still downloads a header-only CSV — matches the existing Attendees/Responses export behavior for a zero-row event, no special "nothing to export" block) | Generic `toast.error` (network/500) | Generic `toast.error` (403) — same toast, no distinct UI (§5) |

**Page-level (whole-page) loading/error/permission-denied** are unchanged from M7-T1 (`reports/loading.tsx`, `reports-load-error.tsx`, `notFound()`) — this ticket adds nothing to the page-level Suspense boundary or the outer `try/catch`, since the templates table needs no server data to render and each panel's own fetch is entirely client-triggered, independent of the page's initial server render.

## 7. Responsive behavior (320 / 768 / 1024 / 1440)

- **320–767px:** Section heading + description stack normally (no trailing actions to wrap). Templates table: the Report cell's two-line name+description wraps naturally at this width (`min-w-56` was chosen so it doesn't truncate awkwardly at 320px — verify during Implement that the longest description, "Row-level payments, discounts, and tax lines behind the finance totals above," wraps to 2–3 lines cleanly rather than overflowing); Category badge and the two action buttons (`Run` / `Export CSV`) wrap onto their own line below the name if needed (`flex flex-wrap` on the actions cell, `text-right` dropped to `text-left` when wrapped — a `TableCell` can't easily conditionally-align, so this design accepts the actions column left-aligning at narrow widths as the simplest correct behavior, matching how `ResponsesTable`'s own actions column already behaves at narrow widths). The Run panel (when open) is full-viewport-width like every other card on this screen; its internal table scrolls horizontally per §3 — this is the width at which the 15-column Order table's horizontal scroll is most pronounced, and is the intended, accepted behavior (§3's explicit ruling), not a bug to fix responsively.
- **768–1023px:** Same single-column behavior as 320–767 for this new section (matches M7-T1's own cards grid, which also doesn't break to 2-column until `lg`) — more horizontal room reduces how much the Report cell's description wraps, and the wide Run-panel tables need proportionally less horizontal scroll to reveal their remaining columns, but no layout branch changes.
- **1024–1439px:** No structural change to the templates table (it was never meant to go 2-column — it's one table, not a card grid) or the panel (a single wide `Card`, always full-width below the table, at every breakpoint — this section never sits side-by-side with anything). The only thing that changes is how much of the wide Run-panel tables is visible without scrolling, which grows with viewport width, same as every other wide table in this app.
- **1440px+:** No further change — same "idle margin beyond the dashboard's existing content max-width" convention as M7-T1 §4 and every prior screen in this codebase.
- **Both themes:** every token used here (`bg-muted/50` active-row highlight, `text-muted-foreground` for descriptions/notes, `Badge variant="secondary"`, `Loader2`/`Download` icons, `EntityEmptyState`/`EntityTableError`'s own tokens) is already verified across light/dark elsewhere in this app — no new palette, no new component-level dark-mode override needed.

## 8. Accessibility notes

- **Run button semantics:** each row's Run/Hide button is a real `<button>` with `aria-expanded` (reflecting whether *this* template's panel is the active one) and `aria-controls="report-run-panel"` — a screen-reader user gets the same expand/collapse semantics a sighted user infers from the label swap and the row highlight, satisfying the accordion pattern's standard ARIA shape even though this isn't built on Radix Accordion (no such primitive is installed in this app yet, and one plain toggle doesn't justify adding a new dependency for a single-open, single-level accordion — the manual `aria-expanded`/`aria-controls` pairing is the correct minimal implementation).
- **Focus management on open/close:** opening a panel moves focus to the panel's own heading (`tabIndex={-1}` container, focused programmatically after the scroll-into-view) — closing it returns focus to the row's own Run button, the same "return focus to the trigger" convention this app's dialogs already use, applied to a non-modal panel.
- **Panel content is not a dialog:** no focus trap, no `Escape`-to-close, no `aria-modal` — this is inline page content the user can tab past freely (into the "Load more"/"Export CSV" controls, then out into whatever follows on the page), consistent with it not being a modal (§0's decision).
- **Masked-email and badges-printed notes** are plain, always-visible text (`<p>`), not `aria-label`-only or tooltip-gated content — a screen-reader user encounters them in normal reading order immediately after the panel's title/description, exactly like a sighted user does, with zero extra interaction required to discover them (same reasoning M7-T1's design doc already applied to its own currency-eyebrow labels).
- **Wide tables:** the `overflow-x-auto` wrapper is a real scrollable region; give it `tabIndex={0}` (matching the one accessibility improvement worth adding beyond pure copy-paste of the existing `AttendeesTable` pattern, since a 15-column table is meaningfully more likely to need keyboard-driven horizontal scrolling than a 6–7 column one) so keyboard users without a trackpad/mouse-wheel can reach the later columns via arrow keys once focused, with an `aria-label` on the wrapper naming the template ("Order & transaction details — scrollable table").
- **Empty-state CTAs** render as real anchor-backed buttons (`Button asChild><Link>`), same convention as M7-T1's own `href`-mode `EntityEmptyState` usage — correctly announced as navigation, not an in-page action.
- **Contrast:** every color token used is already relied on elsewhere for body-text-weight contrast (`text-muted-foreground`, `bg-muted/50`) — no new contrast verification needed.
- **Focus order:** page header → M7-T1 cards → templates-section heading → templates table (row by row, each row's Run then Export CSV) → (if open) Run panel (title → Export CSV → Hide → table → Load more) — top-to-bottom, matching DOM order at every breakpoint, no `tabindex` overrides needed beyond the panel's own programmatic-focus target.

## New components (all else is reuse)

`src/features/reports/components/`: `report-templates-section.tsx`, `report-templates-table.tsx`, `report-run-panel.tsx`. `src/features/reports/templates.ts` (the static `REPORT_TEMPLATES` catalog array — name, description, category, slug, empty-state copy, per-template column config). `src/features/reports/csv.ts` and `src/features/reports/server/load-<template>.ts` × 5 are Backend/FS's files (spec §7/Gap analysis), not design artifacts, but this doc's column/note placement above constrains their client-facing shape (column order, empty-cell fallback rendering, masked-email/badges-printed copy strings). Modified: `reports-workspace.tsx` (render `ReportTemplatesSection` below the existing cards grid — the only change to the M7-T1 file this ticket touches, and only additive). No new `src/components/ui/*` primitive — `Table`, `Card`, `Badge`, `Button`, `Skeleton` all already exist and cover every control this section needs. No new npm dependency (no Accordion library, no data-table library — everything above is existing primitives plus plain component state).

## Open questions back to Research

- **OQ-1 (resolved above):** inline expanding panel, single-open, below the templates table — not a sub-route, not a modal, not tabs. No further input needed from Research on this point.
- **For Research/Security (re: OQ-2, D1):** this design's "Export CSV always visible, no client-side role gate" call reinforces D1's own posture but makes the 403's generic, non-specific toast copy an explicit, named consequence (§5) — flagging back to Research/Security in case that generic-failure-for-permission-denial UX is judged insufficient for the Order & transaction details template specifically, given D1's own note that it's "the first UI surface ever to render individual `Order` line items" and Security may want a more explicit permission-denied signal for that one template even though this design treats all 5 uniformly. Not blocking — this design's default is uniform treatment across all 5 templates unless Security asks otherwise.
- **For QA:** confirm during Implement whether the 320px horizontal-scroll-only treatment of the 15-column Order & transaction details table is genuinely usable in practice, or whether it warrants a follow-up ticket for a sticky first column (§3's explicit, non-blocking flag) — this design does not build that preemptively.
