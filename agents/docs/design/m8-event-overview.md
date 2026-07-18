# M8-T3 — Event overview parity — UI/UX design spec

UI/UX Designer, 2026-07-19. Sources: `agents/docs/specs/m8-event-overview.md` (authoritative behavior — D1-D19), `prototype/prototype/event-overview.html` (authoritative screen composition), `src/features/dashboard/components/organization-event-detail.tsx` (current implementation), the shipped M8-T2 dashboard metric-card and route-loading precedents, and `src/features/dashboard/components/event-status-actions.tsx` (existing status mutation UI).

**Design direction:** preserve the prototype hierarchy: the shared event bar with Preview/status controls, four stat cards in Registered / Invited / Revenue / Abandoned order, then a two-thirds Quick actions + Event identity card beside a one-third Public readiness card. Replace unsupported prototype claims with honest model-derived values. Use the semantic-token treatment shipped in M8-T2 rather than copying the prototype's inline styles or the current component's hard-coded light palette.

## 0. Screen shell and information architecture

The route remains `/dashboard/events/{eventId}` inside the existing event shell. The shell remains authoritative for breadcrumb, event name, status, date/time, venue/code, and Preview. The overview body renders in this order:

1. Four-stat section: `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`.
2. Parity section: `grid gap-6 xl:grid-cols-[2fr_1fr]`; left card contains Quick actions followed by Event identity, right card contains Public readiness.
3. Existing Promotions manager remains below the parity section in its separately imported `#promotions` section so inbound Pricing links continue to work.

Remove the overview-only legacy header actions, variable readiness card, four identity tiles, generic Form builder / Responses / Publish workflow cards, raw event-data diagnostics, and embedded registration-form card. These duplicate the event shell/navigation or are absent from the prototype. This does not delete Promotions functionality (D19).

The event-not-found behavior remains the existing organization-scoped empty state. All other reads begin only after the canonical `organizationId` + `eventId` event ownership check succeeds.

## 1. Stat cards — Registered / Invited / Revenue / Abandoned

Render exactly four cards in this order and with these visible labels:

1. **Registered** — accepted Attendee count. Hint: **"Accepted attendees"**. Do not show the prototype's unsupported weekly delta.
2. **Invited** — sent invitation EmailMessage count (`kind: "invitation"`, `status: "sent"`). Hint: **"Invitation emails sent"**. This is deliberately not pending registration data and does not promise unique recipients.
3. **Revenue** — paid Order `totalMinor`, separated by configured path currency. Hint for configured currencies: **"Paid order totals are not converted or combined."**
4. **Abandoned** — strict-more-than-24-hours incomplete registration-draft count. Its helper is the prototype copy **"Recover via email"**, rendered as a visible text link to `/dashboard/events/{eventId}/attendees`.

**Card treatment:** introduce `EventOverviewStatCard`, following `WorkspaceStatCard` naming and visual conventions: `Card`, `rounded-2xl border-border bg-card py-0`; label `text-xs font-semibold uppercase tracking-wide text-muted-foreground`; value `text-3xl font-semibold tracking-tight tabular-nums text-foreground`; hint `text-sm leading-6 text-muted-foreground`. Emoji are not required and must not carry meaning. Cards are equal-height grid items, not whole-card links.

**Formatting and zero states (D1-D5):**

- Successful counts use locale-grouped integers and ordinary `0`, never `00`.
- Successful single-currency Revenue uses the existing minor-unit-aware `formatMoney`; do not suppress real cents merely to imitate the prototype.
- Configured currency with no paid orders renders that currency's formatted zero.
- No registration-path currency renders **`—`** and hint **"No payment currency configured"**. This is an honest empty state, not an error and not `$0`.
- Abandoned `0` keeps **"Recover via email"** available because the destination also owns the broader abandoned workflow; the link is not disabled.
- Unknown/failed aggregates never become plausible zeroes.

### OQ-1 resolved — stacked multi-currency amounts

**Decision: use stacked, always-visible amount lines in stable alphabetical currency-code order; do not use wrapping chips.** Example:

```text
SGD 1,240.00
USD 380.00
```

Each line uses `formatMoney` and may retain the code when the symbol is ambiguous. There is no total, plus sign, “other currencies” compression, or primary-currency promotion.

This differs intentionally from M8-T2's workspace Revenue card, which selects a primary headline and compresses the remainder into a secondary line/tooltip to summarize many events. A single-event overview has at most the event's configured path currencies and enough meaning to show every amount directly. Stacking is more truthful, scannable at one-card width, keyboard/hover independent, stable at 320px, and avoids chips suggesting filters or selectable categories. Reserve enough value-region height across all four cards for two lines; with more than two currencies the Revenue card grows vertically rather than clipping, while the CSS grid stretches its row peers to match.

## 2. Quick actions and Event identity

The left parity card follows the prototype: Quick actions first, then Event identity separated by heading spacing or a semantic divider.

### Quick actions

Render exactly five `Button asChild` links in this order, wrapping within `flex flex-wrap gap-3`:

1. **Open Page Builder** → `/dashboard/events/{eventId}/page-builder`
2. **Edit Registration Form** → `/dashboard/events/{eventId}/form`
3. **Manage Ticket Types** → `/dashboard/events/{eventId}/tickets`
4. **View Attendees** → `/dashboard/events/{eventId}/attendees`
5. **Set up Check-in** → `/dashboard/events/{eventId}/checkin`

Use outline variants consistently; no action is promoted above the event bar's Publish action. Links remain available regardless of readiness. Viewer access is unchanged; destinations enforce their existing write gates.

### Event identity

Use a semantic description list (`dl`), five horizontal rows with `dt` left and `dd` right. Rows use subtle separators, not individual tiles. Values wrap, remain right-aligned at roomy widths, and switch to label-above-value when necessary on narrow screens.

- **Category:** **"Not set"** in subdued text. The model has no category field; never render "Conference".
- **Timezone:** stored `EventDoc.timezone` as-is. If a friendly label is later added, visibly retain the IANA/raw value or expose it in accessible text.
- **Visibility:** Published → badge/text **"Public"**; Draft → **"Private (draft)"**. Never render "listed in search".
- **Registration:** active/total path-derived value. `A > 0` → **"Open · A active / T paths"**; otherwise **"Closed · 0 active / T paths"**. Apply correct singular `1 path` in the compact form. This is independent of publish status.
- **Payment:** derive active-path methods in stable `card, invoice, comp, none` order. Card/invoice present → **"Simulated · Card + Invoice"** (include only actual methods). Comp/none-only → method labels without a provider. No active methods → **"Not configured"**. Never render Stripe.

If the shared path read fails, Registration and Payment both show **"Unable to load"** with one nearby **"Retry"** control; do not translate the failure to Closed or Not configured. Category, Timezone, and status-derived Visibility continue rendering.

## 3. Public readiness — fixed six-item checklist

The right card header is exactly **"Public readiness"** with visible summary **"N / 6 ready"**. Always render six rows in this order. `N` counts only `done`; `pending` and `unknown` do not count.

| # | Done label | Pending label | Supporting detail | Pending/unknown destination |
|---|---|---|---|---|
| 1 | Event published | Event not published | Published iff event status is Published | `/dashboard/events/{eventId}/edit` (the event-bar status action remains the direct publish control) |
| 2 | Custom page published | Custom page not published | In default/redirect mode, done with **"Not required for {mode} page mode"**; in custom mode requires a published default EventPage | `/dashboard/events/{eventId}/page-builder` |
| 3 | Registration form published | Registration form not published | Requires an existing published Form | `/dashboard/events/{eventId}/form` |
| 4 | Ticket types & pricing set | Ticket types & pricing not set | Requires a TicketType and an active Fee referencing a ticket in the returned set | `/dashboard/events/{eventId}/tickets` |
| 5 | Confirmation email active | Confirmation email not active | Required effective definitions depend on active path payment methods; zero active paths requires both confirmation kinds | `/dashboard/events/{eventId}/emails` |
| 6 | Check-in configured | Check-in not configured | Requires a saved, tenant-matching CheckinConfig document; defaults alone do not pass | `/dashboard/events/{eventId}/checkin` |

The incomplete wording for item 6 intentionally matches the prototype. No seventh redirect-URL check is added. Complete rows are non-links. Pending rows are full-width text links so the label and detail form one generous focus target. Unknown rows show a neutral question-mark icon, label **"{concept} — Unknown"**, detail **"Unable to verify. Retry or open settings."**, and the same destination link; the card also provides a compact **"Retry"** button using route refresh.

**Visual states:** done uses check icon + explicit done wording; pending uses amber alert/circle + explicit pending wording; unknown uses neutral question icon + "Unknown". Color is supplemental. Use `ul`/`li`; do not use checkbox roles because these are derived status summaries, not user-toggleable controls.

Reads settle by readiness concern. A page read failure affects item 2 only; form affects item 3; ticket/fee affects item 4; email definitions affect item 5; check-in affects item 6. A path failure makes item 5 Unknown as well as the two identity fields. The event-status row remains known from the ownership-resolved event.

## 4. Preview and Publish in the event bar

Keep Preview in its existing shared event-bar position and put the reused/refined `EventStatusActions` control in the adjacent reserved slot. At desktop widths the right-side order is **Preview**, then primary status action.

- Preview is always visible, links to `/events/{encoded eventId}`, opens a new tab, and retains safe `rel` attributes.
- Draft + `write:events`: default/primary **"Publish event"**.
- Published + `write:events`: outline secondary **"Move to draft"**; do not call it "Publish changes" because unpublished-change state does not exist.
- Saving: disabled spinner and **"Updating status"**. Existing success/error toast, state retention on failure, API route, and refresh behavior remain unchanged.
- Read-only/viewer: Preview remains; omit the enabled status mutation control. Do not render a misleading disabled button unless the shell already has an established permission-explanation pattern.
- Remove `EventStatusActions`' duplicate **"View public page"** action because Preview owns that function.

At narrow widths, controls wrap beneath event metadata as a full-width action row; Preview precedes status action in DOM and visual order. Each control stays at least 44px high.

## 5. Loading, errors, and empty states

### Route-level loading

Add the event-overview route's `loading.tsx` using M8-T2's composition pattern, not an in-component spinner. Preserve the already-established shell/event-bar skeleton, then render:

- four `EventOverviewStatCardSkeleton` cards with the real `sm:grid-cols-2 xl:grid-cols-4` geometry;
- lower `xl:grid-cols-[2fr_1fr]` shells;
- left shell: heading, five action-button skeletons, identity heading, and five two-column row skeletons;
- right shell: heading + summary skeleton and exactly six checklist-row skeletons;
- Promotions skeleton below only if Promotions remains visible during the same route transition.

Use the shared `Skeleton` component and semantic card chrome. Skeletons describe layout only; no animated status announcement is required. The route transition retains the shell navigation and avoids layout shift.

### Error degradation

- Registered, Invited, each Revenue currency orchestration result, and Abandoned settle independently. A failed card retains its label and shell, renders `—`, **"Couldn't load"**, and a real **"Retry"** button wired to `router.refresh()`.
- A Revenue fan-out failure makes the whole Revenue card unknown; do not show a partial amount as if complete.
- Identity/path failure does not blank stats or readiness rows unrelated to paths.
- Readiness failures become item-level Unknown as specified in §3; the card remains six rows and retains all known results.
- Promotions failure remains within its own separately owned section.
- Only failure of dashboard scope or initial event ownership resolution uses the existing whole-page handling. Never expose raw backend errors, `NaN`, `undefined`, or silently substituted values.

### Valid empty/zero states

- Successful count aggregates render `0`.
- Revenue with configured currencies but no paid orders renders formatted zero per currency; no configured currency renders `— / No payment currency configured`.
- Zero paths honestly renders Registration **"Closed · 0 active / 0 paths"** and Payment **"Not configured"**.
- Missing form/page/tickets/fees/config are pending readiness, not load errors.
- Category always renders **"Not set"** until the model gains a real field.

## 6. Responsive behavior (320 / 768 / 1024 / 1440)

- **320–767px:** four stats stack. Revenue lines wrap safely without horizontal scrolling. Lower cards stack; action buttons become full-width where needed. Identity rows use label above value. Checklist links fill the row and preserve a 44px minimum target. Event-bar actions wrap below metadata.
- **768–1023px:** stats use two columns. Lower cards remain stacked. Quick actions wrap into two or three per row; identity returns to label/value rows when space allows.
- **1024–1439px:** retain two stat columns until `xl` for readable money values. The lower composition may stay stacked until the actual container can sustain approximately 2:1 without squeezing checklist copy; do not key solely to viewport if the sidebar narrows content.
- **1440px+:** four equal stat columns and `xl:grid-cols-[2fr_1fr]` lower layout, matching the prototype's two-column-span left card and one-column readiness card. No new max width; use the event shell's container.

All breakpoints use `min-w-0`, `break-words`, and wrapping controls. No horizontal page scroll at 320px. Equal-height stat rows are preferred; Revenue may increase the row height when the event truly has several currencies.

## 7. Light and dark theme

Use semantic tokens throughout: `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `text-destructive`, and established success/warning token combinations. Do not carry forward `bg-white/92`, `text-slate-*`, `border-white/70`, or prototype inline colors.

Badges and readiness icons must maintain readable foreground/background contrast in both themes. Pending amber and success green never carry meaning without text/icon shape. Buttons reuse default, outline, link, and focus-ring styles. Skeleton styling comes from the existing component with no color override.

## 8. Accessibility and interaction

- Stat section has an accessible heading (visually hidden is acceptable) and each card title is a semantic heading. Values are visible text with `tabular-nums`; cards are not interactive containers.
- Revenue exposes every currency as visible text, so no hover-only tooltip is needed. A screen reader reads currency code and formatted amount line-by-line.
- Identity uses `dl`/`dt`/`dd`, preserving label/value association after responsive reflow.
- Readiness uses a named `section`, visible `N / 6 ready`, and a `ul`. Icons are `aria-hidden`; visible state wording conveys done/pending/unknown. Do not add `role="checkbox"`, `aria-checked`, or positive `tabIndex`.
- Pending/unknown checklist links use a visible destination-oriented label or accessible name, e.g. `aria-label="Fix registration form: open Registration Form"`. Focus ring surrounds the row, not only the icon. Complete rows do not enter the tab order.
- Quick actions and helper actions are real links; retry and publish are real buttons. Decorative lucide icons are `aria-hidden`.
- Preview's accessible name indicates new context: **"Preview event (opens in a new tab)"**; a visible external-link icon may supplement but not replace text.
- Saving publish state disables repeat submission; the existing toast communicates success/failure. Focus remains on the status button after refresh where platform behavior permits.
- DOM focus order: event-bar Preview, status action, stat-card retry/helper controls, Quick actions, identity retry, checklist fix/retry links, then Promotions. No CSS visual reordering that contradicts this sequence.

## 9. Data orchestration and shaped UI contract

`event-overview-loader.ts` is a server-only orchestration layer. It receives canonical `organizationId` and owned `eventId`, calls only tenant/event-scoped DAL methods, and returns display-safe discriminated results. It does not call Firestore directly.

Recommended shape:

- `registered`, `invited`, `abandoned`: `{ value: number } | { loadError: true }`.
- `revenue`: `{ kind: "unconfigured" } | { kind: "currencies"; amounts: Array<{ currency: string; paidMinor: number }> } | { loadError: true }`.
- `identity.paths`: `{ active: number; total: number; methods: PaymentMethod[] } | { loadError: true }`; category/timezone/visibility derive from the owned event.
- `readiness`: exactly six ordered entries, each `{ id, state: "done" | "pending" | "unknown", label, detail, href? }`.

Load metric concerns concurrently with `Promise.allSettled`. Readiness prerequisites also settle independently, with shared path data fanning into Registration, Payment, confirmation-email readiness, and Revenue currency enumeration. A path rejection is represented wherever that dependency is required; it is never coerced to an empty array. The two approved new DAL helpers and all reuse calls follow the exact contracts in the research spec.

## 10. Component composition — `src/features/event/overview/`

Keep generic dashboard primitives in place; move this event-specific composition out of the 455-line dashboard component. Target files:

- `src/features/event/overview/event-overview.tsx` — server/presentational composition entrypoint; parity grid and Promotions section placement only.
- `src/features/event/overview/event-overview-loader.ts` — server orchestration, `Promise.allSettled`, tenant-scoped shaping.
- `src/features/event/overview/event-overview-types.ts` — compact discriminated UI result types shared across slices.
- `src/features/event/overview/event-overview-stat-card.tsx` — `EventOverviewStatCard` and `EventOverviewStatCardSkeleton`, following `workspace-stat-card.tsx` naming/treatment.
- `src/features/event/overview/event-overview-stats.tsx` — ordered four-card composition and per-card presentation rules.
- `src/features/event/overview/event-quick-actions.tsx` — five ordered deep links.
- `src/features/event/overview/event-identity.tsx` — five-row description list and path-read degradation.
- `src/features/event/overview/public-readiness.tsx` — fixed six-row card, summary, states, and fix links.
- `src/features/event/overview/event-overview-retry.tsx` — small client boundary for `router.refresh()` shared by granular failures.
- `src/features/event/overview/index.ts` — narrow public exports for the route.
- `src/app/dashboard/(event)/events/[eventId]/loading.tsx` — route-level event overview skeleton composition.

Continue reusing `src/features/dashboard/components/event-status-actions.tsx`, refined to accept the event-bar slot/permission presentation and without its duplicate public-page link. Do not create new `src/components/ui/*` primitives or move DAL modules. Aim for one concern per file and roughly under 200–250 lines; split only when behavior warrants it, not into one-line wrappers.

## 11. Decision coverage checklist (D1–D19)

- **D1:** locale-grouped integer values and ordinary `0`; no event-level zero padding.
- **D2:** Registered is accepted attendees; unsupported weekly trend is omitted.
- **D3:** Invited is sent invitation messages with honest helper copy, not an Attendee/pending-form proxy.
- **D4:** paid `totalMinor` is shown per currency; no conversion/addition; OQ-1 uses stacked lines.
- **D5:** Abandoned uses strict `>24h` aggregate and links to the Attendees recovery surface.
- **D6:** four metrics degrade independently with `—`, error copy, and retry.
- **D7:** unavailable Category remains a fixed **Not set** row.
- **D8:** stored timezone is rendered honestly.
- **D9:** Visibility is status-derived Public / Private (draft), never search-listing copy.
- **D10:** Registration is active/total path availability with Open/Closed wording.
- **D11:** Payment derives stable active-path methods and simulated provider only where truthful; never Stripe.
- **D12:** readiness is exactly six configuration-derived rows, mode-aware only for custom-page applicability; unknown is excluded from `N / 6`.
- **D13:** Preview remains always available in the shared event bar and opens the public route in a new tab.
- **D14:** existing publish mutation is surfaced in the reserved slot; labels, permission gate, loading/error behavior retained; duplicate Preview removed.
- **D15:** Quick actions use exactly the five shipped routes in prototype order.
- **D16:** prototype hierarchy is retained with responsive 4-card and approximately 2:1 lower grids.
- **D17:** route skeleton and granular metric/identity/readiness failures are explicitly designed.
- **D18:** overview composition, loader, types, and presentational components move to `src/features/event/overview/`.
- **D19:** legacy overview clutter is removed, while Promotions remains below the parity grid at `#promotions`.

## 12. Acceptance-criteria mapping

- **AC1:** §1 defines all four cards, exact order/labels, truthful metrics, and independent failure states.
- **AC2:** §2 defines the five Quick actions and exact deep links.
- **AC3:** §2 defines all five identity rows, path count, provider/method fallbacks, and prohibits fabricated values.
- **AC4:** §3 defines the fixed six rows, truth-state presentation, deep links, Unknown behavior, and `N / 6 ready`.
- **AC5:** §4 defines Preview target/new-tab behavior and reused publish/move-to-draft control.
- **AC6:** §§5 and 9 require canonical organization/event scope and forbid failures becoming zero/empty configuration.
- **AC7:** §1 defines ordinary zero, minor-unit formatting, unconfigured currency state, and no cross-currency total.
- **AC8:** §4 keeps all overview data and Preview visible to viewers while withholding an enabled mutation control.
- **Responsive/theme/accessibility asks:** §§6–8 cover 320/768/1024/1440, semantic light/dark tokens, roles, names, focus, and non-color state cues.
- **Refactor ask:** §10 names the target files and size boundaries.

## 13. Design reconciliation notes

No research D-decision is overruled. OQ-1 confirms the research default of stacked Revenue lines, with a deliberate reconciliation against M8-T2: the workspace card compresses secondary currencies because it summarizes many events, while the event card visibly lists every event currency. The only presentation refinement is that pending readiness concepts use explicit negative wording (while complete rows retain the prototype labels), preserving the locked truth rules and making state understandable without color.
