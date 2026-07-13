# Dashboard v1

## Product Direction

Dashboard v1 is a design-first workspace for organizers using Eventa. It should feel like a calm modern SaaS product, not a dense admin console. The initial experience should help users understand what they can do next, create an event quickly, and find core workflows without exposing raw Firestore collection names.

Locked product decisions:

- Landing page is `Overview`.
- Sidebar stays lean and product-oriented.
- Workspace scope is a single active organization for v1.
- Forms are event-scoped for v1.
- Event creation is accessed by a global CTA to `/dashboard/events/new`.
- Visual tone is calm modern SaaS.

## Dashboard Information Architecture

Primary navigation:

- Overview
- Events
- Forms
- Responses
- Settings

Not included in the first sidebar version:

- Invoices
- Promotions
- Roles
- Other operational or raw Firestore collections

The dashboard language should follow product entities, not database collection names.

## Layout and Navigation

The dashboard shell should behave like an application workspace:

- Persistent sidebar on desktop
- Drawer sidebar on mobile and tablet
- Sticky top bar with page context, workspace label, user controls, and global `Create Event` CTA
- Full-width content area designed for work surfaces, not marketing-page centering

The shell should own all `/dashboard/*` routes and provide one consistent visual system for placeholder pages and future real data views.

## Route Map

Protected routes for v1:

- `/dashboard`
- `/dashboard/events`
- `/dashboard/events/new`
- `/dashboard/events/[eventId]`
- `/dashboard/events/[eventId]/form`
- `/dashboard/events/[eventId]/responses`
- `/dashboard/forms`
- `/dashboard/responses`
- `/dashboard/settings`

Intent by route:

- `/dashboard`: overview landing with summary, quick actions, and setup guidance
- `/dashboard/events`: event index and management page
- `/dashboard/events/new`: create-event workspace
- `/dashboard/events/[eventId]`: event overview hub
- `/dashboard/events/[eventId]/form`: event-owned form builder placeholder
- `/dashboard/events/[eventId]/responses`: event-owned response viewer placeholder
- `/dashboard/forms`: aggregate index of forms across events
- `/dashboard/responses`: aggregate index of responses across events
- `/dashboard/settings`: organization and workspace settings placeholder

## Page-by-Page Intent

### Overview

- Show summary cards for draft, published, forms, and responses
- Highlight quick actions
- Help the user continue setup with clear next steps
- Surface empty states gracefully when no live data exists

### Events

- Provide a main destination for browsing and creating events
- Reserve space for search, filters, status chips, and event cards or tables
- Make the empty state push users toward `Create Event`

### Create Event

- Replace the raw test form experience with a dedicated creation workspace
- Organize the page into clear setup sections such as basics, schedule, form, and publish state
- Prioritize layout and flow, not final validation or schema rules

### Event Overview

- Act as the home for one event
- Surface event summary, publish state, linked form, and linked responses
- Provide clear links to the event form builder and response viewer

### Forms

- Present forms as event-owned assets
- Aggregate forms across events at the org level
- Link back to the owning event and event-scoped form builder

### Responses

- Present response data as event-owned submissions
- Aggregate responses across events at the org level
- Link back to event-scoped response views

### Settings

- Reserve space for organization profile and future members or permissions work
- Keep it lightweight for v1

## Data Model Notes

Current repo truth:

- `/dashboard` is currently a protected placeholder page with `EventFormTest`
- Code-backed data helpers exist for `User`, `Organization`, `Event`, and `PromotionTemplate`
- Firestore visibly contains `Form`, `FormData`, `Invoice`, `Roles`, and both `Event` and `Events`
- Schema is not final and may expand later

UI vocabulary should stay decoupled from collection names because the backend structure is still evolving.

Thin dashboard-facing interfaces should exist even if backed by mock content for now:

- `DashboardNavItem`
- `DashboardSummaryCard`
- `EventListItem`
- `FormListItem`
- `ResponseListItem`

## Responsive Behavior

Dashboard v1 is mobile first.

- Start with stacked sections and a drawer-based sidebar
- Promote to a persistent sidebar at desktop
- Avoid early two-column splits that squeeze work surfaces
- Let event creation, form builder, and responses pages expand horizontally on larger screens
- Keep desktop widths focused on usable workspace, not decorative margins

## Empty States and Placeholder Content

Each placeholder page should include:

- A clear title
- A short description
- A primary action
- Product-like cards, panels, or table shells

The initial dashboard should feel intentional even without final data wiring:

- Overview shows summary cards and setup actions
- List pages show filter rows and empty-state messaging
- Builder and response pages show structured workspace canvases

## Acceptance Criteria

- `docs/dashboard-v1-plan.md` exists as the dashboard source-of-truth document
- `/dashboard/*` routes are designed around a shared protected shell
- Navigation and page purpose are documented without open IA decisions
- Every first-version page has a defined empty-state experience and primary action
- The plan clearly separates v1 shell and layout work from later schema and data expansion

## Assumptions

- Single active organization only in v1
- Forms belong to events in v1
- Dashboard v1 is scaffold-first and design-first
- Real data wiring can follow after the shell and placeholder routes are established
- Firestore structure may change, so UI wording should remain product-oriented
