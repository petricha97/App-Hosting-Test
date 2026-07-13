# Event Page Linking Plan

## Summary
Link the existing event model to the event-page prototype in a safe, incremental way.

The goal is to keep the `Event` document lightweight while storing real custom-page builder data in a separate Firestore collection that can support draft and published states.

## Core Approach

### Event document
Use the `Event` document only for page mode and lightweight linking metadata:

- `pageMode: "default" | "custom" | "redirect"`
- `redirectUrl: string`
- `eventPagePath?: "EventPage/<id>"`

This keeps public routing simple:

- `default`: render the current generic public event page
- `custom`: render a linked custom page if one exists and is published
- `redirect`: redirect visitors to `redirectUrl`

### EventPage collection
Create a new Firestore collection:

- `EventPage`

Each document should store the real page-builder data:

- `eventId`
- `organizationId`
- `title`
- `status: "draft" | "published"`
- `draftContent`
- `publishedContent`
- `createdAt`
- `updatedAt`

Optional future fields:

- `seoTitle`
- `seoDescription`
- `assets`

## Recommended Data Model

### Event
```ts
{
  pageMode: "default" | "custom" | "redirect",
  redirectUrl: "",
  eventPagePath: "EventPage/abc123"
}
```

### EventPage
```ts
{
  eventId: "event_123",
  organizationId: "org_123",
  title: "Gym2028 custom page",
  status: "draft",
  draftContent: {
    content: []
  },
  publishedContent: {
    content: []
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

## Linking Behavior

### Default mode
- Do not load `EventPage`
- Use the existing generic public event page

### Redirect mode
- Ignore `EventPage`
- Send public visitors to `redirectUrl`

### Custom mode
- Look up the linked `EventPage`
- In dashboard/editor routes, use `draftContent`
- In public routes, use `publishedContent`
- If the page is missing or unpublished, fall back to the generic event page

## Dashboard Flow

### New route
Add a dedicated event page workspace route:

- `/dashboard/events/[eventId]/page`

### Behavior
- If the event uses `pageMode === "custom"`, the organizer can open the page workspace
- If no `EventPage` exists yet, create one on first open
- The route should mount the current prototype editor core, but save to Firestore instead of `localStorage`

### Actions
- `Save draft`
- `Publish page`
- `Back to event`

### Permissions
Use the same organization-scoped server pattern as the other dashboard event routes:

- verify session
- verify organization scope
- require `write:events`

## Public Event Rendering

### `/events/[eventId]`
When loading a public event:

1. Load the event
2. Check `pageMode`
3. Branch:
   - `default`: render generic event page
   - `redirect`: redirect to `redirectUrl`
   - `custom`: load linked `EventPage.publishedContent`

If `custom` is selected but no published page exists yet:

- fall back to the generic event page

This avoids breaking public access while organizers are still drafting the custom page.

## Firestore / API Work

### Shared types and schema
Add:

- `EventPageDoc` to `src/types/collection.ts`
- Zod schema in `src/features/event-pages/schema.ts`

### Factory-pattern helpers
Add:

- `src/lib/db/eventPage.ts`
- `src/lib/db/adminEventPage.ts`

Helpers should cover:

- create event page
- get by id
- get by event and organization
- update draft content
- publish draft content

### Server routes
Add server-backed routes for:

- create-or-load event page for an event
- save draft page
- publish page

These should use the Admin SDK and organization validation.

## Prototype Reuse Strategy

Do not wire the current prototype route directly into live event data.

Instead:

1. Extract the reusable editor core from the prototype component
2. Keep the prototype route for sandbox testing
3. Reuse the editor core in the real event page workspace
4. Replace `localStorage` persistence with Firestore draft/publish persistence

## First Implementation Slice

### Phase 1
- Add `EventPage` collection support
- Add shared types and schema
- Add admin/client helpers

### Phase 2
- Add `/dashboard/events/[eventId]/page`
- Create `EventPage` on first open when needed
- Save draft content to Firestore

### Phase 3
- Add publish action
- Store `publishedContent`

### Phase 4
- Make public `/events/[eventId]` respect:
  - `default`
  - `custom`
  - `redirect`

## Testing

### Dashboard
- set an event to `custom`
- open `/dashboard/events/[eventId]/page`
- save a draft
- reload and confirm draft persists
- publish the page

### Public
- for `default`, generic event page still renders
- for `redirect`, public route redirects
- for `custom`, published page renders
- if no custom page is published yet, generic page still renders

## Notes
- Keep the event doc small
- Store builder content in `EventPage`, not directly in `Event`
- Use draft vs published content to avoid accidental public edits
- Add Firebase Storage later for image uploads rather than storing asset data in Firestore
