# M8-T3 — Event overview parity

Research Lead, 2026-07-19. Authoritative screen: `prototype/prototype/event-overview.html`. Implementation target today: `src/app/dashboard/(event)/events/[eventId]/page.tsx` + `src/features/dashboard/components/organization-event-detail.tsx`; recommended destination: `src/features/event/overview/` (§9).

## 1. Outcome and acceptance criteria

Upgrade the per-event Overview to the prototype's information architecture using real, organization-scoped data: four metrics, Quick actions, five identity rows, one fixed six-item readiness checklist, and Preview/Publish actions. The existing event shell remains authoritative for breadcrumb/event identity/status.

Acceptance criteria:

1. The overview shows Registered, Invited, Revenue, and Abandoned in that order, with truthful definitions from §4 and independent loading/error handling.
2. Quick actions deep-link to Page Builder, Registration Form, Ticket Types, Attendees, and Check-in.
3. Event identity shows Category, Timezone, Visibility, Registration (including active/total path count), and Payment using §5 fallbacks; no fabricated Stripe/search-listing state appears.
4. Public readiness always renders exactly the six prototype concepts and `N / 6 ready`; each result follows §6 and is server-derived.
5. Preview opens `/events/{eventId}` in a new tab. The primary status action publishes a Draft event and moves a Published event to Draft, preserving the shipped mutation/error behavior (§7).
6. Every event/org DAL call is scoped by both `eventId` and canonical `organizationId`; aggregate failures do not turn into plausible zeroes.
7. Zero values render `0`, not zero-padded `00`; money uses existing currency-aware minor-unit formatting. Multiple currencies never get added together.
8. Viewer/read-only users can see all overview data and Preview, but cannot receive an enabled publish/unpublish control; mutations remain gated by `write:events`.

## 2. Prototype contract — exhaustive inventory

The prototype places Preview then primary `Publish changes` at the right of the top bar (`prototype/prototype/event-overview.html` 35–42), above an event bar containing logo, title, date/time/location/code, and Published badge (44–52). The real M0 shell already owns this region: its event bar renders Preview at the right and explicitly reserves the adjacent Publish slot for M8-T3 (`src/features/event/components/event-bar.tsx` 118–130); it also renders event name/status/date/venue/code (`event-bar.tsx` 67–115).

The four equal stat cards appear immediately below the event bar (`event-overview.html` 54–60):

- `🎟️ Registered`: integer `148`, plus green `▲ 12 this week` (`event-overview.html` 56).
- `👥 Invited`: integer `158`, no secondary line (57).
- `💳 Revenue`: currency symbol + grouped whole units, `$74,250`, no decimals (58).
- `⛔ Abandoned`: integer `31`, plus amber `recover via email` (59).

There is no zero example and therefore no prototype evidence for zero-padding. D1 locks ordinary `0`. “12 this week” has no backlog requirement and no shipped week-over-week primitive; it is out of scope (D2).

Below, a two-column-wide Quick actions/identity card sits left and readiness sits right (`event-overview.html` 62–94). Quick actions are `Open Page Builder`, `Edit Registration Form`, `Manage Ticket Types`, `View Attendees`, `Set up Check-in` in that order (64–71). Identity has exactly: `Category — Conference`; `Timezone — Eastern (US & Canada)`; `Visibility — Public · listed in search`; `Registration — Open · 8 paths`; `Payment — Stripe · card + invoice` (72–79). Readiness title/subtitle are `Public readiness` and `5 / 6 ready`; items are exactly `Event published`, `Custom page published`, `Registration form published`, `Ticket types & pricing set`, `Confirmation email active`, and the incomplete-state wording `Check-in not configured` (82–92). Complete items use a check; incomplete uses an amber exclamation in the sample (85–91).

## 3. Current implementation and defect/gap identification

The route resolves the tenant-scoped event first, then concurrently loads only form, default event page, promotions, and org promotion templates (`src/app/dashboard/(event)/events/[eventId]/page.tsx` 21–55), serializing all into the 455-line dashboard component (57–65). It loads none of the four metrics, paths, tickets/fees, email readiness, or check-in configuration.

What exists:

- Correct event-not-found state (`organization-event-detail.tsx` 56–74).
- A real status action in the page header plus Edit/Page Builder/Form/Responses buttons (`organization-event-detail.tsx` 161–190).
- Real Event/Form/EventPage-derived readiness, but its length and concepts vary by page mode: redirect has 2 checks, custom 4, default 3 (`organization-event-detail.tsx` 76–156). It is therefore not the prototype's fixed 6.
- A readiness summary and item presentation (`organization-event-detail.tsx` 158–288).
- Identity data, but as four tiles (Schedule, Capacity, Timezone, status-derived Visibility), missing Category, registration path count, and payment (`organization-event-detail.tsx` 290–335).
- Promotions manager, three generic workspace cards, raw event-data diagnostics, and full registration-form card (`organization-event-detail.tsx` 337–452), none present in this prototype overview.

Gaps/defects:

1. All four stat cards are absent.
2. Quick actions do not match: actions are crowded into the page header and a generic three-card section; one “Publish workflow” card incorrectly links to Responses and carries stale “before public discovery ... wired” copy (`organization-event-detail.tsx` 348–390).
3. Visibility currently aliases publish status (`organization-event-detail.tsx` 317–322), but the model has no visibility/search-listing field (`src/types/collection.ts` 277–295).
4. Readiness is mode-dependent and omits ticket/pricing, confirmation email, and check-in.
5. The component duplicates overview identity beneath the M0 event bar and mixes unrelated promotions/form-management concerns.
6. Preview is already in the shell, but `EventStatusActions` also conditionally renders “View public page,” duplicating Preview when Published (`src/features/dashboard/components/event-status-actions.tsx` 94–100).

## 4. Metric definitions and data availability

**D1 — Count format is locale-grouped integer with ordinary `0`; never `00`.** The prototype's nonzero samples contain no padding (`event-overview.html` 56–59). Use tabular numerals and the current locale's grouping.

**D2 — Registered is accepted Attendee count; omit “this week.”** `AttendeeStatus` has only `accepted | cancelled` (`src/types/collection.ts` 671–675), and the existing per-event aggregate supports status filtering (`src/lib/db/adminAttendee.ts` 275–297). Call:

```ts
countAdminAttendeesForEvent({ eventId, organizationId, status: "accepted" }): Promise<number>
```

This exactly reuses the M7 aggregate primitive. The reports registration overview uses the same per-event attendee list shape and labels the two statuses Accepted/Cancelled (`src/features/reports/server/load-registration-overview.ts` 26–39, 42–59). No new DAL is needed.

**D3 — Invited means successfully sent event invitation messages, not an Attendee state.** There is no per-event invitee entity: Attendee has no invited state (`collection.ts` 674, 689–724). The M6 catalog's invitation is a manual email definition with audience label `all-invitees` (`src/features/emails/default-definitions.ts` 125–136), while the actual outbox stores eventId, kind, recipient, and delivery status (`collection.ts` 804–832). Therefore display the count of outbox documents where `kind === "invitation" && status === "sent"`, using the already-shipped aggregate:

```ts
countAdminEmailMessagesForEvent({
  eventId, organizationId, kind: "invitation", status: "sent"
}): Promise<number>
```

The function supports both optional equality filters (`src/lib/db/adminEmailMessage.ts` 376–398); unlike its list sibling, the count has no prohibition on combining them. Tooltip/helper copy: `Invitation emails sent`. This counts successful logical send records, not guaranteed unique human recipients; retries collapse only when callers reuse their deterministic send identity. Do not map pending FormData to “Invited”: that is submitted registration awaiting approval, not outreach.

**D4 — Revenue is paid order total per currency, never cross-currency addition.** Orders store integer minor-unit totals, currency, payment status, and simulated provider (`collection.ts` 545–565). Reuse `sumAdminOrderTotalsForEvent` with `paymentStatus:"paid"`, `field:"totalMinor"` (`src/lib/db/adminOrder.ts` 246–262). Reuse M7's currency enumeration: distinct currencies from event RegistrationPaths, sorted, then per-currency Promise fan-out (`src/features/reports/server/load-finance-summary.ts` 78–109). One currency renders one formatted amount; multiple render one line/chip per currency in stable currency-code order; no paths renders `—` with `No payment currency configured`, not `$0`. The prototype suppresses decimals, but real money must use the existing formatter rather than lose cents (Order minor-unit contract: `collection.ts` 439–469).

**D5 — Abandoned is the existing strict >24h incomplete-draft definition.** Completed drafts are deleted; an existing draft becomes abandoned only when `now - updatedAt > ABANDONED_AFTER_MS` (`collection.ts` 619–623; `src/lib/db/adminRegistrationDraft.ts` 33–39, 244–259). The current tab filters exactly this flag and explains “idle for more than 24 hours” (`src/features/attendees/abandoned.ts` 47–55; `src/features/attendees/components/abandoned-tab.tsx` 185–195). Page length is not a count: the current reader is bounded to 50 and includes fresh drafts (`adminRegistrationDraft.ts` 214–242). Add:

```ts
countAdminAbandonedRegistrationDraftsForEvent(input: {
  eventId: string;
  organizationId: string;
  nowMs?: number;
}): Promise<number>
```

Implementation contract: Firestore aggregate `count()` with equality tenant/event filters and `updatedAt < Timestamp.fromMillis((nowMs ?? Date.now()) - ABANDONED_AFTER_MS)`. The strict `<` preserves strict `>24h`. The card helper is the prototype's `recover via email`, linked to `/dashboard/events/{eventId}/attendees` (the existing Abandoned tab owns Email all).

**D6 — Metrics fail independently.** Load Registered, Invited, Abandoned, paths/currencies and paid sums concurrently (a loader may internally fan out currencies). A rejected metric renders `—` plus retry/error affordance; zero only represents a successful zero aggregate. Do not blank the rest of the overview.

## 5. Event identity rules

**D7 — Category is unavailable and must say `Not set`.** EventDoc has no category or venue/visibility fields—only the fields at `src/types/collection.ts` 277–295. Do not hardcode Conference. Category remains a fixed row for parity, with subdued `Not set`.

**D8 — Timezone is `EventDoc.timezone`.** Render the stored IANA/value as-is; it exists at `collection.ts` 293. Friendly-name conversion is optional presentation only and must retain the raw value accessibly.

**D9 — Visibility is status-derived only and uses honest copy.** `Published` → `Public`; `Draft` → `Private (draft)`. Never say “listed in search”: no such field exists (`collection.ts` 277–295). Event status is the only public-discovery gate used by admin published-event reads (`src/lib/db/adminEvent.ts` 78–106).

**D10 — Registration state is active-path availability.** RegistrationPath stores `isActive` and inactive paths do not appear publicly (`collection.ts` 582–609); `getAdminRegistrationPathsForEvent` includes all and the active sibling filters them (`src/lib/db/adminRegistrationPath.ts` 53–73, 92–104). Show `Open · A active / T paths` when `A > 0`; otherwise `Closed · 0 active / T paths`. This is configuration state, not Event publish state. The prototype's shorter singular/plural form is acceptable responsively (`1 path`, `N paths`).

**D11 — Payment describes configured path methods and the only real provider.** Paths pin `paymentMethod: card | invoice | comp | none` (`collection.ts` 505–507, 578–604). Orders can only persist `paymentProvider:"simulated"` (`collection.ts` 545–562); there is no event payment-settings/provider entity. Derive methods from active paths in stable order `card, invoice, comp, none`. If none: `Not configured`. If card/invoice exists: badge `Simulated · {method labels}`; comp/none-only: `{method labels}` without a provider. Never display Stripe. No new DAL is needed beyond the path list.

## 6. Fixed six-item readiness truth table

**D12 — The checklist is fixed, configuration-based, and mode-aware only where the underlying feature requires it.** It always renders six rows and `N / 6 ready`; a failed read is `Unknown`, excluded from N, and visibly retryable—not false and not true.

1. **Event published** — TRUE iff `event.status === "Published"` (`collection.ts` 292). Existing code already applies this exact test (`organization-event-detail.tsx` 80–85).
2. **Custom page published** — TRUE iff either (a) `event.pageMode !== "custom"` (not applicable, shown complete with detail `Not required for {default|redirect} page mode`), or (b) the default EventPage exists with `status === "published"`. EventPage stores status/published content (`collection.ts` 1058–1072); `getAdminEventPageForEvent` is the scoped reader (`src/lib/db/adminEventPage.ts` 44–75). Existing code already tests the custom branch's status (`organization-event-detail.tsx` 95–119). For redirect mode, redirect URL validity remains an edit-form concern, not a seventh checklist item.
3. **Registration form published** — TRUE iff Form exists and `form.status === "published"` (`collection.ts` 330–339); `getAdminFormForEvent` is the real scoped lookup and its published wrapper applies the same test (`src/lib/db/adminForm.ts` 37–80).
4. **Ticket types & pricing set** — TRUE iff at least one TicketType exists AND at least one active Fee (`status === "active"`) references a ticket in that same returned set. Ticket and Fee ownership/price/status fields are queryable (`collection.ts` 414–437, 453–476). Use existing bounded readers `getAdminTicketTypesForEvent` (`src/lib/db/adminTicketType.ts` 56–77) and `getAdminFeesForEvent` (`src/lib/db/adminFee.ts` 41–56); no new DAL. This deliberately does not require every ticket to be priced: comp/none paths and intentionally unavailable ticket variants are valid.
5. **Confirmation email active** — derive the required confirmation kinds from active paths: card/comp/none requires `confirmation-paid`; invoice requires `confirmation-payment-due`; with zero active paths require both (so an unconfigured event cannot pass accidentally). TRUE iff every required effective definition has `enabled === true`. These two catalog definitions and their `on-accept` triggers are real (`src/features/emails/default-definitions.ts` 164–189). Use `resolveEffectiveEmailDefinition`, which merges stored definitions over virtual defaults and returns the effective enabled flag (`src/features/emails/server/resolve-definition.ts` 44–76). No DAL addition.
6. **Check-in configured** / incomplete wording **Check-in not configured** — TRUE iff a tenant-matching CheckinConfig document has actually been saved. The current getter cannot answer this: it returns in-memory defaults both for no document and cross-org mismatch (`src/lib/db/adminCheckinConfig.ts` 73–93), while the collection is explicitly lazy and has no doc until first save (`adminCheckinConfig.ts` 1–13). Add:

```ts
hasAdminCheckinConfigForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<boolean>
```

It performs the deterministic `eventId` doc read and returns true only when the document exists and its `organizationId` matches. Toggle values are not readiness: defaults intentionally include a mix of on/off settings (`adminCheckinConfig.ts` 36–45); saved existence proves the organizer visited/configured the surface.

Each incomplete row should deep-link to its fix: event Edit/status action, Page Builder, Registration Form, Tickets/Pricing, Emails, Check-in respectively. Complete rows may remain non-links.

## 7. Preview and Publish behavior

**D13 — Preview remains in the shared event bar and is always available.** It already opens `/events/{encoded eventId}` in a new tab with safe rel attributes (`src/features/event/components/event-bar.tsx` 118–128). Draft preview may show the public route's unavailable/default behavior; this ticket does not add preview tokens or bypass publication.

**D14 — Publish is already implemented; surface/refactor it into the reserved event-bar slot.** `EventStatusActions` computes the inverse status, POSTs `/api/dashboard/events/{eventId}/status`, disables during save, reports success/error, and refreshes (`src/features/dashboard/components/event-status-actions.tsx` 19–65). It already labels Draft → `Publish event` and Published → `Move to draft` (`event-status-actions.tsx` 68–92). The route validates Draft/Published, checks `write:events`, scopes event to org, updates status, and returns it (`src/app/api/dashboard/events/[eventId]/status/route.ts` 12–63).

For prototype placement, the event bar receives a status-action slot adjacent to Preview (where line 129 reserves it). Draft state: primary `Publish event`; Published state: outline/destructive-secondary `Move to draft` (not misleading `Publish changes`, because no unpublished-change model exists). Saving: disabled spinner `Updating status`; failure retains state and toast. Remove the component's duplicate `View public page` because Preview already exists. Read-only users see Preview but no enabled mutation.

## 8. Quick actions, responsive/loading/error behavior

**D15 — Quick actions exactly match shipped event routes.** Routes are proven in the central nav: page-builder/form (`src/features/event/event-nav.ts` 45–53), tickets (56–59), attendees/checkin (73–82). Preserve the prototype order and labels from §2. Links remain available even when readiness is incomplete.

**D16 — Layout follows hierarchy, not literal desktop widths.** Desktop: four stat columns; below, Quick actions + identity occupy approximately two-thirds and readiness one-third, matching prototype grid spans (`event-overview.html` 55, 62–94). Collapse to one column on narrow screens; actions wrap, identity remains scannable rows, no horizontal overflow. Use existing theme tokens and provide both light/dark states.

**D17 — Loading and errors are granular.** Route-level skeleton preserves event-bar shell, four metric cards, left identity card and right six-row checklist. Existing event/form/page reads are prerequisites for their rows; paths/tickets/fees/email/check-in reads settle independently. An identity/checklist read failure displays `Unable to load`/Unknown for affected fields, with retry via navigation refresh. Never silently translate a query failure into Closed, Not configured, or 0.

## 9. Architecture and exact implementation scope

**D18 — Refactor into `src/features/event/overview/` is IN scope and recommended.** The backlog already names this direction (`agents/docs/BACKLOG.md` 511–516). The current 455-line component combines seven concerns and imports dashboard shell, event/form/page, promotions/templates, and status mutation (`organization-event-detail.tsx` 1–46, 76–452). M0's event shell/navigation already lives under `src/features/event/` (`src/features/event/event-nav.ts` 37–90). Move the overview composition/presentational components and server loader/types to `src/features/event/overview/`; keep generic dashboard primitives where they are. The route should import the new overview entrypoint.

Recommended slices (names non-binding): `event-overview.tsx`, `event-overview-loader.ts`, `overview-stat-cards.tsx`, `event-identity.tsx`, `public-readiness.tsx`, and a small client status-action component. Do not move unrelated shared DALs.

**D19 — Remove overview-only legacy clutter; promotions ownership is preserved outside this parity composition.** The generic workspace cards, raw-data diagnostic card, and embedded registration-form card are OUT of the parity overview. The Promotions manager is real functionality and its Pricing deep link currently targets `#promotions` (`organization-event-detail.tsx` 337–346); it must not be deleted. Either retain it below the parity grid in a separately imported section or move it to a dedicated existing navigation destination only if all inbound links are updated and regression-tested. This ticket authorizes refactor, not feature deletion.

New DAL surface, exact signatures:

```ts
// src/lib/db/adminRegistrationDraft.ts
export async function countAdminAbandonedRegistrationDraftsForEvent(input: {
  eventId: string;
  organizationId: string;
  nowMs?: number;
}): Promise<number>;

// src/lib/db/adminCheckinConfig.ts
export async function hasAdminCheckinConfigForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<boolean>;
```

Everything else reuses existing methods named in §§4–6. The only likely new index is RegistrationDraft `(eventId ASC, organizationId ASC, updatedAt ASC/DESC)`; an existing descending list index may serve the range aggregate, but Backend must verify against the emulator and add only if Firestore requests it.

## 10. M7 per-event aggregate precedents to reuse

- Registration aggregate primitive: `countAdminAttendeesForEvent` (`src/lib/db/adminAttendee.ts` 275–297).
- Finance orchestration: enumerate path currencies and fan out per currency (`src/features/reports/server/load-finance-summary.ts` 78–109); sum primitive `sumAdminOrderTotalsForEvent` (`src/lib/db/adminOrder.ts` 246–262).
- Registration report shape: tenant/event-scoped paged attendee loads (`src/features/reports/server/load-registration-overview.ts` 42–78).
- Abandoned report: same draft reader + in-memory `isAbandoned` semantics, explicitly noting fresh and abandoned drafts share pages (`src/features/reports/server/load-abandoned-registrations.ts` 1–38, 66–93). The overview must improve this to an aggregate count, not reuse a page length.
- Server orchestration convention: loaders call DALs and shape presentation; finance loader explicitly does not touch Firestore directly (`load-finance-summary.ts` 1–5).

## 11. Permissions and tenancy

All reads occur server-side after `getDashboardScope()` and event ownership resolution, as the current route does (`src/app/dashboard/(event)/events/[eventId]/page.tsx` 21–29). Every collection read includes both organizationId and eventId, except deterministic CheckinConfig doc read which must verify stored organizationId. No raw RegistrationDraft PII crosses the boundary for a count. Publish/unpublish retains the existing `write:events` route check (`status/route.ts` 35–48).

## 12. Explicit non-goals

- No week-over-week Registered trend.
- No new invitee/contact-list entity, unique-recipient analytics, email composer, or real email provider.
- No Stripe integration or event-level payment-provider settings; simulated remains truthful.
- No new category, venue, visibility, search-listing, registration-open, unpublished-changes, or preview-token fields.
- No cross-currency revenue total or currency conversion.
- No readiness item beyond the fixed six; redirect URL validation remains elsewhere.
- No changes to registration, order, attendee, email-trigger, check-in, page publishing, or form publishing workflows.
- No deletion of Promotions functionality.
- No application-code changes are part of this Research deliverable.

## 13. Test/QA acceptance matrix

1. Seed accepted + cancelled attendees; Registered counts accepted only, including successful zero.
2. Seed sent/queued/failed invitation EmailMessages plus unrelated kinds; Invited counts only sent invitation records.
3. Seed paid/outstanding/comped/failed orders across two currencies; Revenue shows only paid `totalMinor`, separated by currency.
4. Draft at exactly 24h is not abandoned; 24h + 1ms is; fresh drafts and deleted completed drafts do not count.
5. Identity covers zero/one/multiple active and inactive paths, all payment method combinations, and no category.
6. Truth-table each readiness row true/false/unknown; verify total is always `/ 6` for default/custom/redirect modes.
7. Custom page is required only in custom mode; default/redirect mark it not required/complete.
8. Ticket/pricing requires at least one ticket and an active fee referencing a returned ticket.
9. Confirmation readiness tests virtual defaults, disabled materialized overrides, and method-dependent required kinds.
10. Check-in defaults without a stored doc remain not configured; saving any valid config makes it configured.
11. Publish/move-to-draft loading, success, failure, permission denial, refresh, and no duplicate Preview link.
12. One aggregate failure leaves other cards usable and shows `—`, never 0; event not found skips related reads.
13. Tenant-isolation fixtures cannot influence any metric, identity row, or readiness result.
14. Responsive/light/dark visual checks preserve action order and no overflow.

## 14. Stale-backlog corrections and Design open questions

Corrections:

- The backlog implies Publish may need implementation (`agents/docs/BACKLOG.md` 512); the mutation and control already ship. M8-T3 only relocates/refines it (§7).
- Preview also already ships in the M0 event bar, with an explicit M8-T3 publish placeholder (`src/features/event/components/event-bar.tsx` 118–130).
- Prototype `Invited` cannot mean an Attendee status, and prototype `Stripe`/`listed in search` are not represented by the data model (§§4–5).
- Existing readiness is not simply missing: it is a real but variable 2/3/4-item implementation that must be replaced by the fixed six (`organization-event-detail.tsx` 76–156).
- M8-T2 has already added the organization-level attendee/order aggregates, while M8-T3 can reuse the pre-existing per-event variants (`src/lib/db/adminAttendee.ts` 275–315; `src/lib/db/adminOrder.ts` 246–281).

**OQ-1 (Design, non-blocking):** choose the compact multiple-currency Revenue presentation (stacked amounts vs. horizontally wrapping currency chips). Default: stacked lines in stable currency-code order because it remains readable at card width and never suggests addition.

No other Design question is unresolved; wording, truth rules, states, placement, and fallbacks are locked above.
