# Design Spec — M2 Pricing & Commerce (Pricing screen: M2-T1/T2/T3)

Source: `prototype/prototype/event-pricing.html`, BACKLOG M2-T1..T3, M1 pattern in `src/features/registration/`. No `agents/docs/specs/m2-*.md` existed at design time — flag any conflicts back to UX when the research spec lands.

## 1. Screen shell — route `/dashboard/events/[eventId]/pricing`
- Replace `ComingSoonSection` page at `src/app/dashboard/(event)/events/[eventId]/pricing/page.tsx` with a server page (fetch fees + tickets + reg types + promotions + taxes, serialize) rendering `<PricingWorkspace>`; add `loading.tsx` using `EntityScreenSkeleton`. Remove `comingSoon`/`milestone`/`description` from the Pricing item in `src/features/event/event-nav.ts`.
- Header row (M1 pattern): `h1 text-xl font-semibold tracking-tight` "Pricing" + `text-sm text-muted-foreground` sub ("Fees attach a price to a ticket — per registration type and currency."). **No global CTA**; each tab owns its primary CTA so the action always matches the visible content.
- **Tabs**: new shadcn primitive `src/components/ui/tabs.tsx` (standard shadcn `@radix-ui/react-tabs` wrapper — Tabs/TabsList/TabsTrigger/TabsContent, default styling). Four triggers: Fees / Discounts / Taxes / Service Fees.
- **URL state**: controlled Tabs; `?tab=fees|discounts|taxes|service-fees` (default/invalid → `fees`). On change: `router.replace(pathname + '?tab=...', { scroll: false })`. Server page reads `searchParams.tab` for initial value so deep links render the right tab without flash.
- Per-tab layout: optional `InfoNote`, then rounded `border-border bg-card rounded-2xl overflow-hidden` table container (exactly the M1 card), `overflow-x-auto` wrapper + `min-w-[…rem]` on each Table for responsive horizontal scroll.

## 2. Fees tab (functional, M2-T1)
- CTA row inside the tab, right-aligned: `Button` "+ Create fee" (Plus icon). Count badge (`Badge variant=secondary rounded-full tabular-nums`, `aria-live=polite`) mirrors M1 toolbar; search/filter deferred until fee lists grow (YAGNI now).
- `InfoNote`: "Same ticket can carry different prices per registration type and currency. Comp variants use ticket-code suffixes — `/C` client comp, `/S` staff comp." (`font-mono` on the suffixes). This is where the comp convention is surfaced for scanning; it repeats as helper text in the dialog.
- Table `aria-label="Fees"` `min-w-[56rem]`, columns: Name (`font-medium text-foreground`) · Ticket code (`font-mono text-xs text-muted-foreground`) · Registration type (name, or "All types" muted) · Base price (right-aligned `tabular-nums`, formatted from minor units via `Intl.NumberFormat(undefined,{style:'currency',currency})` in `utils.ts formatMoney`) · Currency (mono ISO code, e.g. `USD`) · Status (Active = emerald badge exactly as ticket "Open Yes"; Inactive = `Badge variant=secondary`) · sr-only Actions (ghost icon Pencil/Trash2 with `aria-label="Edit/Delete {name}"`).
- **FeeDialog** (create/edit, copy `ticket-type-dialog.tsx` RHF+Zod pattern): Name (text) · Ticket (Select of ticket types, item shows "Name — CODE") · Registration type (Select; first item "All registration types") · Currency (Select, ISO list from RL spec; default event/org currency) · Base price (`Input type=text inputMode=decimal`, **major units**, currency-symbol prefix inside the field; helper `text-xs text-muted-foreground`: "Enter 750.00 — stored as 75000 minor units (cents/pence).") · Active (Switch, default on). Name helper repeats comp convention: "Tip: mirror the ticket code and append /C or /S for comp fees."
- **Uniqueness**: on 409 (duplicate ticket×type×currency) show inline form error on the Ticket field: "A fee for this ticket, registration type and currency already exists." Do not toast-only.
- **Delete guard**: `DeleteEntityDialog` (reused). Blocked message when fee is referenced by orders (post-M2-T4; until then plain confirm): "N orders reference this fee. Deactivate it instead."
- **Empty state**: `EntityEmptyState` icon `CircleDollarSign`, title "No fees yet", description "Attach a price to each ticket — per registration type and currency. Create tickets first if you haven't.", action "+ Create fee". If zero ticket types exist, swap action for a `Button variant=outline` link "Create ticket types" → `.../tickets` and disable fee creation.

## 3. Discounts tab (M2-T2) — decision: read-mostly + settings dialog, no duplicate editor
- Promotion editing lives inline inside `EventPromotionManager` (mounted on the event Overview, `organization-event-detail.tsx`) — it is **not an importable dialog**. Do not extract or re-mount it here. **Chosen design**: this tab is a read-only projection of `SerializedEventPromotion` rows for the base fields, plus a small **DiscountSettingsDialog** that edits only the *new* M2 fields (level Event/Partner, validity window, usage cap, active). FS adds `id="promotions"` to the Overview promotions section; tab header carries a link "Manage codes & rules in Promotions →" (`text-primary underline-offset-4 hover:underline`) → `/dashboard/events/{id}#promotions`, and each row's action menu has "Open in Promotions" plus "Discount settings" (opens the dialog). This keeps one source of truth per field and satisfies the CR duplication watch.
- No create CTA here (creation = attach flow on Overview). Header CTA slot instead holds the Manage link styled as `Button variant=outline`.
- Table `aria-label="Discounts"` `min-w-[60rem]`: Name · Code (mono; em-dash muted if auto-apply, with "Auto-apply" secondary badge) · Level (Badge outline: Event / Partner) · Amount (tabular-nums; "10%" or formatted money by discountType) · Validity ("→ Aug 31" style, `title` = full ISO; muted "No end date" if unset) · Usage (`used / cap` tabular-nums; "used" only when uncapped; amber text when used ≥ cap) · Active (Yes emerald / No secondary badge) · Actions.
- InfoNote: comp-code convention line from prototype (`/C` client comp, `/S` staff comp — mono).
- Empty state: `EntityEmptyState` icon `Tag`, title "No discount codes attached", description "Attach a promotion template to this event to create discount codes.", action label "Manage promotions" → Overview anchor (link-style action).

## 4. Taxes tab (M2-T3) + Service Fees tab
- Taxes: CTA "+ Create tax". Table `aria-label="Taxes"` `min-w-[40rem]`: Name · Code (mono) · Type ("Percentage"; model allows "Fixed" later) · Rate (right-aligned tabular-nums, up to 3 decimals — `8.875%`) · Active (Yes/No badges as above) · Actions. **TaxDialog**: Name · Code (text, uppercased on blur) · Type (Select, Percentage only for now) · Rate (`inputMode=decimal`, `%` suffix adornment, Zod 0–100, ≤3 decimals) · Active Switch. Delete via `DeleteEntityDialog` (blocked once orders reference it). Empty state: icon `Percent`, "No taxes configured", "Add VAT or sales tax to apply on top of fees at checkout.", "+ Create tax".
- **Service Fees**: designed empty state only, **no CTA** (entity stubbed). Reuse the `EntityEmptyState` shell minus the button — extend it with optional `actionLabel`/`onAction` (render no Button when omitted). Icon `CreditCard`, title "No service fees configured", description "Add a per-order processing fee if you pass card costs on to attendees. Coming in a later milestone." Keep it visually identical to other empty states in both themes.

## 5. States, responsive, a11y (all tabs)
- **Loading**: route `loading.tsx` = `EntityScreenSkeleton` + a `TabsSkeleton` strip (four `Skeleton h-9 w-24 rounded-md` in a row) above the table card. Tab switches are client-side over pre-fetched data — no per-switch skeleton.
- **Error**: per-tab `EntityTableError` (`entityLabel` = "fees" / "discounts" / "taxes") with `router.refresh()` retry; shell + tabs stay interactive. Mutation failures: sonner `toast.error` with retry description, dialog stays open (repo convention).
- **Success**: `toast.success` ("Fee created/updated/deleted", etc.); dialog closes; `router.refresh()`.
- **Permission-denied** (API 403): toast "You don't have permission to change pricing." — no separate screen state until M8-T1 roles.
- **Responsive**: <768px the table card scrolls horizontally (`overflow-x-auto`, min-widths above); TabsList itself gets `overflow-x-auto` with no wrap; header row wraps (`flex-wrap gap-3`) so CTA drops below the title. Dialogs use existing `DialogContent` (already mobile-safe).
- **A11y**: Radix Tabs gives roving-tabindex Arrow-key nav + `aria-selected` (use automatic activation, default). Tables use semantic `Table*` primitives with `aria-label`; icon buttons carry explicit `aria-label`s; count badges `aria-live=polite`; price/rate inputs are labeled `Input`s (never placeholder-as-label); emerald/amber badges pair color with text ("Yes"/"No", never color-only). Verify badge contrast in dark theme (reuse M1's `dark:bg-emerald-950 dark:text-emerald-200` combo).

## 6. Component tree — `src/features/pricing/`
```
src/features/pricing/
  types.ts                      # SerializedFee, SerializedTax, discount-row projection type
  schemas.ts                    # Zod: feeFormSchema, taxFormSchema, discountSettingsSchema
  utils.ts                      # formatMoney(minorUnits, currency), formatRate, validity label
  components/
    pricing-workspace.tsx       # client shell: header + Tabs + URL sync; receives all tab data
    fees-tab.tsx                # count badge, InfoNote, table, empty/error, delete wiring
    fee-dialog.tsx              # RHF + Zod create/edit (clone ticket-type-dialog pattern)
    discounts-tab.tsx           # read-mostly table + Manage links
    discount-settings-dialog.tsx# edits level / validity / usage cap / active only
    taxes-tab.tsx
    tax-dialog.tsx
    service-fees-tab.tsx        # CTA-less empty state
```
- **New shared primitive**: `src/components/ui/tabs.tsx` (standard shadcn Radix Tabs — the only new ui/ component).
- **Reused cross-feature** (import as-is from `@/features/registration/components/`): `EntityEmptyState` (extended: optional action), `EntityTableError`, `EntityScreenSkeleton`, `InfoNote`, `DeleteEntityDialog`. They are presentational/generic; promotion to a shared folder is optional follow-up, not part of this ticket.
- **Touched elsewhere**: `event-nav.ts` (drop comingSoon on pricing), pricing `page.tsx` + new `loading.tsx`, `organization-event-detail.tsx` (`id="promotions"` anchor), `ticket-types-workspace.tsx` price column em-dash → real formatted price once fees exist (link stays when no fee).
