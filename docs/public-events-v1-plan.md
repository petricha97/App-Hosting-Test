# Public Events Discovery and Detail Pages v1

## Summary
Add a public event discovery flow outside the dashboard:

- a public `/events` page that lists only published events
- a public `/events/[eventId]` detail page that shows the event details in a generic public style
- a public registration section at the bottom of the detail page that renders the organizer-built form and saves responses into `FormData`

This should ship as a public-facing feature layered on top of the existing dashboard and event builder work, without waiting for the future CMS or custom event branding system.

## Key Changes

### Public routes and navigation
- Add `src/app/events/page.tsx` for the public events index.
- Add `src/app/events/[eventId]/page.tsx` for the public event detail page.
- Add `/events` as a first-class public destination in the marketing header.
- Update the landing page’s relevant discovery links and CTAs to point to `/events` instead of placeholder anchors where appropriate.
- Keep URLs ID-based for now: `/events/[eventId]`.
- Do not add slug support yet; explicitly leave that for the future CMS and content pass.

### Public event data rules
- Only events with `status === "Published"` are eligible for public listing.
- Draft events must never appear on `/events`.
- Draft events must 404 or behave as not found on `/events/[eventId]`.
- Public event reads should be server-side and admin-backed, not client Firestore reads.
- Add public server helpers alongside the current admin event helpers:
  - list public published events
  - get one public published event by id
- Reuse the existing event serialization pattern so public pages receive plain JSON-safe event objects.

### Public event page behavior
- `/events` should use a calm generic card or grid layout consistent with the marketing site, not the dashboard shell.
- Each public event card should show:
  - event name
  - short description
  - primary schedule label
  - capacity summary if available
  - CTA to open the public detail page
- `/events/[eventId]` should show:
  - event title
  - description
  - schedule summary
  - timezone
  - capacity and expected guests summary
  - any generic organizer-facing fields that are safe and meaningful publicly
- The public detail page should intentionally use generic presentation only.
- Do not add custom hero images, CMS blocks, or organizer-managed branding yet.
- Add one clear section near the bottom for registration.

### Public registration behavior
- The public event detail page should render the saved event-owned form at the bottom.
- Only show the registration form when:
  - the event is published
  - the linked form exists
  - the form status is `published`
- If the event is public but the form is missing or still draft, show a clear `registration not available yet` message instead of the form.
- Public form submission should allow unauthenticated users.
- Add a new public submission route for the event form, separate from the dashboard-only route.
- The public submission route should:
  - verify the event is published
  - verify the form is published
  - validate against the saved custom field definitions
  - write to `FormData`
- Reuse the saved field model from the form builder for rendering and validation so the public form and builder stay in sync.

### Data and interface additions
- Keep `EventDoc` status behavior unchanged for now: `Draft | Published`.
- Reuse the existing `FormDoc` and `FormDataDoc` structures already introduced.
- Add public-facing form and event loaders rather than creating a second copy of event or form types.
- Keep `FormData` writes minimal for this pass:
  - `formId`
  - `eventId`
  - `organizationId`
  - `submission`
  - `submittedAt`
- Do not add attendee account linkage, tickets, payment, or submission review workflow changes in this pass unless already required by the current route contracts.

## Test Plan
- Public list:
  - published events appear on `/events`
  - draft events do not appear on `/events`
  - empty state is shown cleanly when no public events exist
- Public detail:
  - `/events/[eventId]` renders for published events
  - draft or unknown event ids return not found behavior
  - page uses public layout, not dashboard layout
- Public registration:
  - published event + published form renders the form
  - published event + draft or missing form shows unavailable message
  - unauthenticated user can submit the public form
  - required fields validate correctly
  - email fields validate correctly
  - successful submission creates a `FormData` document
- Navigation:
  - header links to `/events`
  - landing page discovery links reach `/events`

## Assumptions and Defaults
- Public event detail uses `/events/[eventId]` for v1.
- Public event pages should already include signup, not just event details.
- Public signup is open to anyone and does not require authentication.
- A public event only exposes a registration form when the form itself is published.
- The existing internal dashboard event detail and builder pages remain in place; this plan adds a separate public-facing layer rather than replacing them.
- Generic public styling is sufficient for now; CMS-driven images and organizer-managed visuals are explicitly deferred.
