# Design Spec — M0-T1 Event Workspace Shell

Sources: BACKLOG M0-T1 · `prototype/prototype/event-overview.html` + `assets/style.css` · current `dashboard-shell.tsx` / `nav.ts`. No research spec exists for this ticket yet; taxonomy below follows the prototype nav verbatim.

## 1. Layout decision — replace, don't nest

The prototype swaps the workspace sidebar for an event sidebar on event routes. Nesting `EventShell` inside `DashboardShell` gives double sidebars; conditionally hiding the workspace sidebar couples the two shells. **Recommended: route groups.**

- `src/app/dashboard/layout.tsx` — keep auth/session resolution only (no chrome).
- `src/app/dashboard/(workspace)/layout.tsx` — mounts `DashboardShell`; move all existing non-event-detail routes here (`page.tsx`, `events/page.tsx`, `events/new/`, `forms/`, `responses/`, `promotions/`, `iam/`, `settings/`).
- `src/app/dashboard/(event)/events/[eventId]/layout.tsx` — mounts `EventShell`; move existing `form/`, `responses/`, `page-builder/`, `edit/`, and the overview `page.tsx` under it. URLs are unchanged (route groups don't affect paths), so no links break.

`EventShell` mirrors `DashboardShell`'s structure (sticky sidebar + header + main) but renders the **event bar** as its header and event nav in the sidebar. One shell visible at a time, ever.

## 2. Event bar anatomy (replaces the workspace header on event routes)

Sticky `top-0 z-30`, `border-b border-border bg-background/90 backdrop-blur-xl`, inner `flex items-center gap-4 px-4 py-4 sm:px-6 lg:px-8`.

1. **Logo/placeholder** — `Avatar` `h-11 w-11 rounded-xl`; `AvatarImage` from event image if present, `AvatarFallback` = first 2 initials of event name on the existing brand gradient (same treatment as org avatar in `dashboard-shell.tsx`).
2. **Title block** (`min-w-0 flex-1`) — breadcrumb row `Events / {event name}` ("Events" links to `/dashboard/events`, same `uppercase tracking-[0.18em] text-xs text-muted-foreground` style as the workspace header); `h1` event name `text-xl sm:text-2xl font-semibold tracking-tight truncate`; **meta line** `text-sm text-muted-foreground truncate`: `{formatted date} · {venue} · <span class="font-mono text-xs">{eventId}</span>` — omit any missing segment and its separator.
3. **Status badge** — `Badge`: Published = `rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200` with a `h-1.5 w-1.5 rounded-full bg-current` dot; Draft = `variant="secondary"` with dot.
4. **Actions slot** (right, `flex items-center gap-2`) — render a `ml-auto` container now: `Button variant="outline" rounded-full` **Preview** (links to public event page, `target="_blank"`), and a reserved slot where **Publish changes** (primary) lands in M8-T3 — do not render a disabled Publish button yet.

Below `md`: logo + title on row 1; meta line wraps under it; badge moves next to the title; actions drop into row 2 right-aligned. Title `truncate` at all sizes.

## 3. Event sidebar

Same visual system as `DashboardShell`'s sidebar (`lg:w-80` expanded / `lg:w-24` collapsed, sticky, `border-r border-border bg-card/95 backdrop-blur-xl`, collapse toggle persisted to `localStorage` key `eventa-event-sidebar-collapsed`). Do **not** copy the prototype's dark-navy sidebar — keep the app's design language. Use semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`) instead of the hardcoded slate/white values in `dashboard-shell.tsx` so dark mode works; light rendering should look identical to the current shell.

**Top:** back link — `ArrowLeft` icon + "All events" → `/dashboard/events`, styled as a ghost nav row. Then `Separator`.

**Groups** (label: `text-xs uppercase tracking-[0.2em] text-muted-foreground px-3 pt-4 pb-1`, hidden when collapsed):

| Group | Label | Route (`/dashboard/events/[eventId]/…`) | lucide icon | Status |
|---|---|---|---|---|
| Event | Overview | `` (exact) | `LayoutDashboard` | live |
| Build | Website / Pages | `page-builder` | `LayoutTemplate` | live |
| Build | Registration Form | `form` | `ClipboardList` | live |
| Registration | Ticket Types | `tickets` | `Ticket` | soon (M1) |
| Registration | Pricing | `pricing` | `CircleDollarSign` | soon (M2) |
| Registration | Registration Types | `registration-types` | `Tags` | soon (M1) |
| Registration | Registration Paths | `registration-paths` | `Route` | soon (M3) |
| Engage & Manage | Responses | `responses` | `Inbox` | live (merges into Attendees at M5) |
| Engage & Manage | Emails | `emails` | `Mail` | soon (M6) |
| Engage & Manage | Attendees | `attendees` | `Users` | soon (M5) |
| Engage & Manage | Check-in | `checkin` | `QrCode` | soon (M5) |
| Engage & Manage | Reports | `reports` | `BarChart3` | soon (M7) |

**Item states** (reuse dashboard nav row recipe, single-line — no description text, rows are `px-3 py-2.5 rounded-2xl text-sm font-semibold` with the `h-9 w-9 rounded-xl` icon chip):
- Active: `bg-primary/10 text-foreground shadow-sm`, chip `bg-background text-primary`. Match: `exact` for Overview, prefix otherwise.
- Hover: `hover:bg-muted hover:text-foreground`.
- **Coming soon:** items stay real links (routes render the placeholder page — stable deep links, no disabled-link a11y traps). Row text `text-muted-foreground`, trailing `Badge variant="outline" className="ml-auto rounded-full text-[10px]">Soon</Badge>`; when collapsed, `title` tooltip reads "{Title} — coming soon".

## 4. States

- **Event bar skeleton** — while the layout resolves the event: `Skeleton` row matching the bar (`h-11 w-11 rounded-xl` + stacked `h-4 w-64` / `h-3 w-80` + `h-6 w-24 rounded-full` badge). Requires new `src/components/ui/skeleton.tsx` (standard shadcn: `animate-pulse rounded-md bg-muted`). Sidebar renders immediately (nav needs only `eventId` from params).
- **Event not found / wrong org** — shell chrome still renders (sidebar + bar replaced by a plain header with "All events" back link); main shows a centered `Card` (`max-w-md mx-auto text-center p-8`): `SearchX` icon in muted chip, "Event not found", one line ("It may have been deleted or belongs to another workspace."), `Button` → "Back to events". Same treatment covers permission-denied — do not distinguish (no existence leaking).
- **Sub-page loading** — each section owns its own skeleton; the shell only guarantees the bar/nav.
- **Responsive** — `lg+`: sticky sidebar (collapsible). `<lg`: sidebar hidden; a `Menu` icon button (left of the event-bar logo) opens the existing `Dialog`-as-drawer pattern from `dashboard-shell.tsx` (left-anchored, `w-[88vw] max-w-[19rem]`, close X, focus trapped, closes on navigate). Chose drawer over top tabs: 13 items don't fit a tab strip, and it reuses proven code.
- **Themes** — all colors above are semantic tokens; verify Soon badge and status badges hit ≥4.5:1 in `.dark`.

## 5. Coming-soon placeholder page

`ComingSoon` component rendered by stub `page.tsx` files for each unbuilt route. Centered within main: `Card` `max-w-md mx-auto mt-12 p-8 text-center space-y-3` — the section's own lucide icon in a `h-12 w-12 rounded-2xl bg-muted text-muted-foreground` chip, `h2 text-lg font-semibold` "{Section} is coming soon", one-liner (`text-sm text-muted-foreground`, per-section copy passed as prop, e.g. "Create admission items with capacity and sales windows."), and `Button variant="outline" rounded-full` → "Back to overview" (`/dashboard/events/[eventId]`). Page `title` metadata still set per section.

## 6. Component tree & file placement

```
src/features/event/
  event-nav.ts                    // EventNavGroup[]: label + items {title, segment, icon, exact?, comingSoon?}; href built from eventId
  components/
    event-shell.tsx               // client; sidebar (desktop + drawer Dialog) + <EventBar> + <main>; collapse state
    event-bar.tsx                 // bar anatomy §2; props: event summary | null (skeleton when undefined)
    event-nav-sidebar.tsx         // grouped nav renderer used by both desktop aside and drawer
    coming-soon.tsx               // §5; props: icon, title, description, eventId
    event-not-found.tsx           // §4 card
src/components/ui/skeleton.tsx    // new primitive (shadcn standard)
src/app/dashboard/(event)/events/[eventId]/layout.tsx   // fetch event via getAdminEventForOrganization → EventShell
src/app/dashboard/(event)/events/[eventId]/{tickets,pricing,registration-types,registration-paths,emails,attendees,checkin,reports}/page.tsx  // ComingSoon stubs
```

The layout fetches the event once (server) and passes the serialized summary to `EventShell`; sub-pages keep their own data fetching. `src/features/dashboard/nav.ts` untouched; `getPageMeta`'s event branches in `dashboard-shell.tsx` become dead and should be pruned.

## 7. Accessibility

- Sidebar nav: `<nav aria-label="Event sections">`; group labels are `<p id="…">` + `aria-labelledby` on each group's wrapping `<div role="group">` (or simply visible headings — no `role="menu"`).
- Active link: `aria-current="page"`. Coming-soon links: visible "Soon" badge plus `<span class="sr-only">(coming soon)</span>` inside the link name.
- Focus: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on all nav rows, back link, and bar actions (Button already provides this — nav `Link`s must add it).
- Keyboard/DOM order: back link → nav groups top-to-bottom → event bar (breadcrumb link, Preview) → main content. Drawer: focus trapped by `Dialog`, Escape closes, focus returns to the Menu trigger.
- Event bar is a `<header>`; main content `<main>`. Status badge is text, not color-only (label inside badge). Mono event code has `aria-label="Event code {id}"` if truncated.
