# M8-T2 — Workspace dashboard real metrics — UI/UX design spec

UI/UX Designer, 2026-07-19. Sources: `agents/docs/specs/m8-dashboard-metrics.md` (authoritative behavior — D1-D10 and sections 1-8), `prototype/prototype/index.html` lines 44-81 (authoritative screen reference for the stat-card row, Quick actions card, and Setup notes card), `src/features/dashboard/components/organization-event-overview.tsx` (current live component), and the shipped M7 reports precedent: `finance-summary-card.tsx`, reports `loading.tsx`, and reports `page.tsx`'s `Promise.allSettled` card-degradation pattern.

**Design direction:** keep the prototype's Overview composition exactly where this ticket is scoped: 4 stat cards in one row, then a lower grid with Quick actions spanning the wider column and Setup notes in the narrower column. Replace the current live component's wrong card content ("Total events", `"TBD"` Active forms), workspace-generic quick actions, and stale Setup notes copy. Use the app's newer semantic-token dashboard convention where possible (`text-xl font-semibold tracking-tight`, `text-muted-foreground`, `rounded-2xl border border-border bg-card`) while preserving the prototype's information architecture and order.

## 0. Screen shell — `organization-event-overview.tsx` / route `/dashboard`

`src/app/dashboard/(workspace)/page.tsx` remains the Server Component boundary: `getDashboardScope()` gates org membership, `getAdminEventsForOrganization(scope.organizationId)` supplies the event list, and new org-scoped aggregate loaders supply Registrations and Revenue. The screen itself renders:

- Header: keep the existing dashboard Overview header placement, but update the description away from "forms and responses can keep evolving" copy. Recommended copy: title **"Keep your organization workspace moving with clear next steps."** and description **"Workspace-level event, registration, and paid revenue snapshots for the active organization."**
- Stat-card section directly under the header: `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`, exactly 4 cards in prototype order (§1).
- Lower action section: `grid gap-6 xl:grid-cols-[1.15fr_0.85fr]`, left = Quick actions, right = Setup notes (§2/§3). This matches `index.html`'s `grid c3` where Quick actions spans two columns and Setup notes occupies the third.
- Existing lower "Organization events" and `DashboardEmptyState` region can remain below this ticket's scoped dashboard metrics. Do not let that region introduce alternate metrics or second CTAs that contradict the new Quick actions behavior; see §8 for the empty-state call.

**Resolved D1:** `mock-data.ts` and its unused backing types are not part of this design surface. The visible fix happens in `organization-event-overview.tsx` and the new server loading/error components.

## 1. Stat Cards — Draft Events / Published Events / Registrations / Revenue

Exactly 4 stat cards, in this order from `index.html` lines 44-49:

1. **Draft Events** — value `String(draftCount).padStart(2, "0")`.
2. **Published Events** — value `String(publishedCount).padStart(2, "0")`.
3. **Registrations** — plain integer string, no zero padding.
4. **Revenue (paid)** — formatted money figure, no zero padding.

Remove **Total events** and **Active forms** entirely. No card may render `"TBD"`, `"00"` as a placeholder for unknown data, `NaN`, `undefined`, or a raw error.

**Card component and typography:**
- Use `Card` / `CardHeader` / `CardContent`, `rounded-2xl border border-border bg-card`, not the older `rounded-[1.75rem] border-white/70 bg-white/90` hard-coded light styling.
- Title/eyebrow line: `text-xs font-semibold uppercase tracking-wide text-muted-foreground`. Use text labels only; do not rely on the prototype emoji as icons.
- Value: `text-3xl font-semibold tracking-tight tabular-nums text-foreground`. Apply the same class to all four cards so the padded event counts, plain registration count, and money figure share visual weight. Use `tabular-nums` to keep the numeric baselines steady.
- Hint line: `mt-2 text-sm leading-6 text-muted-foreground`, static only. Per D8, do not render prototype trend/delta labels like "12 this week" or "vs early-bird".

**Metric definitions:**
- Draft/Published counts are computed in memory from the already-loaded `getAdminEventsForOrganization()` result (D2).
- Registrations is accepted attendees only: `Attendee.status === "accepted"`, org-wide, across all owned events regardless of event status (D3).
- Revenue is paid card revenue only: `sum(Order.amounts.totalMinor)` where `paymentStatus === "paid"`, org-wide, grouped by currency (D4/D5). Pending, failed, outstanding, and comped orders do not contribute to the headline.
- Zero-events brand-new org renders: **Draft Events `00`**, **Published Events `00`**, **Registrations `0`**, **Revenue (paid) `$0`**.

**Per-card failure affordance:** Registrations and Revenue can independently fail. In that case, the failed card keeps its title and shell, renders a large dash `—` in the value slot with `text-muted-foreground`, and renders an inline retry row below it: `text-xs text-destructive` **"Couldn't load"** plus a small `Button variant="link"` **"Retry"** wired to `router.refresh()`. Keep the copy short so the stat-card grid does not jump or turn into a table-style error panel. Draft and Published do not have independent error states because they derive from the event-list read; if that read fails, the whole page uses §6.

## 2. Quick Actions

Quick actions stay in the lower left card, matching the prototype's wider card. Header:

- Eyebrow: **"Quick actions"**
- Title: **"Shape the core event workflow"**
- Description: **"Jump into the most recently updated event in this workspace."**

**Non-empty state:** render exactly 5 event-scoped links, where the event is the first element of the sorted `getAdminEventsForOrganization()` result (D6):

1. **Open "{event.name}"** -> `/dashboard/events/{eventId}`
2. **Add ticket types** -> `/dashboard/events/{eventId}/tickets`
3. **Set pricing & discounts** -> `/dashboard/events/{eventId}/pricing`
4. **Configure emails** -> `/dashboard/events/{eventId}/emails`
5. **Set up check-in** -> `/dashboard/events/{eventId}/checkin`

Use a compact action list/bar, not the current 3-column mini-card layout. Recommended composition: `div.flex.flex-wrap.gap-3`, each action as `Button asChild variant="outline"` with an icon where available (`FolderOpen`, `Ticket`, `Tags`, `Mail`, `QrCode`/`ScanLine`) and visible text. The first "Open" action can use the default button variant to make the current event target clear; the other four use outline.

**Zero-events state:** collapse the card to a single primary CTA **"Create your first event"** -> `/dashboard/events/new`. Do not render disabled event-scoped links and do not point actions at workspace-generic `/dashboard/events`, `/dashboard/forms`, or `/dashboard/responses`.

**Permissions:** no role-specific quick-action changes (D9). Viewers see and can open the same links; destination pages keep their existing mutation gating.

## 3. Setup Notes

Setup notes stay a static, non-interactive feature-availability list in the lower right card (D7). No links, no checkboxes, no computed state, no "readiness" progress. This is not M8-T3's per-event checklist.

Header:

- Eyebrow: **"Setup notes"**
- Title: **"What this workspace now handles"**
- Description: **"Available across the active organization."**

List content, with check icons as decorative `aria-hidden` icons and text carrying the meaning:

- **Ticket types** — "Create typed offers for each event."
- **Pricing & discount codes** — "Configure fees, promo codes, comped paths, and paid orders."
- **Registration types & paths** — "Route attendees through the right application or checkout flow."
- **Lifecycle emails** — "Send operational messages from event-specific email tools."
- **On-site check-in / QR** — "Support arrival workflows from the event workspace."
- **Reports** — "Review registrations and finance summaries per event."

The list renders identically for zero-events, single-event, and high-activity organizations. It is product capability copy, not organization progress copy.

## 4. Multi-Currency Revenue Treatment — OQ-1 Resolved

**Decision:** the Revenue card headline always shows one currency only: the primary currency total. Other currencies are shown in an always-visible secondary line, with a tooltip for the full breakdown. This is the best fit for a single stat tile: it avoids silent currency blending, avoids hiding required context behind hover only, and keeps the card height aligned with the other three stat cards.

Primary currency rule (from D5): currency with the most org-wide `RegistrationPath` docs; ties break alphabetically for deterministic rendering.

**Single-currency org:** headline is `formatMoney(paidMinor, currency)`, no secondary currency line.

**Two-or-more-currency org:**
- Headline: `formatMoney(primaryPaidMinor, primaryCurrency)`.
- Secondary line directly under the headline, before the static hint: `text-xs text-muted-foreground`, for example **"+ GBP 8,420 paid in other currencies"** for one other currency, or **"+ 2 other currencies"** for multiple.
- Wrap the secondary line in `Tooltip` or place an adjacent `Info` icon button with `aria-label="Revenue by currency"`; tooltip content lists every non-primary currency and its formatted paid total, one per line, sorted alphabetically by currency code. The primary currency is not repeated in the tooltip unless implementation prefers a full "All currencies" list; if included, label it clearly as primary.
- The static hint for the card should read **"Paid order totals are not converted or blended across currencies."** This line is present for multi-currency only; for single-currency use **"Paid orders across every event in this workspace."**

**Zero `RegistrationPath` docs:** render the literal headline **"$0"**, no tooltip and no secondary line. This is the only case where the money display does not come from `formatMoney`, per D5.

## 5. Loading State — New Route-Level `loading.tsx`

Add `src/app/dashboard/(workspace)/loading.tsx` following the reports route composition pattern: route-level skeleton, not an in-component spinner (D10).

Skeleton composition:

- Header skeleton: `Skeleton h-7 w-64 max-w-full` and `Skeleton h-4 w-96 max-w-full`.
- Stat-card skeleton row: 4 instances of a new `WorkspaceStatCardSkeleton` export. Each skeleton uses the same card chrome as the real stat card, with `Skeleton h-3 w-28`, `Skeleton h-9 w-24`, and `Skeleton h-4 w-full`.
- Lower grid skeleton: same `xl:grid-cols-[1.15fr_0.85fr]` as the real layout. Left shell uses card header skeleton plus 5 pill/button skeletons in a wrapping action row. Right shell uses card header skeleton plus 6 short list-row skeletons.
- If the existing lower event-list region remains in the real screen, the loading route can add a simple lower card skeleton after the metrics section, but the required M8-T2 skeletons are the 4 stat cards plus Quick actions and Setup notes shells.

Use `Skeleton` from `src/components/ui/skeleton`, same as reports `loading.tsx`. No shimmer color overrides; semantic skeleton styling already adapts to light/dark.

## 6. Error States

**Whole-page load failure:** create `WorkspaceLoadError`, matching `ReportsLoadError`'s shape:

- Client component with `useRouter()` and `router.refresh()`.
- Same page shell spacing as the success state.
- Header text: h1 **"Overview"**, description **"Workspace-level event, registration, and paid revenue snapshots for the active organization."**
- Retry panel: `rounded-2xl border border-border bg-card px-6 py-12 text-center`, title **"Couldn't load workspace overview"**, description **"Something went wrong on our side. Try again in a moment."**, `Button variant="outline"` **"Retry"**.
- Used only when `getDashboardScope()` or the initial event-list read throws. `notFound()`/redirect behavior remains outside this component as appropriate to the route.

**Independent per-card degradation:** after the event list succeeds, Registrations and Revenue aggregate results are handled with `Promise.allSettled`, matching reports `page.tsx` lines 76-94. A Registrations failure affects only the Registrations card; a Revenue failure affects only the Revenue card. Draft Events, Published Events, Quick actions, Setup notes, and the existing event-list region keep rendering from the successful event-list read.

**Never states:** do not render raw Firestore errors, unhandled promise rejections, `NaN`, `undefined`, or `"TBD"` anywhere in the metric cards.

## 7. Empty States

**Zero-events workspace is a valid dashboard state, not a page error.** The top metric section still renders all 4 cards with zero values. Quick actions collapse to **"Create your first event"**. Setup notes render unchanged.

**Existing `DashboardEmptyState` decision:** do not redesign `DashboardEmptyState` from scratch. It already provides the right generic empty shell and CTA mechanics for the lower dashboard region. Update only its usage/copy if it conflicts with the new metrics:

- Primary action label should align with the Quick actions zero-state: **"Create your first event"** or **"Create Event"** is acceptable, but avoid introducing a different destination or a second concept.
- Secondary action to `/dashboard/events` can remain if the lower section still wants a browse affordance, but it should not appear inside the new Quick actions card in zero-events state.
- Remove stale descriptions about forms/responses being "modeled later"; the dashboard now has real event, registration, revenue, check-in, email, and report surfaces through M1-M7.

**Events but no registration paths:** Draft/Published counts may be non-zero, Registrations is `0`, Revenue is literal `$0`. Do not show an empty-state block inside the Revenue stat card; it is a stat tile, not the per-event Finance card.

## 8. Responsive Behavior (320 / 768 / 1024 / 1440)

- **320-767px:** page uses `space-y-6`; stat cards stack single-column below `sm`; each value line uses `break-words` or a constrained `min-w-0` parent so long money values do not overflow. Quick actions buttons wrap and become full-width only if needed; the long `Open "{event.name}"` label truncates with a `title` attribute or uses a two-line layout, never horizontal page scroll. Setup notes stack below Quick actions.
- **768-1023px:** stat cards render two columns (`sm:grid-cols-2`); Quick actions and Setup notes remain stacked because the lower grid does not split until `xl`. Action buttons wrap across available width.
- **1024-1439px:** stat cards remain two columns until `xl` to preserve comfortable card width. Lower cards may still stack; do not force the prototype 2+1 layout too early if it makes Quick actions cramped.
- **1440px+:** stat cards render four columns (`xl:grid-cols-4`) and lower grid renders Quick actions wider than Setup notes (`xl:grid-cols-[1.15fr_0.85fr]`). No new page max-width; rely on the dashboard layout's existing content container.
- **Height consistency:** in multi-currency Revenue, the always-visible secondary line must not push the stat row into visibly mismatched heights. Reserve one secondary-line slot in all stat cards via consistent hint spacing, or accept a one-line height increase only when the grid uses equal-height cards.

## 9. Light/Dark Theme

Use semantic tokens throughout:

- Surfaces: `bg-card`, `border-border`, no hard-coded `bg-white`, `text-slate-*`, or `border-white/70` in the rewritten metric/action cards.
- Primary text: `text-foreground`; secondary text: `text-muted-foreground`.
- Error text: `text-destructive`; retry affordance uses `Button variant="link"` or `variant="outline"` with no custom red button fill.
- Skeletons: existing `Skeleton` component only.
- Action buttons: default and outline button variants. Do not introduce the prototype's inline CSS, orange-only palette, or emoji-dependent labels.

This keeps the workspace overview consistent with the reports, emails, attendees, pricing, and IAM screens that already moved to semantic tokens, while preserving the prototype's layout and information order.

## 10. Accessibility & Interaction

- Stat cards are read-only summaries. Use semantic headings (`CardTitle` or `h3`) and text labels; do not make whole cards clickable.
- Numeric values use `tabular-nums`; event counts and registration counts are plain text, not `aria-label`-only values. For Revenue multi-currency, the secondary line must be visible text because tooltip-only disclosure would hide important financial scope.
- Tooltip trigger for multi-currency details must be keyboard-focusable (`Button size="icon" variant="ghost"` or an accessible `TooltipTrigger asChild` wrapper) and have `aria-label="Revenue by currency"`.
- Quick actions are real links (`Button asChild><Link>` or styled `Link`), with visible text. Icons are decorative (`aria-hidden="true"`).
- Setup notes check icons are decorative; the note text carries the meaning. No checkbox role, no `aria-checked`, no interactive affordance.
- Retry controls are real buttons. The page-level retry and per-card retry both call `router.refresh()`; there is no hidden client refetch state to announce separately.
- Focus order follows DOM order: header actions, stat cards, Quick actions, Setup notes, then any existing lower event-list/empty-state section. Do not use positive `tabIndex`.
- Color is never the only state indicator. Error cards include text; multi-currency state includes visible copy; zero values are rendered as values, not just muted styling.

## 11. Data Orchestration Notes (Design-Relevant)

The UI contract expects a shaped summary object rather than direct Firestore calls inside the component:

- `draftCount` and `publishedCount` from the event list (D2).
- `registrations` result as `{ value: number }` or `{ loadError: true }`.
- `revenue` result as either `{ kind: "zero-currency" }`, `{ kind: "single", currency, paidMinor }`, `{ kind: "multi", primaryCurrency, primaryPaidMinor, otherCurrencies: [...] }`, or `{ loadError: true }`.
- `quickActionEvent` = first event from the sorted event list, or `null`.

The page should use `Promise.allSettled` for Registrations and Revenue after the event-list read succeeds, mirroring reports. This is a design constraint because it directly determines the visible independent error states.

## New Components (all else is reuse)

New or changed design surface:

- `src/features/dashboard/components/workspace-stat-card.tsx` or local stat-card helpers inside `organization-event-overview.tsx`, including `WorkspaceStatCardSkeleton`.
- `src/features/dashboard/components/workspace-load-error.tsx`, matching `ReportsLoadError`.
- `src/app/dashboard/(workspace)/loading.tsx`, composing header, stat-card, Quick actions, and Setup notes skeletons.
- `src/features/dashboard/server/load-workspace-summary.ts` or equivalent server loader that shapes Registrations/Revenue data for the UI.
- Modified `organization-event-overview.tsx`: replace the stat-card array, replace quick actions, refresh Setup notes copy, add per-card error props and retry plumbing.

No new `src/components/ui/*` primitives and no new dependency. Reuse `Card`, `Button`, `Tooltip`, `Skeleton`, and lucide icons already available in the app.

## Decision Coverage Checklist

- D1 reflected: dead mock data is not a design input; live component is the edit surface.
- D2 reflected: event counts from loaded event list; registrations/revenue from org-scoped aggregates.
- D3 reflected: Registrations means accepted attendees.
- D4 reflected: Revenue means paid order totals only.
- D5 reflected and OQ-1 resolved: primary-currency headline plus visible secondary line/tooltip, no blended currencies.
- D6 reflected: quick actions target the most-recently-updated event; zero-events CTA collapses.
- D7 reflected: Setup notes are static, non-interactive copy.
- D8 reflected: no trend/delta sub-labels.
- D9 reflected: org-member read access unchanged for all roles.
- D10 reflected: new route-level loading skeleton.

## Acceptance Coverage Checklist

- Ask 1: §1 defines all 4 stat cards, order, value formatting, and typography.
- Ask 2: §2 defines the 5 non-empty quick links and the zero-events CTA.
- Ask 3: §3 defines static Setup notes copy and non-interactivity.
- Ask 4: §4 resolves multi-currency Revenue treatment.
- Ask 5: §5 defines the new route-level loading skeleton composition.
- Ask 6: §1 and §6 define independent Registrations/Revenue card errors and retry.
- Ask 7: §6 defines `WorkspaceLoadError`.
- Ask 8: §7 confirms `DashboardEmptyState` reuse and limited copy/usage updates.
