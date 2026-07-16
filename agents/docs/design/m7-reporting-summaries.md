# M7-T1 — Reporting aggregates + event report summaries — UI/UX design spec

UI/UX Designer, 2026-07-17. Sources: `agents/docs/specs/m7-reporting-summaries.md` (authoritative behavior — section numbers below reference it as "spec §N"), `prototype/prototype/event-reports.html` (authoritative visual reference for the two summary cards only — the "Report templates" table at the bottom of that file is M7-T2, out of scope, see spec Non-goals). Reuse-first, same conventions as `agents/docs/design/m6-emails-admin.md` / `m5-attendees-checkin.md`: `src/components/ui/*` primitives (Card, Progress, Skeleton, Badge — all already installed, nothing new needed there) + `src/features/registration/components/entity-table-states.tsx` (`EntityEmptyState`, `EntityTableError`) + `src/features/checkin/components/checkin-*` as the closest existing sibling screen shape (stat-card row + Server Component page with a single `Promise.all`/`try-catch` + page-level retry panel + route-level `loading.tsx`) + `formatMoney`/`formatFeePrice` from `src/features/pricing/utils.ts` (verbatim, no new formatter, per spec §2 AC-6). Route `/dashboard/events/[eventId]/reports` (flip `comingSoon` in `src/features/event/event-nav.ts`; replace the `ComingSoonSection` render in `src/app/dashboard/(event)/events/[eventId]/reports/page.tsx`).

## Confirmed against the prototype

`prototype/prototype/event-reports.html`'s summary-card markup is plain inline-styled flex `<div>`s (a `<div>` track + width-percentage `<div>` fill for the bar chart, `.kv` flex rows for the finance card) — no charting library, no `<canvas>`/SVG chart. This design follows spec §6's recommendation with one refinement: **reuse the already-installed shadcn `Progress` primitive** (`src/components/ui/progress.tsx`, `bg-primary/20` track + `bg-primary` indicator, Radix `role="progressbar"` + `aria-valuenow`/`aria-valuemax` built in for free) instead of hand-rolled div-with-inline-width, since it is (a) already in the component inventory, (b) already styled with the exact semantic tokens the prototype's `--brand-soft`/`--brand` pair maps to in this app (`bg-primary/20` / `bg-primary`), and (c) gives correct ARIA semantics with zero extra markup — strictly less code than reimplementing the prototype's raw divs, and no new dependency (satisfies spec §6 AC-1).

## 0. Screen shell — `reports-workspace.tsx`

`src/features/reports/components/reports-workspace.tsx`, Server Component page (`src/app/dashboard/(event)/events/[eventId]/reports/page.tsx`) rendering a client-optional presentational shell — this screen has **no client-side mutation** (spec §7: zero mutating routes), so `reports-workspace.tsx` can be a plain Server or Client component; kept as a thin Client Component only because the two card-level error panels need an `onRetry` handler (`router.refresh()`), matching the `CheckinLoadError`/`checkin-workspace.tsx` split precedent — no other interactivity exists on this screen (no tabs, no filters, no dialogs).

- **Header row** (`flex flex-wrap items-start justify-between gap-3`, matching every other event sub-screen header): `h1 className="text-xl font-semibold tracking-tight"` **"Reports"** + `p className="text-sm text-muted-foreground"` **"Registration and finance snapshots for this event."** No trailing actions — spec §7/Non-goals: no CSV export, no schedule, no mutating route exists yet for this ticket (the prototype's topbar "Schedule"/"Export table" buttons belong to M7-T2/T3 and are explicitly not rendered here, not even disabled — they don't exist as concepts for this ticket, same "absent, not disabled-with-tooltip" posture the M6 spec used for trigger-type options that T3 hasn't defined yet).
- **Cards grid** (`grid gap-6 lg:grid-cols-2` — the spec's own "c2 two-card grid stacks below ~1024px" convention, spec §8-1, identical breakpoint to M6-T2's confirmation-preview layout): left = `ticket-type-bar-chart-card.tsx` (§1), right = `finance-summary-card.tsx` (§2). Single-column stack below `lg` (~1024px) — chart card renders first in DOM/reading order at every width (registrations is the more universally-relevant number; finance is secondary), so this ordering holds at all breakpoints, not just mobile.

**States:**
- **Loading:** route-level `src/app/dashboard/(event)/events/[eventId]/reports/loading.tsx` — header skeleton (`Skeleton h-7 w-32` + `Skeleton h-4 w-72`) + the two card skeletons (§1/§2 loading shapes below) in the same `grid gap-6 lg:grid-cols-2`. This is the Suspense/streaming boundary per spec §5 ("this page is a Server Component... 'loading' in practice means the Suspense/streaming boundary").
- **Error (whole-page fetch failure):** page-level retry panel, same shape as `CheckinLoadError` — `reports-load-error.tsx` renders the header (unchanged) + a single centered `EntityTableError`-shaped panel with "Couldn't load report data" / "Something went wrong on our side. Try again in a moment." / `Button variant="outline"` "Retry" (`router.refresh()`). This is the **all-or-nothing** page-level error (e.g., `getDashboardScope()` or the initial event lookup itself throws) — distinct from the **per-card** independent error state below, which is the expected/primary error path per spec §5.
- **Per-card independent error (primary path, spec §5):** the server page (§below) wraps the ticket-type aggregation and the finance aggregation in **two separate `try/catch` blocks** even though both run inside one outer `Promise.all` for concurrency — each catch sets its own boolean (`ticketTypeLoadError`, `financeLoadError`) passed as props, so a Firestore hiccup scoped to `sum()` on `Order` never blanks the unrelated ticket-type `count()` calls and vice versa (spec §5's explicit requirement, restated for FS: "keep the two cards' error boundaries independent in the UI even if the underlying fetch is combined"). Each card renders its own `EntityTableError entityLabel="..."` in place of its content when its flag is true, `onRetry` wired to `router.refresh()` (full-page reload is the only refresh mechanism this Server-Component page has — no client refetch route exists for this ticket).
- **Permission-denied:** no bespoke UI — signed-in, no org membership → `notFound()` (404) at the route level per spec §7, identical to every other event sub-page. No 403 UI, no partial page shell (IDOR-safe).

## 1. Registrations by ticket type (bar chart card)

`src/features/reports/components/ticket-type-bar-chart-card.tsx` — `Card`, `CardHeader` → `CardTitle className="text-base font-semibold"` **"Registrations by ticket type"** (no `CardDescription` needed — the row labels are self-explanatory), `CardContent` hosts `ticket-type-bar-chart.tsx` (the presentational component named in spec §6).

### `ticket-type-bar-chart.tsx`

Props: `{ rows: { label: string; count: number }[] }` — exactly the plain shape spec §6 AC-2 requires (no chart-library-specific data leaking in). Rows arrive **pre-sorted** (descending by count, ties by creation order, "No ticket type" bucket appended last only when its count > 0) by the server loader — the component does no sorting, only rendering + width math.

**Per-row layout** (`space-y-4` between rows inside the card, each row `space-y-1.5`):

```
<div className="space-y-1.5">
  <div className="flex items-baseline justify-between gap-3 text-sm">
    <span className="truncate text-foreground">{label}</span>
    <span className={cn(
      "shrink-0 font-semibold tabular-nums",
      count === 0 ? "text-muted-foreground font-normal" : "text-foreground"
    )}>{count}</span>
  </div>
  <Progress
    value={pct}
    aria-label={`${label}: ${count} ${count === 1 ? "registration" : "registrations"}`}
    className="h-2"
  />
</div>
```

- **Width math** (component-internal, per spec §1's "largest bar always 100%-scaled, non-trivial minimum for non-zero, empty track for zero"): `max = Math.max(1, ...rows.map(r => r.count))` (the `1` floor prevents divide-by-zero on the all-zero case); for each row, `pct = row.count === 0 ? 0 : Math.max(4, Math.round((row.count / max) * 100))`. The `Math.max(4, …)` floor is the "visually non-trivial minimum" spec §1 leaves as a UX call — 4% of the track (a `h-2` / 8px-tall bar) renders as a clearly-visible short pill next to a 100%-wide bar, satisfying AC-1's "monotonically increasing, largest visually dominant" without a "1" row disappearing to a hairline.
- **Zero-count row treatment (spec OQ-3 / AC-2 — "always render, never a phantom-looking omission"):** the `Progress` renders at `value={0}` (empty `bg-primary/20` track, no visible indicator — this is the intended "confirmed zero" look, not a bug) and the **count text drops from bold `text-foreground` to `font-normal text-muted-foreground`** — the one deliberate typographic distinction between a real (possibly small) count and an explicit zero, so a zero row reads as "this ticket type truly has 0 registrations" rather than "the number failed to load." The row's **label** stays full-weight `text-foreground` regardless (the ticket type name itself is not de-emphasized, only its now-zero value).
- **All-zero event** (every row's count is 0 — spec §1 "not an error state, not the chart's empty state"): every `Progress` renders empty per the rule above; no special-case banner — the visual result (every track empty, every value muted "0") already communicates the state correctly without extra copy.
- **"No ticket type" row:** rendered identically to any other row (same component, same width math) — no distinguishing icon/style beyond its label text itself ("No ticket type") reading as self-explanatory; positioned last by the server loader's ordering, not by any client-side special-casing.

**Loading skeleton** (`ticket-type-bar-chart-card.tsx`'s own skeleton export, used by the route's `loading.tsx`): 4 skeleton rows (matches the prototype's 4-row sample, a reasonable representative count — the real row count is unknown pre-fetch), each `space-y-1.5`: `Skeleton className="h-4 w-40"` (label+value line, single skeleton block standing in for both since their exact split isn't knowable pre-load) + `Skeleton className="h-2 w-full rounded-full"` (bar-shaped, matching `Progress`'s own `h-2 rounded-full` chrome so the skeleton-to-real transition doesn't jump size).

**Empty state — zero ticket types** (spec §5, AC-2: "explanatory empty state... linking to the Tickets screen, instead of an empty chart shell"): renders in place of the row list, inside the same `CardContent`, using `EntityEmptyState` (icon `Ticket`, title **"No ticket types yet"**, description **"Create a ticket type to start tracking registrations by offer."**). `EntityEmptyState`'s existing `actionLabel`/`onAction` prop pair is callback-shaped, not link-shaped — this screen's CTA needs to **navigate** to `/dashboard/events/[eventId]/tickets`, so this design adds one small, additive, backward-compatible prop to the shared component rather than forking it: `EntityEmptyState` gains an optional `href?: string` that, when present, renders the action as `Button asChild><Link href={href}>{actionLabel}</Link></Button>` instead of a plain `onClick` button (falls back to the existing `onAction` behavior when `href` is absent — every other current caller of `EntityEmptyState` is unaffected). `ticket-type-bar-chart-card.tsx` passes `actionLabel="Go to Tickets"` + `href={`/dashboard/events/${eventId}/tickets`}`.

**Error state:** `EntityTableError entityLabel="ticket-type registrations"` in place of the row list (per §0's per-card error wiring).

## 2. Finance summary card (key-value list)

`src/features/reports/components/finance-summary-card.tsx` — `Card`, `CardHeader` → `CardTitle className="text-base font-semibold"` **"Finance — orders overview"**, `CardContent` hosts the currency section(s) + the shared discount-codes row.

### Row shape (reused for every money row, single-currency or multi-currency)

Matches the established "money key-value row" convention already used for order totals elsewhere in this app (`summary-step.tsx`'s `flex justify-between text-sm tabular-nums` pattern, ported to dashboard tokens instead of the public-registration page's slate palette):

```
<div className="flex items-center justify-between gap-4 py-1.5 text-sm">
  <span className="text-muted-foreground">{rowLabel}</span>
  <span className={valueClassName}>{formattedValue}</span>
</div>
```

| Row | `valueClassName` | Rationale |
|---|---|---|
| Paid (card) | `font-semibold tabular-nums text-foreground` | Primary confirmed-revenue figure — bold, neutral (matches prototype's `t-strong`, no color). |
| Outstanding (invoice) | `font-semibold tabular-nums text-amber-600 dark:text-amber-400` | Bold **and** colored — reuses the exact text-only amber pairing already established at `src/features/pricing/components/discounts-tab.tsx:175` (`tabular-nums text-amber-600 dark:text-amber-400`, a rate/money value, same semantic family: "needs attention" money, not an error). Matches the prototype's own amber-colored Outstanding row. Not a badge — a colored number, since this is a scannable list, not a status pill. |
| Comped value | `tabular-nums text-foreground` | Plain weight (matches prototype's un-bolded Comped row) — informational, secondary to Paid/Outstanding. |
| Discount codes used | `tabular-nums text-foreground` | Plain weight, plain integer (not currency-formatted) — shared across all currency sections, rendered once. |

Money values use `formatMoney(minorUnits, currency)` from `src/features/pricing/utils.ts` **verbatim** (spec §2 AC-6 — no new formatter). "Comped value" is `formatMoney`, never `formatFeePrice` (which special-cases `0 → "Comp"`) — spec §2's "Comped value" row is itself already the number that answers "how much was comped," so a literal `$0.00` for a genuinely-free fee is the correct, honest render (not "Comp" text, which would be a category label, not an amount, in a row already titled "Comped value").

### Single-currency layout (expected common case — spec §4 AC-1: "renders identically in shape to the prototype's mock")

Exactly one distinct currency across the event's `RegistrationPath` docs → render the four rows directly in `CardContent`, no currency label, no divider, `divide-y divide-border` between the four rows (a light structural divider consistent with dense key-value lists elsewhere in this app, e.g. the pricing/fee-summary rows) — this is the prototype's layout, unchanged.

### Multi-currency layout (spec OQ-1 — design decision made here)

**Decision: stacked, always-visible per-currency sections — no tabs, no switcher.** Each distinct currency renders its own three-row group (Paid / Outstanding / Comped, same row shape and colors as above), headed by a small currency-code eyebrow label; the "Discount codes used" row renders **once**, below every currency group (it is currency-agnostic per spec §2 — repeating it per currency would misleadingly imply the count is currency-scoped, which it is not).

```
<div className="space-y-5">
  {currencies.map((c) => (
    <div key={c.currency} className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {c.currency}
      </p>
      <div className="divide-y divide-border">
        {/* Paid / Outstanding / Comped rows for this currency */}
      </div>
    </div>
  ))}
  <div className="border-t border-border pt-1.5">
    {/* Discount codes used row */}
  </div>
</div>
```

**Why stacked-sections over a tab/switcher (rejected alternative), stated explicitly:**
1. **This is a report, not a workspace.** The entire value proposition of "at a glance" summary cards (the ticket's own framing, spec line 1) is defeated by hiding a currency's numbers behind a click — an organizer scanning this card should see every currency's Paid/Outstanding/Comped without interacting with anything. A tab switcher actively works against the "glance" goal for the exact organizers who need it most (multi-market events).
2. **Multi-currency is the rare case, not the common one** (spec §4: "single-currency event (expected common case)"). Building interactive tab-switching chrome for the minority case is speculative complexity (YAGNI) the single generic list-of-sections approach avoids — it degrades to the identical single-currency layout automatically when there's only one section, with zero conditional-rendering branches for "is this multi-currency" beyond "how many sections do I map over."
3. **No new state, no URL/tab-sync question, no keyboard-focus management to design** — this card stays a pure, static read surface consistent with the rest of the page (§0: zero interactivity beyond the two retry buttons). A switcher would be the only piece of client interaction anywhere on this screen, an odd one-off.
4. **Never silently omits the non-primary currency** (spec §4 AC-2's explicit guarantee) — a switcher defaulting to one currency risks an organizer never clicking to the second tab and concluding (wrongly) that the event only sold in one currency; a stacked list makes that structurally impossible.
5. **Vertical growth is cheap and expected here.** A finance card growing from ~4 rows to ~7-10 rows for a two/three-currency event is a normal, acceptable card height on a report screen (the ticket-type card next to it can be taller too, e.g. an event with a dozen ticket types) — this app's dashboard already tolerates variable-height cards side-by-side (see the check-in screen's badge-preview | settings+team column pairing, `checkin-workspace.tsx`).

This satisfies spec §4 AC-2 (two independently-scoped currency groups, no blending) and AC-3 (zero-currency event → the card's dedicated empty state below, not a crash) without inventing a currency-conversion display or any new interaction pattern.

### Empty state — zero currencies (spec §4, "zero `RegistrationPath` docs → finance card empty state, not a crash")

This is the finance card's **only** true empty state (zero orders is *not* an empty state — see below). Triggered when the event has zero `RegistrationPath` docs (nothing to enumerate a currency from). Renders in `CardContent` via `EntityEmptyState` (icon `CircleDollarSign`, title **"No pricing set up yet"**, description **"Add registration paths and fees for this event to start tracking payments here."**, `actionLabel="Go to Registration Paths"` + `href={`/dashboard/events/${eventId}/registration-paths`}` via the same additive `href` prop described in §1).

### Zero orders (any currency configured, but no orders yet — spec §2 AC-5 / §5: "valid, common early-event state, not a different layout")

Renders the normal single- or multi-currency layout exactly as above, with every money row showing `formatMoney(0, currency)` (e.g. "$0.00") and "Discount codes used" showing `0` — **not** a distinct empty-state block. This is the important distinction from the zero-currency case: zero orders still has a currency to scope $0.00 against (a real, meaningful "nothing has sold yet" answer), while zero currencies has no scope to render numbers in at all.

**Loading skeleton:** `finance-summary-card.tsx`'s skeleton export — 4 `Skeleton h-5 w-full` rows (label+value combined per row, matching the row's own height) inside `space-y-2`, no currency-eyebrow skeleton (the real currency count is unknown pre-fetch; a single generic group renders skeleton-only, collapsing to the single-currency shape visually — acceptable since skeletons are a rough shape preview, not a pixel-exact preview of final row count).

**Error state:** `EntityTableError entityLabel="finance data"` in place of the row list (per §0's per-card error wiring).

## 3. Server page — data orchestration (design-relevant shape only; DAL/query details are spec §3/Backend's)

`src/app/dashboard/(event)/events/[eventId]/reports/page.tsx` mirrors the `EventCheckinPage` shape: `getDashboardScope()` → `getAdminEventForOrganization` → `notFound()` on null → two independently-caught data groups run inside one outer `Promise.all` (per spec §3 AC-2, parallel, and §5, independent failure):

```
let ticketTypeRows: { label: string; count: number }[] = [];
let ticketTypeLoadError = false;
let financeData: FinanceCardData | null = null; // null = zero-currency empty state
let financeLoadError = false;

const [ticketTypeResult, financeResult] = await Promise.allSettled([
  loadTicketTypeRegistrations({ eventId, organizationId }),
  loadFinanceSummary({ eventId, organizationId }),
]);

if (ticketTypeResult.status === "fulfilled") ticketTypeRows = ticketTypeResult.value;
else ticketTypeLoadError = true;

if (financeResult.status === "fulfilled") financeData = financeResult.value;
else financeLoadError = true;
```

`Promise.allSettled` (not a single `Promise.all` + one try/catch) is the mechanism that satisfies spec §5's "each card degrades independently" requirement while still issuing both data groups' underlying aggregate queries concurrently (§3 AC-2) — this is the one piece of this design doc that constrains an implementation detail, called out because the spec's own wording ("likely share one `Promise.all`... keep error boundaries independent in the UI") left the exact mechanism open; `allSettled` is the direct, idiomatic way to get concurrent execution **and** independent success/failure without any manual flag-juggling inside a single `try/catch`.

## 4. Responsive behavior (320 / 768 / 1024 / 1440)

- **320–767px:** header row wraps if needed (h1 + sub always fit on one line at this width in practice — no trailing actions to wrap). Cards grid is single-column full width (`grid-cols-1`, the `lg:grid-cols-2` hasn't activated). Each card's internal content never needs its own horizontal scroll — bar rows and key-value rows are both intrinsically narrow (`flex justify-between`, no fixed-width table), unlike the table-heavy M1–M6 screens. Ticket-type labels that are long (`truncate` per §1) show a `title` attribute with the full label so nothing is silently lost on small screens.
- **768–1023px:** unchanged from mobile — the grid breakpoint is `lg` (~1024px, matching spec §8-1's explicit statement that 768 is "still stacked"), so this range is still a single-column stack, just with more horizontal room per card (cards don't get artificially capped in width below `lg`).
- **1024–1439px:** grid becomes 2-column (chart | finance side by side). Card heights are independent (`items-start` implicit via CSS grid default `align-items: stretch` is fine here too — equal-height cards look intentional for a two-card summary row; no explicit `items-start` override needed unless a future multi-currency finance card grows dramatically taller than the chart card, in which case FS should confirm visually during Implement whether `lg:items-start` reads better — a minor, non-blocking implementation call).
- **1440px+:** no further layout change — the dashboard's existing content max-width already caps the grid's width; extra space is idle margin, consistent with every other dashboard screen (no new max-width container introduced, per the standing convention restated in every prior design doc in this repo).
- **Both themes:** every color used (`bg-primary`/`bg-primary/20` for bars, `text-amber-600 dark:text-amber-400` for Outstanding, `text-muted-foreground`/`text-foreground` throughout) is an existing token already verified across light/dark elsewhere in this app — no new palette introduced, satisfying spec §5 AC-1 / §8-1's "both themes" requirement for every state (loading, empty, error, success) on both cards.

## 5. Accessibility & interaction summary

- **Bars are real progress elements, not decorative divs:** `Progress` (Radix) renders `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` automatically; each instance gets an explicit `aria-label` naming the ticket type and its literal count ("GC super early bird: 13 registrations") so a screen-reader user gets the same information a sighted user reads from the adjacent text — the visual count text is not the *only* place this number exists for assistive tech, it's redundant-but-consistent with the ARIA label (both must be kept in sync in the component, not just visually adjacent).
- **No color-only meaning:** the Outstanding row's amber color is paired with its own row label ("Outstanding (invoice)") and its number — no icon or badge relies on color alone, and the row would be fully legible in grayscale (bold vs non-bold weight already carries the "important row" signal independent of color).
- **Currency eyebrow labels** (multi-currency case) are real text content (`<p>`), not `aria-label`-only decoration — screen readers encounter "USD" / "GBP" as normal reading-order text directly above each group's rows, so the grouping is conveyed the same way to everyone, sighted or not (no separate `role="group"`/`aria-labelledby` wiring needed for a 3-row visual group this simple — the eyebrow text immediately precedes its rows in DOM order).
- **Both cards' error `Try again` buttons** are real `<button>`s (via `EntityTableError`'s existing `Button variant="outline"`), independently focusable and independently operable — a screen-reader/keyboard user can retry just the finance card without affecting the (working) chart card, matching the visual independence described in §0.
- **Empty-state CTAs** (`href`-mode `EntityEmptyState`) render as real anchor-backed buttons (`Button asChild><Link>`), so they are correctly announced as links (navigate) rather than buttons (perform an in-page action) — matches this app's existing `Button asChild` + `Link` pattern used elsewhere (e.g. `coming-soon.tsx`'s "Back to overview").
- **Focus order:** header → chart card (empty/error/content) → finance card (empty/error/content), top-to-bottom / left-to-right in both single- and two-column layouts — no `tabindex` overrides needed anywhere on this screen, the DOM order already matches the intended reading/focus order at every breakpoint.
- **Contrast:** `text-amber-600 dark:text-amber-400` and `text-muted-foreground`/`text-foreground` are all tokens already relied on elsewhere in this codebase for body-text-weight contrast (not just badge-background contrast) — no new contrast verification needed beyond what M1–M6 already established for these exact classes.

## New components (all else is reuse)

`src/features/reports/components/`: `reports-workspace.tsx`, `reports-load-error.tsx`, `ticket-type-bar-chart-card.tsx`, `ticket-type-bar-chart.tsx`, `finance-summary-card.tsx`. `src/features/reports/server/`: `load-report-summary.ts` (or split `load-ticket-type-registrations.ts` + `load-finance-summary.ts` — FS's naming call, matching the Gap analysis's own "Backend/FS's naming call" posture for the DAL layer). `src/app/dashboard/(event)/events/[eventId]/reports/loading.tsx` (new route-level skeleton, composing the two cards' own skeleton exports). Modified: `src/features/event/event-nav.ts` (drop `comingSoon` on Reports), `src/app/dashboard/(event)/events/[eventId]/reports/page.tsx` (render `ReportsWorkspace` instead of `ComingSoonSection`), **`src/features/registration/components/entity-table-states.tsx`** (small additive change: `EntityEmptyState` gains an optional `href` prop, backward-compatible with every existing caller). No new `src/components/ui/*` primitives — `Card`, `Progress`, `Skeleton`, `Badge`, `Button` all already exist and cover every control this screen needs. No new npm dependency (spec §6 AC-1 — confirmed, `Progress` is already installed via the existing `radix-ui` package).
