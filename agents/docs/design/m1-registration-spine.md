# Design Spec — M1 Registration Data Spine (Registration Types + Ticket Types)

Sources: BACKLOG M1-T1/M1-T2 · `prototype/prototype/event-registration-types.html`, `event-tickets.html`, `assets/style.css` · M0 shell spec (`agents/docs/design/m0-event-shell.md`). No RL spec exists yet for M1; entity semantics below follow the backlog and prototype (FS should reconcile if an RL spec lands).

## 1. Shared foundations (both screens)

- **Mounting:** each screen replaces the `ComingSoonSection` stub in `src/app/dashboard/(event)/events/[eventId]/{registration-types,tickets}/page.tsx`. Remove `comingSoon`/`milestone`/`description` from the two items in `src/features/event/event-nav.ts` so the "Soon" badge disappears. Pages are Server Components that fetch via the admin DAL and render a client workspace component; mutations go through API routes + `router.refresh()` (same pattern as `event-promotion-manager.tsx`).
- **Page header:** the event bar (M0) already shows breadcrumb + event identity. Each screen starts with a local header row: `flex flex-wrap items-start justify-between gap-3` — left: `h1 text-xl font-semibold tracking-tight` + one-line `text-sm text-muted-foreground` subtitle (copy below); right: primary CTA `Button` ("+ Create type" / "+ Create ticket type"). This mirrors the prototype topbar CTA without duplicating the event bar.
- **Note banner** (`InfoNote`, new shared component in `src/features/registration/components/info-note.tsx`): `rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground`, leading `Info` lucide icon `h-4 w-4 text-primary mt-0.5 shrink-0`, content = `<b>` lead-in + body. `role="note"`. Dismissal not required (educational, per prototype it is always visible). Verify `bg-primary/5` contrast in `.dark`; body text stays `text-foreground`, never the primary tint.
- **Table system (new primitive):** add `src/components/ui/table.tsx` (standard shadcn: `Table/TableHeader/TableBody/TableRow/TableHead/TableCell`, header cells `text-xs uppercase tracking-wide text-muted-foreground`, rows `border-b border-border`, cell `px-4 py-3 text-sm`). Wrap in a `Card`-like shell: `rounded-2xl border border-border bg-card overflow-hidden`, with an inner `overflow-x-auto` div.
- **Responsive:** horizontal scroll below `md` (the inner `overflow-x-auto` + `min-w-[<n>rem]` on the table), NOT card collapse — nothing in the codebase collapses to cards yet, tables are short-row entity lists, and scroll preserves column comparison. First column gets `min-w-48` so names stay readable while scrolling.
- **Cell styles:** entity name `font-medium text-foreground`; **Code** cells `font-mono text-xs text-muted-foreground`; numbers left-aligned like the prototype; "Unlimited" rendered as plain text (not a badge).
- **Row actions:** trailing column (no header text, `aria-label="Actions"` on cells' buttons): ghost icon `Button size="icon"` `Pencil` (Edit) and `Trash2` (Delete), `text-muted-foreground hover:text-foreground`; delete hover `hover:text-destructive`. Buttons carry `aria-label="Edit {name}"` / `aria-label="Delete {name}"`.
- **Dialogs:** existing `Dialog` + `Form` (React Hook Form + zodResolver, per `src/components/ui/form.tsx`). Radix provides focus trap, Escape-to-close, focus return. `DialogDescription` always present. Footer: `Cancel` (outline) + submit (primary) with pending state (`disabled` + `Loader2 animate-spin`). Success → `toast.success(...)`, close, `router.refresh()`. API error → `toast.error` with server message; keep dialog open, re-enable submit.
- **Delete confirm:** add `src/components/ui/alert-dialog.tsx` (shadcn, from the installed `radix-ui` umbrella). Destructive action button `variant="destructive"`. Radix AlertDialog focuses Cancel first — correct default for destructive ops.
- **States (both screens):**
  - *Loading:* `page.tsx` exports a `loading.tsx`-style skeleton via Suspense or the workspace renders it while data resolves: header `Skeleton h-7 w-48`, banner `h-16 w-full rounded-2xl`, table shell containing 5 skeleton rows (`h-5` bars sized per column widths). Keep the tools row visible-but-disabled on Tickets so layout doesn't jump.
  - *Error:* centered in table shell — `AlertTriangle` icon chip (`bg-muted` `rounded-2xl`), "Couldn't load {things}", one-line cause-free message, `Button variant="outline"` "Try again" (`router.refresh()`).
  - *Permission denied / event not found:* handled by the M0 shell's `EventNotFound` treatment; these pages never render partial data.
- **Themes:** semantic tokens only (`bg-card`, `border-border`, `text-muted-foreground`, `bg-primary/5`, badge recipes below). No slate/orange literals — do not copy `organization-events-browser.tsx` colors.

## 2. Screen A — Registration Types (`/dashboard/events/[eventId]/registration-types`)

Subtitle: "Who the attendee is. This is the join key that drives pricing, badges, emails and access."

**Banner copy:** lead-in **"Why separate from tickets?"** — "A 'Delegate' (type) can buy several tickets (super early / early / standard). Emails, badges and check-in rules all key off the **type**, so keep it distinct from the ticket."

**Table columns:** Registration type · Code (mono) · Capacity ("Unlimited" or number) · Registered (count, `tabular-nums`) · actions. `min-w-[36rem]`.

**Create/Edit dialog** (`RegistrationTypeDialog`, one component, `mode: "create" | "edit"`):
- Fields: **Name** (Input, required, max 80), **Code** (Input, required, auto-uppercased on blur, `font-mono`, pattern `^[A-Z0-9-]{1,12}$`, `FormDescription`: "Short unique code used in pricing and reports, e.g. GC-ONL"), **Capacity** — radio-less pattern: `Switch` "Limit capacity" + conditional number `Input` (min 1) that autofocuses when enabled; off = Unlimited. Registered count is read-only derived data — never editable; in edit mode show it as plain text under the fields ("12 registered so far").
- Zod: refine code uniqueness server-side; surface duplicate-code errors on the Code field via `form.setError("code", ...)`, not a toast.

**Delete confirm:** AlertDialog title "Delete {name}?" body "This removes the type permanently." Two guarded cases (server decides, dialog copy adapts from the API response or pre-check):
- Referenced by tickets (M1-T2 association) → blocked: body becomes "**{name}** is used by {n} ticket type(s). Reassign or delete those tickets first." Only a Close button (no destructive action offered).
- Has registered > 0 → warning line "{n} people are registered under this type." + destructive Confirm still available (RL may tighten; flag for FS).

**Empty state** (in place of table shell): centered `Card p-10 text-center` — `Tags` icon chip, "No registration types yet", "Define who can attend — Delegate, VIP, Press, Crew — before creating tickets and pricing.", primary `Button` "+ Create your first type" (opens the same dialog). Banner still renders above it (it explains the concept — most valuable when empty).

## 3. Screen B — Ticket Types (`/dashboard/events/[eventId]/tickets`)

Subtitle: "What an attendee registers as. Each ticket has its own code, capacity and open window; price lives in Pricing." — "Pricing" is a `Link` to `.../pricing` (`text-primary underline-offset-4 hover:underline`).

**Banner copy:** lead-in **"New concept vs a single-form model:"** — "an event sells many **typed tickets** (Cvent's 'Admission Item'). Fields shown to the buyer are still driven by your form."

**Tools row** (inside table shell, above the table, `flex flex-wrap items-center gap-2 border-b border-border px-4 py-3`):
1. Search `Input type="search"` with leading `Search` icon (reuse the relative-icon recipe from `organization-events-browser.tsx`), placeholder "Search tickets…", `aria-label="Search tickets"`, `max-w-xs`, debounced/`useDeferredValue` client filter over name+code.
2. `Select` registration-type filter: item "All registration types" (default) + one item per reg type (fetched with the page). `aria-label="Filter by registration type"`. Filters to tickets associated with that type.
3. `<span class="grow">` spacer (`flex-1`).
4. Count `Badge variant="secondary" rounded-full tabular-nums`: total only when unfiltered ("16 tickets"), else "16 tickets · 9 shown". Wrap in `aria-live="polite"` so filter results are announced.

**Table columns:** Ticket · Code (mono) · Registered · Capacity · Sales window · Open · actions. `min-w-[52rem]`. **No Price column in M1** — price lands with M2-T1 Fees; do not render a placeholder column.

**Sales-window cell** (derived text, `text-sm`):
- no dates → "Open" `text-muted-foreground`
- until-date in future, no/past from-date → "until {Mon D}" (e.g. "until Jul 31")
- from-date in future → "from {Mon D}"
- until-date in past → "Closed" `text-muted-foreground`
Dates formatted in the event timezone via the existing `Intl` helpers in `src/features/event/utils.ts`; include year when ≠ current year. Full ISO datetime in `title` tooltip.

**Open badge** (window state AND the manual open flag): Yes → `Badge` `rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200`; No → `Badge variant="secondary" rounded-full`. Text label ("Yes"/"No"), never color-only. If flag is on but the window is closed, badge shows No — the Sales window cell explains why.

**Create/Edit dialog** (`TicketTypeDialog`): fields —
- **Name** (required, max 100), **Code** (same recipe as Screen A, e.g. `GC-SEB`).
- **Registration types** (multi-select): labelled group ("Who can buy this ticket") of `Checkbox` rows (add `src/components/ui/checkbox.tsx`, shadcn/radix) — one per reg type, name + mono code. `fieldset`/`legend` semantics via `FormLabel` + `role="group" aria-labelledby`. Zod: at least one required. If the event has zero reg types, the dialog shows an inline `InfoNote` "Create a registration type first" linking to Screen A, and disables submit.
- **Capacity**: same Switch + number pattern as Screen A.
- **Sales window**: two optional fields "Sales open" / "Sales close" using `Input type="date"` (native picker — no calendar/popover primitives exist and none are needed; keyboard + AT support is built in). `FormDescription`: "Leave both empty to keep the ticket always open. Times use the event timezone (open at 00:00, close at 23:59)." Zod refine: close ≥ open.
- **Open** `Switch` ("Available for registration") default on, `FormDescription`: "Manual override — a closed sales window wins."

**Delete confirm:** AlertDialog; if registered > 0, warning line as in Screen A. (Fees referencing tickets arrive in M2 — no fee guard yet.)

**Empty states:** (a) zero tickets → `Ticket` icon chip, "No ticket types yet", "Create admission items like early bird, standard, and comp tickets. Pricing comes next.", CTA "+ Create your first ticket type"; tools row hidden. (b) zero after filtering → inside the table shell: "No tickets match", `Button variant="ghost"` "Clear filters" (resets search + select).

## 4. Component tree & file placement

```
src/features/registration/
  components/
    info-note.tsx                       // shared banner (§1)
    registration-types-workspace.tsx    // client: header+CTA, banner, table, dialogs, states
    registration-type-dialog.tsx        // RHF+Zod create/edit
    ticket-types-workspace.tsx          // client: header+CTA, banner, tools row, table, dialogs, states
    ticket-type-dialog.tsx              // RHF+Zod incl. window dates + reg-type checkboxes
    entity-table-states.tsx             // shared table skeleton rows / error / empty shells
  schemas.ts                            // Zod: registrationTypeSchema, ticketTypeSchema (client+server shared)
  utils.ts                              // sales-window derivation (getSalesWindowLabel, isTicketOpen) — pure, unit-tested
src/components/ui/table.tsx             // new primitive (shadcn)
src/components/ui/alert-dialog.tsx      // new primitive (radix-ui umbrella)
src/components/ui/checkbox.tsx          // new primitive (radix-ui umbrella)
src/app/dashboard/(event)/events/[eventId]/registration-types/page.tsx  // server fetch → RegistrationTypesWorkspace
src/app/dashboard/(event)/events/[eventId]/tickets/page.tsx             // server fetch (tickets + reg types) → TicketTypesWorkspace
```

## 5. Accessibility summary

- Tab order: header CTA → banner (inert) → tools (search, select, count is announced not focusable) → table rows' action buttons → dialog on open (Radix traps + returns focus).
- Table: real `<table>` semantics from the primitive; `aria-label` on each table ("Registration types" / "Ticket types"); sortable headers are out of scope for M1.
- All icon-only buttons carry `aria-label` with the row's entity name; toasts via Sonner are `aria-live` by default; filter count badge wrapped in `aria-live="polite"`.
- Contrast: emerald badge pair and `bg-primary/5` banner must pass 4.5:1 in both themes (QA checklist item).
