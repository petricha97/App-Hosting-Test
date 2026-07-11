# M4 — Event Website: New Blocks & Per-Path Pages (Behavioral Spec)

Screens: `prototype/prototype/event-page-builder.html` (palette rows 56–58: Registration Embed, "Ticket & Pricing table [new]", "Countdown timer [new]"; 3-pane builder, device toggles, Save draft / Publish), `prototype/prototype/event-registration-paths.html` ("Each path page is customizable in Page Builder").
Code baseline: `src/features/event-pages/puck.tsx` (config factory + renderer-injection pattern), `src/lib/db/adminEventPage.ts` (single page per event, found by `eventId`), `src/app/events/[eventId]/page.tsx` (public render), `src/features/public-registration/server/tickets.ts` (M3 public ticket projection), `src/app/events/[eventId]/register/page.tsx` (M3 entry rules).

## User stories
- As an **event organizer**, I drag a live pricing table onto my event page so visitors see current ticket prices without me re-editing the page when prices change.
- As an **organizer**, I add a countdown to event start (or any custom moment) to create urgency.
- As an **organizer**, I place a Register CTA that drops visitors into the M3 multi-step flow.
- As an **organizer**, I give each registration path its own landing page (e.g. Sponsor vs Delegate) while unconfigured paths fall back to the default page.
- As an **attendee**, arriving via a path link I see that path's page and its Register button keeps me on that path.

---

## T1 — Three Puck blocks

### Block 1: Ticket & Pricing table (`TicketPricingTable`)
Props (all text unless noted): `title`, `intro`, `emptyMessage` (default "Tickets will be announced soon."). No data props — data is bound, never author-entered.

**Data rule (decision).** The event page is **path-agnostic**, so the table cannot reuse M3's per-path eligibility/currency filter verbatim. Rule: show every ticket of the event that is (a) **derived-open** per M1 (`isOpen` + sales window — closed/scheduled tickets hidden, same as M3) and (b) **priced**: has ≥1 active Fee in ≥1 currency. Per ticket, per currency that prices it, display the **minimum** `basePriceMinor` across that ticket's fees (per-regType fees differ), rendered as a "from" price (`from $120`) whenever >1 distinct fee amount exists in that currency; exact price otherwise. Currencies render as columns (or stacked lines on mobile), ordered by first appearance. Eligibility (`registrationTypeIds`) does **not** hide rows here — audience-restricted tickets still show (the register flow enforces eligibility); rows may show the audience names as a caption. Sold-out tickets render with a "Sold out" badge, never hidden (M3 parity).

**Freshness (decision): live read at request time.** `publishedContent` stores only block props, never price data; the public route reads tickets/fees server-side on every request (route is already dynamic via Admin SDK). Justification: frozen prices go stale the moment an organizer edits a fee post-publish — wrong public prices are a trust/legal defect, and "republish the page after every price change" is an unteachable workflow. No snapshotting.

**Wiring.** `Render` in `public-custom-event-page.tsx` is client-side, so the server page fetches the projection and injects a renderer via the config factory (same pattern as `registrationRender`). Editor canvas (decision): **live org data**, fetched once server-side when the editor loads (dashboard-scoped endpoint, org-checked); when the event has zero qualifying tickets the canvas shows the block's empty state plus an editor-only hint ("Add tickets & fees under Pricing"). No fake sample data — organizers must see what visitors will see.

**ACs**
1. Ticket hidden when derived-closed (isOpen=false, before salesStart, or after salesEnd); boundary: open at `salesStart`, closed at `salesEnd` exactly (M1 rule reuse).
2. Ticket hidden when it has no active fee in any currency; a ticket priced in only one of the event's currencies shows "—" (or omits) in unpriced currency columns.
3. Min-across-fees "from" price per currency; single-fee currencies show the exact amount, minor units formatted per currency.
4. Sold-out ticket (capacity − registeredCount ≤ 0) renders with "Sold out" badge, price still visible.
5. Zero qualifying tickets → `emptyMessage` renders (public and canvas); block never renders a broken/blank table.
6. Fee or ticket edited after page publish → next public request reflects it without republishing the page.
7. Projection is public-safe: response/props carry only name/code/price/currency/availability/audience-names — never capacity, registeredCount, raw ids of internal docs, or sales timestamps.
8. Data-fetch failure on the public page → block renders `emptyMessage` (page must not 500 because of one block); error logged server-side.

### Block 2: Countdown timer (`CountdownTimer`)
Props: `title`; `target` radio = `eventStart` (default; resolved server-side from the event doc's start datetime + timezone) | `custom`; `customDateTime` (ISO string, shown only for custom); `completedMessage` (default "The event has started."). Displays days / hours / minutes / seconds.

**ACs**
9. `target=eventStart` tracks the event doc — organizer reschedules the event, countdown follows on next request, no page republish.
10. `customDateTime` invalid/unparseable → falls back to event start; no event start either → renders `completedMessage`.
11. Target in the past (or reached while viewing) → digits replaced by `completedMessage`; no negative numbers ever shown; at exactly zero the message shows.
12. SSR/hydration: server renders the four unit cells at fixed width (tabular numerals) with a deterministic placeholder or server-computed value; ticking starts client-side after mount; zero hydration warnings and zero layout shift (unit cells never resize as digits change).

### Block 3: Registration Embed (`RegistrationEmbed`, retargeted)
Keep the existing block type and its `title`/`body` props so already-saved pages load unchanged; add `buttonLabel` (default "Register now", applied when absent on legacy docs).

**Behavior.** When the event has ≥1 active registration path: render heading + body + a button linking to `/events/[eventId]/register` (on a path page, `?path=<pathId>` is appended — see T2). When **0 active paths**: keep today's inline legacy form render (matches the register route's redirect-to-event-page fallback — the CTA would bounce back here otherwise). When registration is unavailable (event unpublished form, or all paths inactive after having some): **disabled message, not hidden** (decision — hiding silently collapses the layout and organizers file it as a bug; Cvent shows "Registration is closed"): the block renders title/body plus a non-interactive "Registration is closed" notice.

**ACs**
13. ≥1 active path → button navigates to the M3 flow entry; single-path events land directly in the stepper (M3 AC-1 redirect), multi-path events land on the picker.
14. 0 paths ever configured → inline legacy form renders (existing behavior preserved, existing pages unaffected).
15. Paths exist but none active / form unpublished → title/body + disabled "Registration is closed" notice; no dead link, no hidden block.
16. Legacy saved pages (no `buttonLabel` prop) render with the default label; no content migration required.

### Cross-block ACs
17. **XSS:** every block prop renders as React text (`String(...)` interpolation, as existing blocks do) — never `dangerouslySetInnerHTML`; `<script>alert(1)</script>` in any prop renders as literal text on canvas and public page. `customDateTime` is parsed, never echoed raw into attributes.
18. All three blocks appear in the palette, render on mobile/tablet/desktop editor previews without horizontal overflow, and the pricing table collapses to stacked rows on mobile.
19. Save draft / Publish flows unchanged: draft-only changes never affect the public page; publish snapshots block **props** only (data stays live per AC-6/9).
20. All three blocks pass `eventPageContentSchema` (props.id present) and round-trip through `ensurePuckDataIds`.

---

## T2 — Per-path page customization

**Model (decision).** Extend `EventPageDoc` with `pageKey: string` — `"default"` for the event page, else a `RegistrationPath` id of the same event. Legacy docs without the field read as `"default"` (schema default; no backfill). Uniqueness: one page per `(eventId, pageKey)`; `getAdminEventPageForEvent`/`getAdminPublishedEventPageForEvent` gain a `pageKey` param (default `"default"`) and filter the `eventId` matches by it — required, since today's "first org-scoped match" lookup becomes ambiguous with multiple docs per event. `event.eventPagePath` keeps pointing at the default page only; path pages are found by query.

**What a path page IS (decision).** The pre-registration **landing page for that path**: `/events/[eventId]?path=<pathId>` renders the path's published custom page instead of the generic event page. The M3 register flow itself is untouched; the path page's RegistrationEmbed links to `/register?path=<pathId>`. Path-picker cards may deep-link to the path page when one is published, else straight to the flow (UX choice, non-blocking).

**Builder.** Path switcher in the editor workspace: "Default event page" + one entry per path (name + active/inactive badge). Switching loads that page's draft; a path with no page yet starts from `blankCustomData` and creates its doc on first save. Each page saves/publishes independently.

**ACs**
21. `?path=<id>` where that path has a **published** page → path page renders (with live blocks per T1); its RegistrationEmbed carries `?path=<id>` into the register flow.
22. Fallback: active path with no custom page (or draft-only) → default event-page behavior renders (custom default page, default detail, or redirect per `pageMode`) — never a 404, never a blank page.
23. Access control: `?path=` referencing an inactive, foreign-event, or unknown path → the param is ignored and the default page renders (no 404 — marketing surface degrades gracefully; note divergence from `/register?path=` which 404s). Inactive paths' pages are never publicly reachable.
24. Builder switcher lists default + all paths (inactive included, badged); edits/publishes to one page never touch another; publishing a path page does not flip `event.pageMode`.
25. Admin routes for path pages verify org membership AND that `pageKey` is a path id belonging to the event (route-validated, like M3's audience validation).
26. **Delete cascade (decision):** deleting a registration path deletes its EventPage doc in the same operation (orphaned pages are unreachable and would collide on recreate); the delete confirm warns "its custom page will also be deleted" when one exists. Shared event storage assets are untouched.
27. `pageKey="default"` docs and pre-M4 docs behave identically (schema default proven by loading a legacy event's page unmodified).

---

## Gap analysis
- `puck.tsx`: 7 blocks exist; **no** pricing table or countdown; `RegistrationEmbed` renders the legacy inline form only — needs the path-aware CTA branch (AC-13/15) while keeping AC-14/16 back-compat.
- No public-safe, path-agnostic ticket/fee projection — M3's `listPublicTicketsForPath` is per-path (eligibility + single currency); T1 needs a sibling `listPublicTicketsForEvent` reusing `isTicketOpen`/`deriveTicketAvailability` but iterating fees across currencies.
- `public-custom-event-page.tsx` receives no ticket/fee/path data; server page must fetch and inject (renderer-factory pattern already exists for registration).
- Editor workspace has no data-bound block support and no path switcher; `EventPageDoc`/`eventPageDocumentSchema` have no `pageKey`; `adminEventPage.ts` lookup breaks (ambiguous first-match) once >1 page per event exists.
- `/events/[eventId]/page.tsx` ignores `searchParams` entirely (no `?path=` handling); path delete API has no page cascade.

## Q&A log
(Answers to other agents' questions get appended here.)
